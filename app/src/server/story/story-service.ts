import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONTRACT_VERSION,
  ChapterFrameSchema,
  NARRATIVE_AUDIT_DIMENSIONS,
  NarrativeAuditCandidateSchema,
  NarrativeAuditSchema,
  PlayerActionSchema,
  PROMPT_VERSION,
  type ChapterRecord,
  type Choice,
  type ModelCallTrace,
  type NarrativeAudit,
  type NarrativeAuditCandidate,
  type PlayerAction,
  type TraceEnvelope,
  type ValidationIssue,
  type WorldState,
  buildPovContext,
  getClockPolicy,
  resolveTurn,
  stageWorldDelta,
  validateChapterDraft,
  validateChapterFrameSafety,
  validateSuggestedChoices,
  validateWorldState,
} from "@infinite-litrpg/shared";
import OpenAI from "openai";

import {
  ChapterCostBudget,
  OpenAIRuntimeError,
  PRICING_VERSION,
  ZERO_USAGE,
  addUsage,
  createAuditedNarrationReplay,
  runLunaWorldTick,
  runStructuredResponse,
  type LunaCallSummary,
  type RuntimeAttempt,
  type RuntimeCallResult,
  type RuntimeUsage,
} from "../openai";
import { StaleWorldVersionError, StoryStore } from "../storage/story-store";
import {
  buildAuditPrompt,
  buildChapterFramePrompt,
  buildCustomActionPrompt,
  buildLunaAgentInputs,
  buildLunaCoordinatorInstructions,
  buildNarrationPrompt,
  selectBackgroundActors,
} from "./prompts";

const WORLD_ID = "ashen-crown-v1";

export interface StoryServiceOptions {
  readonly maxBackgroundAgents: number;
  readonly maxCostUsdPerChapter: number;
  readonly nativeMultiAgent: boolean;
  readonly onNarrativeAudit?: (audit: NarrativeAudit) => void;
  readonly onNarrativeDraftRejected?: (issues: readonly ValidationIssue[]) => void;
  readonly onRuntimeAttempt?: (attempt: TraceEnvelope["attempts"][number]) => void;
}

export interface TakeChoiceCommand {
  readonly choiceId: string;
  readonly expectedWorldVersion: number;
  readonly requestId: string;
  readonly type: "take_action";
}

export interface CustomActionCommand {
  readonly description: string;
  readonly expectedWorldVersion: number;
  readonly requestId: string;
  readonly type: "custom_action";
}

export type TurnCommand = TakeChoiceCommand | CustomActionCommand;

export class StoryServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StoryServiceError";
    this.status = status;
  }
}

