import { createHash } from "node:crypto";

import {
  CONTRACT_VERSION,
  NARRATIVE_AUDIT_DIMENSIONS,
  PROMPT_VERSION,
  resolveTurn,
  stageWorldDelta,
  type Choice,
} from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { StoryService } from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";
import { restoreRetainedChapter, type LiveResult } from "./run-live";

describe("retained chapter state restore", () => {
  it("authenticates and restores a chapter 1 prefix without model work", () => {
    const store = new StoryStore();
    try {
      const service = testService(store);
      const view = service.selectPov("elara-voss");
      const choice = view.chapter.choices[0];
      expect(choice).toBeDefined();
      const result = restorableResult(store, choice);

      restoreRetainedChapter(store, result, choice);

      const restored = store.loadWorldState("ashen-crown-v1");
      expect(restored?.chapter).toBe(1);
      expect(hashJson(restored)).toBe(result.trace.stateAfterHash);
      expect(store.loadChapter("ashen-crown-v1", 1)?.prose).toBe(result.prose);
    } finally {
      store.close();
    }
  });

  it("rejects a tampered state hash and a chapter-2-only prefix", () => {
    const hashStore = new StoryStore();
    try {
      const service = testService(hashStore);
      const view = service.selectPov("elara-voss");
      const choice = view.chapter.choices[0];
      const result = restorableResult(hashStore, choice);
      expect(() =>
        restoreRetainedChapter(
          hashStore,
          { ...result, trace: { ...result.trace, stateAfterHash: "f".repeat(64) } },
          choice,
        ),
      ).toThrow("state-after hash");
    } finally {
      hashStore.close();
    }

    const chapterStore = new StoryStore();
    try {
      const service = testService(chapterStore);
      const view = service.selectPov("elara-voss");
      const choice = view.chapter.choices[0];
      const result = restorableResult(chapterStore, choice);
      expect(() => restoreRetainedChapter(chapterStore, { ...result, chapter: 2 }, choice)).toThrow(
        "chapter 1 prefix",
      );
    } finally {
      chapterStore.close();
    }
  });
});

function testService(store: StoryStore): StoryService {
  return new StoryService(store, {} as OpenAI, {
    maxBackgroundAgents: 3,
    maxCostUsdPerChapter: 0.1,
    nativeMultiAgent: false,
  });
}

function restorableResult(store: StoryStore, choice: Choice | undefined): LiveResult {
  if (!choice) throw new Error("Test fixture needs an initial choice");
  const before = store.loadWorldState("ashen-crown-v1");
  if (!before || before.lockedPovId !== "elara-voss") throw new Error("Test world is not locked");
  const resolved = resolveTurn(
    before,
    {
      action: choice.action,
      actorId: "elara-voss",
      description: choice.description,
      milestoneId: choice.milestoneId,
      source: "suggested",
      stateVersion: before.version,
    },
    [],
  );
  if (!resolved.ok) throw new Error("Test player choice did not resolve");
  const staged = stageWorldDelta(before, resolved.data.intents, resolved.data.delta);
  if (!staged.ok) throw new Error("Test delta did not stage");
  const prose = Array.from({ length: 900 }, () => "Ash").join(" ");
  const proseHash = hashText(prose);
  const usage = {
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
  const audit = {
    approved: true,
    evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
      detail: "Passes fixed release rubric.",
      dimension,
      issueCode: "pass" as const,
    })),
    leakedFactIds: [],
    proseHash,
    scores: {
      arcProgress: 2 as const,
      characterAutonomy: 2 as const,
      choiceFulfillment: 2 as const,
      continuity: 2 as const,
      litrpgMechanics: 2 as const,
      povSafety: 2 as const,
      prose: 2 as const,
    },
  };
  return {
    adapterMode: "sequential",
    audit,
    chapter: 1,
    costUsd: 0.01,
    latencyMs: 1,
    povId: "elara-voss",
    prose,
    streamChunkCount: 1,
    streamingLatencyMs: 1,
    streamReconstructed: true,
    trace: {
      acceptedDelta: resolved.data.delta,
      adapterMode: "sequential",
      attempts: [
        {
          agentId: null,
          attempt: 0,
          costUsd: 0.01,
          errorCode: null,
          latencyMs: 1,
          model: "gpt-5.6-terra",
          phase: "narration",
          requestedServiceTier: "standard",
          responseId: "resp_restore_attempt",
          serviceTier: "standard",
          usage,
        },
      ],
      calls: [
        {
          agentId: null,
          errorCode: null,
          estimatedCostUsd: 0.01,
          latencyMs: 1,
          model: "gpt-5.6-terra",
          phase: "narration",
          reasoningEffort: "none",
          refusal: false,
          requestedServiceTier: "standard",
          responseId: "resp_restore_narration",
          retries: 0,
          serviceTier: "standard",
          timedOut: false,
          usage,
        },
        {
          agentId: null,
          errorCode: null,
          estimatedCostUsd: 0,
          latencyMs: 1,
          model: "gpt-5.6-luna",
          phase: "audit",
          reasoningEffort: "none",
          refusal: false,
          requestedServiceTier: "standard",
          responseId: "resp_restore_audit",
          retries: 0,
          serviceTier: "standard",
          timedOut: false,
          usage,
        },
      ],
      contractVersion: CONTRACT_VERSION,
      fixtureId: before.id,
      fixtureVersion: before.fixtureVersion,
      gateResult: "passed",
      gitSha: "abcdef0",
      intents: [...resolved.data.intents],
      multiAgentOutputItems: [],
      pricingVersion: "test-pricing",
      promptVersion: PROMPT_VERSION,
      runId: "00000000-0000-4000-8000-000000000001",
      schemaVersion: CONTRACT_VERSION,
      seed: 0,
      stateAfterHash: hashJson(staged.data.state),
      stateBeforeHash: hashJson(before),
      totalEstimatedCostUsd: 0.01,
      totalLatencyMs: 1,
      totalUsage: usage,
      validationFailures: [],
    },
    usage,
    wordCount: 900,
  };
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}
