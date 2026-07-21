import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  CONTRACT_VERSION,
  DEMO_CHAPTER_LIMIT,
  ChapterFrameModelCandidateSchema,
  ChapterFrameSchema,
  NARRATIVE_AUDIT_DIMENSIONS,
  NarrativeAuditCandidateSchema,
  NarrativeAuditSchema,
  PlayerActionSchema,
  PROMPT_VERSION,
  RUNTIME_SCHEMA_VERSION,
  WorldDeltaSchema,
  WorldIntentSchema,
  type ChapterFrame,
  type ChapterRecord,
  type Choice,
  type ModelCallTrace,
  type NarrativeAudit,
  type NarrativeAuditCandidate,
  type PersistedTraceEnvelope,
  type PlayerAction,
  type TraceEnvelope,
  type RuntimeServiceTier,
  type StorySetup,
  type StoryGenesisRecordV1,
  type ValidationIssue,
  type WorldDelta,
  type WorldState,
  buildChapterChoiceOptions,
  buildPovContext,
  buildTenChapterQualityPlan,
  canonicalizeChapterFrameCandidate,
  decodeChapterFrameModelCandidate,
  getClockPolicy,
  planRoutineContinuation,
  prioritizeSceneMovementOptionIds,
  resolveTurn,
  stageWorldDelta,
  validateChapterDraft,
  validateNarrativeQuality,
  validateNarrativeStateClaims,
  validateSuggestedChoices,
  validateTitleNovelty,
  validateWorldState,
} from "@infinite-litrpg/shared";
import OpenAI from "openai";

import {
  ChapterCostBudget,
  OpenAIRuntimeError,
  ZERO_USAGE,
  addUsage,
  createAuditedNarrationReplay,
  runLunaWorldTick,
  runStructuredResponse,
  type LunaCallSummary,
  type RuntimeAttempt,
  type RuntimeCallResult,
  type RuntimeCostHooks,
  type RuntimeModel,
  type RuntimePolicy,
  type RuntimeReasoningEffort,
  type RuntimeUsage,
  type NarrationRawCandidateContext,
  pricingVersionForServiceTier,
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
  type BackgroundStoryHistoryEntry,
  type StoryHistoryEntry,
  type StoryPromptPreferences,
} from "./prompts";
import { sanitizeReaderProse } from "./reader-safety";

const WORLD_ID = "ashen-crown-v1";

export interface StoryModelConfig {
  readonly audit: {
    readonly model: RuntimeModel;
    readonly reasoningEffort: Extract<RuntimeReasoningEffort, "low" | "none">;
  };
  readonly frame: {
    readonly model: RuntimeModel;
    readonly reasoningEffort: RuntimeReasoningEffort;
  };
  readonly narration: {
    readonly model: RuntimeModel;
    readonly reasoningEffort: RuntimeReasoningEffort;
  };
}

export const STORY_MODELS: StoryModelConfig = Object.freeze({
  audit: Object.freeze({ model: "gpt-5.6-terra", reasoningEffort: "low" }),
  frame: Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "medium" }),
  narration: Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "medium" }),
});

export interface NarrativeTurnIdentity {
  readonly chapter: number;
  readonly povId: string;
  readonly requestId: string;
  readonly turnId: string;
  readonly worldVersionAfter: number;
  readonly worldVersionBefore: number;
}

interface NarrativeRecoveryEvidence {
  readonly accepted: boolean;
  readonly attempt: number;
  readonly maximumAdditionalWords: number;
  readonly minimumAdditionalWords: number;
  readonly prose: string;
  readonly rejectionReason: string | null;
  readonly responseId: string;
  readonly wordCount: number;
}

interface NarrativeResponseEvidence {
  readonly attempt: number;
  readonly bufferedOutputText: string;
  readonly chapter: number;
  readonly phase: "audit" | "narration" | "recovery";
  readonly povId: string;
  readonly rawOutputText: string;
  readonly responseId: string;
  readonly sourceGitSha: string;
  readonly status: NarrationRawCandidateContext["status"];
  readonly turn: NarrativeTurnIdentity;
  readonly worldVersionAfter: number;
  readonly worldVersionBefore: number;
}

interface NarrativeAuditAttemptEvidence {
  readonly attempt: number;
  readonly candidate: NarrativeAuditCandidate | null;
  readonly rawOutputText: string;
  readonly responseId: string;
  readonly status: NarrationRawCandidateContext["status"];
}

export interface NarrativeCandidateEvidence {
  readonly accepted: boolean;
  readonly adapterMode: TraceEnvelope["adapterMode"];
  readonly allowedFactIds: readonly string[];
  readonly audit: NarrativeAudit | null;
  readonly auditAttempts: readonly NarrativeAuditAttemptEvidence[];
  readonly auditResponseId: string | null;
  readonly backgroundIntents: TraceEnvelope["intents"];
  readonly chapter: number;
  readonly delta: WorldDelta;
  readonly deterministicIssues: readonly ValidationIssue[];
  readonly forbiddenFacts: readonly { readonly claim: string; readonly id: string }[];
  readonly frame: ChapterFrame;
  readonly mergedProse: string;
  readonly mergedWordCount: number;
  readonly multiAgentOutputItems: TraceEnvelope["multiAgentOutputItems"];
  readonly narratorAttempt: number;
  readonly narratorResponseId: string;
  readonly playerAction: PlayerAction;
  readonly povId: string;
  readonly promptVersion: typeof PROMPT_VERSION;
  readonly rawProse: string;
  readonly rawWordCount: number;
  readonly recovery: NarrativeRecoveryEvidence | null;
  readonly rejectionStage: "accepted" | "audit" | "audit-invalid" | "deterministic" | "recovery";
  readonly schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  readonly sourceGitSha: string;
  readonly stateAfter: WorldState;
  readonly stateBefore: WorldState;
  readonly turn: NarrativeTurnIdentity;
  readonly worldVersionAfter: number;
  readonly worldVersionBefore: number;
}

type NarrativeCandidateOutcome = Pick<
  NarrativeCandidateEvidence,
  | "accepted"
  | "audit"
  | "auditAttempts"
  | "auditResponseId"
  | "deterministicIssues"
  | "mergedProse"
  | "mergedWordCount"
  | "narratorAttempt"
  | "narratorResponseId"
  | "rawProse"
  | "rawWordCount"
  | "recovery"
  | "rejectionStage"
>;

export interface StoryServiceOptions {
  readonly auditReasoningEffort?: Extract<RuntimeReasoningEffort, "low" | "none">;
  readonly canonicalNarrationDirective?: string;
  readonly costHooks?: RuntimeCostHooks;
  readonly enforceNarrativeQuality?: boolean;
  readonly maxBackgroundAgents: number;
  readonly maxCostUsdPerChapter: number | null;
  readonly modelConfig?: StoryModelConfig;
  readonly nativeMultiAgent: boolean;
  readonly onNarrativeAudit?: (audit: NarrativeAudit) => void;
  readonly onNarrativeCandidate?: (candidate: NarrativeCandidateEvidence) => void;
  readonly onNarrativeResponse?: (response: NarrativeResponseEvidence) => void;
  readonly onNarrativeDraftRejected?: (issues: readonly ValidationIssue[]) => void;
  readonly onRuntimeAttempt?: (
    attempt: TraceEnvelope["attempts"][number],
    turn: NarrativeTurnIdentity,
  ) => void;
  readonly promptCacheKey?: string;
  readonly serviceTier?: RuntimeServiceTier;
  readonly storyTitle?: string;
  readonly timeoutMs?: number;
}

export interface CanonicalNarrationSource {
  readonly adapterMode: TraceEnvelope["adapterMode"];
  readonly delta: WorldDelta;
  readonly frame: ChapterFrame;
  readonly intents: readonly TraceEnvelope["intents"][number][];
  readonly multiAgentOutputItems: readonly TraceEnvelope["multiAgentOutputItems"][number][];
  readonly playerAction: PlayerAction;
  readonly stateAfter: WorldState;
  readonly stateBefore: WorldState;
}

export interface CanonicalRenarrationResult {
  readonly chapter: ChapterRecord;
  readonly streamChunks: readonly string[];
  readonly trace: TraceEnvelope;
}

interface TakeChoiceCommand {
  readonly choiceId: string;
  readonly expectedWorldVersion: number;
  readonly requestId: string;
  readonly type: "take_action";
}

interface CustomActionCommand {
  readonly description: string;
  readonly expectedWorldVersion: number;
  readonly requestId: string;
  readonly type: "custom_action";
}

interface ContinueStoryCommand {
  readonly approvedThroughChapter: number;
  readonly expectedWorldVersion: number;
  readonly requestId: string;
  readonly type: "continue_story";
}

export interface RerollLatestCommand {
  readonly expectedWorldVersion: number;
  readonly requestId: string;
}

