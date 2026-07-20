import { createHash } from "node:crypto";

import {
  CHARACTER_IDS,
  PlayerActionSchema,
  RUNTIME_SCHEMA_VERSION,
  buildChapterChoiceOptions,
  canonicalizeChapterFrameCandidate,
  resolveTurn,
  stageWorldDelta,
  type BackgroundIntentCandidate,
  NARRATIVE_AUDIT_DIMENSIONS,
  type NarrativeAudit,
  type NarrativeAuditCandidate,
  type TraceEnvelope,
  type ValidationIssue,
} from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import type { Response, ResponseUsage } from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";

import { FLEX_PRICING_VERSION, PRICING_VERSION } from "../openai/usage";
import { StoryStore } from "../storage/story-store";
import {
  canonicalizeNarrativeAuditOutput,
  type NarrativeCandidateEvidence,
  type NarrativeResponseEvidence,
  type NarrativeTurnIdentity,
  StoryService,
  StoryServiceError,
  validateCustomActionTranslation,
  validateNarrativeAuditOutput,
} from "./story-service";

describe("StoryService", () => {
  it.each(CHARACTER_IDS)("locks %s and exposes two valid opening choices", (characterId) => {
    const store = new StoryStore();
    const service = new StoryService(store, unusedClient(), options());

    const view = service.selectPov(characterId);

    expect(view.pov.id).toBe(characterId);
    expect(view.chapter.choices).toHaveLength(2);
    expect(view.continuationPlan).toBeNull();
    expect(view.world).toMatchObject({ chapter: 0, terminal: false, version: 1 });
    store.close();
  });

  it("never changes the selected viewpoint", () => {
    const store = new StoryStore();
    const service = new StoryService(store, unusedClient(), options());
    service.selectPov("rowan-ashborn");

    expect(() => service.selectPov("elara-voss")).toThrowError(StoryServiceError);
    expect(service.getStory()?.pov.id).toBe("rowan-ashborn");
    store.close();
  });

  it("re-narrates exact canon without intent, frame, or store mutation", async () => {
    const store = new StoryStore();
    const seedService = new StoryService(store, unusedClient(), options());
    const view = seedService.selectPov("rowan-ashborn");
    const before = store.loadWorldState("ashen-crown-v1");
    const choice = view.chapter.choices[0];
    if (!before || !choice) throw new Error("Test seed is incomplete");
    const playerAction = PlayerActionSchema.parse({
      action: choice.action,
      actorId: "rowan-ashborn",
      description: choice.description,
      milestoneId: choice.milestoneId,
      source: "suggested",
      stateVersion: before.version,
    });
    const resolved = resolveTurn(before, playerAction, []);
    if (!resolved.ok) throw new Error("Test action did not resolve");
    const staged = stageWorldDelta(before, resolved.data.intents, resolved.data.delta);
    if (!staged.ok) throw new Error("Test delta did not stage");
    const optionsById = buildChapterChoiceOptions(staged.data.state);
    const frame = canonicalizeChapterFrameCandidate(staged.data.state, {
      optionIds: optionsById.slice(0, 2).map(({ id }) => id),
      title: "The Canon Road",
    });
    if (!frame.ok) throw new Error("Test frame is invalid");
    const prose = Array.from({ length: 900 }, (_, index) => `canon${index}`).join(" ");
    const proseHash = createHash("sha256").update(prose).digest("hex");
    const audit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "pass",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash,
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const create = vi.fn().mockResolvedValue(parsedResponse(audit, "resp_renarration_audit"));
    const stream = vi.fn().mockReturnValue(fakeStream(prose, "resp_renarration"));
    const service = new StoryService(
      store,
      { responses: { create, stream } } as unknown as OpenAI,
      {
        ...options(),
        auditReasoningEffort: "low",
        canonicalAuditMaxOutputTokens: 64,
        canonicalNarrationDirective: "Keep the exact canonical route.",
      },
    );
    const source = {
      adapterMode: "sequential" as const,
      delta: resolved.data.delta,
      frame: frame.data,
      intents: resolved.data.intents,
      multiAgentOutputItems: [],
      playerAction,
      stateAfter: staged.data.state,
      stateBefore: before,
    };
    const beforeSnapshot = structuredClone(before);

    const result = await service.renarrateCanonicalTurn(
      source,
      "00000000-0000-4000-8000-000000000088",
    );

    expect(store.loadWorldState("ashen-crown-v1")).toEqual(beforeSnapshot);
    expect(create).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      max_output_tokens: 64,
      reasoning: { effort: "low" },
    });
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ reasoning: { effort: "none" } });
    expect(JSON.parse(String(stream.mock.calls[0]?.[0].input))).toMatchObject({
      retryDirective: "Keep the exact canonical route.",
    });
    expect(result.chapter.prose).toBe(prose);
    expect(result.streamChunks.join("")).toBe(prose);
    expect(
      result.trace.calls.map(({ phase, reasoningEffort }) => [phase, reasoningEffort]),
    ).toEqual([
      ["narration", "none"],
      ["audit", "low"],
    ]);

    const tampered = structuredClone(source);
    const rowan = tampered.stateAfter.characters.find(({ id }) => id === "rowan-ashborn");
    if (!rowan) throw new Error("Rowan is missing");
    rowan.mana.current -= 1;
    await expect(
      service.renarrateCanonicalTurn(tampered, "00000000-0000-4000-8000-000000000089"),
    ).rejects.toThrow("restage");

    const tamperedAction = structuredClone(source);
    tamperedAction.playerAction.milestoneId = "act-two-faction";
    await expect(
      service.renarrateCanonicalTurn(tamperedAction, "00000000-0000-4000-8000-000000000090"),
    ).rejects.toThrow("milestone");
    expect(create).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("does not retry narration when narrative evidence persistence fails", async () => {
    const store = new StoryStore();
    const prose = Array.from({ length: 900 }, (_, index) => `ember${index}`).join(" ");
    const proseHash = createHash("sha256").update(prose).digest("hex");
    const frame = {
      choices: [],
      terminal: false,
      title: "The Ash Road",
    };
    const audit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "pass",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash,
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(frame, "resp_evidence_frame"))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_evidence_audit"));
    const stream = vi.fn().mockReturnValue(fakeStream(prose, "resp_evidence_narration"));
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      {
        ...options(),
        onNarrativeCandidate: () => {
          throw new Error("evidence disk unavailable");
        },
      },
    );
    const selected = service.selectPov("rowan-ashborn");

    await expect(
      service.takeTurn({
        choiceId: selected.chapter.choices[0]?.id ?? "missing",
        expectedWorldVersion: 1,
        requestId: "00000000-0000-4000-8000-000000000099",
        type: "take_action",
      }),
    ).rejects.toMatchObject({ code: "INVALID_POLICY" });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(2);
    store.close();
  });

  it.each([
    {
      expectedPricingVersion: PRICING_VERSION,
      requestedTier: "standard" as const,
      responseTier: "default" as const,
    },
    {
      expectedPricingVersion: FLEX_PRICING_VERSION,
      requestedTier: "flex" as const,
      responseTier: "flex" as const,
    },
  ])(
    "audits prose before one atomic chapter commit on $requestedTier",
    async ({ expectedPricingVersion, requestedTier, responseTier }) => {
      const store = new StoryStore();
      const oversizedProse = Array.from({ length: 1_301 }, (_, index) => `excess${index}`).join(
        " ",
      );
      const prose = Array.from({ length: 900 }, (_, index) => `ember${index}`).join(" ");
      const proseHash = createHash("sha256").update(prose).digest("hex");
      const frame = {
        choices: [
          {
            action: { type: "wait" },
            description: "Wait and watch the road for movement.",
            id: "choice-1",
            milestoneId: null,
          },
          {
            action: { subjectId: "ash-road", type: "investigate" },
            description: "Inspect the ash road for a fresh trail.",
            id: "choice-2",
            milestoneId: null,
          },
        ],
        terminal: false,
        title: "The Ash Road",
      } as const;
      const audit: NarrativeAudit = {
        approved: true,
        evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
          detail: "The chapter obeys the selected viewpoint and committed action.",
          dimension,
          issueCode: "pass",
        })),
        leakedFactIds: [],
        proseHash,
        scores: {
          arcProgress: 2,
          characterAutonomy: 2,
          choiceFulfillment: 2,
          continuity: 2,
          litrpgMechanics: 2,
          povSafety: 2,
          prose: 2,
        },
      };
      const parse = vi
        .fn()
        .mockResolvedValueOnce(parsedResponse(frame, "resp_frame", usage(), responseTier))
        .mockResolvedValueOnce(parsedResponse(audit, "resp_audit", usage(), responseTier));
      const stream = vi
        .fn()
        .mockReturnValueOnce(
          fakeStream(oversizedProse, "resp_narration_rejected", usage(), responseTier),
        )
        .mockReturnValueOnce(fakeStream(prose, "resp_narration_approved", usage(), responseTier));
      const client = {
        responses: { create: parse, stream },
      } as unknown as OpenAI;
      const draftRejections: (readonly ValidationIssue[])[] = [];
      const narrativeCandidates: NarrativeCandidateEvidence[] = [];
      const runtimeAttempts: TraceEnvelope["attempts"] = [];
      const runtimeTurns: NarrativeTurnIdentity[] = [];
      const service = new StoryService(store, client, {
        ...options(),
        onNarrativeDraftRejected: (issues) => draftRejections.push(issues),
        onNarrativeCandidate: (candidate) => narrativeCandidates.push(candidate),
        onRuntimeAttempt: (attempt, turn) => {
          runtimeAttempts.push(attempt);
          runtimeTurns.push(turn);
        },
        serviceTier: requestedTier,
      });
      const selected = service.selectPov("rowan-ashborn");
      const replayed: string[] = [];
      const command = {
        choiceId: selected.chapter.choices[0]?.id ?? "missing",
        expectedWorldVersion: 1,
        requestId: "00000000-0000-4000-8000-000000000001",
        type: "take_action" as const,
      };

      await expect(
        service.takeTurn(command, (chunk) => {
          expect(store.loadChapters("ashen-crown-v1")).toHaveLength(1);
          replayed.push(chunk);
          if (replayed.join("").length === prose.length) {
            throw new Error("Replay consumer disconnected after commit");
          }
        }),
      ).rejects.toThrow("Replay consumer disconnected after commit");
      const result = await service.takeTurn(command);

      expect(result.world).toMatchObject({ chapter: 1, version: 2 });
      expect(result.chapter).toMatchObject({ title: "The Ash Road" });
      expect(result.chapter.prose.split(/\s+/u)).toHaveLength(900);
      expect(result.godMode).toMatchObject({ gateResult: "passed" });
      expect(result.godMode).toMatchObject({ schemaVersion: RUNTIME_SCHEMA_VERSION });
      expect(store.loadChapters("ashen-crown-v1")).toHaveLength(1);
      expect(replayed.join("")).toBe(prose);
      expect(store.loadFailedTurnTraces("ashen-crown-v1")).toEqual([]);
      expect(parse).toHaveBeenCalledTimes(2);
      expect(stream).toHaveBeenCalledTimes(2);
      expect(draftRejections).toHaveLength(1);
      expect(draftRejections[0]?.some(({ code }) => code === "INVALID_SCHEMA")).toBe(true);
      expect(narrativeCandidates).toHaveLength(2);
      expect(narrativeCandidates[0]).toMatchObject({
        accepted: false,
        deterministicIssues: [expect.objectContaining({ code: "INVALID_SCHEMA" })],
        narratorAttempt: 0,
        narratorResponseId: "resp_narration_rejected",
        rawProse: oversizedProse,
        rawWordCount: 1_301,
        rejectionStage: "deterministic",
      });
      expect(narrativeCandidates[1]).toMatchObject({
        accepted: true,
        auditResponseId: "resp_audit",
        mergedProse: prose,
        narratorAttempt: 1,
        narratorResponseId: "resp_narration_approved",
        rejectionStage: "accepted",
      });
      expect(runtimeAttempts).toContainEqual(
        expect.objectContaining({ errorCode: "NARRATIVE_AUDIT_REJECTED", phase: "narration" }),
      );
      const committedChapter = store.loadChapter("ashen-crown-v1", 1);
      if (!committedChapter) throw new Error("Committed chapter missing");
      const committedTrace = store.loadTrace(committedChapter.traceId);
      if (!committedTrace) throw new Error("Committed trace missing");
      expect(committedTrace.pricingVersion).toBe(expectedPricingVersion);
      expect(
        committedTrace.attempts.every(
          ({ requestedServiceTier, serviceTier }) =>
            requestedServiceTier === requestedTier && serviceTier === requestedTier,
        ),
      ).toBe(true);
      expect(
        committedTrace.calls.every(
          ({ requestedServiceTier, serviceTier }) =>
            requestedServiceTier === requestedTier && serviceTier === requestedTier,
        ),
      ).toBe(true);
      const committedRunId = committedTrace.runId;
      expect(new Set(runtimeTurns.map(({ turnId }) => turnId))).toEqual(new Set([committedRunId]));
      expect(runtimeTurns.every(({ requestId }) => requestId === command.requestId)).toBe(true);
      expect(narrativeCandidates.every(({ turn }) => turn.turnId === committedRunId)).toBe(true);
      const calls = result.godMode.calls as readonly {
        model: string;
        phase: string;
        retries: number;
      }[];
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ model: "gpt-5.6-luna", phase: "intent" }),
          expect.objectContaining({ model: "gpt-5.6-luna", phase: "narration" }),
          expect.objectContaining({ model: "gpt-5.6-luna", phase: "audit" }),
        ]),
      );
      expect(stream.mock.calls.map(([body]) => (body as { model?: string }).model)).toEqual([
        "gpt-5.6-luna",
        "gpt-5.6-luna",
      ]);
      expect(
        parse.mock.calls.map(([body]) => (body as { service_tier?: string }).service_tier),
      ).toEqual([responseTier, responseTier]);
      expect(
        stream.mock.calls.map(([body]) => (body as { service_tier?: string }).service_tier),
      ).toEqual([responseTier, responseTier]);
      expect(calls[1]?.retries).toBe(1);
      const duplicate = await service.takeTurn(command);
      expect(duplicate.world).toMatchObject({ chapter: 1, version: 2 });
      expect(parse).toHaveBeenCalledTimes(2);
      expect(stream).toHaveBeenCalledTimes(2);
      await expect(
        service.takeTurn({
          ...command,
          requestId: "00000000-0000-4000-8000-000000000002",
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(service.exportJson()).not.toContain("Malachar contained the Void beneath his throne");
      expect(service.exportJson("god")).toContain("Malachar contained the Void beneath his throne");
      store.close();
    },
  );

  it("rejects automatic continuation at an incomplete milestone before any model call", async () => {
    const store = new StoryStore();
    const locked = milestoneLockedWorld();
    const create = vi.fn();
    const stream = vi.fn();
    const service = new StoryService(
      store,
      { responses: { create, stream } } as unknown as OpenAI,
      options(),
      () => locked,
    );
    const view = service.selectPov("rowan-ashborn");

    expect(view.continuationPlan).toBeNull();
    await expect(
      service.takeTurn({
        approvedThroughChapter: 47,
        expectedWorldVersion: locked.version,
        requestId: "00000000-0000-4000-8000-000000000147",
        type: "continue_story",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(create).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    store.close();
  });

  it("continues with the persisted recommended choice on routine chapters", async () => {
    const store = new StoryStore();
    const prose = Array.from({ length: 900 }, (_, index) => `ember${index}`).join(" ");
    const proseHash = createHash("sha256").update(prose).digest("hex");
    const frame = {
      choices: [],
      terminal: false,
      title: "The Ash Road",
    } as const;
    const audit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The chapter follows committed canon.",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash,
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const create = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(frame, "resp_frame_1"))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_audit_1"))
      .mockResolvedValueOnce(parsedResponse(frame, "resp_frame_2"))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_audit_2"));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(prose, "resp_narration_1"))
      .mockReturnValueOnce(fakeStream(prose, "resp_narration_2"));
    const service = new StoryService(
      store,
      { responses: { create, stream } } as unknown as OpenAI,
      options(),
    );
    const opening = service.selectPov("rowan-ashborn");
    const first = await service.takeTurn({
      choiceId: opening.chapter.choices[0]?.id ?? "missing",
      expectedWorldVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000151",
      type: "take_action",
    });
    const recommended = first.chapter.choices.find(({ id }) => id === "choice-1");
    if (!recommended) throw new Error("Recommended choice missing");

    expect(first.continuationPlan).toEqual({
      chapterCount: 46,
      endChapter: 47,
      maxCostUsd: 46,
      maxCostUsdPerChapter: 1,
    });
    await expect(
      service.takeTurn({
        approvedThroughChapter: 100,
        expectedWorldVersion: 2,
        requestId: "00000000-0000-4000-8000-000000000154",
        type: "continue_story",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(stream).toHaveBeenCalledTimes(1);

    const continued = await service.takeTurn({
      approvedThroughChapter: 47,
      expectedWorldVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000152",
      type: "continue_story",
    });

    expect(continued.world).toMatchObject({ chapter: 2, version: 3 });
    expect(store.loadChapter("ashen-crown-v1", 2)?.playerAction).toMatchObject({
      action: recommended.action,
      description: recommended.description,
      source: "suggested",
    });
    expect(create).toHaveBeenCalledTimes(4);
    expect(stream).toHaveBeenCalledTimes(2);
    store.close();
  });

  it("rejects automatic continuation at the chapter-100 demo horizon before model work", async () => {
    const store = new StoryStore();
    const horizon = demoHorizonWorld();
    const create = vi.fn();
    const stream = vi.fn();
    const service = new StoryService(
      store,
      { responses: { create, stream } } as unknown as OpenAI,
      options(),
      () => horizon,
    );
    const view = service.selectPov("rowan-ashborn");

    expect(view.continuationPlan).toBeNull();
    await expect(
      service.takeTurn({
        approvedThroughChapter: 100,
        expectedWorldVersion: horizon.version,
        requestId: "00000000-0000-4000-8000-000000000153",
        type: "continue_story",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(create).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    store.close();
  });

  it.each([
    {
      characterId: "rowan-ashborn" as const,
      defect: "Two mana left him in a measured thread. His mana settled at sixteen of eighteen.",
      expectedIssue: "mana as 16/18",
      label: "uncommitted mana spend",
    },
    {
      characterId: "elara-voss" as const,
      defect:
        "She crossed beneath them into the shadow of Aurelis Capital. Stone replaced packed earth.",
      expectedIssue: "arrival at Aurelis Capital",
      label: "movement beyond the committed destination",
    },
    {
      characterId: "lucan-aurelis" as const,
      defect: "Lucan judged it likely that Varek Thorn planned to stage a border coup.",
      expectedIssue: "Lucan Aurelis's canon to Varek Thorn",
      label: "private plan attributed to another character",
    },
  ])("rejects live $label before model audit", async ({ characterId, defect, expectedIssue }) => {
    const store = new StoryStore();
    const rejectedProse = exactWordCount(defect, 900, "ash");
    const acceptedProse = exactWordCount(
      "The road held steady while the viewpoint character completed the accepted action.",
      900,
      "cinder",
    );
    const proseHash = createHash("sha256").update(acceptedProse).digest("hex");
    const frame = { choices: [], terminal: false, title: "The Canon Road" };
    const audit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "pass",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash,
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(frame, `resp_${characterId}_frame`))
      .mockResolvedValueOnce(parsedResponse(audit, `resp_${characterId}_audit`));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(rejectedProse, `resp_${characterId}_rejected`))
      .mockReturnValueOnce(fakeStream(acceptedProse, `resp_${characterId}_accepted`));
    const draftRejections: (readonly ValidationIssue[])[] = [];
    const narrativeCandidates: NarrativeCandidateEvidence[] = [];
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      {
        ...options(),
        onNarrativeCandidate: (candidate) => narrativeCandidates.push(candidate),
        onNarrativeDraftRejected: (issues) => draftRejections.push(issues),
      },
    );
    const selected = service.selectPov(characterId);

    const result = await service.takeTurn({
      choiceId: selected.chapter.choices[0]?.id ?? "missing",
      expectedWorldVersion: 1,
      requestId:
        characterId === "rowan-ashborn"
          ? "00000000-0000-4000-8000-000000000210"
          : "00000000-0000-4000-8000-000000000211",
      type: "take_action",
    });

    expect(result.world).toMatchObject({ chapter: 1, version: 2 });
    expect(draftRejections).toHaveLength(1);
    expect(draftRejections[0]).toEqual([
      expect.objectContaining({
        code: "INVALID_SCHEMA",
        message: expect.stringContaining(expectedIssue),
        path: "prose",
      }),
    ]);
    expect(narrativeCandidates).toHaveLength(2);
    expect(narrativeCandidates[0]).toMatchObject({
      accepted: false,
      audit: null,
      rejectionStage: "deterministic",
    });
    expect(narrativeCandidates[1]).toMatchObject({
      accepted: true,
      rejectionStage: "accepted",
    });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(stream).toHaveBeenCalledTimes(2);
    store.close();
  });

  it("never echoes hidden canon into narration retries", async () => {
    const store = new StoryStore();
    const hiddenClaim = "Malachar contained the Void beneath his throne.";
    const hiddenFactId = "malachar-contained-the-void";
    const hiddenProse = `${hiddenClaim} ${Array.from({ length: 841 }, (_, index) => `ember${index}`).join(" ")}`;
    const auditedProse = Array.from({ length: 900 }, (_, index) => `cinder${index}`).join(" ");
    const frame = {
      choices: [
        {
          action: { type: "wait" },
          description: "Wait and watch the road for movement.",
          id: "choice-1",
          milestoneId: null,
        },
        {
          action: { subjectId: "ash-road", type: "investigate" },
          description: "Inspect the ash road for a fresh trail.",
          id: "choice-2",
          milestoneId: null,
        },
      ],
      terminal: false,
      title: "The Ash Road",
    } as const;
    const rejectedAudit: NarrativeAudit = {
      approved: false,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail:
          dimension === "povSafety"
            ? `The prose exposes ${hiddenClaim}`
            : "The chapter passes this dimension.",
        dimension,
        issueCode: dimension === "povSafety" ? "hidden-knowledge" : "pass",
      })),
      leakedFactIds: [hiddenFactId],
      proseHash: createHash("sha256").update(auditedProse).digest("hex"),
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 0,
        prose: 2,
      },
    };
    const approvedAudit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The regenerated chapter stays inside supplied viewpoint canon.",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash: createHash("sha256").update(auditedProse).digest("hex"),
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(frame, "resp_safe_retry_frame"))
      .mockResolvedValueOnce(parsedResponse(rejectedAudit, "resp_hidden_audit"))
      .mockResolvedValueOnce(parsedResponse(approvedAudit, "resp_safe_audit"));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(hiddenProse, "resp_literal_hidden_draft"))
      .mockReturnValueOnce(fakeStream(auditedProse, "resp_semantic_hidden_draft"));
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      options(),
    );
    const selected = service.selectPov("rowan-ashborn");

    const result = await service.takeTurn({
      choiceId: selected.chapter.choices[0]?.id ?? "missing",
      expectedWorldVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000352",
      type: "take_action",
    });

    expect(result.chapter.prose).toBe(auditedProse);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(3);
    const deterministicRetryInput = (stream.mock.calls[1]?.[0] as { input?: string } | undefined)
      ?.input;
    expect(deterministicRetryInput).toBeTypeOf("string");
    expect(deterministicRetryInput).not.toContain(hiddenClaim);
    expect(deterministicRetryInput).not.toContain(hiddenFactId);
    expect(deterministicRetryInput).toContain("POV_LEAK");
    const rejectedAuditInput = (parse.mock.calls[1]?.[0] as { input?: string } | undefined)?.input;
    const acceptedAuditInput = (parse.mock.calls[2]?.[0] as { input?: string } | undefined)?.input;
    expect(rejectedAuditInput).toBe(acceptedAuditInput);
    expect(rejectedAuditInput).toContain(auditedProse);
    store.close();
  });

  it.each([
    {
      continuationWordCount: 132,
      expectedMaximumAdditionalWords: 181,
      name: "the live 768-word lower eligibility path",
      rawWordCount: 768,
    },
    {
      continuationWordCount: 88,
      expectedMaximumAdditionalWords: 137,
      name: "the existing 812 plus 88 word three-agent path",
      rawWordCount: 812,
    },
    {
      continuationWordCount: 91,
      expectedMaximumAdditionalWords: 99,
      name: "the live 850 plus 91 word defect",
      rawWordCount: 850,
    },
  ])("repairs $name under the release cap", async (testCase) => {
    const store = new StoryStore();
    const rawProse = Array.from({ length: testCase.rawWordCount }, () => "ember").join(" ");
    const continuation = Array.from(
      { length: testCase.continuationWordCount },
      () => "cinder",
    ).join(" ");
    const prose = `${rawProse} ${continuation}`;
    const mergedWordCount = testCase.rawWordCount + testCase.continuationWordCount;
    const proseHash = createHash("sha256").update(prose).digest("hex");
    const actorIds = ["lucan-aurelis", "maelin-rook", "nyra-vale"] as const;
    const meteredUsage = usage(1_000, 200);
    const frame = {
      choices: [
        {
          action: { type: "wait" },
          description: "Wait and study the road before committing.",
          id: "choice-1",
          milestoneId: null,
        },
        {
          action: { subjectId: "capital-road", type: "investigate" },
          description: "Inspect Capital Road for immediate danger.",
          id: "choice-2",
          milestoneId: null,
        },
      ],
      terminal: false,
      title: "The Capital Road",
    } as const;
    const unsafeFrame = {
      ...frame,
      title: "Malachar contained the Void beneath his throne.",
    } as const;
    const audit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The chapter stays inside supplied canon.",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash,
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(waitIntent(), "resp_lucan", meteredUsage))
      .mockResolvedValueOnce(parsedResponse(waitIntent(), "resp_maelin", meteredUsage))
      .mockResolvedValueOnce(parsedResponse(waitIntent(), "resp_nyra", meteredUsage))
      .mockResolvedValueOnce(
        parsedResponse(unsafeFrame, "resp_frame_hidden_1", usage(1_853, 112, 0, 1_850)),
      )
      .mockResolvedValueOnce(
        parsedResponse(unsafeFrame, "resp_frame_hidden_2", usage(1_853, 112, 1_850)),
      )
      .mockResolvedValueOnce(parsedResponse(frame, "resp_frame_three", usage(1_853, 114, 1_850)))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_audit_three", meteredUsage));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(rawProse, "resp_narration_three", usage(1_252, 1_052)))
      .mockReturnValueOnce(fakeStream(continuation, "resp_recovery_three", usage(300, 80)));
    const count = vi
      .fn()
      .mockResolvedValueOnce({ input_tokens: 1_400, object: "response.input_tokens" })
      .mockResolvedValueOnce({ input_tokens: 3_200, object: "response.input_tokens" });
    const narrativeCandidates: NarrativeCandidateEvidence[] = [];
    const service = new StoryService(
      store,
      { responses: { create: parse, inputTokens: { count }, stream } } as unknown as OpenAI,
      {
        maxBackgroundAgents: 3,
        maxCostUsdPerChapter: 0.0405,
        nativeMultiAgent: false,
        onNarrativeCandidate: (candidate) => narrativeCandidates.push(candidate),
      },
    );
    const selected = service.selectPov("elara-voss");

    const replayed: string[] = [];
    const result = await service.takeTurn(
      {
        choiceId: selected.chapter.choices[0]?.id ?? "missing",
        expectedWorldVersion: 1,
        requestId: "00000000-0000-4000-8000-000000000050",
        type: "take_action",
      },
      (chunk) => {
        replayed.push(chunk);
      },
    );

    expect(result.world).toMatchObject({ chapter: 1, version: 2 });
    expect(result.estimatedCostUsd).toBeLessThanOrEqual(0.0405);
    expect(result.chapter.prose).toBe(prose);
    expect(parse).toHaveBeenCalledTimes(7);
    expect(parse.mock.calls.slice(0, 3).map(([body]) => (body as { input: string }).input)).toEqual(
      [
        "Use assigned actor instructions. Intent only.",
        "Use assigned actor instructions. Intent only.",
        "Use assigned actor instructions. Intent only.",
      ],
    );
    expect(
      parse.mock.calls.slice(3, 6).map(([body]) => (body as { instructions: string }).instructions),
    ).toEqual([
      expect.stringContaining("optionsByIdAsDescription"),
      expect.stringContaining("optionsByIdAsDescription"),
      expect.stringContaining("optionsByIdAsDescription"),
    ]);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(count).not.toHaveBeenCalled();
    expect(replayed.join("")).toBe(prose);
    expect(narrativeCandidates).toHaveLength(1);
    expect(narrativeCandidates[0]).toMatchObject({
      accepted: true,
      auditResponseId: "resp_audit_three",
      mergedProse: prose,
      mergedWordCount,
      narratorResponseId: "resp_narration_three",
      rawProse,
      rawWordCount: testCase.rawWordCount,
      recovery: {
        accepted: true,
        maximumAdditionalWords: testCase.expectedMaximumAdditionalWords,
        minimumAdditionalWords: 900 - testCase.rawWordCount,
        prose: continuation,
        responseId: "resp_recovery_three",
        wordCount: testCase.continuationWordCount,
      },
    });
    const calls = result.godMode.calls as readonly {
      agentId: string | null;
      model: string;
      phase: string;
    }[];
    expect(calls.filter(({ agentId }) => agentId !== null).map(({ agentId }) => agentId)).toEqual(
      actorIds,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "gpt-5.6-luna", phase: "narration" }),
        expect.objectContaining({ model: "gpt-5.6-luna", phase: "recovery" }),
        expect.objectContaining({ model: "gpt-5.6-luna", phase: "audit" }),
      ]),
    );
    const chapter = store.loadChapter("ashen-crown-v1", 1);
    if (!chapter) throw new Error("Three-agent recovery chapter missing");
    const trace = store.loadTrace(chapter.traceId);
    if (!trace) throw new Error("Three-agent recovery trace missing");
    expect(chapter.proseHash).toBe(proseHash);
    expect(chapter.narrativeAudit.proseHash).toBe(proseHash);
    expect(trace.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "gpt-5.6-luna", phase: "recovery" }),
      ]),
    );
    expect(trace.totalEstimatedCostUsd).toBe(
      trace.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
    );
    expect(trace.totalUsage.totalTokens).toBe(
      trace.attempts.reduce((sum, attempt) => sum + attempt.usage.totalTokens, 0),
    );
    store.close();
  });

  it.each([
    { name: "below the minimum", rejectedWordCount: 10 },
    { name: "above the acceptance ceiling", rejectedWordCount: 130 },
  ])("records recovery $name before retrying narration", async ({ rejectedWordCount }) => {
    const store = new StoryStore();
    const rawProse = "ember ".repeat(820).trim();
    const rejectedContinuation = "cinder ".repeat(rejectedWordCount).trim();
    const finalProse = "ash ".repeat(900).trim();
    const frame = {
      choices: [
        {
          action: { type: "wait" },
          description: "Wait and watch the road for movement.",
          id: "choice-1",
          milestoneId: null,
        },
        {
          action: { subjectId: "ash-road", type: "investigate" },
          description: "Inspect the ash road for a fresh trail.",
          id: "choice-2",
          milestoneId: null,
        },
      ],
      terminal: false,
      title: "The Ash Road",
    } as const;
    const audit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The chapter stays inside supplied canon.",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash: createHash("sha256").update(finalProse).digest("hex"),
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(frame, "resp_recovery_frame"))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_recovery_audit"));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(rawProse, "resp_short_narration"))
      .mockReturnValueOnce(fakeStream(rejectedContinuation, "resp_bad_recovery"))
      .mockReturnValueOnce(fakeStream(finalProse, "resp_retried_narration"));
    const narrativeCandidates: NarrativeCandidateEvidence[] = [];
    const narrativeResponses: NarrativeResponseEvidence[] = [];
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      {
        ...options(),
        maxBackgroundAgents: 0,
        onNarrativeCandidate: (candidate) => narrativeCandidates.push(candidate),
        onNarrativeResponse: (response) => narrativeResponses.push(response),
      },
    );
    const selected = service.selectPov("rowan-ashborn");

    const result = await service.takeTurn({
      choiceId: selected.chapter.choices[0]?.id ?? "missing",
      expectedWorldVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000353",
      type: "take_action",
    });

    expect(result.chapter.prose).toBe(finalProse);
    expect(narrativeCandidates).toHaveLength(2);
    expect(narrativeResponses.map(({ phase, responseId }) => [phase, responseId])).toEqual([
      ["narration", "resp_short_narration"],
      ["recovery", "resp_bad_recovery"],
      ["narration", "resp_retried_narration"],
      ["audit", "resp_recovery_audit"],
    ]);
    expect(narrativeCandidates[0]).toMatchObject({
      accepted: false,
      mergedProse: rawProse,
      narratorResponseId: "resp_short_narration",
      rawWordCount: 820,
      recovery: {
        accepted: false,
        maximumAdditionalWords: 129,
        minimumAdditionalWords: 80,
        prose: rejectedContinuation,
        responseId: "resp_bad_recovery",
        wordCount: rejectedWordCount,
      },
      rejectionStage: "recovery",
    });
    expect(narrativeCandidates[1]).toMatchObject({
      accepted: true,
      narratorAttempt: 1,
      narratorResponseId: "resp_retried_narration",
      rejectionStage: "accepted",
    });
    const retryInput = (stream.mock.calls[2]?.[0] as { input?: string } | undefined)?.input;
    expect(retryInput).toContain("prior draft had 820 words");
    expect(retryInput).not.toContain(rawProse);
    store.close();
  });

  it.each([
    {
      expectedPricingVersion: PRICING_VERSION,
      requestedTier: "standard" as const,
      responseTier: "default" as const,
    },
    {
      expectedPricingVersion: FLEX_PRICING_VERSION,
      requestedTier: "flex" as const,
      responseTier: "flex" as const,
    },
  ])(
    "stops after exhausted same-prose audit retries on $requestedTier",
    async ({ expectedPricingVersion, requestedTier, responseTier }) => {
      const store = new StoryStore();
      const firstProse = Array.from({ length: 900 }, (_, index) => `ember${index}`).join(" ");
      const proseHash = createHash("sha256").update(firstProse).digest("hex");
      const frame = {
        choices: [
          {
            action: { type: "wait" },
            description: "Wait and watch the road for movement.",
            id: "choice-1",
            milestoneId: null,
          },
          {
            action: { subjectId: "ash-road", type: "investigate" },
            description: "Inspect the ash road for a fresh trail.",
            id: "choice-2",
            milestoneId: null,
          },
        ],
        terminal: false,
        title: "The Ash Road",
      } as const;
      const audit: NarrativeAudit = {
        approved: true,
        evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
          detail: "The chapter obeys the selected viewpoint and committed action.",
          dimension,
          issueCode: "pass",
        })),
        leakedFactIds: [],
        proseHash,
        scores: {
          arcProgress: 2,
          characterAutonomy: 2,
          choiceFulfillment: 2,
          continuity: 2,
          litrpgMechanics: 2,
          povSafety: 2,
          prose: 2,
        },
      };
      const invalidAudit = {
        ...audit,
        approved: false,
        leakedFactIds: ["invented-audit-fact"],
      } as const;
      const parse = vi
        .fn()
        .mockResolvedValueOnce(parsedResponse(frame, "resp_frame_retry", usage(), responseTier))
        .mockResolvedValueOnce(
          parsedResponse(invalidAudit, "resp_audit_bad_1", usage(), responseTier),
        )
        .mockResolvedValueOnce(
          parsedResponse(invalidAudit, "resp_audit_bad_2", usage(), responseTier),
        )
        .mockResolvedValueOnce(
          parsedResponse(invalidAudit, "resp_audit_bad_3", usage(), responseTier),
        );
      const stream = vi
        .fn()
        .mockReturnValueOnce(
          fakeStream(firstProse, "resp_narration_audit_failed", usage(), responseTier),
        );
      const narrativeCandidates: NarrativeCandidateEvidence[] = [];
      const runtimeTurns: NarrativeTurnIdentity[] = [];
      const service = new StoryService(
        store,
        { responses: { create: parse, stream } } as unknown as OpenAI,
        {
          ...options(),
          onNarrativeCandidate: (candidate) => narrativeCandidates.push(candidate),
          onRuntimeAttempt: (_attempt, turn) => runtimeTurns.push(turn),
          serviceTier: requestedTier,
        },
      );
      const selected = service.selectPov("rowan-ashborn");

      await expect(
        service.takeTurn({
          choiceId: selected.chapter.choices[0]?.id ?? "missing",
          expectedWorldVersion: 1,
          requestId: "00000000-0000-4000-8000-000000000003",
          type: "take_action",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_OUTPUT",
        message: "Narrative audit exhausted retries for the fixed prose",
      });

      expect(store.loadChapters("ashen-crown-v1")).toHaveLength(0);
      const failures = store.loadFailedTurnTraces("ashen-crown-v1");
      expect(failures).toHaveLength(1);
      const trace = failures[0];
      if (!trace) throw new Error("Failed trace missing");
      expect(trace.pricingVersion).toBe(expectedPricingVersion);
      expect(
        trace.attempts.every(
          ({ requestedServiceTier, serviceTier }) =>
            requestedServiceTier === requestedTier && serviceTier === requestedTier,
        ),
      ).toBe(true);
      expect(trace.attempts).toHaveLength(5);
      const failedAudits = trace.attempts.filter(
        ({ errorCode, phase }) => phase === "audit" && errorCode === "INVALID_OUTPUT",
      );
      expect(failedAudits.map(({ responseId }) => responseId)).toEqual([
        "resp_audit_bad_1",
        "resp_audit_bad_2",
        "resp_audit_bad_3",
      ]);
      expect(
        trace.attempts.some(
          ({ errorCode, phase, responseId }) =>
            phase === "narration" &&
            errorCode === "INVALID_OUTPUT" &&
            responseId === "resp_narration_audit_failed",
        ),
      ).toBe(true);
      const attemptCost = trace.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
      const attemptTokens = trace.attempts.reduce(
        (sum, attempt) => sum + attempt.usage.totalTokens,
        0,
      );
      expect(trace.totalEstimatedCostUsd).toBe(attemptCost);
      expect(trace.totalUsage.totalTokens).toBe(attemptTokens);
      expect(new Set(runtimeTurns.map(({ turnId }) => turnId))).toEqual(new Set([trace.runId]));
      expect(narrativeCandidates[0]?.turn.turnId).toBe(trace.runId);
      expect(narrativeCandidates).toEqual([
        expect.objectContaining({
          accepted: false,
          auditAttempts: expect.arrayContaining([
            expect.objectContaining({ responseId: "resp_audit_bad_1" }),
            expect.objectContaining({ responseId: "resp_audit_bad_2" }),
            expect.objectContaining({ responseId: "resp_audit_bad_3" }),
          ]),
          narratorAttempt: 0,
          narratorResponseId: "resp_narration_audit_failed",
          rawProse: firstProse,
          rejectionStage: "audit-invalid",
        }),
      ]);
      expect(parse).toHaveBeenCalledTimes(4);
      expect(stream).toHaveBeenCalledTimes(1);
      expect(
        parse.mock.calls.map(([body]) => (body as { service_tier?: string }).service_tier),
      ).toEqual(Array.from({ length: 4 }, () => responseTier));
      expect(
        stream.mock.calls.map(([body]) => (body as { service_tier?: string }).service_tier),
      ).toEqual([responseTier]);
      store.close();
    },
  );

  it("blocks chapter 351 before any model method runs", async () => {
    const store = new StoryStore();
    const terminal = terminalWorld();
    store.createWorld(terminal);
    const parse = vi.fn();
    const stream = vi.fn();
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      options(),
    );

    await expect(
      service.takeTurn({
        choiceId: "choice-1",
        expectedWorldVersion: terminal.version,
        requestId: "00000000-0000-4000-8000-000000000350",
        type: "take_action",
      }),
    ).rejects.toThrow("terminal");
    expect(parse).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    store.close();
  });

  it.each([
    "Investigate the immediate area for fresh tracks.",
    "Inspect local tracks for signs of passage.",
  ])(
    "rejects impossible local milestone investigation %s before any model call",
    async (description) => {
      const store = new StoryStore();
      const locked = milestoneLockedWorld();
      const parse = vi.fn();
      const stream = vi.fn();
      const service = new StoryService(
        store,
        { responses: { create: parse, stream } } as unknown as OpenAI,
        options(),
        () => locked,
      );
      service.selectPov("rowan-ashborn");

      await expect(
        service.takeTurn({
          description,
          expectedWorldVersion: locked.version,
          requestId: "00000000-0000-4000-8000-000000000047",
          type: "custom_action",
        }),
      ).rejects.toMatchObject({ status: 422 });

      expect(parse).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
      expect(store.loadWorldState("ashen-crown-v1")).toMatchObject({
        chapter: 47,
        version: 48,
      });
      store.close();
    },
  );

  it("translates a clear local investigation without a translator model call", async () => {
    const store = new StoryStore();
    const parse = vi.fn().mockRejectedValue(new Error("Stop after deterministic translation"));
    const stream = vi.fn();
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      options(),
    );
    service.selectPov("rowan-ashborn");

    await expect(
      service.takeTurn({
        description: "Investigate the immediate area for fresh tracks.",
        expectedWorldVersion: 1,
        requestId: "00000000-0000-4000-8000-000000000048",
        type: "custom_action",
      }),
    ).rejects.toThrow("Stop after deterministic translation");

    expect(parse).toHaveBeenCalledTimes(3);
    for (const [request] of parse.mock.calls) {
      const structuredRequest = request as
        { model?: string; text?: { format?: { name?: string } } } | undefined;
      expect(structuredRequest?.model).toBe("gpt-5.6-luna");
      expect(structuredRequest?.text?.format?.name).toBe("chapter_frame_candidate");
    }
    expect(stream).not.toHaveBeenCalled();
    expect(store.loadWorldState("ashen-crown-v1")).toMatchObject({ chapter: 0, version: 1 });
    store.close();
  });

  it("routes a compound local investigation through the translator model", async () => {
    const store = new StoryStore();
    const parse = vi.fn().mockRejectedValue(new Error("Stop inside translator"));
    const stream = vi.fn();
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      options(),
    );
    service.selectPov("rowan-ashborn");

    await expect(
      service.takeTurn({
        description: "Investigate the immediate area, then defend Nyra.",
        expectedWorldVersion: 1,
        requestId: "00000000-0000-4000-8000-000000000049",
        type: "custom_action",
      }),
    ).rejects.toThrow("Stop inside translator");

    expect(parse).toHaveBeenCalledTimes(3);
    for (const [request] of parse.mock.calls) {
      const structuredRequest = request as
        { model?: string; text?: { format?: { name?: string } } } | undefined;
      expect(structuredRequest?.model).toBe("gpt-5.6-terra");
      expect(structuredRequest?.text?.format?.name).toBe("player_action");
    }
    expect(stream).not.toHaveBeenCalled();
    store.close();
  });

  it("retries invalid custom investigation translations before resolution", async () => {
    const store = new StoryStore();
    const description = "Investigate the known reincarnation memory.";
    const actionFields = {
      actorId: "rowan-ashborn",
      description,
      milestoneId: null,
      source: "custom",
      stateVersion: 1,
    } as const;
    const translatedWait = { ...actionFields, action: { type: "wait" } } as const;
    const translatedWrongTarget = {
      ...actionFields,
      action: { subjectId: "capital", type: "investigate" },
    } as const;
    const translatedKnownInvestigation = {
      ...actionFields,
      action: { subjectId: "rowan-is-malachar-reincarnated", type: "investigate" },
    } as const;
    const prose = Array.from({ length: 900 }, (_, index) => `track${index}`).join(" ");
    const frame = {
      choices: [
        {
          action: { type: "wait" },
          description: "Wait and watch the village edge.",
          id: "choice-1",
          milestoneId: null,
        },
        {
          action: { subjectId: "cinder-village", type: "investigate" },
          description: "Search the village edge for another trail.",
          id: "choice-2",
          milestoneId: null,
        },
      ],
      terminal: false,
      title: "Tracks in Cinder",
    } as const;
    const audit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The chapter fulfills the local investigation inside visible canon.",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash: createHash("sha256").update(prose).digest("hex"),
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(translatedWait, "resp_custom_wait_1"))
      .mockResolvedValueOnce(parsedResponse(translatedWrongTarget, "resp_custom_target_2"))
      .mockResolvedValueOnce(parsedResponse(translatedKnownInvestigation, "resp_custom_valid_3"))
      .mockResolvedValueOnce(parsedResponse(frame, "resp_custom_frame"))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_custom_audit"));
    const stream = vi.fn().mockReturnValueOnce(fakeStream(prose, "resp_custom_narration"));
    const service = new StoryService(
      store,
      { responses: { create: parse, stream } } as unknown as OpenAI,
      options(),
    );
    service.selectPov("rowan-ashborn");

    const result = await service.takeTurn({
      description,
      expectedWorldVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000351",
      type: "custom_action",
    });

    expect(parse).toHaveBeenCalledTimes(5);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.world).toMatchObject({ chapter: 1, version: 2 });
    const chapter = store.loadChapter("ashen-crown-v1", 1);
    if (!chapter) throw new Error("Custom chapter missing");
    const trace = store.loadTrace(chapter.traceId);
    if (!trace) throw new Error("Custom trace missing");
    expect(trace.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorCode: "INVALID_OUTPUT",
          phase: "intent",
          responseId: "resp_custom_wait_1",
        }),
        expect.objectContaining({
          errorCode: "INVALID_OUTPUT",
          phase: "intent",
          responseId: "resp_custom_target_2",
        }),
      ]),
    );
    expect(trace.calls[0]).toMatchObject({ phase: "intent", retries: 2 });
    expect(store.loadFailedTurnTraces("ashen-crown-v1")).toEqual([]);
    store.close();
  });

  it("persists every model attempt when a turn fails before commit", async () => {
    const store = new StoryStore();
    const unsafeFrame = {
      choices: [
        {
          action: { type: "wait" },
          description: "Wait and watch the road for movement.",
          id: "choice-1",
          milestoneId: null,
        },
        {
          action: { subjectId: "ash-road", type: "investigate" },
          description: "Inspect the ash road for a fresh trail.",
          id: "choice-2",
          milestoneId: null,
        },
      ],
      terminal: false,
      title: "Malachar contained the Void beneath his throne.",
    } as const;
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse(unsafeFrame, "resp_failed_frame_1"))
      .mockResolvedValueOnce(parsedResponse(unsafeFrame, "resp_failed_frame_2"))
      .mockResolvedValueOnce(parsedResponse(unsafeFrame, "resp_failed_frame_3"));
    const stream = vi.fn();
    const client = { responses: { create: parse, stream } } as unknown as OpenAI;
    const service = new StoryService(store, client, options());
    const selected = service.selectPov("rowan-ashborn");
    const command = {
      choiceId: selected.chapter.choices[0]?.id ?? "missing",
      expectedWorldVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000004",
      type: "take_action" as const,
    };

    await expect(service.takeTurn(command)).rejects.toMatchObject({ code: "INVALID_OUTPUT" });

    const failures = store.loadFailedTurnTraces("ashen-crown-v1");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      attemptedChapter: 1,
      commandType: "take_action",
      errorCode: "INVALID_OUTPUT",
      gateResult: "failed",
      requestId: "00000000-0000-4000-8000-000000000004",
      worldVersion: 1,
    });
    expect(failures[0]?.attempts.map(({ responseId }) => responseId)).toEqual([
      "resp_failed_frame_1",
      "resp_failed_frame_2",
      "resp_failed_frame_3",
    ]);
    expect(failures[0]?.totalEstimatedCostUsd).toBe(
      failures[0]?.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
    );
    expect(store.loadWorldState("ashen-crown-v1")).toMatchObject({ chapter: 0, version: 1 });
    expect(store.loadChapters("ashen-crown-v1")).toEqual([]);
    expect(stream).not.toHaveBeenCalled();

    const priorExposure = failures[0]?.totalEstimatedCostUsd ?? 0;
    parse.mockClear();
    const retryService = new StoryService(store, client, {
      ...options(),
      maxCostUsdPerChapter: priorExposure + 0.000_000_001,
    });
    await expect(retryService.takeTurn(command)).rejects.toMatchObject({
      code: "COST_CAP_EXCEEDED",
    });
    expect(parse).not.toHaveBeenCalled();
    expect(store.loadFailedTurnTraces("ashen-crown-v1")).toHaveLength(1);

    const recoveredProse = Array.from({ length: 900 }, (_, index) => `recovery${index}`).join(" ");
    const recoveredAudit: NarrativeAudit = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The recovered chapter stays inside visible canon.",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash: createHash("sha256").update(recoveredProse).digest("hex"),
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    parse
      .mockResolvedValueOnce(
        parsedResponse({ ...unsafeFrame, title: "Recovered Ash" }, "resp_recovered_frame"),
      )
      .mockResolvedValueOnce(parsedResponse(recoveredAudit, "resp_recovered_audit"));
    stream.mockReturnValueOnce(fakeStream(recoveredProse, "resp_recovered_narration"));
    const recovered = await new StoryService(store, client, options()).takeTurn(command);
    const recoveredChapter = store.loadChapter("ashen-crown-v1", 1);
    if (!recoveredChapter) throw new Error("Recovered chapter missing");
    const recoveredTrace = store.loadTrace(recoveredChapter.traceId);
    if (!recoveredTrace) throw new Error("Recovered trace missing");
    expect(recovered.chapter.title).toBe("Recovered Ash");
    expect(recoveredTrace.attempts).toHaveLength(6);
    expect(recoveredTrace.attempts.slice(0, 3).map(({ responseId }) => responseId)).toEqual([
      "resp_failed_frame_1",
      "resp_failed_frame_2",
      "resp_failed_frame_3",
    ]);
    expect(recoveredChapter.estimatedCostUsd).toBe(recoveredTrace.totalEstimatedCostUsd);
    expect(recoveredChapter.estimatedCostUsd).toBeGreaterThan(priorExposure);
    store.close();
  });

  it("rejects mismatched audit issue codes and invented leak IDs", () => {
    const base: NarrativeAudit = {
      approved: false,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The chapter contains an unsupported durable contradiction.",
        dimension,
        issueCode: dimension === "continuity" ? "contradiction" : "pass",
      })),
      leakedFactIds: [],
      proseHash: "a".repeat(64),
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 0,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    };
    const wrongIssueCode: NarrativeAudit = {
      ...base,
      evidence: base.evidence.map((entry, index) =>
        index === 4 ? { ...entry, issueCode: "prose-quality" } : entry,
      ),
    };
    expect(() =>
      validateNarrativeAuditOutput(wrongIssueCode, wrongIssueCode.proseHash, new Set()),
    ).toThrow("invalid issue code");

    const inventedLeak: NarrativeAudit = {
      ...base,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The chapter contains an unsupported hidden-fact leak.",
        dimension,
        issueCode:
          dimension === "continuity"
            ? "contradiction"
            : dimension === "povSafety"
              ? "hidden-knowledge"
              : "pass",
      })),
      leakedFactIds: ["invented-public-threat-id"],
      scores: { ...base.scores, continuity: 0, povSafety: 0 },
    };
    expect(() =>
      validateNarrativeAuditOutput(inventedLeak, inventedLeak.proseHash, new Set(["real-fact"])),
    ).toThrow("invented leaked fact ID");
  });

  it("derives audit approval and locks the prose hash deterministically", () => {
    const prose = "The chapter stays inside supplied canon.";
    const expectedHash = createHash("sha256").update(prose).digest("hex");
    const candidate: NarrativeAuditCandidate = {
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map(() => "The chapter stays inside supplied canon."),
      leakEvidence: [],
      scores: [2, 2, 2, 2, 2, 1, 1],
    };

    expect(canonicalizeNarrativeAuditOutput(candidate, prose, new Map())).toMatchObject({
      approved: true,
      proseHash: expectedHash,
      scores: {
        arcProgress: 1,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 1,
      },
    });

    const rejectedProse = `${prose} Forbidden signal crossed the room.`;
    const rejected: NarrativeAuditCandidate = {
      ...candidate,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((_, index) =>
        index === 2 || index === 4
          ? "Forbidden signal crossed the room."
          : "The chapter stays inside supplied canon.",
      ),
      scores: [2, 2, 0, 2, 0, 1, 1] as NarrativeAuditCandidate["scores"],
    };
    expect(canonicalizeNarrativeAuditOutput(rejected, rejectedProse, new Map())).toMatchObject({
      approved: false,
      evidence: expect.arrayContaining([
        expect.objectContaining({ dimension: "povSafety", issueCode: "hidden-knowledge" }),
        expect.objectContaining({ dimension: "continuity", issueCode: "unsupported-canon" }),
      ]),
    });
  });

  it("rejects an allowed reincarnation identity misreported as a hidden fact", () => {
    const prose = "Rowan remembered that he was Malachar reincarnated.";
    const candidate: NarrativeAuditCandidate = {
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((_, index) =>
        index === 2 ? prose : "The chapter stays inside supplied canon.",
      ),
      leakEvidence: [
        {
          factId: "malachar-contained-the-void",
          proseQuote: prose,
        },
      ],
      scores: [2, 2, 0, 2, 2, 2, 2],
    };

    expect(() =>
      canonicalizeNarrativeAuditOutput(
        candidate,
        prose,
        new Map([
          ["malachar-contained-the-void", "Malachar contained the Void beneath his throne."],
        ]),
      ),
    ).toThrow("lacks forbidden-fact anchors");
  });

  it("rejects a real forbidden fact grounded in an exact prose quote", () => {
    const prose = "Malachar contained the Void beneath his throne.";
    const candidate: NarrativeAuditCandidate = {
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((_, index) =>
        index === 2 ? prose : "The chapter stays inside supplied canon.",
      ),
      leakEvidence: [
        {
          factId: "malachar-contained-the-void",
          proseQuote: prose,
        },
      ],
      scores: [2, 2, 0, 2, 2, 2, 2],
    };

    expect(
      canonicalizeNarrativeAuditOutput(
        candidate,
        prose,
        new Map([
          ["malachar-contained-the-void", "Malachar contained the Void beneath his throne."],
        ]),
      ),
    ).toMatchObject({
      approved: false,
      leakedFactIds: ["malachar-contained-the-void"],
      scores: { povSafety: 0 },
    });
  });

  it("accepts multiple grounded quotes for one leaked fact and deduplicates its ID", () => {
    const prose =
      "Malachar contained the Void beneath his throne. The Void remained contained by Malachar.";
    const candidate: NarrativeAuditCandidate = {
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((_, index) =>
        index === 2 ? "Malachar contained the Void beneath his throne." : "pass",
      ),
      leakEvidence: [
        {
          factId: "malachar-contained-the-void",
          proseQuote: "Malachar contained the Void beneath his throne.",
        },
        {
          factId: "malachar-contained-the-void",
          proseQuote: "The Void remained contained by Malachar.",
        },
      ],
      scores: [2, 2, 0, 2, 2, 2, 2],
    };

    expect(
      canonicalizeNarrativeAuditOutput(
        candidate,
        prose,
        new Map([
          ["malachar-contained-the-void", "Malachar contained the Void beneath his throne."],
        ]),
      ).leakedFactIds,
    ).toEqual(["malachar-contained-the-void"]);
  });

  it("rejects a custom investigation translated as waiting", () => {
    const store = new StoryStore();
    const service = new StoryService(store, unusedClient(), options());
    service.selectPov("rowan-ashborn");
    const state = store.loadWorldState("ashen-crown-v1");
    if (!state) throw new Error("Seed world missing");
    const baseAction = {
      actorId: "rowan-ashborn",
      description: "Investigate the immediate area for fresh tracks.",
      milestoneId: null,
      source: "custom",
      stateVersion: 1,
    } as const;

    expect(() =>
      validateCustomActionTranslation(state, baseAction.description, {
        ...baseAction,
        action: { type: "wait" },
      }),
    ).toThrow("replaced an explicit investigation");
    expect(() =>
      validateCustomActionTranslation(state, baseAction.description, {
        ...baseAction,
        action: { subjectId: "cinder-village", type: "investigate" },
      }),
    ).not.toThrow();
    expect(() =>
      validateCustomActionTranslation(state, "Searching the immediate area.", {
        ...baseAction,
        action: { type: "wait" },
        description: "Searching the immediate area.",
      }),
    ).toThrow("replaced an explicit investigation");
    expect(() =>
      validateCustomActionTranslation(state, "Do not search; wait.", {
        ...baseAction,
        action: { type: "wait" },
        description: "Do not search; wait.",
      }),
    ).not.toThrow();
    expect(() =>
      validateCustomActionTranslation(state, "Search? No, wait.", {
        ...baseAction,
        action: { type: "wait" },
        description: "Search? No, wait.",
      }),
    ).not.toThrow();
    store.close();
  });
});