export class StoryService {
  private turnQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: StoryStore,
    private readonly client: OpenAI,
    private readonly options: StoryServiceOptions,
    private readonly seedLoader: () => WorldState = loadSeedWorld,
  ) {}

  getStory(): StoryView | null {
    const state = this.store.loadWorldState(WORLD_ID);
    return state ? this.toView(state) : null;
  }

  selectPov(povCharacterId: string): StoryView {
    const existing = this.store.loadWorldState(WORLD_ID);
    if (existing) {
      if (existing.lockedPovId !== povCharacterId) {
        throw new StoryServiceError("Viewpoint is permanently locked for this world", 409);
      }
      return this.toView(existing);
    }

    const seed = this.seedLoader();
    if (!seed.characters.some(({ id }) => id === povCharacterId)) {
      throw new StoryServiceError("Unknown viewpoint character");
    }
    seed.lockedPovId = povCharacterId;
    const validated = validateWorldState(seed);
    if (!validated.ok) {
      throw new StoryServiceError(
        `Seed world is invalid: ${JSON.stringify(validated.issues)}`,
        500,
      );
    }
    this.store.createWorld(validated.data);
    return this.toView(validated.data);
  }

  async takeTurn(
    command: TurnCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
  ): Promise<StoryView> {
    let releaseTurn!: () => void;
    const priorTurn = this.turnQueue;
    this.turnQueue = new Promise<void>((resolveTurn) => {
      releaseTurn = resolveTurn;
    });
    await priorTurn;
    try {
      return await this.takeTurnUnlocked(command, onNarrationChunk);
    } finally {
      releaseTurn();
    }
  }

  private async takeTurnUnlocked(
    command: TurnCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
  ): Promise<StoryView> {
    const before = this.store.loadWorldState(WORLD_ID);
    if (!before) throw new StoryServiceError("Select a viewpoint first", 409);
    if (!Number.isSafeInteger(command.expectedWorldVersion) || command.expectedWorldVersion < 1) {
      throw new StoryServiceError("Expected world version is invalid");
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        command.requestId,
      )
    ) {
      throw new StoryServiceError("Request ID must be a UUID");
    }
    const priorChapter = this.store.loadChapterByRequestId(WORLD_ID, command.requestId);
    if (priorChapter) {
      const current = this.store.loadWorldState(WORLD_ID);
      if (!current) throw new StoryServiceError("Committed world disappeared", 500);
      return this.toView(current);
    }
    if (command.expectedWorldVersion !== before.version) {
      throw new StoryServiceError("World changed before this action", 409);
    }
    if (before.terminal) throw new StoryServiceError("This story is terminal", 409);
    if (before.lockedPovId === null) throw new StoryServiceError("Viewpoint is not locked", 409);

    const startedAt = performance.now();
    const budget = new ChapterCostBudget(this.options.maxCostUsdPerChapter);
    const priorFailures = this.store
      .loadFailedTurnTraces(WORLD_ID)
      .filter((trace) => trace.worldVersion === before.version);
    const priorFailedExposureUsd = priorFailures.reduce(
      (sum, trace) => sum + trace.totalEstimatedCostUsd,
      0,
    );
    if (priorFailedExposureUsd > 0) budget.charge(priorFailedExposureUsd);
    const attempts: TraceEnvelope["attempts"] = priorFailures.flatMap((trace) => trace.attempts);
    const currentAttempts: TraceEnvelope["attempts"] = [];
    let attemptPhase: TraceEnvelope["attempts"][number]["phase"] = "intent";
    const policy = {
      budget,
      maxRetries: 2,
      onAttempt: (attempt: RuntimeAttempt) => {
        const tracedAttempt = { ...attempt, phase: attemptPhase };
        attempts.push(tracedAttempt);
        currentAttempts.push(tracedAttempt);
        this.options.onRuntimeAttempt?.(tracedAttempt);
      },
      timeoutMs: 60_000,
    } as const;
    let turnCommitted = false;
    try {
      const calls: ModelCallTrace[] = [];
      let playerAction: PlayerAction;

      if (command.type === "take_action") {
        const choice = this.currentChoices(before).find(({ id }) => id === command.choiceId);
        if (!choice) throw new StoryServiceError("Choice is stale or unknown", 409);
        playerAction = PlayerActionSchema.parse({
          action: choice.action,
          actorId: before.lockedPovId,
          description: choice.description,
          milestoneId: choice.milestoneId,
          source: "suggested",
          stateVersion: before.version,
        });
      } else {
        const description = command.description.trim();
        if (description.length < 1 || description.length > 240) {
          throw new StoryServiceError("Custom action must contain 1 to 240 characters");
        }
        validateCustomActionRequest(before, description);
        const deterministicAction = buildDeterministicCustomAction(before, description);
        if (deterministicAction) {
          playerAction = deterministicAction;
        } else {
          const customCall = await runStructuredResponse(this.client, {
            input: buildCustomActionPrompt(before, description),
            instructions:
              "Convert one player attempt into the strict PlayerAction schema. Preserve explicit action semantics. Output no extra fields.",
            maxOutputTokens: 500,
            model: "gpt-5.6-terra",
            policy,
            reasoningEffort: "none",
            schema: PlayerActionSchema,
            schemaName: "player_action",
            validate: (action) => {
              if (
                action.actorId !== before.lockedPovId ||
                action.stateVersion !== before.version ||
                action.source !== "custom" ||
                action.description !== description
              ) {
                throw new OpenAIRuntimeError(
                  "INVALID_OUTPUT",
                  "Custom action translation changed locked input fields",
                  { retryable: true },
                );
              }
              validateCustomActionTranslation(before, description, action);
            },
          });
          playerAction = customCall.data;
          calls.push(toModelCall(customCall, "gpt-5.6-terra", "intent", null));
        }
      }

      const actors = selectBackgroundActors(before).slice(0, this.options.maxBackgroundAgents);
      let backgroundIntents: Parameters<typeof resolveTurn>[2] = [];
      let adapterMode: TraceEnvelope["adapterMode"] = "sequential";
      let multiAgentOutputItems: Record<string, unknown>[] = [];
      if (actors.length > 0) {
        attemptPhase = "intent";
        const luna = await runLunaWorldTick(this.client, {
          agents: buildLunaAgentInputs(before, actors),
          capabilities: { nativeMultiAgent: this.options.nativeMultiAgent },
          coordinatorInstructions: buildLunaCoordinatorInstructions(actors),
          maxOutputTokens: 700,
          policy,
          reasoningEffort: "none",
          resolverInput: JSON.stringify({
            chapter: before.chapter,
            immutableStateVersion: before.version,
            instruction: "Emit intent only. Never mutate canonical state.",
          }),
          rootAgentName: "/root",
        });
        backgroundIntents = luna.batch.intents;
        adapterMode = luna.mode;
        multiAgentOutputItems = luna.multiAgentOutputItems.map(sanitizeOutputItem);
        calls.push(...luna.calls.map((call) => toLunaModelCall(call)));
      }

      const resolved = resolveTurn(before, playerAction, backgroundIntents);
      if (!resolved.ok) {
        throw new StoryServiceError(`Action rejected: ${formatIssues(resolved.issues)}`, 422);
      }
      const staged = stageWorldDelta(before, resolved.data.intents, resolved.data.delta);
      if (!staged.ok) {
        throw new StoryServiceError(`World delta rejected: ${formatIssues(staged.issues)}`, 422);
      }
      const prospective = staged.data.state;

      const frameCall = await runStructuredResponse(this.client, {
        input: buildChapterFramePrompt(prospective),
        instructions:
          "Return a strict chapter frame: title, terminal flag, and two legal next choices unless terminal.",
        maxOutputTokens: 800,
        model: "gpt-5.6-luna",
        policy,
        reasoningEffort: "none",
        schema: ChapterFrameSchema,
        schemaName: "chapter_frame",
        validate: (frame) => {
          const frameValidation = validateChapterFrameSafety(prospective, frame);
          if (!frameValidation.ok) {
            throw new OpenAIRuntimeError(
              "INVALID_OUTPUT",
              `Frame is unsafe or invalid: ${formatIssues(frameValidation.issues)}`,
              { retryable: true },
            );
          }
        },
      });
      calls.push(toModelCall(frameCall, "gpt-5.6-luna", "intent", null));

      const auditCalls: RuntimeCallResult<NarrativeAudit>[] = [];
      let approvedAudit: NarrativeAudit | null = null;
      let retryDirective: string | null = null;
      const allowedFactIds = new Set(buildPovContext(prospective, before.lockedPovId).factIds);
      const forbiddenFactIds = new Set(
        prospective.facts.filter(({ id }) => !allowedFactIds.has(id)).map(({ id }) => id),
      );
      const narrationBrief = JSON.parse(
        buildNarrationPrompt(before, prospective, playerAction, resolved.data.delta),
      ) as unknown;
      attemptPhase = "narration";
      const narration = await createAuditedNarrationReplay(this.client, {
        audit: async (prose) => {
          const draft = validateChapterDraft(prospective, {
            choices: frameCall.data.choices,
            contractVersion: CONTRACT_VERSION,
            prose,
            terminal: prospective.terminal,
            title: frameCall.data.title,
          });
          if (!draft.ok) {
            this.options.onNarrativeDraftRejected?.(draft.issues);
            const safeIssueCodes = [...new Set(draft.issues.map(({ code }) => code))].sort();
            retryDirective = `The prior draft failed deterministic validation with issue codes: ${safeIssueCodes.join(", ")}. Write 900 to 925 words. Remove every unsupported fact or action. Never repeat prior text that is absent from the supplied POV canon.`;
            return { accepted: false, reason: formatIssues(draft.issues) };
          }
          const proseHash = hashText(prose);
          attemptPhase = "audit";
          let auditCall: RuntimeCallResult<NarrativeAudit>;
          try {
            const candidateCall = await runStructuredResponse(this.client, {
              input: buildAuditPrompt(
                before,
                prospective,
                playerAction,
                resolved.data.delta,
                frameCall.data,
                prose,
              ),
              instructions: "Audit canon. Return schema JSON only.",
              maxOutputTokens: 450,
              model: "gpt-5.6-luna",
              policy,
              reasoningEffort: "none",
              schema: NarrativeAuditCandidateSchema,
              schemaName: "narrative_audit",
              validate: (audit) => {
                canonicalizeNarrativeAuditOutput(audit, proseHash, forbiddenFactIds);
              },
            });
            auditCall = {
              ...candidateCall,
              data: canonicalizeNarrativeAuditOutput(
                candidateCall.data,
                proseHash,
                forbiddenFactIds,
              ),
            };
          } finally {
            attemptPhase = "narration";
          }
          auditCalls.push(auditCall);
          approvedAudit = auditCall.data;
          this.options.onNarrativeAudit?.(approvedAudit);
          if (!approvedAudit.approved) {
            const safeFailures = NARRATIVE_AUDIT_DIMENSIONS.flatMap((dimension, index) =>
              approvedAudit?.scores[dimension] === 0
                ? [`${dimension}: ${approvedAudit.evidence[index]?.issueCode ?? "failed"}`]
                : [],
            );
            if (approvedAudit.leakedFactIds.length > 0) {
              safeFailures.push("povSafety: hidden-knowledge");
            }
            retryDirective = `The prior draft failed fixed rubric checks: ${[...new Set(safeFailures)].join(", ") || "quality"}. Remove unsupported claims, durable facts, and extra actions. Keep only supplied viewpoint canon and canonical effects. Never repeat prior text that is absent from the supplied POV canon.`;
          }
          return {
            accepted: approvedAudit.approved,
            reason: approvedAudit.evidence.map(({ detail }) => detail).join(" "),
          };
        },
        chunkCharacters: 512,
        input: () =>
          JSON.stringify({
            chapterBrief: narrationBrief,
            ...(retryDirective === null ? {} : { retryDirective }),
          }),
        instructions:
          "Write close-third Ashen Crown prose. Obey the supplied canon whitelist exactly.",
        maxOutputTokens: 1_300,
        model: "gpt-5.6-terra",
        policy,
        reasoningEffort: "none",
      });
      calls.push(toModelCall(narration, "gpt-5.6-terra", "narration", null));
      if (auditCalls.length === 0 || approvedAudit === null) {
        throw new StoryServiceError("Narrative audit did not complete", 502);
      }
      calls.push(
        ...auditCalls.map((auditCall) => toModelCall(auditCall, "gpt-5.6-luna", "audit", null)),
      );

      const totalUsage = attempts.reduce<RuntimeUsage>(
        (sum, attempt) => addUsage(sum, attempt.usage),
        ZERO_USAGE,
      );
      const totalLatencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const totalEstimatedCostUsd = attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
      const proseHash = hashText(narration.prose);
      const runId = randomUUID();
      const trace: TraceEnvelope = {
        acceptedDelta: resolved.data.delta,
        adapterMode,
        attempts,
        calls,
        contractVersion: CONTRACT_VERSION,
        fixtureId: before.id,
        fixtureVersion: before.fixtureVersion,
        gateResult: "passed",
        gitSha: currentGitSha(),
        intents: [...resolved.data.intents],
        multiAgentOutputItems,
        pricingVersion: PRICING_VERSION,
        promptVersion: PROMPT_VERSION,
        runId,
        schemaVersion: CONTRACT_VERSION,
        seed: before.chapter,
        stateAfterHash: hashJson(prospective),
        stateBeforeHash: hashJson(before),
        totalEstimatedCostUsd,
        totalLatencyMs,
        totalUsage,
        validationFailures: [],
      };
      const chapter: ChapterRecord = {
        chapter: prospective.chapter,
        choices: frameCall.data.choices,
        estimatedCostUsd: totalEstimatedCostUsd,
        id: `chapter-${String(prospective.chapter).padStart(3, "0")}`,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        narrativeAudit: approvedAudit,
        playerAction,
        povCharacterId: before.lockedPovId,
        prose: narration.prose,
        proseHash,
        requestId: command.requestId,
        safeContextHash: hashJson(buildPovContext(prospective, before.lockedPovId)),
        stateAfterVersion: prospective.version,
        stateBeforeVersion: before.version,
        terminal: prospective.terminal,
        title: frameCall.data.title,
        traceId: runId,
        usage: totalUsage,
      };

      try {
        this.store.commitTurn({ chapter, delta: resolved.data.delta, state: prospective, trace });
        turnCommitted = true;
      } catch (error) {
        if (
          error instanceof StaleWorldVersionError &&
          this.store.loadChapterByRequestId(WORLD_ID, command.requestId)
        ) {
          const current = this.store.loadWorldState(WORLD_ID);
          if (!current) throw new StoryServiceError("Committed world disappeared", 500);
          return this.toView(current);
        }
        throw error;
      }
      if (onNarrationChunk) {
        for await (const chunk of narration.replay) {
          await onNarrationChunk(chunk);
        }
      }
      return this.toView(prospective);
    } catch (error) {
      if (currentAttempts.length > 0 && !turnCommitted) {
        const totalUsage = currentAttempts.reduce<RuntimeUsage>(
          (sum, attempt) => addUsage(sum, attempt.usage),
          ZERO_USAGE,
        );
        this.store.recordFailedTurn({
          attempts: currentAttempts,
          attemptedChapter: before.chapter + 1,
          commandType: command.type,
          contractVersion: CONTRACT_VERSION,
          errorCode: runtimeFailureCode(error),
          fixtureId: before.id,
          fixtureVersion: before.fixtureVersion,
          gateResult: "failed",
          gitSha: currentGitSha(),
          pricingVersion: PRICING_VERSION,
          promptVersion: PROMPT_VERSION,
          requestId: command.requestId,
          runId: randomUUID(),
          schemaVersion: CONTRACT_VERSION,
          stateBeforeHash: hashJson(before),
          totalEstimatedCostUsd: currentAttempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
          totalLatencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          totalUsage,
          worldVersion: before.version,
        });
      }
      throw error;
    }
  }

  exportJson(scope: "reader" | "god" = "reader"): string {
    const world = this.store.loadWorldState(WORLD_ID);
    if (!world) throw new StoryServiceError("No story exists", 404);
    const chapters = this.store.loadChapters(WORLD_ID);
    if (scope === "god") {
      return `${JSON.stringify({ chapters, scope, world }, null, 2)}\n`;
    }
    if (world.lockedPovId === null) throw new StoryServiceError("Viewpoint is not locked", 409);
    return `${JSON.stringify(
      {
        chapters: chapters.map(({ chapter, choices, prose, terminal, title }) => ({
          chapter,
          choices,
          prose,
          terminal,
          title,
        })),
        scope,
        viewpoint: buildPovContext(world, world.lockedPovId),
        world: {
          act: world.act,
          calendar: world.calendar,
          chapter: world.chapter,
          id: world.id,
          terminal: world.terminal,
          terminalReason: world.terminalReason,
          threat: world.threat,
          version: world.version,
        },
      },
      null,
      2,
    )}\n`;
  }

  exportMarkdown(): string {
    const world = this.store.loadWorldState(WORLD_ID);
    if (!world) throw new StoryServiceError("No story exists", 404);
    const chapters = this.store.loadChapters(WORLD_ID);
    return [
      "# Ashen Crown",
      "",
      `Locked viewpoint: ${world.lockedPovId ?? "none"}`,
      `Chapters: ${world.chapter} of 350`,
      "",
      ...chapters.flatMap((chapter) => [
        `## Chapter ${chapter.chapter}: ${chapter.title}`,
        "",
        chapter.prose,
        "",
      ]),
    ].join("\n");
  }

  private currentChoices(state: WorldState): readonly Choice[] {
    if (state.terminal) return [];
    if (state.chapter === 0) return initialChoices(state);
    return this.store.loadChapter(state.id, state.chapter)?.choices ?? [];
  }

  private toView(state: WorldState): StoryView {
    if (state.lockedPovId === null) throw new StoryServiceError("Viewpoint is not locked", 500);
    const pov = state.characters.find(({ id }) => id === state.lockedPovId);
    if (!pov) throw new StoryServiceError("Locked viewpoint is missing", 500);
    const latestChapter =
      state.chapter > 0 ? this.store.loadChapter(state.id, state.chapter) : null;
    const trace = latestChapter ? this.store.loadTrace(latestChapter.traceId) : null;
    const context = buildPovContext(state, state.lockedPovId);
    const locationNames = new Map(state.locations.map(({ id, name }) => [id, name]));
    const characterNames = new Map(state.characters.map(({ id, name }) => [id, name]));
    const initial = state.chapter === 0 ? initialChoices(state) : [];
    const usage = latestChapter?.usage ?? ZERO_USAGE;

    return {
      adapterMode: trace?.adapterMode ?? "sequential",
      chapter: latestChapter
        ? {
            choices: latestChapter.choices,
            prose: latestChapter.prose,
            title: latestChapter.title,
          }
        : {
            choices: initial,
            prose: "Ash hangs over a world already in motion. Choose the first attempt.",
            title: "Before the First Step",
          },
      estimatedCostUsd: latestChapter?.estimatedCostUsd ?? 0,
      godMode: {
        acceptedIntentIds: trace?.acceptedDelta.acceptedIntentIds ?? [],
        audit: latestChapter?.narrativeAudit ?? null,
        calls: trace?.calls ?? [],
        delta: trace?.acceptedDelta ?? null,
        gateResult: trace?.gateResult ?? "not-run",
        intents:
          trace?.intents.map((intent) => ({
            ...intent,
            accepted: trace.acceptedDelta.acceptedIntentIds.includes(intent.id),
            actorName: characterNames.get(intent.actorId) ?? intent.actorId,
            phase: "Resolution",
          })) ?? [],
        promptVersion: trace?.promptVersion ?? PROMPT_VERSION,
        rejected: trace?.acceptedDelta.rejectedIntents ?? [],
        schemaVersion: trace?.schemaVersion ?? CONTRACT_VERSION,
        stateAfterHash: trace?.stateAfterHash ?? "",
        stateBeforeHash: trace?.stateBeforeHash ?? "",
      },
      latencyMs: latestChapter?.latencyMs ?? 0,
      pov: {
        ...pov,
        characterClass: pov.characterClassName,
        experienceToNextLevel: pov.level * 100,
        inventory: pov.inventory.map((item) => ({ ...item, id: item.itemId })),
        location: locationNames.get(pov.locationId) ?? pov.locationId,
        relationships: pov.relationships.map((relationship) => ({
          ...relationship,
          id: relationship.characterId,
          name: characterNames.get(relationship.characterId) ?? relationship.characterId,
        })),
      },
      progress: state.chapter / 350,
      usage,
      visibleEvents: context.observedEvents.map((event) => ({
        id: event.id,
        location: locationNames.get(event.locationId) ?? event.locationId,
        summary: event.summary,
      })),
      world: {
        act: state.act,
        calendar: state.calendar,
        chapter: state.chapter,
        id: state.id,
        terminal: state.terminal,
        terminalReason: state.terminalReason,
        threat: state.threat,
        version: state.version,
      },
    };
  }
}

