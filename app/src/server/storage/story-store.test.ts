import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  stageWorldDelta,
  resolveTurn,
  WorldStateSchema,
  type ChapterRecord,
  type PlayerAction,
  type TraceEnvelope,
  type WorldState,
} from "@infinite-litrpg/shared";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  InvalidCommitError,
  StaleWorldVersionError,
  StoryStore,
  type CommitTurnInput,
  type StoryStoreOptions,
} from "./story-store";

const stores: StoryStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

describe("StoryStore atomic turn commit", () => {
  it("persists world, delta, knowledge, chapter, trace, and usage together", () => {
    const store = openStore();
    const initial = seedState();
    const turn = makeTurn(initial);

    store.createWorld(initial);
    store.commitTurn(turn);

    expect(store.loadWorldState(initial.id)).toEqual(turn.state);
    expect(store.loadDelta(initial.id, turn.state.version)).toEqual(turn.delta);
    expect(store.loadKnowledgeChanges(initial.id, turn.state.version)).toEqual(
      turn.delta.knowledgeMutations,
    );
    expect(store.loadChapter(initial.id, turn.chapter.chapter)).toEqual(turn.chapter);
    expect(store.loadChapterByRequestId(initial.id, turn.chapter.requestId ?? "missing")).toEqual(
      turn.chapter,
    );
    expect(store.loadTrace(turn.trace.runId)).toEqual(turn.trace);
    expect(store.loadUsage(initial.id, turn.chapter.chapter)).toEqual({
      chapterUsage: turn.chapter.usage,
      totalEstimatedCostUsd: turn.trace.totalEstimatedCostUsd,
      totalLatencyMs: turn.trace.totalLatencyMs,
      traceUsage: turn.trace.totalUsage,
    });
  });

  it("reads authenticated prompt 1.4.9 deltas and traces after a prompt upgrade", () => {
    const directory = mkdtempSync(join(tmpdir(), "infinite-litrpg-store-"));
    const filename = join(directory, "story.sqlite");
    let store: StoryStore | null = null;

    try {
      store = new StoryStore(filename);
      const initial = seedState();
      const turn = makeTurn(initial);
      store.createWorld(initial);
      store.commitTurn(turn);
      store.close();
      store = null;

      const historicalDelta = { ...turn.delta, promptVersion: "1.4.9" };
      const historicalTrace = {
        ...turn.trace,
        acceptedDelta: historicalDelta,
        intents: turn.trace.intents.map((intent) => ({ ...intent, promptVersion: "1.4.9" })),
        promptVersion: "1.4.9",
      };
      const database = new Database(filename);
      database
        .prepare("UPDATE world_deltas SET delta_json = ? WHERE world_id = ?")
        .run(JSON.stringify(historicalDelta), initial.id);
      database
        .prepare("UPDATE traces SET trace_json = ? WHERE trace_id = ?")
        .run(JSON.stringify(historicalTrace), turn.trace.runId);
      database.close();

      store = new StoryStore(filename);
      expect(store.loadDelta(initial.id, turn.state.version)).toEqual(historicalDelta);
      expect(store.loadTrace(turn.trace.runId)).toEqual(historicalTrace);
    } finally {
      store?.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects a stale expected version without writing any turn artifact", () => {
    const store = openStore();
    const initial = seedState();
    const staleTurn = withExpectedVersion(makeTurn(initial), 2);

    store.createWorld(initial);

    expect(() => store.commitTurn(staleTurn)).toThrow(StaleWorldVersionError);
    expect(store.loadWorldState(initial.id)).toEqual(initial);
    expect(store.loadDelta(initial.id, staleTurn.state.version)).toBeNull();
    expect(store.loadKnowledgeChanges(initial.id, staleTurn.state.version)).toEqual([]);
    expect(store.loadChapter(initial.id, staleTurn.chapter.chapter)).toBeNull();
    expect(store.loadTrace(staleTurn.trace.runId)).toBeNull();
    expect(store.loadUsage(initial.id, staleTurn.chapter.chapter)).toBeNull();
  });

  it("rejects a duplicate chapter and rolls back its guarded world update", () => {
    const store = openStore();
    const initial = seedState();
    const firstTurn = makeTurn(initial);

    store.createWorld(initial);
    store.commitTurn(firstTurn);

    const duplicateTurn = withChapter(makeTurn(firstTurn.state), firstTurn.chapter.chapter);

    expect(() => store.commitTurn(duplicateTurn)).toThrow(InvalidCommitError);
    expect(store.loadWorldState(initial.id)).toEqual(firstTurn.state);
    expect(store.loadDelta(initial.id, duplicateTurn.state.version)).toBeNull();
    expect(store.loadKnowledgeChanges(initial.id, duplicateTurn.state.version)).toEqual([]);
    expect(store.loadChapter(initial.id, firstTurn.chapter.chapter)).toEqual(firstTurn.chapter);
    expect(store.loadTrace(duplicateTurn.trace.runId)).toBeNull();
  });

  it("rolls back every row after an injected mid-transaction failure", () => {
    const injectedError = new Error("injected storage failure");
    const store = openStore({
      failureInjector: (point) => {
        if (point === "after-knowledge-changes") throw injectedError;
      },
    });
    const initial = seedState();
    const turn = makeTurn(initial);

    store.createWorld(initial);

    expect(() => store.commitTurn(turn)).toThrow(injectedError);
    expect(store.loadWorldState(initial.id)).toEqual(initial);
    expect(store.loadDelta(initial.id, turn.state.version)).toBeNull();
    expect(store.loadKnowledgeChanges(initial.id, turn.state.version)).toEqual([]);
    expect(store.loadChapter(initial.id, turn.chapter.chapter)).toBeNull();
    expect(store.loadTrace(turn.trace.runId)).toBeNull();
    expect(store.loadUsage(initial.id, turn.chapter.chapter)).toBeNull();
  });

  it("rejects a forged post-state that the accepted delta cannot produce", () => {
    const store = openStore();
    const initial = seedState();
    const turn = makeTurn(initial);
    const forgedState = structuredClone(turn.state);
    forgedState.threat = "A forged threat that never appeared in the delta.";

    store.createWorld(initial);
    expect(() => store.commitTurn({ ...turn, state: forgedState })).toThrow(InvalidCommitError);
    expect(store.loadWorldState(initial.id)).toEqual(initial);
    expect(store.loadDelta(initial.id, forgedState.version)).toBeNull();
    expect(store.loadChapter(initial.id, forgedState.chapter)).toBeNull();
  });

  it.each(["pov", "usage", "cost"] as const)(
    "rejects cross-artifact %s mismatch without writing",
    (mismatch) => {
      const store = openStore();
      const initial = seedState();
      const turn = makeTurn(initial);
      const forged = structuredClone(turn);
      const candidate: CommitTurnInput = {
        ...forged,
        chapter: {
          ...forged.chapter,
          ...(mismatch === "pov" ? { povCharacterId: "elara-voss" as const } : {}),
          ...(mismatch === "usage"
            ? {
                usage: {
                  ...forged.chapter.usage,
                  outputTokens: forged.chapter.usage.outputTokens + 1,
                },
              }
            : {}),
          ...(mismatch === "cost"
            ? { estimatedCostUsd: forged.chapter.estimatedCostUsd + 0.001 }
            : {}),
        },
      };

      store.createWorld(initial);
      expect(() => store.commitTurn(candidate)).toThrow(InvalidCommitError);
      expect(store.loadWorldState(initial.id)).toEqual(initial);
      expect(store.loadChapter(initial.id, turn.chapter.chapter)).toBeNull();
    },
  );
});

function openStore(options?: StoryStoreOptions): StoryStore {
  const store = new StoryStore(":memory:", options);
  stores.push(store);
  return store;
}

function seedState(): WorldState {
  const raw = JSON.parse(
    readFileSync(resolve("evals/fixtures/demon-king-world.json"), "utf8"),
  ) as unknown;
  const state = WorldStateSchema.parse(raw);
  state.lockedPovId = "rowan-ashborn";
  return state;
}

function makeTurn(before: WorldState): CommitTurnInput {
  const playerAction: PlayerAction = {
    action: { subjectId: "cinder-village", type: "investigate" },
    actorId: "rowan-ashborn",
    description: "Watch the ash road before acting.",
    milestoneId: null,
    source: "suggested",
    stateVersion: before.version,
  };
  const resolved = resolveTurn(before, playerAction, []);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));

  const delta = structuredClone(resolved.data.delta);

  const staged = stageWorldDelta(before, resolved.data.intents, delta);
  if (!staged.ok) throw new Error(JSON.stringify(staged.issues));

  const traceId = randomUUID();
  const prose = words(
    "Ash drifted across the silent road while Rowan watched the ruined village",
    900,
  );
  const proseHash = createHash("sha256").update(prose).digest("hex");
  const choices = [
    {
      action: { destinationId: "ash-road", type: "move" as const },
      description: "Follow the raider trail onto Ash Road.",
      id: "choice-1" as const,
      milestoneId: null,
    },
    {
      action: { skillId: "ember-sense", targetId: null, type: "use_skill" as const },
      description: "Use Ember Sense on the village cinders.",
      id: "choice-2" as const,
      milestoneId: null,
    },
  ];
  const usage = {
    cacheWriteTokens: 0,
    cachedInputTokens: 10,
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 5,
    totalTokens: 155,
  };
  const chapter: ChapterRecord = {
    chapter: staged.data.state.chapter,
    choices,
    estimatedCostUsd: 0.01,
    id: `chapter-${String(staged.data.state.chapter).padStart(3, "0")}`,
    latencyMs: 125,
    narrativeAudit: {
      approved: true,
      evidence: [
        "choiceFulfillment",
        "characterAutonomy",
        "povSafety",
        "litrpgMechanics",
        "continuity",
        "arcProgress",
        "prose",
      ].map((dimension) => ({
        detail: "The action, state, and viewpoint remain consistent.",
        dimension,
        issueCode: "pass",
      })) as ChapterRecord["narrativeAudit"]["evidence"],
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
    },
    playerAction,
    povCharacterId: "rowan-ashborn",
    prose,
    proseHash,
    requestId: randomUUID(),
    safeContextHash: "a".repeat(64),
    stateAfterVersion: staged.data.state.version,
    stateBeforeVersion: before.version,
    terminal: staged.data.state.terminal,
    title: "Ash Road Vigil",
    traceId,
    usage,
  };
  const trace: TraceEnvelope = {
    acceptedDelta: delta,
    adapterMode: "sequential",
    attempts: [
      {
        agentId: null,
        attempt: 0,
        costUsd: 0.01,
        errorCode: null,
        latencyMs: 125,
        model: "gpt-5.6-terra",
        phase: "narration",
        responseId: `resp_storage_narration_${before.version}`,
        usage,
      },
    ],
    calls: [
      {
        agentId: null,
        errorCode: null,
        estimatedCostUsd: 0,
        latencyMs: 0,
        model: "gpt-5.6-luna",
        phase: "intent",
        reasoningEffort: "none",
        refusal: false,
        responseId: `resp_storage_intent_${before.version}`,
        retries: 0,
        timedOut: false,
        usage: zeroUsage(),
      },
      {
        agentId: null,
        errorCode: null,
        estimatedCostUsd: 0.01,
        latencyMs: 125,
        model: "gpt-5.6-terra",
        phase: "narration",
        reasoningEffort: "none",
        refusal: false,
        responseId: `resp_storage_narration_${before.version}`,
        retries: 0,
        timedOut: false,
        usage,
      },
      {
        agentId: null,
        errorCode: null,
        estimatedCostUsd: 0,
        latencyMs: 0,
        model: "gpt-5.6-luna",
        phase: "audit",
        reasoningEffort: "none",
        refusal: false,
        responseId: `resp_storage_audit_${before.version}`,
        retries: 0,
        timedOut: false,
        usage: zeroUsage(),
      },
    ],
    contractVersion: "1.1.0",
    fixtureId: before.id,
    fixtureVersion: before.fixtureVersion,
    gateResult: "passed",
    gitSha: "abcdef0",
    intents: [...resolved.data.intents],
    multiAgentOutputItems: [],
    pricingVersion: "test-pricing-v1",
    promptVersion: delta.promptVersion,
    runId: traceId,
    schemaVersion: "1.1.0",
    seed: before.version,
    stateAfterHash: hashJson(staged.data.state),
    stateBeforeHash: hashJson(before),
    totalEstimatedCostUsd: 0.01,
    totalLatencyMs: 125,
    totalUsage: usage,
    validationFailures: [],
  };

  return { chapter, delta, state: staged.data.state, trace };
}