function options() {
  return {
    maxBackgroundAgents: 0,
    maxCostUsdPerChapter: 1,
    nativeMultiAgent: false,
  } as const;
}

function exactWordCount(seed: string, count: number, filler: string): string {
  const words = seed.trim().split(/\s+/u);
  return [...words, ...Array.from({ length: count - words.length }, () => filler)].join(" ");
}

function terminalWorld() {
  const store = new StoryStore();
  const service = new StoryService(store, unusedClient(), options());
  service.selectPov("rowan-ashborn");
  const state = store.loadWorldState("ashen-crown-v1");
  store.close();
  if (!state) throw new Error("Seed world missing");
  state.act = 7;
  state.calendar.day = 351;
  state.calendar.label = "Year 1, Ashfall 351";
  state.chapter = 350;
  state.terminal = true;
  state.terminalReason = "Chapter 350 terminal resolution";
  state.version = 351;
  for (const milestone of state.arcClock.milestones) milestone.completed = true;
  return state;
}

function milestoneLockedWorld() {
  const store = new StoryStore();
  const service = new StoryService(store, unusedClient(), options());
  service.selectPov("rowan-ashborn");
  const state = store.loadWorldState("ashen-crown-v1");
  store.close();
  if (!state) throw new Error("Seed world missing");
  state.arcClock.convergencePressure = true;
  state.calendar.day = 48;
  state.calendar.label = "Year 1, Ashfall 48";
  state.chapter = 47;
  state.version = 48;
  return state;
}