export interface StoryView {
  readonly adapterMode: string;
  readonly chapter: {
    readonly choices: readonly Choice[];
    readonly prose: string;
    readonly title: string;
  };
  readonly estimatedCostUsd: number;
  readonly godMode: Readonly<Record<string, unknown>>;
  readonly latencyMs: number;
  readonly pov: Readonly<Record<string, unknown>>;
  readonly progress: number;
  readonly usage: RuntimeUsage;
  readonly visibleEvents: readonly {
    readonly id: string;
    readonly location: string;
    readonly summary: string;
  }[];
  readonly world: Readonly<Record<string, unknown>>;
}

function loadSeedWorld(): WorldState {
  const path = resolve(workspaceRoot(), "evals", "fixtures", "demon-king-world.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const result = validateWorldState(raw);
  if (!result.ok) throw new Error(`Seed fixture invalid: ${JSON.stringify(result.issues)}`);
  return structuredClone(result.data);
}

function initialChoices(state: WorldState): readonly Choice[] {
  if (state.lockedPovId === null) return [];
  const actor = state.characters.find(({ id }) => id === state.lockedPovId);
  if (!actor) return [];
  const location = state.locations.find(({ id }) => id === actor.locationId);
  const destinationId = location?.adjacentLocationIds[0];
  const skill = actor.skills.find(
    ({ manaCost, minimumLevel, prerequisiteSkillIds, requiredClassId }) =>
      actor.level >= minimumLevel &&
      actor.mana.current >= manaCost &&
      actor.characterClassId === requiredClassId &&
      prerequisiteSkillIds.every((id) => actor.skills.some((known) => known.id === id)),
  );
  const first: Choice = destinationId
    ? {
        action: { destinationId, type: "move" },
        description: `Travel toward ${locationNames(state).get(destinationId) ?? destinationId}.`,
        id: "choice-1",
        milestoneId: null,
      }
    : {
        action: { subjectId: actor.locationId, type: "investigate" },
        description: "Investigate the immediate danger.",
        id: "choice-1",
        milestoneId: null,
      };
  const second: Choice = skill
    ? {
        action: { skillId: skill.id, targetId: null, type: "use_skill" },
        description: `Use ${skill.name} to read the situation.`,
        id: "choice-2",
        milestoneId: null,
      }
    : {
        action: { subjectId: actor.locationId, type: "investigate" },
        description: "Study the nearby signs before moving.",
        id: "choice-2",
        milestoneId: null,
      };
  const validation = validateSuggestedChoices(state, [first, second]);
  if (!validation.ok) {
    throw new StoryServiceError(
      `Initial choices are invalid: ${formatIssues(validation.issues)}`,
      500,
    );
  }
  return validation.data;
}

function toModelCall(
  call: Pick<
    RuntimeCallResult<unknown>,
    "estimatedCostUsd" | "latencyMs" | "responseId" | "retries" | "usage"
  >,
  model: ModelCallTrace["model"],
  phase: ModelCallTrace["phase"],
  agentId: string | null,
): ModelCallTrace {
  return {
    agentId,
    errorCode: null,
    estimatedCostUsd: call.estimatedCostUsd,
    latencyMs: call.latencyMs,
    model,
    phase,
    reasoningEffort: "none",
    refusal: false,
    responseId: call.responseId,
    retries: call.retries,
    timedOut: false,
    usage: call.usage,
  };
}

function toLunaModelCall(call: LunaCallSummary): ModelCallTrace {
  return toModelCall(call, "gpt-5.6-luna", "intent", call.agentId);
}

function sanitizeOutputItem(item: unknown): Record<string, unknown> {
  const parsed = JSON.parse(JSON.stringify(item)) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : { value: parsed };
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function currentGitSha(): string {
  const configured = process.env.GIT_SHA;
  if (configured && /^[a-f0-9]{7,40}$/u.test(configured)) return configured;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot(),
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    }).trim();
  } catch {
    return "0000000";
  }
}