function zeroUsage() {
  return {
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function words(seed: string, count: number): string {
  const tokens = seed.split(/\s+/u);
  return Array.from({ length: count }, (_, index) => tokens[index % tokens.length]).join(" ");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withExpectedVersion(turn: CommitTurnInput, expectedWorldVersion: number): CommitTurnInput {
  const delta = structuredClone(turn.delta);
  delta.expectedWorldVersion = expectedWorldVersion;
  const state = structuredClone(turn.state);
  state.version = expectedWorldVersion + 1;
  const chapter = structuredClone(turn.chapter);
  chapter.stateBeforeVersion = expectedWorldVersion;
  chapter.stateAfterVersion = state.version;
  const trace = structuredClone(turn.trace);
  trace.acceptedDelta = delta;

  return { chapter, delta, state, trace };
}

function withChapter(turn: CommitTurnInput, chapterNumber: number): CommitTurnInput {
  const delta = structuredClone(turn.delta);
  delta.clock.toChapter = chapterNumber;
  const state = structuredClone(turn.state);
  state.chapter = chapterNumber;
  const chapter = structuredClone(turn.chapter);
  chapter.chapter = chapterNumber;
  chapter.id = `chapter-${String(chapterNumber).padStart(3, "0")}`;
  const trace = structuredClone(turn.trace);
  trace.acceptedDelta = delta;

  return { chapter, delta, state, trace };
}