export type TurnCommand = TakeChoiceCommand | CustomActionCommand | ContinueStoryCommand;
export type StoryGenerationPhase =
  "world" | "world-checking" | "preparing" | "characters" | "writing" | "checking" | "saving";

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

  getReaderChapter(chapterNumber: number): ReaderChapterView {
    const state = this.store.loadWorldState(WORLD_ID);
    if (!state || state.lockedPovId === null) {
      throw new StoryServiceError("No locked story exists", 404);
    }
    if (
      !Number.isSafeInteger(chapterNumber) ||
      chapterNumber < 1 ||
      chapterNumber > state.chapter
    ) {
      throw new StoryServiceError("Chapter is outside the saved story", 404);
    }
    const chapter = this.store.loadChapter(state.id, chapterNumber);
    if (!chapter || chapter.povCharacterId !== state.lockedPovId) {
      throw new StoryServiceError("Chapter is not available to this viewpoint", 404);
    }
    return {
      chapter: chapter.chapter,
      prose: sanitizeReaderProse(chapter.prose),
      title: chapter.title,
    };
  }

  selectPov(povCharacterId: string, setup?: StorySetup): StoryView {
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
    this.store.createWorld(validated.data, setup);
    return this.toView(validated.data);
  }

  initializeGenesis(genesis: StoryGenesisRecordV1): StoryView {
    const existing = this.store.loadWorldState(WORLD_ID);
    if (existing) return this.toView(existing);
    this.store.createWorld(genesis.initialWorld, genesis.setup, genesis);
    return this.toView(genesis.initialWorld);
  }

  async takeTurn(
    command: TurnCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
    onProgress?: (phase: StoryGenerationPhase) => void,
  ): Promise<StoryView> {
    let releaseTurn!: () => void;
    const priorTurn = this.turnQueue;
    this.turnQueue = new Promise<void>((resolveTurn) => {
      releaseTurn = resolveTurn;
    });
    await priorTurn;
    try {
      return await this.takeTurnUnlocked(command, onNarrationChunk, onProgress);
    } finally {
      releaseTurn();
    }
  }

  async rerollLatest(
    command: RerollLatestCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
    onProgress?: (phase: StoryGenerationPhase) => void,
  ): Promise<StoryView> {
    let releaseTurn!: () => void;
    const priorTurn = this.turnQueue;
    this.turnQueue = new Promise<void>((resolveTurn) => {
      releaseTurn = resolveTurn;
    });
    await priorTurn;
    try {
      onProgress?.("writing");
      return await this.rerollLatestUnlocked(command, onNarrationChunk);
    } finally {
      releaseTurn();
    }
  }

  async renarrateCanonicalTurn(
    source: CanonicalNarrationSource,
    requestId: string,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
  ): Promise<CanonicalRenarrationResult> {
    const canonical = parseCanonicalNarrationSource(source);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)
    ) {
      throw new StoryServiceError("Request ID must be a UUID");
    }
    const startedAt = performance.now();
    const turnId = randomUUID();
    const turnIdentity: NarrativeTurnIdentity = {
      chapter: canonical.stateAfter.chapter,
      povId: canonical.stateBefore.lockedPovId!,
      requestId,
      turnId,
      worldVersionAfter: canonical.stateAfter.version,
      worldVersionBefore: canonical.stateBefore.version,
    };
    const budget = new ChapterCostBudget(this.options.maxCostUsdPerChapter);
    const serviceTier = this.options.serviceTier ?? "standard";
    const modelConfig = this.options.modelConfig ?? STORY_MODELS;
    const promptCache =
      this.options.promptCacheKey === undefined
        ? {}
        : { promptCacheKey: this.options.promptCacheKey };
    const storyHistory = loadStoryHistory(this.store, canonical.stateAfter.chapter);
    const promptPreferences: StoryPromptPreferences = {
      setup: this.store.loadStorySetup(WORLD_ID),
      ...(this.options.storyTitle === undefined ? {} : { title: this.options.storyTitle }),
    };
    const pricingVersion = pricingVersionForServiceTier(serviceTier);
    const attempts: TraceEnvelope["attempts"] = [];
    let attemptPhase: TraceEnvelope["attempts"][number]["phase"] = "narration";
    const policy: RuntimePolicy = {
      budget,
      ...(this.options.costHooks === undefined ? {} : { costHooks: this.options.costHooks }),
      maxRetries: 2,
      onAttempt: (attempt) => {
        const tracedAttempt = { ...attempt, phase: attemptPhase };
        attempts.push(tracedAttempt);
        this.options.onRuntimeAttempt?.(tracedAttempt, turnIdentity);
      },
      serviceTier,
      timeoutMs: this.options.timeoutMs ?? 60_000,
    };
    const narration = await generateAuditedCanonicalNarration(this.client, canonical, {
      auditModel: modelConfig.audit.model,
      auditReasoningEffort: this.options.auditReasoningEffort ?? modelConfig.audit.reasoningEffort,
      enforceNarrativeQuality: this.options.enforceNarrativeQuality ?? false,
      history: storyHistory,
      initialNarrationDirective: this.options.canonicalNarrationDirective ?? null,
      narrationModel: modelConfig.narration.model,
      narrationReasoningEffort: modelConfig.narration.reasoningEffort,
      onNarrativeAudit: this.options.onNarrativeAudit,
      onNarrativeCandidate: this.options.onNarrativeCandidate,
      onNarrativeDraftRejected: this.options.onNarrativeDraftRejected,
      onNarrativeResponse: this.options.onNarrativeResponse,
      policy,
      promptPreferences,
      ...promptCache,
      setAttemptPhase: (phase) => {
        attemptPhase = phase;
      },
      turn: turnIdentity,
    });
    const totalUsage = attempts.reduce<RuntimeUsage>(
      (sum, attempt) => addUsage(sum, attempt.usage),
      ZERO_USAGE,
    );
    const totalEstimatedCostUsd = attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
    const totalLatencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const trace: TraceEnvelope = {
      acceptedDelta: canonical.delta,
      adapterMode: canonical.adapterMode,
      attempts,
      calls: [...narration.calls],
      contractVersion: CONTRACT_VERSION,
      fixtureId: canonical.stateBefore.id,
      fixtureVersion: canonical.stateBefore.fixtureVersion,
      gateResult: "passed",
      gitSha: currentGitSha(),
      intents: [...canonical.intents],
      multiAgentOutputItems: [...canonical.multiAgentOutputItems],
      pricingVersion,
      promptVersion: PROMPT_VERSION,
      runId: turnId,
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      seed: canonical.stateBefore.chapter,
      stateAfterHash: hashJson(canonical.stateAfter),
      stateBeforeHash: hashJson(canonical.stateBefore),
      totalEstimatedCostUsd,
      totalLatencyMs,
      totalUsage,
      validationFailures: [],
    };
    const chapter: ChapterRecord = {
      chapter: canonical.stateAfter.chapter,
      choices: canonical.frame.choices,
      estimatedCostUsd: totalEstimatedCostUsd,
      id: `chapter-${String(canonical.stateAfter.chapter).padStart(3, "0")}`,
      latencyMs: totalLatencyMs,
      narrativeAudit: narration.audit,
      playerAction: canonical.playerAction,
      povCharacterId: canonical.stateBefore.lockedPovId!,
      prose: narration.prose,
      proseHash: hashText(narration.prose),
      requestId,
      safeContextHash: hashJson(
        buildPovContext(canonical.stateAfter, canonical.stateBefore.lockedPovId!),
      ),
      stateAfterVersion: canonical.stateAfter.version,
      stateBeforeVersion: canonical.stateBefore.version,
      terminal: canonical.stateAfter.terminal,
      title: canonical.frame.title,
      traceId: turnId,
      usage: totalUsage,
    };
    const streamChunks: string[] = [];
    for await (const chunk of narration.replay) {
      streamChunks.push(chunk);
      await onNarrationChunk?.(chunk);
    }
    return { chapter, streamChunks, trace };
  }

  private async rerollLatestUnlocked(
    command: RerollLatestCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
  ): Promise<StoryView> {
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
    const world = this.store.loadWorldState(WORLD_ID);
    if (!world || world.lockedPovId === null) {
      throw new StoryServiceError("No locked story exists", 404);
    }
    const priorRequest = this.store.loadChapterByRequestId(WORLD_ID, command.requestId);
    if (priorRequest) return this.toView(world);
    if (world.version !== command.expectedWorldVersion) {
      throw new StoryServiceError("World changed before this rewrite", 409);
    }
    if (world.chapter < 1) throw new StoryServiceError("No chapter exists to rewrite", 409);

    const currentChapter = this.store.loadChapter(WORLD_ID, world.chapter);
    if (!currentChapter) throw new StoryServiceError("Latest chapter is missing", 500);
    const currentTrace = this.store.loadTrace(currentChapter.traceId);
    if (!currentTrace) throw new StoryServiceError("Latest chapter trace is missing", 500);
    const canonical = reconstructLatestCanonicalTurn(
      this.store,
      this.seedLoader,
      world,
      currentChapter,
      currentTrace,
    );
    const replacement = await this.renarrateCanonicalTurn(canonical, command.requestId);
    this.store.replaceLatestChapterNarration({
      chapter: replacement.chapter,
      expectedPriorProseHash: currentChapter.proseHash,
      expectedPriorTraceId: currentChapter.traceId,
      expectedWorldVersion: world.version,
      trace: replacement.trace,
      worldId: WORLD_ID,
    });
    for (const chunk of replacement.streamChunks) await onNarrationChunk?.(chunk);
    const unchangedWorld = this.store.loadWorldState(WORLD_ID);
    if (!unchangedWorld) throw new StoryServiceError("Rewritten world disappeared", 500);
    return this.toView(unchangedWorld);
  }

  private async takeTurnUnlocked(
    command: TurnCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
    onProgress?: (phase: StoryGenerationPhase) => void,
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
    if (command.type === "continue_story") {
      const plan = this.continuationPlanFor(before);
      if (!plan) {
        throw new StoryServiceError(
          before.chapter >= DEMO_CHAPTER_LIMIT
            ? `Automatic demo continuation stops at chapter ${DEMO_CHAPTER_LIMIT}`
            : "This chapter needs a player decision",
          409,
        );
      }
      if (command.approvedThroughChapter !== plan.endChapter) {
        throw new StoryServiceError("Continuation approval is stale or exceeds the safe run", 409);
      }
    }
    onProgress?.("preparing");

    const startedAt = performance.now();
    const turnId = randomUUID();
    const turnIdentity: NarrativeTurnIdentity = {
      chapter: before.chapter + 1,
      povId: before.lockedPovId,
      requestId: command.requestId,
      turnId,
      worldVersionAfter: before.version + 1,
      worldVersionBefore: before.version,
    };
    const budget = new ChapterCostBudget(this.options.maxCostUsdPerChapter);
    const serviceTier = this.options.serviceTier ?? "standard";
    const modelConfig = this.options.modelConfig ?? STORY_MODELS;
    const promptCache =
      this.options.promptCacheKey === undefined
        ? {}
        : { promptCacheKey: this.options.promptCacheKey };
    const priorChapters = loadPriorChapters(this.store, before.chapter + 1);
    const storyHistory = toStoryHistory(priorChapters);
    const promptPreferences: StoryPromptPreferences = {
      setup: this.store.loadStorySetup(WORLD_ID),
      ...(this.options.storyTitle === undefined ? {} : { title: this.options.storyTitle }),
    };
    const backgroundStoryHistory = loadBackgroundStoryHistory(this.store, priorChapters);
    const pricingVersion = pricingVersionForServiceTier(serviceTier);
    const priorFailures = this.store
      .loadFailedTurnTraces(WORLD_ID)
      .filter((trace) => trace.worldVersion === before.version);
    const attempts: TraceEnvelope["attempts"] = priorFailures.flatMap((trace) => trace.attempts);
    const currentAttempts: TraceEnvelope["attempts"] = [];
    let attemptPhase: TraceEnvelope["attempts"][number]["phase"] = "intent";
    const policy = {
      budget,
      ...(this.options.costHooks === undefined ? {} : { costHooks: this.options.costHooks }),
      maxRetries: 2,
      onAttempt: (attempt: RuntimeAttempt) => {
        const tracedAttempt = { ...attempt, phase: attemptPhase };
        attempts.push(tracedAttempt);
        currentAttempts.push(tracedAttempt);
        this.options.onRuntimeAttempt?.(tracedAttempt, turnIdentity);
      },
      serviceTier,
      timeoutMs: this.options.timeoutMs ?? 60_000,
    } as const;
    let turnCommitted = false;
    try {
      const calls: ModelCallTrace[] = [];
      let playerAction: PlayerAction;

      if (command.type === "take_action" || command.type === "continue_story") {
        const choice = this.currentChoices(before).find(({ id }) =>
          command.type === "take_action" ? id === command.choiceId : id === "choice-1",
        );
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
          calls.push(toModelCall(customCall, "gpt-5.6-terra", "intent", null, "none"));
        }
      }

      const actionPreflight = resolveTurn(before, playerAction, []);
      if (!actionPreflight.ok) {
        throw new StoryServiceError(
          `Action rejected: ${formatIssues(actionPreflight.issues)}`,
          422,
        );
      }

      const actors = selectBackgroundActors(before).slice(0, this.options.maxBackgroundAgents);
      let backgroundIntents: Parameters<typeof resolveTurn>[2] = [];
      let adapterMode: TraceEnvelope["adapterMode"] = "application-parallel";
      let multiAgentOutputItems: Record<string, unknown>[] = [];
      if (actors.length > 0) {
        onProgress?.("characters");
        attemptPhase = "intent";
        const luna = await runLunaWorldTick(this.client, {
          agents: buildLunaAgentInputs(before, actors, backgroundStoryHistory),
          capabilities: { nativeMultiAgent: this.options.nativeMultiAgent },
          coordinatorInstructions: buildLunaCoordinatorInstructions(actors),
          policy,
          reasoningEffort: "none",
          resolverInput: "Use assigned actor instructions. Intent only.",
          rootAgentName: "/root",
          stateVersion: before.version,
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
      const decodeFrameCandidate = (candidate: unknown) => {
        const decoded = decodeChapterFrameModelCandidate(candidate);
        const recentActions = [...storyHistory.map(({ action }) => action), playerAction.action];
        const prioritizedOptionIds = prioritizeSceneMovementOptionIds(
          prospective,
          decoded.optionIds,
          recentActions,
        );
        return {
          ...decoded,
          optionIds: this.options.enforceNarrativeQuality
            ? diversifyQualityOptionIds(prospective, prioritizedOptionIds, recentActions)
            : prioritizedOptionIds,
        };
      };

      const frameCandidateCall = await runStructuredResponse(this.client, {
        ...promptCache,
        input: buildChapterFramePrompt(prospective, storyHistory, promptPreferences),
        instructions:
          'Return {"t":title,"o":rankedOptionIds}. Use a short reader-facing title and at most two supplied IDs. Rank only optionActionsById entries. Use serialArc, tenChapterQualityPlan, presentCharacters, and storyHistory internally to diversify recent action and progression signatures. For chapter one, make the title fit openingContract. Never expose readerExclusions, prompt keys, planning phases, scheduled beats, act numbers, milestone IDs, chapter deadlines, targets, or evaluation language in the title. When a dialogue beat is scheduled and a present character exists, prefer a legal interact option. When a System consequence or tradeoff is scheduled, prefer a legal use_skill, use_item, investigate, or social option whose supplied action can dramatize it. Never force an unsupported action. Never reveal hidden facts. Application code owns terminal state, actions, IDs, descriptions, and targets. Return schema JSON only.',
        model: modelConfig.frame.model,
        policy,
        reasoningEffort: modelConfig.frame.reasoningEffort,
        schema: ChapterFrameModelCandidateSchema,
        schemaName: "chapter_frame_candidate",
        validate: (candidate) => {
          const frameValidation = canonicalizeChapterFrameCandidate(
            prospective,
            decodeFrameCandidate(candidate),
          );
          if (!frameValidation.ok) {
            throw new OpenAIRuntimeError(
              "INVALID_OUTPUT",
              `Frame is unsafe or invalid: ${formatIssues(frameValidation.issues)}`,
              { retryable: true },
            );
          }
          if (this.options.enforceNarrativeQuality) {
            const titleIssues = validateTitleNovelty(frameValidation.data.title, storyHistory);
            if (titleIssues.length > 0) {
              throw new OpenAIRuntimeError(
                "INVALID_OUTPUT",
                `Frame title failed novelty validation: ${formatIssues(titleIssues)}`,
                { retryable: true },
              );
            }
          }
        },
      });
      const frameValidation = canonicalizeChapterFrameCandidate(
        prospective,
        decodeFrameCandidate(frameCandidateCall.data),
      );
      if (!frameValidation.ok) {
        throw new StoryServiceError(
          `Canonical frame is invalid: ${formatIssues(frameValidation.issues)}`,
          502,
        );
      }
      if (this.options.enforceNarrativeQuality) {
        const titleIssues = validateTitleNovelty(frameValidation.data.title, storyHistory);
        if (titleIssues.length > 0) {
          throw new StoryServiceError(
            `Canonical frame title is repetitive: ${formatIssues(titleIssues)}`,
            502,
          );
        }
      }
      const frameCall: RuntimeCallResult<ChapterFrame> = {
        ...frameCandidateCall,
        data: frameValidation.data,
      };
      calls.push(
        toModelCall(
          frameCall,
          modelConfig.frame.model,
          "intent",
          null,
          modelConfig.frame.reasoningEffort,
        ),
      );

      const auditCalls: RuntimeCallResult<NarrativeAudit>[] = [];
      let approvedAudit: NarrativeAudit | null = null;
      let retryDirective: string | null = null;
      const allowedFactIds = new Set(buildPovContext(prospective, before.lockedPovId).factIds);
      const forbiddenFacts = prospective.facts
        .filter(({ id }) => !allowedFactIds.has(id))
        .map(({ claim, id }) => ({ claim, id }));
      const forbiddenFactsById = new Map(
        forbiddenFacts.map(({ claim, id }) => [id, claim] as const),
      );
      const narrationBrief = JSON.parse(
        buildNarrationPrompt(
          before,
          prospective,
          playerAction,
          resolved.data.delta,
          storyHistory,
          promptPreferences,
        ),
      ) as unknown;
      const validateDraft = (prose: string): ReturnType<typeof validateChapterDraft> => {
        const structural = validateChapterDraft(prospective, {
          choices: frameCall.data.choices,
          contractVersion: CONTRACT_VERSION,
          prose,
          terminal: prospective.terminal,
          title: frameCall.data.title,
        });
        const stateIssues = validateNarrativeStateClaims(before, prospective, prose);
        const qualityIssues = this.options.enforceNarrativeQuality
          ? validateNarrativeQuality({
              dialogueRequired: buildTenChapterQualityPlan(
                prospective.chapter,
                dialogueIsPossible(prospective, turnIdentity.povId),
              ).beats.consequentialDialogue,
              history: storyHistory,
              openingOriginRequired: prospective.chapter === 1 && promptPreferences.setup !== null,
              prose,
              ...(promptPreferences.setup === null || promptPreferences.setup === undefined
                ? {}
                : { systemName: prospective.system?.name ?? "System" }),
              systemNoticeRequired:
                (prospective.chapter === 1 && promptPreferences.setup !== null) ||
                hasPovMechanicalChange(resolved.data.delta, turnIdentity.povId),
              title: frameCall.data.title,
            })
          : [];
        if (stateIssues.length === 0 && qualityIssues.length === 0) return structural;
        return {
          issues: [...(structural.ok ? [] : structural.issues), ...stateIssues, ...qualityIssues],
          ok: false,
        };
      };
      const candidateBase = {
        adapterMode,
        allowedFactIds: [...allowedFactIds].sort(),
        backgroundIntents: [...resolved.data.intents],
        chapter: prospective.chapter,
        delta: resolved.data.delta,
        forbiddenFacts,
        frame: frameCall.data,
        multiAgentOutputItems: [...multiAgentOutputItems],
        playerAction,
        povId: before.lockedPovId,
        promptVersion: PROMPT_VERSION,
        schemaVersion: RUNTIME_SCHEMA_VERSION,
        sourceGitSha: currentGitSha(),
        stateAfter: prospective,
        stateBefore: before,
        turn: turnIdentity,
        worldVersionAfter: prospective.version,
        worldVersionBefore: before.version,
      } satisfies Omit<NarrativeCandidateEvidence, keyof NarrativeCandidateOutcome>;
      const emitCandidate = (outcome: NarrativeCandidateOutcome): void => {
        try {
          this.options.onNarrativeCandidate?.({ ...candidateBase, ...outcome });
        } catch (error) {
          throw new OpenAIRuntimeError("INVALID_POLICY", "Narrative evidence hook failed", {
            cause: error,
          });
        }
      };
      const emitNarrativeResponse = (
        phase: NarrativeResponseEvidence["phase"],
        context: {
          readonly attempt: number;
          readonly bufferedOutputText?: string;
          readonly rawOutputText: string;
          readonly responseId: string;
          readonly status: NarrationRawCandidateContext["status"];
        },
      ): void => {
        try {
          this.options.onNarrativeResponse?.({
            attempt: context.attempt,
            bufferedOutputText: context.bufferedOutputText ?? context.rawOutputText,
            chapter: candidateBase.chapter,
            phase,
            povId: candidateBase.povId,
            rawOutputText: context.rawOutputText,
            responseId: context.responseId,
            sourceGitSha: candidateBase.sourceGitSha,
            status: context.status,
            turn: candidateBase.turn,
            worldVersionAfter: candidateBase.worldVersionAfter,
            worldVersionBefore: candidateBase.worldVersionBefore,
          });
        } catch (error) {
          throw new OpenAIRuntimeError(
            "INVALID_POLICY",
            "Narrative response evidence hook failed",
            {
              cause: error,
            },
          );
        }
      };
      attemptPhase = "narration";
      onProgress?.("writing");
      const narration = await createAuditedNarrationReplay(this.client, {
        ...promptCache,
        audit: async (prose, narratorContext) => {
          const rawWordCount = countWords(prose);
          const recoveryEvidence = null;
          const auditedProse = prose;
          const draft = validateDraft(auditedProse);
          if (!draft.ok) this.options.onNarrativeDraftRejected?.(draft.issues);
          if (!draft.ok) {
            retryDirective = buildDeterministicNarrationRetryDirective(
              draft.issues,
              prospective.system?.name ?? "System",
            );
            emitCandidate({
              accepted: false,
              audit: null,
              auditAttempts: [],
              auditResponseId: null,
              deterministicIssues: [...draft.issues],
              mergedProse: auditedProse,
              mergedWordCount: countWords(auditedProse),
              narratorAttempt: narratorContext.attempt,
              narratorResponseId: narratorContext.responseId,
              rawProse: prose,
              rawWordCount,
              recovery: recoveryEvidence,
              rejectionStage: "deterministic",
            });
            return { accepted: false, reason: formatIssues(draft.issues) };
          }
          const auditAttempts: NarrativeAuditAttemptEvidence[] = [];
          onProgress?.("checking");
          const auditAttemptStart = currentAttempts.length;
          attemptPhase = "audit";
          let auditCall: RuntimeCallResult<NarrativeAudit>;
          try {
            const candidateCall = await runStructuredResponse(this.client, {
              ...promptCache,
              input: buildAuditPrompt(
                before,
                prospective,
                playerAction,
                resolved.data.delta,
                frameCall.data,
                auditedProse,
                storyHistory,
                promptPreferences,
              ),
              instructions: "Audit canon. Return schema JSON only.",
              model: modelConfig.audit.model,
              onCandidate: (candidate, context) => {
                const index = auditAttempts.findLastIndex(
                  (entry) =>
                    entry.attempt === context.attempt && entry.responseId === context.responseId,
                );
                const raw = auditAttempts[index];
                if (index < 0 || raw === undefined) {
                  throw new Error("Parsed audit candidate has no raw response evidence");
                }
                auditAttempts[index] = { ...raw, candidate };
              },
              onRawCandidate: (context) => {
                auditAttempts.push({
                  attempt: context.attempt,
                  candidate: null,
                  rawOutputText: context.rawOutputText,
                  responseId: context.responseId,
                  status: context.status,
                });
                emitNarrativeResponse("audit", context);
              },
              policy,
              reasoningEffort: modelConfig.audit.reasoningEffort,
              schema: NarrativeAuditCandidateSchema,
              schemaName: "narrative_audit",
              validate: (audit) => {
                canonicalizeNarrativeAuditOutput(audit, auditedProse, forbiddenFactsById);
              },
            });
            auditCall = {
              ...candidateCall,
              data: canonicalizeNarrativeAuditOutput(
                candidateCall.data,
                auditedProse,
                forbiddenFactsById,
              ),
            };
          } catch (error) {
            const auditResponseId =
              auditAttempts.at(-1)?.responseId ??
              currentAttempts.slice(auditAttemptStart).findLast(({ phase }) => phase === "audit")
                ?.responseId ??
              null;
            emitCandidate({
              accepted: false,
              audit: null,
              auditAttempts,
              auditResponseId,
              deterministicIssues: [],
              mergedProse: auditedProse,
              mergedWordCount: countWords(auditedProse),
              narratorAttempt: narratorContext.attempt,
              narratorResponseId: narratorContext.responseId,
              rawProse: prose,
              rawWordCount,
              recovery: recoveryEvidence,
              rejectionStage: "audit-invalid",
            });
            if (error instanceof OpenAIRuntimeError && !error.retryable) throw error;
            throw new OpenAIRuntimeError(
              "INVALID_OUTPUT",
              "Narrative audit exhausted retries for the fixed prose",
              { cause: error },
            );
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
          emitCandidate({
            accepted: approvedAudit.approved,
            audit: approvedAudit,
            auditAttempts,
            auditResponseId: auditCall.responseId,
            deterministicIssues: [],
            mergedProse: auditedProse,
            mergedWordCount: countWords(auditedProse),
            narratorAttempt: narratorContext.attempt,
            narratorResponseId: narratorContext.responseId,
            rawProse: prose,
            rawWordCount,
            recovery: recoveryEvidence,
            rejectionStage: approvedAudit.approved ? "accepted" : "audit",
          });
          return {
            accepted: approvedAudit.approved,
            auditedProse,
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
          "Write only the complete close-third story scene described by chapterBrief. End after its consequence and forward hook. No meta commentary. Never mention prompts, fields, whitelists, canon rules, allowed facts, or supplied context. Obey supplied story facts exactly.",
        model: modelConfig.narration.model,
        onRawCandidate: (context) => emitNarrativeResponse("narration", context),
        policy,
        reasoningEffort: modelConfig.narration.reasoningEffort,
      });
      calls.push(
        toModelCall(
          narration,
          modelConfig.narration.model,
          "narration",
          null,
          modelConfig.narration.reasoningEffort,
        ),
      );
      if (auditCalls.length === 0 || approvedAudit === null) {
        throw new StoryServiceError("Narrative audit did not complete", 502);
      }
      calls.push(
        ...auditCalls.map((auditCall) =>
          toModelCall(
            auditCall,
            modelConfig.audit.model,
            "audit",
            null,
            modelConfig.audit.reasoningEffort,
          ),
        ),
      );

      const totalUsage = attempts.reduce<RuntimeUsage>(
        (sum, attempt) => addUsage(sum, attempt.usage),
        ZERO_USAGE,
      );
      const totalLatencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const totalEstimatedCostUsd = attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
      const proseHash = hashText(narration.prose);
      const runId = turnId;
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
        pricingVersion,
        promptVersion: PROMPT_VERSION,
        runId,
        schemaVersion: RUNTIME_SCHEMA_VERSION,
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
        onProgress?.("saving");
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
          pricingVersion,
          promptVersion: PROMPT_VERSION,
          requestId: command.requestId,
          runId: turnId,
          schemaVersion: RUNTIME_SCHEMA_VERSION,
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

  exportJson(): string {
    const world = this.store.loadWorldState(WORLD_ID);
    if (!world) throw new StoryServiceError("No story exists", 404);
    const chapters = this.store.loadChapters(WORLD_ID);
    if (world.lockedPovId === null) throw new StoryServiceError("Viewpoint is not locked", 409);
    return `${JSON.stringify(
      {
        chapters: chapters.map(({ chapter, choices, prose, terminal, title }) => ({
          chapter,
          choices,
          prose: sanitizeReaderProse(prose),
          terminal,
          title,
        })),
        scope: "reader",
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
      `# ${this.options.storyTitle ?? "Infinite LitRPG Story"}`,
      "",
      `Locked viewpoint: ${world.lockedPovId ?? "none"}`,
      `Chapters: ${world.chapter} of 350`,
      "",
      ...chapters.flatMap((chapter) => [
        `## Chapter ${chapter.chapter}: ${chapter.title}`,
        "",
        sanitizeReaderProse(chapter.prose),
        "",
      ]),
    ].join("\n");
  }

  private currentChoices(state: WorldState): readonly Choice[] {
    if (state.terminal) return [];
    if (state.chapter === 0) {
      return (
        this.genesisOpeningChoices(state) ??
        initialChoices(state, this.store.loadStorySetup(WORLD_ID) !== null)
      );
    }
    return this.store.loadChapter(state.id, state.chapter)?.choices ?? [];
  }

  private continuationPlanFor(state: WorldState): StoryView["continuationPlan"] {
    const plan = planRoutineContinuation(state, DEMO_CHAPTER_LIMIT);
    if (!plan || !this.currentChoices(state).some(({ id }) => id === "choice-1")) return null;
    return plan;
  }

  private toView(state: WorldState): StoryView {
    if (state.lockedPovId === null) throw new StoryServiceError("Viewpoint is not locked", 500);
    const pov = state.characters.find(({ id }) => id === state.lockedPovId);
    if (!pov) throw new StoryServiceError("Locked viewpoint is missing", 500);
    const chapters = state.chapter > 0 ? this.store.loadChapters(state.id) : [];
    const latestChapter = chapters.at(-1) ?? null;
    const context = buildPovContext(state, state.lockedPovId);
    const locationNames = new Map(state.locations.map(({ id, name }) => [id, name]));
    const characterNames = new Map(state.characters.map(({ id, name }) => [id, name]));
    const setup = this.store.loadStorySetup(WORLD_ID);
    const initial =
      state.chapter === 0
        ? (this.genesisOpeningChoices(state) ?? initialChoices(state, setup !== null))
        : [];

    return {
      chapterHistory: chapters.map(({ chapter, title }) => ({ chapter, title })),
      continuationPlan: this.continuationPlanFor(state),
      chapter: latestChapter
        ? {
            choices: latestChapter.choices,
            prose: sanitizeReaderProse(latestChapter.prose),
            title: latestChapter.title,
          }
        : {
            choices: initial,
            prose: "",
            title: "",
          },
      systemName: state.system?.name ?? "System",
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
      visibleEvents: context.observedEvents.map((event) => ({
        id: event.id,
        location: locationNames.get(event.locationId) ?? event.locationId,
        summary: readerEventSummary(state, event.summary),
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

  private genesisOpeningChoices(state: WorldState): readonly Choice[] | null {
    const genesis = this.store.loadStoryGenesis(state.id);
    if (!genesis) return null;
    return [
      {
        action: genesis.openingAction,
        description: genesis.openingActionDescription,
        id: "choice-1",
        milestoneId: null,
      },
    ];
  }
}

export interface StoryView {
  readonly chapterHistory: readonly {
    readonly chapter: number;
    readonly title: string;
  }[];
  readonly continuationPlan: {
    readonly chapterCount: number;
    readonly endChapter: number;
  } | null;
  readonly chapter: {
    readonly choices: readonly Choice[];
    readonly prose: string;
    readonly title: string;
  };
  readonly systemName: string;
  readonly pov: Readonly<Record<string, unknown>>;
  readonly visibleEvents: readonly {
    readonly id: string;
    readonly location: string;
    readonly summary: string;
  }[];
  readonly world: Readonly<Record<string, unknown>>;
}

export interface ReaderChapterView {
  readonly chapter: number;
  readonly prose: string;
  readonly title: string;
}

interface AuditedCanonicalNarrationOptions {
  readonly auditModel: RuntimeModel;
  readonly auditReasoningEffort: Extract<RuntimeReasoningEffort, "low" | "none">;
  readonly enforceNarrativeQuality: boolean;
  readonly history: readonly StoryHistoryEntry[];
  readonly initialNarrationDirective: string | null;
  readonly narrationModel: RuntimeModel;
  readonly narrationReasoningEffort: RuntimeReasoningEffort;
  readonly onNarrativeAudit?: StoryServiceOptions["onNarrativeAudit"];
  readonly onNarrativeCandidate?: StoryServiceOptions["onNarrativeCandidate"];
  readonly onNarrativeDraftRejected?: StoryServiceOptions["onNarrativeDraftRejected"];
  readonly onNarrativeResponse?: StoryServiceOptions["onNarrativeResponse"];
  readonly policy: RuntimePolicy;
  readonly promptPreferences: StoryPromptPreferences;
  readonly promptCacheKey?: string;
  readonly setAttemptPhase: (phase: "audit" | "narration" | "recovery") => void;
  readonly turn: NarrativeTurnIdentity;
}

interface AuditedCanonicalNarrationResult {
  readonly audit: NarrativeAudit;
  readonly calls: readonly ModelCallTrace[];
  readonly prose: string;
  readonly replay: AsyncIterable<string>;
}

function reconstructLatestCanonicalTurn(
  store: StoryStore,
  seedLoader: () => WorldState,
  currentWorld: WorldState,
  currentChapter: ChapterRecord,
  currentTrace: PersistedTraceEnvelope,
): CanonicalNarrationSource {
  const seeded = store.loadStoryGenesis(WORLD_ID)?.initialWorld ?? seedLoader();
  seeded.lockedPovId = currentWorld.lockedPovId;
  const validatedSeed = validateWorldState(seeded);
  if (!validatedSeed.ok) throw new StoryServiceError("Seed world cannot replay this story", 500);
  let state = validatedSeed.data;
  let latestSource: CanonicalNarrationSource | null = null;

  for (let chapterNumber = 1; chapterNumber <= currentWorld.chapter; chapterNumber += 1) {
    const chapter = store.loadChapter(WORLD_ID, chapterNumber);
    if (!chapter) throw new StoryServiceError(`Chapter ${chapterNumber} is missing`, 500);
    const trace = store.loadTrace(chapter.traceId);
    if (!trace) throw new StoryServiceError(`Trace for chapter ${chapterNumber} is missing`, 500);
    if (trace.promptVersion !== PROMPT_VERSION) {
      throw new StoryServiceError(
        "This legacy chapter cannot be rewritten. Start a new story to use the quality model.",
        409,
      );
    }
    const storedDelta = store.loadDelta(WORLD_ID, chapter.stateAfterVersion);
    if (!storedDelta || !isDeepStrictEqual(storedDelta, trace.acceptedDelta)) {
      throw new StoryServiceError(`Delta for chapter ${chapterNumber} is invalid`, 500);
    }
    if (trace.stateBeforeHash !== hashJson(state)) {
      throw new StoryServiceError(`Chapter ${chapterNumber} replay starts from changed canon`, 500);
    }
    const delta = WorldDeltaSchema.parse(trace.acceptedDelta);
    const intents = trace.intents.map((intent) => WorldIntentSchema.parse(intent));
    const staged = stageWorldDelta(state, intents, delta);
    if (!staged.ok || trace.stateAfterHash !== hashJson(staged.data.state)) {
      throw new StoryServiceError(`Chapter ${chapterNumber} cannot replay exact canon`, 500);
    }
    if (chapterNumber === currentWorld.chapter) {
      if (
        chapter.traceId !== currentChapter.traceId ||
        trace.runId !== currentTrace.runId ||
        !isDeepStrictEqual(trace, currentTrace)
      ) {
        throw new StoryServiceError("Latest chapter changed during rewrite preparation", 409);
      }
      latestSource = {
        adapterMode: trace.adapterMode,
        delta,
        frame: {
          choices: chapter.choices,
          terminal: chapter.terminal,
          title: chapter.title,
        },
        intents,
        multiAgentOutputItems: trace.multiAgentOutputItems,
        playerAction: chapter.playerAction,
        stateAfter: staged.data.state,
        stateBefore: state,
      };
    }
    state = staged.data.state;
  }

  if (!latestSource || !isDeepStrictEqual(state, currentWorld)) {
    throw new StoryServiceError("Story replay does not match current canon", 500);
  }
  return latestSource;
}

function parseCanonicalNarrationSource(source: CanonicalNarrationSource): CanonicalNarrationSource {
  const beforeValidation = validateWorldState(source.stateBefore);
  const afterValidation = validateWorldState(source.stateAfter);
  if (!beforeValidation.ok || !afterValidation.ok) {
    throw new StoryServiceError("Canonical re-narration state is invalid", 422);
  }
  const stateBefore = beforeValidation.data;
  const stateAfter = afterValidation.data;
  const playerAction = PlayerActionSchema.parse(source.playerAction);
  const delta = WorldDeltaSchema.parse(source.delta);
  if (source.intents.length < 1 || source.intents.length > 4) {
    throw new StoryServiceError("Canonical re-narration intents are invalid", 422);
  }
  const intents = source.intents.map((intent) => WorldIntentSchema.parse(intent));
  const frame = ChapterFrameSchema.parse(source.frame);
  if (
    stateBefore.lockedPovId === null ||
    stateAfter.lockedPovId !== stateBefore.lockedPovId ||
    stateAfter.version !== stateBefore.version + 1 ||
    stateAfter.chapter !== stateBefore.chapter + 1 ||
    playerAction.actorId !== stateBefore.lockedPovId ||
    playerAction.stateVersion !== stateBefore.version ||
    (!getClockPolicy(stateBefore.chapter).choicesRequireMilestone &&
      playerAction.milestoneId !== null) ||
    delta.expectedWorldVersion !== stateBefore.version ||
    frame.terminal !== stateAfter.terminal
  ) {
    throw new StoryServiceError(
      "Canonical re-narration versions, viewpoint, milestone, or frame disagree",
      422,
    );
  }
  const playerIntents = intents.filter(
    ({ actorId, id }) => actorId === stateBefore.lockedPovId && id.startsWith("intent-player-"),
  );
  if (
    playerIntents.length !== 1 ||
    playerIntents[0]?.goal !== playerAction.description ||
    !isDeepStrictEqual(playerIntents[0]?.action, playerAction.action)
  ) {
    throw new StoryServiceError("Canonical re-narration player intent disagrees", 422);
  }
  const resolved = resolveTurn(
    stateBefore,
    playerAction,
    intents.filter(({ id }) => id !== playerIntents[0]?.id),
  );
  if (
    !resolved.ok ||
    !isDeepStrictEqual(resolved.data.intents, intents) ||
    !isDeepStrictEqual(resolved.data.delta, delta)
  ) {
    throw new StoryServiceError("Canonical re-narration action does not resolve exactly", 422);
  }
  const staged = stageWorldDelta(stateBefore, intents, delta);
  if (!staged.ok || !isDeepStrictEqual(staged.data.state, stateAfter)) {
    throw new StoryServiceError("Canonical re-narration state does not restage exactly", 422);
  }
  const choices = validateSuggestedChoices(stateAfter, frame.choices);
  if (!choices.ok || !isDeepStrictEqual(choices.data, frame.choices)) {
    throw new StoryServiceError("Canonical re-narration frame is invalid", 422);
  }
  return {
    adapterMode: source.adapterMode,
    delta,
    frame,
    intents,
    multiAgentOutputItems: source.multiAgentOutputItems.map(sanitizeOutputItem),
    playerAction,
    stateAfter,
    stateBefore,
  };
}

async function generateAuditedCanonicalNarration(
  client: OpenAI,
  source: CanonicalNarrationSource,
  options: AuditedCanonicalNarrationOptions,
): Promise<AuditedCanonicalNarrationResult> {
  const auditCalls: RuntimeCallResult<NarrativeAudit>[] = [];
  let approvedAudit: NarrativeAudit | null = null;
  const initialNarrationDirective = options.initialNarrationDirective?.trim() || null;
  let retryDirective: string | null = initialNarrationDirective;
  const updateRetryDirective = (specific: string): void => {
    retryDirective =
      initialNarrationDirective === null ? specific : `${initialNarrationDirective} ${specific}`;
  };
  const allowedFactIds = new Set(
    buildPovContext(source.stateAfter, source.stateBefore.lockedPovId!).factIds,
  );
  const forbiddenFacts = source.stateAfter.facts
    .filter(({ id }) => !allowedFactIds.has(id))
    .map(({ claim, id }) => ({ claim, id }));
  const forbiddenFactsById = new Map(forbiddenFacts.map(({ claim, id }) => [id, claim] as const));
  const narrationBrief = JSON.parse(
    buildNarrationPrompt(
      source.stateBefore,
      source.stateAfter,
      source.playerAction,
      source.delta,
      options.history,
      options.promptPreferences,
    ),
  ) as unknown;
  const validateDraft = (prose: string): ReturnType<typeof validateChapterDraft> => {
    const structural = validateChapterDraft(source.stateAfter, {
      choices: source.frame.choices,
      contractVersion: CONTRACT_VERSION,
      prose,
      terminal: source.stateAfter.terminal,
      title: source.frame.title,
    });
    const stateIssues = validateNarrativeStateClaims(source.stateBefore, source.stateAfter, prose);
    const qualityIssues = options.enforceNarrativeQuality
      ? validateNarrativeQuality({
          dialogueRequired: buildTenChapterQualityPlan(
            source.stateAfter.chapter,
            dialogueIsPossible(source.stateAfter, source.stateBefore.lockedPovId!),
          ).beats.consequentialDialogue,
          history: options.history,
          openingOriginRequired:
            source.stateAfter.chapter === 1 && options.promptPreferences.setup !== null,
          prose,
          ...(options.promptPreferences.setup === null ||
          options.promptPreferences.setup === undefined
            ? {}
            : { systemName: source.stateAfter.system?.name ?? "System" }),
          systemNoticeRequired:
            hasPovMechanicalChange(source.delta, source.stateBefore.lockedPovId!) ||
            (source.stateAfter.chapter === 1 && options.promptPreferences.setup !== null),
          title: source.frame.title,
        })
      : [];
    if (stateIssues.length === 0 && qualityIssues.length === 0) return structural;
    return {
      issues: [...(structural.ok ? [] : structural.issues), ...stateIssues, ...qualityIssues],
      ok: false,
    };
  };
  const candidateBase = {
    adapterMode: source.adapterMode,
    allowedFactIds: [...allowedFactIds].sort(),
    backgroundIntents: [...source.intents],
    chapter: source.stateAfter.chapter,
    delta: source.delta,
    forbiddenFacts,
    frame: source.frame,
    multiAgentOutputItems: [...source.multiAgentOutputItems],
    playerAction: source.playerAction,
    povId: source.stateBefore.lockedPovId!,
    promptVersion: PROMPT_VERSION,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    sourceGitSha: currentGitSha(),
    stateAfter: source.stateAfter,
    stateBefore: source.stateBefore,
    turn: options.turn,
    worldVersionAfter: source.stateAfter.version,
    worldVersionBefore: source.stateBefore.version,
  } satisfies Omit<NarrativeCandidateEvidence, keyof NarrativeCandidateOutcome>;
  const emitCandidate = (outcome: NarrativeCandidateOutcome): void => {
    try {
      options.onNarrativeCandidate?.({ ...candidateBase, ...outcome });
    } catch (error) {
      throw new OpenAIRuntimeError("INVALID_POLICY", "Narrative evidence hook failed", {
        cause: error,
      });
    }
  };
  const emitNarrativeResponse = (
    phase: NarrativeResponseEvidence["phase"],
    context: {
      readonly attempt: number;
      readonly bufferedOutputText?: string;
      readonly rawOutputText: string;
      readonly responseId: string;
      readonly status: NarrationRawCandidateContext["status"];
    },
  ): void => {
    try {
      options.onNarrativeResponse?.({
        attempt: context.attempt,
        bufferedOutputText: context.bufferedOutputText ?? context.rawOutputText,
        chapter: candidateBase.chapter,
        phase,
        povId: candidateBase.povId,
        rawOutputText: context.rawOutputText,
        responseId: context.responseId,
        sourceGitSha: candidateBase.sourceGitSha,
        status: context.status,
        turn: candidateBase.turn,
        worldVersionAfter: candidateBase.worldVersionAfter,
        worldVersionBefore: candidateBase.worldVersionBefore,
      });
    } catch (error) {
      throw new OpenAIRuntimeError("INVALID_POLICY", "Narrative response evidence hook failed", {
        cause: error,
      });
    }
  };

  options.setAttemptPhase("narration");
  const narration = await createAuditedNarrationReplay(client, {
    ...(options.promptCacheKey === undefined ? {} : { promptCacheKey: options.promptCacheKey }),
    audit: async (prose, narratorContext) => {
      const rawWordCount = countWords(prose);
      const recoveryEvidence = null;
      const auditedProse = prose;
      const draft = validateDraft(auditedProse);
      if (!draft.ok) options.onNarrativeDraftRejected?.(draft.issues);
      if (!draft.ok) {
        updateRetryDirective(
          buildDeterministicNarrationRetryDirective(
            draft.issues,
            source.stateAfter.system?.name ?? "System",
          ),
        );
        emitCandidate({
          accepted: false,
          audit: null,
          auditAttempts: [],
          auditResponseId: null,
          deterministicIssues: [...draft.issues],
          mergedProse: auditedProse,
          mergedWordCount: countWords(auditedProse),
          narratorAttempt: narratorContext.attempt,
          narratorResponseId: narratorContext.responseId,
          rawProse: prose,
          rawWordCount,
          recovery: recoveryEvidence,
          rejectionStage: "deterministic",
        });
        return { accepted: false, reason: formatIssues(draft.issues) };
      }
      const auditAttempts: NarrativeAuditAttemptEvidence[] = [];
      options.setAttemptPhase("audit");
      let auditCall: RuntimeCallResult<NarrativeAudit>;
      try {
        const candidateCall = await runStructuredResponse(client, {
          ...(options.promptCacheKey === undefined
            ? {}
            : { promptCacheKey: options.promptCacheKey }),
          input: buildAuditPrompt(
            source.stateBefore,
            source.stateAfter,
            source.playerAction,
            source.delta,
            source.frame,
            auditedProse,
            options.history,
            options.promptPreferences,
          ),
          instructions: "Audit canon. Return schema JSON only.",
          model: options.auditModel,
          onCandidate: (candidate, context) => {
            const index = auditAttempts.findLastIndex(
              (entry) =>
                entry.attempt === context.attempt && entry.responseId === context.responseId,
            );
            const raw = auditAttempts[index];
            if (index < 0 || raw === undefined) {
              throw new Error("Parsed audit candidate has no raw response evidence");
            }
            auditAttempts[index] = { ...raw, candidate };
          },
          onRawCandidate: (context) => {
            auditAttempts.push({
              attempt: context.attempt,
              candidate: null,
              rawOutputText: context.rawOutputText,
              responseId: context.responseId,
              status: context.status,
            });
            emitNarrativeResponse("audit", context);
          },
          policy: options.policy,
          reasoningEffort: options.auditReasoningEffort,
          schema: NarrativeAuditCandidateSchema,
          schemaName: "narrative_audit",
          validate: (audit) => {
            canonicalizeNarrativeAuditOutput(audit, auditedProse, forbiddenFactsById);
          },
        });
        auditCall = {
          ...candidateCall,
          data: canonicalizeNarrativeAuditOutput(
            candidateCall.data,
            auditedProse,
            forbiddenFactsById,
          ),
        };
      } catch (error) {
        emitCandidate({
          accepted: false,
          audit: null,
          auditAttempts,
          auditResponseId: auditAttempts.at(-1)?.responseId ?? null,
          deterministicIssues: [],
          mergedProse: auditedProse,
          mergedWordCount: countWords(auditedProse),
          narratorAttempt: narratorContext.attempt,
          narratorResponseId: narratorContext.responseId,
          rawProse: prose,
          rawWordCount,
          recovery: recoveryEvidence,
          rejectionStage: "audit-invalid",
        });
        if (error instanceof OpenAIRuntimeError && !error.retryable) throw error;
        throw new OpenAIRuntimeError(
          "INVALID_OUTPUT",
          "Narrative audit exhausted retries for the fixed prose",
          { cause: error },
        );
      } finally {
        options.setAttemptPhase("narration");
      }
      auditCalls.push(auditCall);
      approvedAudit = auditCall.data;
      options.onNarrativeAudit?.(approvedAudit);
      if (!approvedAudit.approved) {
        const safeFailures = NARRATIVE_AUDIT_DIMENSIONS.flatMap((dimension, index) =>
          approvedAudit?.scores[dimension] === 0
            ? [`${dimension}: ${approvedAudit.evidence[index]?.issueCode ?? "failed"}`]
            : [],
        );
        if (approvedAudit.leakedFactIds.length > 0) {
          safeFailures.push("povSafety: hidden-knowledge");
        }
        updateRetryDirective(
          `The prior draft failed fixed rubric checks: ${[...new Set(safeFailures)].join(", ") || "quality"}. Remove unsupported claims, durable facts, and extra actions. Keep only supplied viewpoint canon and canonical effects. Never repeat prior text that is absent from the supplied POV canon.`,
        );
      }
      emitCandidate({
        accepted: approvedAudit.approved,
        audit: approvedAudit,
        auditAttempts,
        auditResponseId: auditCall.responseId,
        deterministicIssues: [],
        mergedProse: auditedProse,
        mergedWordCount: countWords(auditedProse),
        narratorAttempt: narratorContext.attempt,
        narratorResponseId: narratorContext.responseId,
        rawProse: prose,
        rawWordCount,
        recovery: recoveryEvidence,
        rejectionStage: approvedAudit.approved ? "accepted" : "audit",
      });
      return {
        accepted: approvedAudit.approved,
        auditedProse,
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
      "Write only the complete close-third story scene described by chapterBrief. End after its consequence and forward hook. No meta commentary. Never mention prompts, fields, whitelists, canon rules, allowed facts, or supplied context. Obey supplied story facts exactly.",
    model: options.narrationModel,
    onRawCandidate: (context) => emitNarrativeResponse("narration", context),
    policy: options.policy,
    reasoningEffort: options.narrationReasoningEffort,
  });
  if (auditCalls.length === 0 || approvedAudit === null) {
    throw new StoryServiceError("Narrative audit did not complete", 502);
  }
  const calls = [
    toModelCall(
      narration,
      options.narrationModel,
      "narration",
      null,
      options.narrationReasoningEffort,
    ),
    ...auditCalls.map((auditCall) =>
      toModelCall(auditCall, options.auditModel, "audit", null, options.auditReasoningEffort),
    ),
  ];
  return { audit: approvedAudit, calls, prose: narration.prose, replay: narration.replay };
}

function loadStoryHistory(store: StoryStore, chapterExclusive: number): StoryHistoryEntry[] {
  return toStoryHistory(loadPriorChapters(store, chapterExclusive));
}

function loadPriorChapters(store: StoryStore, chapterExclusive: number): ChapterRecord[] {
  return store.loadChapters(WORLD_ID).filter(({ chapter }) => chapter < chapterExclusive);
}

function toStoryHistory(chapters: readonly ChapterRecord[]): StoryHistoryEntry[] {
  return chapters.map(({ chapter, playerAction, prose, title }) => ({
    action: playerAction.action,
    actionDescription: playerAction.description,
    chapter,
    prose,
    title,
  }));
}

function loadBackgroundStoryHistory(
  store: StoryStore,
  chapters: readonly ChapterRecord[],
): BackgroundStoryHistoryEntry[] {
  return chapters.map(({ chapter, traceId }) => {
    const trace = store.loadTrace(traceId);
    if (!trace) {
      throw new StoryServiceError(`Trace for prior chapter ${chapter} is missing`, 500);
    }
    if (trace.acceptedDelta.clock.toChapter !== chapter) {
      throw new StoryServiceError(`Trace for prior chapter ${chapter} has the wrong clock`, 500);
    }
    return {
      chapter,
      delta: trace.acceptedDelta,
      intents: trace.intents,
    };
  });
}

function dialogueIsPossible(state: WorldState, povId: string): boolean {
  const pov = state.characters.find(({ id }) => id === povId);
  if (!pov) return false;
  return state.characters.some(
    ({ id, locationId, status }) =>
      id !== povId &&
      locationId === pov.locationId &&
      status !== "dead" &&
      status !== "incapacitated" &&
      status !== "terminal",
  );
}

export function diversifyQualityOptionIds(
  state: WorldState,
  requestedOptionIds: readonly string[],
  recentActions: readonly PlayerAction["action"][],
): string[] {
  const options = buildChapterChoiceOptions(state);
  const byId = new Map(options.map((option) => [option.id, option] as const));
  const first = requestedOptionIds.map((id) => byId.get(id)).find(Boolean) ?? options[0];
  if (!first) return [];
  const second = requestedOptionIds
    .map((id) => byId.get(id))
    .find((option) => option !== undefined && option.id !== first.id);
  const recentType = recentActions.at(-1)?.type;
  if (
    second &&
    second.action.type !== first.action.type &&
    (recentType === undefined || second.action.type !== recentType)
  ) {
    return [first.id, second.id];
  }
  const replacement =
    options.find(
      ({ action, id }) =>
        id !== first.id && action.type !== first.action.type && action.type !== recentType,
    ) ?? options.find(({ action, id }) => id !== first.id && action.type !== first.action.type);
  return replacement ? [first.id, replacement.id] : [first.id];
}

function hasPovMechanicalChange(delta: WorldDelta, povId: string): boolean {
  const stateChange = delta.stateMutations.some((mutation) => {
    if (mutation.type === "complete_milestone" || mutation.type === "end_story") return true;
    if (mutation.type === "set_threat") return false;
    if (mutation.type === "set_relationship") {
      return mutation.characterId === povId || mutation.targetCharacterId === povId;
    }
    return mutation.characterId === povId;
  });
  return stateChange || delta.knowledgeMutations.some(({ characterId }) => characterId === povId);
}

export function loadSeedWorld(): WorldState {
  const path = resolve(workspaceRoot(), "evals", "fixtures", "demon-king-world.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const result = validateWorldState(raw);
  if (!result.ok) throw new Error(`Seed fixture invalid: ${JSON.stringify(result.issues)}`);
  return structuredClone(result.data);
}

export function initialChoices(state: WorldState, openingOrigin = false): readonly Choice[] {
  if (state.lockedPovId === null) return [];
  const actor = state.characters.find(({ id }) => id === state.lockedPovId);
  if (!actor) return [];
  const location = state.locations.find(({ id }) => id === actor.locationId);
  const presentCharacter = state.characters.find(
    ({ id, locationId, status }) =>
      id !== actor.id &&
      locationId === actor.locationId &&
      status !== "dead" &&
      status !== "incapacitated" &&
      status !== "terminal",
  );
  const destinationId = presentCharacter
    ? undefined
    : (nextStepTowardNearestCharacter(state, actor.id) ?? location?.adjacentLocationIds[0]);
  const skill = actor.skills.find(
    ({ manaCost, minimumLevel, prerequisiteSkillIds, requiredClassId }) =>
      actor.level >= minimumLevel &&
      actor.mana.current >= manaCost &&
      actor.characterClassId === requiredClassId &&
      prerequisiteSkillIds.every((id) => actor.skills.some((known) => known.id === id)),
  );
  const first: Choice =
    openingOrigin && state.chapter === 0
      ? {
          action: { subjectId: actor.locationId, type: "investigate" },
          description: "Awaken in the new life and understand the immediate danger.",
          id: "choice-1",
          milestoneId: null,
        }
      : presentCharacter
        ? {
            action: {
              approach: `Confront ${presentCharacter.name} about the immediate threat.`,
              targetId: presentCharacter.id,
              type: "interact",
            },
            description: `Confront ${presentCharacter.name} about what must happen next.`,
            id: "choice-1",
            milestoneId: null,
          }
        : destinationId
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

function nextStepTowardNearestCharacter(state: WorldState, actorId: string): string | undefined {
  const actor = state.characters.find(({ id }) => id === actorId);
  if (!actor) return undefined;
  const targetLocationIds = new Set(
    state.characters
      .filter(
        ({ id, status }) =>
          id !== actorId &&
          status !== "dead" &&
          status !== "incapacitated" &&
          status !== "terminal",
      )
      .map(({ locationId }) => locationId),
  );
  const start = state.locations.find(({ id }) => id === actor.locationId);
  if (!start) return undefined;
  const visited = new Set([start.id]);
  const queue = start.adjacentLocationIds.map((locationId) => ({
    firstStep: locationId,
    locationId,
  }));
  for (const { locationId } of queue) visited.add(locationId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (targetLocationIds.has(current.locationId)) return current.firstStep;
    const location = state.locations.find(({ id }) => id === current.locationId);
    for (const adjacentLocationId of location?.adjacentLocationIds ?? []) {
      if (visited.has(adjacentLocationId)) continue;
      visited.add(adjacentLocationId);
      queue.push({ firstStep: current.firstStep, locationId: adjacentLocationId });
    }
  }
  return undefined;
}

function toModelCall(
  call: Pick<
    RuntimeCallResult<unknown>,
    | "estimatedCostUsd"
    | "latencyMs"
    | "responseId"
    | "retries"
    | "usage"
    | "requestedServiceTier"
    | "serviceTier"
  >,
  model: ModelCallTrace["model"],
  phase: ModelCallTrace["phase"],
  agentId: string | null,
  reasoningEffort: ModelCallTrace["reasoningEffort"],
): ModelCallTrace {
  return {
    agentId,
    errorCode: null,
    estimatedCostUsd: call.estimatedCostUsd,
    latencyMs: call.latencyMs,
    model,
    phase,
    reasoningEffort,
    refusal: false,
    requestedServiceTier: call.requestedServiceTier,
    responseId: call.responseId,
    retries: call.retries,
    serviceTier: call.serviceTier,
    timedOut: false,
    usage: call.usage,
  };
}

function toLunaModelCall(call: LunaCallSummary): ModelCallTrace {
  return toModelCall(call, "gpt-5.6-luna", "intent", call.agentId, "none");
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

function buildDeterministicNarrationRetryDirective(
  issues: readonly ValidationIssue[],
  systemName: string,
): string {
  const issueCodes = [...new Set(issues.map(({ code }) => code))].sort();
  const corrections: string[] = [];
  if (issueCodes.includes("SYSTEM_NOTICE_MISSING")) {
    corrections.push(
      `Print one concise bracketed notice beginning [${systemName} Notice: and containing only supplied quest, stat, resource, skill, class, title, or progression information.`,
    );
  }
  if (issueCodes.includes("OPENING_ORIGIN_MISSING")) {
    corrections.push(
      "Start in-scene with the prior-life ending or its immediate remembered aftermath. Explicitly use prior life, previous life, last breath, death, execution, reborn, or reincarnated. Then explicitly show the viewpoint awoke, awakened, opened their eyes, or recognized a new body before the first System pressure.",
    );
  }
  if (issueCodes.includes("OPENING_WORLD_MISSING")) {
    corrections.push(
      "Ground the awakening in immediate sensory danger from the supplied location and world canon.",
    );
  }
  return `The prior draft failed deterministic validation with issue codes: ${issueCodes.join(", ")}. ${corrections.join(" ")} Return one complete scene with a consequence and forward hook. Remove every unsupported fact or action. Never repeat prior text that is absent from the supplied POV canon.`;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function readerEventSummary(state: WorldState, summary: string): string {
  const labels = [
    ...state.characters.map(({ id, name }) => [id, name] as const),
    ...state.locations.map(({ id, name }) => [id, name] as const),
    ...state.factions.map(({ id, name }) => [id, name] as const),
    ...state.characters.flatMap(({ inventory, skills }) => [
      ...inventory.map(({ itemId, name }) => [itemId, name] as const),
      ...skills.map(({ id, name }) => [id, name] as const),
    ]),
  ].sort(([left], [right]) => right.length - left.length);
  const withoutNamePunctuation = labels.reduce(
    (text, [, name]) => text.replaceAll(name, name.replace(/[.!?]+$/u, "").trimEnd()),
    summary,
  );
  return labels.reduce(
    (text, [id, name]) => text.replaceAll(id, name.replace(/[.!?]+$/u, "").trimEnd()),
    withoutNamePunctuation,
  );
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
  prose: string,
  forbiddenFactsById: ReadonlyMap<string, string>,
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
  for (const [index, dimension] of NARRATIVE_AUDIT_DIMENSIONS.entries()) {
    const detail = audit.evidence[index];
    if (scores[dimension] === 0 && (detail === undefined || !prose.includes(detail))) {
      throw invalidAudit(`Audit zero for ${dimension} must quote the prose exactly`);
    }
  }
  for (const leak of audit.leakEvidence) {
    const forbiddenClaim = forbiddenFactsById.get(leak.factId);
    if (forbiddenClaim === undefined) {
      throw invalidAudit(`Audit invented leaked fact ID ${leak.factId}`);
    }
    if (!prose.includes(leak.proseQuote)) {
      throw invalidAudit(`Audit leak for ${leak.factId} must quote the prose exactly`);
    }
    if (sharedSignificantTokenCount(leak.proseQuote, forbiddenClaim) < 2) {
      throw invalidAudit(`Audit leak for ${leak.factId} lacks forbidden-fact anchors`);
    }
  }
  const leakedFactIds = [...new Set(audit.leakEvidence.map(({ factId }) => factId))].sort();
  const proseHash = hashText(prose);
  const canonical = NarrativeAuditSchema.parse({
    evidence,
    leakedFactIds,
    approved:
      NARRATIVE_AUDIT_DIMENSIONS.every((dimension) => scores[dimension] >= 1) &&
      leakedFactIds.length === 0,
    proseHash,
    scores,
  });
  validateNarrativeAuditOutput(canonical, proseHash, new Set(forbiddenFactsById.keys()));
  return canonical;
}

const AUDIT_ANCHOR_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "beneath",
  "by",
  "for",
  "from",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "they",
  "to",
  "under",
  "was",
  "were",
  "with",
]);

function sharedSignificantTokenCount(left: string, right: string): number {
  const leftTokens = significantTokens(left);
  const rightTokens = significantTokens(right);
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared;
}

function significantTokens(value: string): Set<string> {
  return new Set(
    (value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (token) => token.length > 2 && !AUDIT_ANCHOR_STOP_WORDS.has(token),
    ),
  );
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