function workspaceRoot(): string {
  return process.cwd().replace(/[\\/]app$/u, "");
}

function formatIssues(
  issues: readonly { readonly code: string; readonly message: string }[],
): string {
  return issues.map(({ code, message }) => `${code}: ${message}`).join("; ");
}

function locationNames(state: WorldState): Map<string, string> {
  return new Map(state.locations.map(({ id, name }) => [id, name]));
}

export function validateNarrativeAuditOutput(
  audit: NarrativeAudit,
  proseHash: string,
  forbiddenFactIds: ReadonlySet<string>,
): void {
  if (audit.proseHash !== proseHash) {
    throw invalidAudit("Audit prose hash mismatch");
  }
  const inventedLeakId = audit.leakedFactIds.find((id) => !forbiddenFactIds.has(id));
  if (inventedLeakId) {
    throw invalidAudit(`Audit invented leaked fact ID ${inventedLeakId}`);
  }
  const shouldApprove =
    NARRATIVE_AUDIT_DIMENSIONS.every((dimension) => audit.scores[dimension] >= 1) &&
    audit.leakedFactIds.length === 0;
  if (audit.approved !== shouldApprove) {
    throw invalidAudit("Audit approval disagrees with its scores or leaked facts");
  }
  const zeroIssueCodes: Readonly<
    Record<(typeof NARRATIVE_AUDIT_DIMENSIONS)[number], ReadonlySet<string>>
  > = {
    arcProgress: new Set(["arc-stalled", "unsupported-canon"]),
    characterAutonomy: new Set(["autonomy-violation", "unsupported-canon"]),
    choiceFulfillment: new Set(["choice-not-fulfilled", "unsupported-canon"]),
    continuity: new Set(["contradiction", "unsupported-canon"]),
    litrpgMechanics: new Set(["mechanics-mismatch", "unsupported-canon"]),
    povSafety: new Set(["hidden-knowledge", "unsupported-canon"]),
    prose: new Set(["prose-quality"]),
  };
  for (const [index, dimension] of NARRATIVE_AUDIT_DIMENSIONS.entries()) {
    const evidence = audit.evidence[index];
    if (!evidence || evidence.dimension !== dimension) {
      throw invalidAudit(`Audit evidence for ${dimension} is out of order`);
    }
    if (audit.scores[dimension] > 0 && evidence.issueCode !== "pass") {
      throw invalidAudit(`Audit positive score for ${dimension} must use pass`);
    }
    if (audit.scores[dimension] === 0 && !zeroIssueCodes[dimension].has(evidence.issueCode)) {
      throw invalidAudit(`Audit zero for ${dimension} has an invalid issue code`);
    }
  }
}