function demoHorizonWorld() {
  const store = new StoryStore();
  const service = new StoryService(store, unusedClient(), options());
  service.selectPov("rowan-ashborn");
  const state = store.loadWorldState("ashen-crown-v1");
  store.close();
  if (!state) throw new Error("Seed world missing");
  state.act = 3;
  state.calendar.day = 101;
  state.calendar.label = "Year 1, Ashfall 101";
  state.chapter = 100;
  state.version = 101;
  for (const milestone of state.arcClock.milestones) {
    if (milestone.act <= 2) milestone.completed = true;
  }
  return state;
}

function unusedClient(): OpenAI {
  return {
    responses: {
      create: vi.fn(() => {
        throw new Error("Unexpected model call");
      }),
      stream: vi.fn(() => {
        throw new Error("Unexpected model call");
      }),
    },
  } as unknown as OpenAI;
}

function parsedResponse<T>(
  output: T,
  id: string,
  responseUsage: ResponseUsage = usage(),
  serviceTier: "default" | "flex" = "default",
): Response {
  const modelOutput = structuredCandidateOutput(output);
  return {
    error: null,
    id,
    incomplete_details: null,
    output: [],
    output_text: JSON.stringify(modelOutput),
    service_tier: serviceTier,
    status: "completed",
    usage: responseUsage,
  } as unknown as Response;
}

