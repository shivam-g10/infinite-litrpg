import { createHash } from "node:crypto";

import {
  CHARACTER_IDS,
  CONTRACT_VERSION,
  NARRATIVE_AUDIT_DIMENSIONS,
  PROMPT_VERSION,
  type NarrativeAudit,
  type NarrativeAuditCandidate,
  type TraceEnvelope,
  type ValidationIssue,
  type WorldIntent,
} from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import type { ParsedResponse, Response, ResponseUsage } from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";

import { StoryStore } from "../storage/story-store";
import {
  canonicalizeNarrativeAuditOutput,
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

  it("audits prose before one atomic chapter commit", async () => {
    const store = new StoryStore();
    const oversizedProse = Array.from({ length: 1_301 }, (_, index) => `excess${index}`).join(" ");
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
      .mockResolvedValueOnce(parsedResponse(frame, "resp_frame"))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_audit"));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(oversizedProse, "resp_narration_rejected"))
      .mockReturnValueOnce(fakeStream(prose, "resp_narration_approved"));
    const client = {
      responses: { parse, stream },
    } as unknown as OpenAI;
    const draftRejections: (readonly ValidationIssue[])[] = [];
    const runtimeAttempts: TraceEnvelope["attempts"] = [];
    const service = new StoryService(store, client, {
      ...options(),
      onNarrativeDraftRejected: (issues) => draftRejections.push(issues),
      onRuntimeAttempt: (attempt) => runtimeAttempts.push(attempt),
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
    expect(store.loadChapters("ashen-crown-v1")).toHaveLength(1);
    expect(replayed.join("")).toBe(prose);
    expect(store.loadFailedTurnTraces("ashen-crown-v1")).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(draftRejections).toHaveLength(1);
    expect(draftRejections[0]?.some(({ code }) => code === "INVALID_SCHEMA")).toBe(true);
    expect(runtimeAttempts).toContainEqual(
      expect.objectContaining({ errorCode: "NARRATIVE_AUDIT_REJECTED", phase: "narration" }),
    );
    const calls = result.godMode.calls as readonly {
      model: string;
      phase: string;
      retries: number;
    }[];
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "gpt-5.6-luna", phase: "intent" }),
        expect.objectContaining({ model: "gpt-5.6-terra", phase: "narration" }),
        expect.objectContaining({ model: "gpt-5.6-luna", phase: "audit" }),
      ]),
    );
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
  });

  it("never echoes hidden canon into narration retries", async () => {
    const store = new StoryStore();
    const hiddenClaim = "Malachar contained the Void beneath his throne.";
    const hiddenFactId = "malachar-contained-the-void";
    const hiddenProse = `${hiddenClaim} ${Array.from({ length: 841 }, (_, index) => `ember${index}`).join(" ")}`;
    const auditedProse = Array.from({ length: 900 }, (_, index) => `cinder${index}`).join(" ");
    const finalProse = Array.from({ length: 900 }, (_, index) => `ash${index}`).join(" ");
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
      .mockResolvedValueOnce(parsedResponse(frame, "resp_safe_retry_frame"))
      .mockResolvedValueOnce(parsedResponse(rejectedAudit, "resp_hidden_audit"))
      .mockResolvedValueOnce(parsedResponse(approvedAudit, "resp_safe_audit"));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(hiddenProse, "resp_literal_hidden_draft"))
      .mockReturnValueOnce(fakeStream(auditedProse, "resp_semantic_hidden_draft"))
      .mockReturnValueOnce(fakeStream(finalProse, "resp_safe_draft"));
    const service = new StoryService(
      store,
      { responses: { parse, stream } } as unknown as OpenAI,
      options(),
    );
    const selected = service.selectPov("rowan-ashborn");

    const result = await service.takeTurn({
      choiceId: selected.chapter.choices[0]?.id ?? "missing",
      expectedWorldVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000352",
      type: "take_action",
    });

    expect(result.chapter.prose).toBe(finalProse);
    expect(stream).toHaveBeenCalledTimes(3);
    const deterministicRetryInput = (stream.mock.calls[1]?.[0] as { input?: string } | undefined)
      ?.input;
    const auditRetryInput = (stream.mock.calls[2]?.[0] as { input?: string } | undefined)?.input;
    for (const retryInput of [deterministicRetryInput, auditRetryInput]) {
      expect(retryInput).toBeTypeOf("string");
      expect(retryInput).not.toContain(hiddenClaim);
      expect(retryInput).not.toContain(hiddenFactId);
    }
    expect(deterministicRetryInput).toContain("POV_LEAK");
    expect(auditRetryInput).toContain("povSafety: hidden-knowledge");
    store.close();
  });

  it("repairs an 848-word draft with three background agents under the release cap", async () => {
    const store = new StoryStore();
    const rawProse = Array.from({ length: 848 }, () => "ember").join(" ");
    const continuation = Array.from({ length: 52 }, () => "cinder").join(" ");
    const prose = `${rawProse} ${continuation}`;
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
      .mockResolvedValueOnce(parsedResponse(waitIntent(actorIds[0], 0), "resp_lucan", meteredUsage))
      .mockResolvedValueOnce(
        parsedResponse(waitIntent(actorIds[1], 1), "resp_maelin", meteredUsage),
      )
      .mockResolvedValueOnce(parsedResponse(waitIntent(actorIds[2], 2), "resp_nyra", meteredUsage))
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
    const service = new StoryService(store, { responses: { parse, stream } } as unknown as OpenAI, {
      maxBackgroundAgents: 3,
      maxCostUsdPerChapter: 0.05,
      nativeMultiAgent: false,
    });
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
    expect(result.estimatedCostUsd).toBeLessThanOrEqual(0.05);
    expect(result.chapter.prose).toBe(prose);
    expect(parse).toHaveBeenCalledTimes(7);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(replayed.join("")).toBe(prose);
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

  it("records exhausted audit retries before a regenerated narration succeeds", async () => {
    const store = new StoryStore();
    const firstProse = Array.from({ length: 900 }, (_, index) => `ember${index}`).join(" ");
    const recoveredProse = Array.from({ length: 900 }, (_, index) => `cinder${index}`).join(" ");
    const proseHash = createHash("sha256").update(recoveredProse).digest("hex");
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
      .mockResolvedValueOnce(parsedResponse(frame, "resp_frame_retry"))
      .mockResolvedValueOnce(parsedResponse(invalidAudit, "resp_audit_bad_1"))
      .mockResolvedValueOnce(parsedResponse(invalidAudit, "resp_audit_bad_2"))
      .mockResolvedValueOnce(parsedResponse(invalidAudit, "resp_audit_bad_3"))
      .mockResolvedValueOnce(parsedResponse(audit, "resp_audit_recovered"));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(firstProse, "resp_narration_audit_failed"))
      .mockReturnValueOnce(fakeStream(recoveredProse, "resp_narration_recovered"));
    const service = new StoryService(
      store,
      { responses: { parse, stream } } as unknown as OpenAI,
      options(),
    );
    const selected = service.selectPov("rowan-ashborn");

    const result = await service.takeTurn({
      choiceId: selected.chapter.choices[0]?.id ?? "missing",
      expectedWorldVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000003",
      type: "take_action",
    });

    const chapter = store.loadChapter("ashen-crown-v1", 1);
    if (!chapter) throw new Error("Committed chapter missing");
    const trace = store.loadTrace(chapter.traceId);
    if (!trace) throw new Error("Committed trace missing");
    expect(result.chapter.prose).toBe(recoveredProse);
    expect(trace.attempts).toHaveLength(7);
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
    expect(result.estimatedCostUsd).toBe(attemptCost);
    expect(result.usage).toEqual(trace.totalUsage);
    expect(parse).toHaveBeenCalledTimes(5);
    expect(stream).toHaveBeenCalledTimes(2);
    store.close();
  });

  it("blocks chapter 351 before any model method runs", async () => {
    const store = new StoryStore();
    const terminal = terminalWorld();
    store.createWorld(terminal);
    const parse = vi.fn();
    const stream = vi.fn();
    const service = new StoryService(
      store,
      { responses: { parse, stream } } as unknown as OpenAI,
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
        { responses: { parse, stream } } as unknown as OpenAI,
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
      { responses: { parse, stream } } as unknown as OpenAI,
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
      expect(structuredRequest?.text?.format?.name).toBe("chapter_frame");
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
      { responses: { parse, stream } } as unknown as OpenAI,
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
      const structuredRequest = request as { text?: { format?: { name?: string } } } | undefined;
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
      { responses: { parse, stream } } as unknown as OpenAI,
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
    const client = { responses: { parse, stream } } as unknown as OpenAI;
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
    const expectedHash = "a".repeat(64);
    const candidate: NarrativeAuditCandidate = {
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map(() => "The chapter stays inside supplied canon."),
      leakedFactIds: [],
      scores: [2, 2, 2, 2, 2, 1, 1],
    };

    expect(canonicalizeNarrativeAuditOutput(candidate, expectedHash, new Set())).toMatchObject({
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

    const rejected = {
      ...candidate,
      scores: [2, 2, 0, 2, 0, 1, 1] as NarrativeAuditCandidate["scores"],
    };
    expect(canonicalizeNarrativeAuditOutput(rejected, expectedHash, new Set())).toMatchObject({
      approved: false,
      evidence: expect.arrayContaining([
        expect.objectContaining({ dimension: "povSafety", issueCode: "hidden-knowledge" }),
        expect.objectContaining({ dimension: "continuity", issueCode: "unsupported-canon" }),
      ]),
    });
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

function unusedClient(): OpenAI {
  return {
    responses: {
      parse: vi.fn(() => {
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
): ParsedResponse<T> {
  const modelOutput = structuredCandidateOutput(output);
  return {
    error: null,
    id,
    incomplete_details: null,
    output: [],
    output_parsed: modelOutput,
    output_text: JSON.stringify(modelOutput),
    status: "completed",
    usage: responseUsage,
  } as unknown as ParsedResponse<T>;
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
    return { optionIds: [], title: (output as { title: unknown }).title };
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
    leakedFactIds: audit.leakedFactIds,
    scores: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => audit.scores[dimension]),
  };
}

function fakeStream(prose: string, id = "resp_narration", responseUsage: ResponseUsage = usage()) {
  const response = {
    error: null,
    id,
    incomplete_details: null,
    output: [],
    output_text: prose,
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

function waitIntent(actorId: (typeof CHARACTER_IDS)[number], index: number): WorldIntent {
  return {
    action: { type: "wait" },
    actorId,
    contractVersion: CONTRACT_VERSION,
    expectedEffect: "Observe the current situation.",
    goal: "Survive the chapter.",
    id: `intent-background-${index}`,
    prerequisites: { requiredFactIds: [], requiredItemIds: [], requiredSkillIds: [] },
    promptVersion: PROMPT_VERSION,
    stateVersion: 1,
  };
}