export function canonicalizeNarrativeAuditOutput(
  audit: NarrativeAuditCandidate,
  proseHash: string,
  forbiddenFactIds: ReadonlySet<string>,
): NarrativeAudit {
  const scores: NarrativeAudit["scores"] = {
    arcProgress: audit.scores[5]!,
    characterAutonomy: audit.scores[1]!,
    choiceFulfillment: audit.scores[0]!,
    continuity: audit.scores[4]!,
    litrpgMechanics: audit.scores[3]!,
    povSafety: audit.scores[2]!,
    prose: audit.scores[6]!,
  };
  const zeroIssueCodes = {
    arcProgress: "arc-stalled",
    characterAutonomy: "autonomy-violation",
    choiceFulfillment: "choice-not-fulfilled",
    continuity: "unsupported-canon",
    litrpgMechanics: "mechanics-mismatch",
    povSafety: "hidden-knowledge",
    prose: "prose-quality",
  } as const;
  const evidence = NARRATIVE_AUDIT_DIMENSIONS.map((dimension, index) => ({
    detail: audit.evidence[index],
    dimension,
    issueCode: scores[dimension] > 0 ? ("pass" as const) : zeroIssueCodes[dimension],
  }));
  const canonical = NarrativeAuditSchema.parse({
    evidence,
    leakedFactIds: audit.leakedFactIds,
    approved:
      NARRATIVE_AUDIT_DIMENSIONS.every((dimension) => scores[dimension] >= 1) &&
      audit.leakedFactIds.length === 0,
    proseHash,
    scores,
  });
  validateNarrativeAuditOutput(canonical, proseHash, forbiddenFactIds);
  return canonical;
}