function structuredCandidateOutput(output: unknown): unknown {
  if (
    typeof output === "object" &&
    output !== null &&
    "choices" in output &&
    "terminal" in output &&
    "title" in output &&
    !("prose" in output)
  ) {
    return { o: [], t: (output as { title: unknown }).title };
  }
  if (
    typeof output !== "object" ||
    output === null ||
    !("approved" in output) ||
    !("proseHash" in output) ||
    !("scores" in output) ||
    !("evidence" in output) ||
    !("leakedFactIds" in output)
  ) {
    return output;
  }
  const audit = output as NarrativeAudit;
  return {
    evidence: audit.evidence.map(({ detail }) => detail),
    leakEvidence: audit.leakedFactIds.map((factId) => ({
      factId,
      proseQuote:
        audit.evidence.find(({ dimension }) => dimension === "povSafety")?.detail ??
        "Missing POV evidence",
    })),
    scores: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => audit.scores[dimension]),
  };
}

function fakeStream(
  prose: string,
  id = "resp_narration",
  responseUsage: ResponseUsage = usage(),
  serviceTier: "default" | "flex" = "default",
) {
  const response = {
    error: null,
    id,
    incomplete_details: null,
    output: [],
    output_text: prose,
    service_tier: serviceTier,
    status: "completed",
    usage: responseUsage,
  } as unknown as Response;
  return {
    async *[Symbol.asyncIterator]() {
      yield { delta: prose, type: "response.output_text.delta" };
    },
    finalResponse: async () => response,
  };
}

function usage(
  inputTokens = 100,
  outputTokens = 20,
  cachedInputTokens = 0,
  cacheWriteTokens = 0,
): ResponseUsage {
  return {
    input_tokens: inputTokens,
    input_tokens_details: {
      cache_write_tokens: cacheWriteTokens,
      cached_tokens: cachedInputTokens,
    },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: 2 },
    total_tokens: inputTokens + outputTokens,
  };
}

function waitIntent(): BackgroundIntentCandidate {
  return {
    a: { t: "wait", v: [] },
    e: "Observe the current situation.",
    g: "Survive the chapter.",
    r: { f: [], i: [], s: [] },
  };
}