export function validateCustomActionTranslation(
  state: WorldState,
  description: string,
  action: PlayerAction,
): void {
  const explicitlyInvestigates = explicitlyRequestsInvestigation(description);
  if (explicitlyInvestigates && action.action.type !== "investigate") {
    throw new OpenAIRuntimeError(
      "INVALID_OUTPUT",
      "Custom action translation replaced an explicit investigation",
      { retryable: true },
    );
  }
  const requestsImmediateArea = requestsImmediateAreaInvestigation(description);
  const pov = state.characters.find(({ id }) => id === state.lockedPovId);
  if (
    explicitlyInvestigates &&
    requestsImmediateArea &&
    action.action.type === "investigate" &&
    action.action.subjectId !== pov?.locationId
  ) {
    throw new OpenAIRuntimeError(
      "INVALID_OUTPUT",
      "Custom immediate-area investigation did not target the POV location",
      { retryable: true },
    );
  }
  const translated = resolveTurn(state, action, []);
  if (!translated.ok) {
    throw new OpenAIRuntimeError(
      "INVALID_OUTPUT",
      `Custom action translation is illegal: ${formatIssues(translated.issues)}`,
      { retryable: true },
    );
  }
}

function validateCustomActionRequest(state: WorldState, description: string): void {
  if (!explicitlyRequestsInvestigation(description)) return;
  const policy = getClockPolicy(state.chapter);
  const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  if (
    policy.choicesRequireMilestone &&
    milestone &&
    (!milestone.compatibleActionTypes.includes("investigate") ||
      (!milestone.completed && requestsImmediateAreaInvestigation(description)))
  ) {
    throw new StoryServiceError(
      "This investigation cannot advance the required act milestone",
      422,
    );
  }
}

function buildDeterministicCustomAction(
  state: WorldState,
  description: string,
): PlayerAction | null {
  if (!isSimpleLocalInvestigation(description)) {
    return null;
  }
  const pov = state.characters.find(({ id }) => id === state.lockedPovId);
  if (!pov || state.lockedPovId === null) return null;
  const policy = getClockPolicy(state.chapter);
  const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  const action = PlayerActionSchema.parse({
    action: { subjectId: pov.locationId, type: "investigate" },
    actorId: state.lockedPovId,
    description,
    milestoneId: policy.choicesRequireMilestone ? (milestone?.id ?? null) : null,
    source: "custom",
    stateVersion: state.version,
  });
  validateCustomActionTranslation(state, description, action);
  return action;
}

function isSimpleLocalInvestigation(description: string): boolean {
  if (
    !explicitlyRequestsInvestigation(description) ||
    !requestsImmediateAreaInvestigation(description)
  ) {
    return false;
  }
  const command = description.trim().replace(/[.!?]+$/u, "");
  return !(
    /[,.:;!?]/u.test(command) ||
    /\b(?:and|or|then|before|after|while|if|unless|but|instead|rather|otherwise|not|never|cannot)\b|\b(?:do|does|did)\s+not\b|\b(?:don't|doesn't|didn't|can't)\b/iu.test(
      command,
    )
  );
}

function explicitlyRequestsInvestigation(description: string): boolean {
  const startsWithInvestigation =
    /^\s*(?:please\s+)?(?:investigat(?:e|es|ed|ing)|inspect(?:s|ed|ing)?|examin(?:e|es|ed|ing)|search(?:es|ed|ing)?|scan(?:s|ned|ning)?|look(?:s|ed|ing)?\s+(?:around|for|into|over))\b/iu.test(
      description,
    );
  const cancelsForWait =
    /\bno\s*,?\s*(?:just\s+)?wait\b|\b(?:instead|rather)\b[^.?!;]*\bwait\b/iu.test(description);
  return startsWithInvestigation && !cancelsForWait;
}

function requestsImmediateAreaInvestigation(description: string): boolean {
  return /\b(?:immediate|nearby|local)\s+area\b|\bsurroundings\b|\blocal\s+tracks\b/iu.test(
    description,
  );
}

function invalidAudit(message: string): OpenAIRuntimeError {
  return new OpenAIRuntimeError("INVALID_OUTPUT", message, { retryable: true });
}

function runtimeFailureCode(error: unknown): string {
  if (error instanceof OpenAIRuntimeError) return error.code;
  if (error instanceof Error && error.name.length > 0) return error.name.slice(0, 240);
  return "UNKNOWN_RUNTIME_ERROR";
}
