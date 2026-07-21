import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_STORY_SETUP,
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
  StaleChapterNarrationError,
  StaleWorldVersionError,
  StoryStore,
  type CommitTurnInput,
  type ReplaceLatestChapterNarrationInput,
  type StoryStoreOptions,
} from "./story-store";

const stores: StoryStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

describe("StoryStore story setup", () => {
  it("persists a strict setup across database reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "infinite-litrpg-setup-"));
    const filename = join(directory, "story.sqlite");
    let store: StoryStore | null = null;

    try {
      store = new StoryStore(filename);
      const initial = seedState();
      const setup = structuredClone(DEFAULT_STORY_SETUP);
      setup.guidance = "Keep the opening intimate and dangerous.";
      store.createWorld(initial, setup);
      store.close();
      store = null;

      store = new StoryStore(filename);
      expect(store.loadWorldState(initial.id)).toEqual(initial);
      expect(store.loadStorySetup(initial.id)).toEqual(setup);
    } finally {
      store?.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps legacy worlds readable without a setup", () => {
    const store = openStore();
    const initial = seedState();

    store.createWorld(initial);

    expect(store.loadWorldState(initial.id)).toEqual(initial);
    expect(store.loadStorySetup(initial.id)).toBeNull();
  });

  it("rolls back both world and setup after an injected setup failure", () => {
    const injectedError = new Error("injected setup storage failure");
    const store = openStore({
      failureInjector: (point) => {
        if (point === "after-story-setup-insert") throw injectedError;
      },
    });
    const initial = seedState();

    expect(() => store.createWorld(initial, DEFAULT_STORY_SETUP)).toThrow(injectedError);
    expect(store.loadWorldState(initial.id)).toBeNull();
    expect(store.loadStorySetup(initial.id)).toBeNull();
  });

  it("rejects an invalid setup before creating the world", () => {
    const store = openStore();
    const initial = seedState();

    expect(() =>
      store.createWorld(initial, { ...DEFAULT_STORY_SETUP, foundation: "regression-system" }),
    ).toThrow(InvalidCommitError);
    expect(store.loadWorldState(initial.id)).toBeNull();
  });
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

  it.each([
    "His mana settled at sixteen of eighteen.",
    "He crossed into Ash Road and entered the old battlefield.",
  ])("rejects approved prose that contradicts staged canon: %s", (claim) => {
    const store = openStore();
    const initial = seedState();
    const turn = withProse(makeTurn(initial), words(claim, 900));

    store.createWorld(initial);
    expect(() => store.commitTurn(turn)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("Chapter prose contradicts staged canon"),
      }),
    );
    expect(store.loadWorldState(initial.id)).toEqual(initial);
    expect(store.loadDelta(initial.id, turn.state.version)).toBeNull();
    expect(store.loadChapter(initial.id, turn.chapter.chapter)).toBeNull();
    expect(store.loadTrace(turn.trace.runId)).toBeNull();
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

describe("StoryStore atomic latest-chapter reroll", () => {
  it("archives old evidence and replaces narration without changing canon", () => {
    const store = openStore();
    const initial = seedState();
    const turn = makeTurn(initial);
    const replacement = makeNarrationReplacement(turn, "first");
    store.createWorld(initial);
    store.commitTurn(turn);
    const worldBefore = store.loadWorldState(initial.id);
    const deltaBefore = store.loadDelta(initial.id, turn.state.version);
    const knowledgeBefore = store.loadKnowledgeChanges(initial.id, turn.state.version);

    expect(store.replaceLatestChapterNarration(rerollInput(turn, replacement))).toEqual(
      replacement.chapter,
    );

    expect(store.loadWorldState(initial.id)).toEqual(worldBefore);
    expect(store.loadDelta(initial.id, turn.state.version)).toEqual(deltaBefore);
    expect(store.loadKnowledgeChanges(initial.id, turn.state.version)).toEqual(knowledgeBefore);
    expect(store.loadChapter(initial.id, turn.chapter.chapter)).toEqual(replacement.chapter);
    expect(store.loadTrace(turn.trace.runId)).toBeNull();
    expect(store.loadTrace(replacement.trace.runId)).toEqual(replacement.trace);
    expect(store.loadUsage(initial.id, turn.chapter.chapter)).toEqual({
      chapterUsage: replacement.chapter.usage,
      totalEstimatedCostUsd: replacement.trace.totalEstimatedCostUsd,
      totalLatencyMs: replacement.trace.totalLatencyMs,
      traceUsage: replacement.trace.totalUsage,
    });
    expect(store.loadChapterRevisions(initial.id, turn.chapter.chapter)).toEqual([
      {
        archivedByTraceId: replacement.trace.runId,
        chapter: turn.chapter,
        revision: 1,
        trace: turn.trace,
        usage: {
          chapterUsage: turn.chapter.usage,
          totalEstimatedCostUsd: turn.trace.totalEstimatedCostUsd,
          totalLatencyMs: turn.trace.totalLatencyMs,
          traceUsage: turn.trace.totalUsage,
        },
      },
    ]);
    expect(store.loadChapterByRequestId(initial.id, turn.chapter.requestId ?? "missing")).toEqual(
      replacement.chapter,
    );
    expect(
      store.loadChapterByRequestId(initial.id, replacement.chapter.requestId ?? "missing"),
    ).toEqual(replacement.chapter);
  });

  it("rejects stale world and prior narration guards without changing evidence", () => {
    const store = openStore();
    const initial = seedState();
    const turn = makeTurn(initial);
    const replacement = makeNarrationReplacement(turn, "stale");
    store.createWorld(initial);
    store.commitTurn(turn);

    expect(() =>
      store.replaceLatestChapterNarration({
        ...rerollInput(turn, replacement),
        expectedWorldVersion: turn.state.version + 1,
      }),
    ).toThrow(StaleWorldVersionError);
    expect(() =>
      store.replaceLatestChapterNarration({
        ...rerollInput(turn, replacement),
        expectedPriorTraceId: randomUUID(),
      }),
    ).toThrow(StaleChapterNarrationError);
    expect(() =>
      store.replaceLatestChapterNarration({
        ...rerollInput(turn, replacement),
        expectedPriorProseHash: "b".repeat(64),
      }),
    ).toThrow(StaleChapterNarrationError);

    expect(store.loadWorldState(initial.id)).toEqual(turn.state);
    expect(store.loadChapter(initial.id, turn.chapter.chapter)).toEqual(turn.chapter);
    expect(store.loadTrace(turn.trace.runId)).toEqual(turn.trace);
    expect(store.loadTrace(replacement.trace.runId)).toBeNull();
    expect(store.loadChapterRevisions(initial.id, turn.chapter.chapter)).toEqual([]);
  });

  it("rejects rerolling an older chapter after canon advances", () => {
    const store = openStore();
    const initial = seedState();
    const firstTurn = makeTurn(initial);
    const secondTurn = makeTurn(firstTurn.state);
    const replacement = makeNarrationReplacement(firstTurn, "not-latest");
    store.createWorld(initial);
    store.commitTurn(firstTurn);
    store.commitTurn(secondTurn);

    expect(() =>
      store.replaceLatestChapterNarration({
        ...rerollInput(firstTurn, replacement),
        expectedWorldVersion: secondTurn.state.version,
      }),
    ).toThrowError(
      expect.objectContaining({ message: "Only the latest committed chapter can be rerolled" }),
    );
    expect(store.loadWorldState(initial.id)).toEqual(secondTurn.state);
    expect(store.loadChapter(initial.id, firstTurn.chapter.chapter)).toEqual(firstTurn.chapter);
    expect(store.loadChapter(initial.id, secondTurn.chapter.chapter)).toEqual(secondTurn.chapter);
    expect(store.loadChapterRevisions(initial.id, firstTurn.chapter.chapter)).toEqual([]);
  });

  it.each([
    [
      "player action",
      (chapter: ChapterRecord) => {
        chapter.playerAction.description = "Forge a different canonical action.";
      },
    ],
    [
      "choices",
      (chapter: ChapterRecord) => {
        chapter.choices.reverse();
      },
    ],
    [
      "title",
      (chapter: ChapterRecord) => {
        chapter.title = "A Different Canonical Title";
      },
    ],
    [
      "world versions",
      (chapter: ChapterRecord) => {
        chapter.stateBeforeVersion += 1;
      },
    ],
    [
      "safe context",
      (chapter: ChapterRecord) => {
        chapter.safeContextHash = "b".repeat(64);
      },
    ],
  ] as const)("rejects replacement chapter tampering: %s", (_label, mutate) => {
    const store = openStore();
    const initial = seedState();
    const turn = makeTurn(initial);
    const replacement = makeNarrationReplacement(turn, "chapter-tamper");
    mutate(replacement.chapter);
    store.createWorld(initial);
    store.commitTurn(turn);

    expect(() => store.replaceLatestChapterNarration(rerollInput(turn, replacement))).toThrow(
      InvalidCommitError,
    );
    expectUnchangedAfterRejectedReroll(store, initial.id, turn, replacement.trace.runId);
  });

  it.each([
    [
      "delta",
      (trace: TraceEnvelope) => {
        trace.acceptedDelta.clock.transitionRequired =
          !trace.acceptedDelta.clock.transitionRequired;
      },
    ],
    [
      "intents",
      (trace: TraceEnvelope) => {
        const playerIntent = trace.intents.find(({ id }) => id.startsWith("intent-player-"));
        if (!playerIntent) throw new Error("Missing player intent");
        playerIntent.expectedEffect = `${playerIntent.expectedEffect} altered`;
      },
    ],
    [
      "state hashes",
      (trace: TraceEnvelope) => {
        trace.stateBeforeHash = "b".repeat(64);
      },
    ],
    [
      "schema version",
      (trace: TraceEnvelope) => {
        trace.schemaVersion = "reroll-forgery";
      },
    ],
  ] as const)("rejects replacement trace tampering: %s", (_label, mutate) => {
    const store = openStore();
    const initial = seedState();
    const turn = makeTurn(initial);
    const replacement = makeNarrationReplacement(turn, "trace-tamper");
    mutate(replacement.trace);
    store.createWorld(initial);
    store.commitTurn(turn);

    expect(() => store.replaceLatestChapterNarration(rerollInput(turn, replacement))).toThrow(
      InvalidCommitError,
    );
    expectUnchangedAfterRejectedReroll(store, initial.id, turn, replacement.trace.runId);
  });

  it.each([
    "after-reroll-archive",
    "after-reroll-chapter-update",
    "after-reroll-trace-insert",
    "after-reroll-usage-insert",
  ] as const)("rolls back every reroll row after failure at %s", (failurePoint) => {
    const injectedError = new Error(`injected ${failurePoint}`);
    const store = openStore({
      failureInjector: (point) => {
        if (point === failurePoint) throw injectedError;
      },
    });
    const initial = seedState();
    const turn = makeTurn(initial);
    const replacement = makeNarrationReplacement(turn, failurePoint);
    store.createWorld(initial);
    store.commitTurn(turn);

    expect(() => store.replaceLatestChapterNarration(rerollInput(turn, replacement))).toThrow(
      injectedError,
    );
    expectUnchangedAfterRejectedReroll(store, initial.id, turn, replacement.trace.runId);
  });

  it("preserves every revision and resolves every old request to the current chapter", () => {
    const store = openStore();
    const initial = seedState();
    const turn = makeTurn(initial);
    const first = makeNarrationReplacement(turn, "first-repeat");
    const second = makeNarrationReplacement(first, "second-repeat");
    store.createWorld(initial);
    store.commitTurn(turn);

    store.replaceLatestChapterNarration(rerollInput(turn, first));
    store.replaceLatestChapterNarration({
      chapter: second.chapter,
      expectedPriorProseHash: first.chapter.proseHash,
      expectedPriorTraceId: first.trace.runId,
      expectedWorldVersion: turn.state.version,
      trace: second.trace,
      worldId: initial.id,
    });

    const revisions = store.loadChapterRevisions(initial.id, turn.chapter.chapter);
    expect(revisions.map(({ chapter, revision }) => [revision, chapter.traceId])).toEqual([
      [1, turn.trace.runId],
      [2, first.trace.runId],
    ]);
    expect(store.loadChapter(initial.id, turn.chapter.chapter)).toEqual(second.chapter);
    for (const requestId of [
      turn.chapter.requestId,
      first.chapter.requestId,
      second.chapter.requestId,
    ]) {
      expect(store.loadChapterByRequestId(initial.id, requestId ?? "missing")).toEqual(
        second.chapter,
      );
    }
    expect(store.loadTrace(turn.trace.runId)).toBeNull();
    expect(store.loadTrace(first.trace.runId)).toBeNull();
    expect(store.loadTrace(second.trace.runId)).toEqual(second.trace);
    expect(store.loadWorldState(initial.id)).toEqual(turn.state);
  });
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
        requestedServiceTier: "standard",
        responseId: `resp_storage_narration_${before.version}`,
        serviceTier: "standard",
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
        requestedServiceTier: "standard",
        responseId: `resp_storage_intent_${before.version}`,
        retries: 0,
        serviceTier: "standard",
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
        requestedServiceTier: "standard",
        responseId: `resp_storage_narration_${before.version}`,
        retries: 0,
        serviceTier: "standard",
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
        requestedServiceTier: "standard",
        responseId: `resp_storage_audit_${before.version}`,
        retries: 0,
        serviceTier: "standard",
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

function makeNarrationReplacement(
  prior: Pick<CommitTurnInput, "chapter" | "trace">,
  label: string,
): Pick<CommitTurnInput, "chapter" | "trace"> {
  const traceId = randomUUID();
  const prose = words(
    `Rowan answered the villagers and chose a sharper path through ${label}`,
    900,
  );
  const proseHash = createHash("sha256").update(prose).digest("hex");
  const usage = {
    cacheWriteTokens: 0,
    cachedInputTokens: 12,
    inputTokens: 120,
    outputTokens: 60,
    reasoningTokens: 8,
    totalTokens: 200,
  };
  const chapter: ChapterRecord = {
    ...structuredClone(prior.chapter),
    estimatedCostUsd: 0.02,
    latencyMs: 175,
    narrativeAudit: {
      ...structuredClone(prior.chapter.narrativeAudit),
      evidence: prior.chapter.narrativeAudit.evidence.map((item) => ({
        ...item,
        detail: `Reroll ${label} passed the same canon checks.`,
      })),
      proseHash,
    },
    prose,
    proseHash,
    requestId: randomUUID(),
    traceId,
    usage,
  };
  const trace: TraceEnvelope = {
    ...structuredClone(prior.trace),
    attempts: [
      {
        agentId: null,
        attempt: 0,
        costUsd: 0.02,
        errorCode: null,
        latencyMs: 175,
        model: "gpt-5.6-sol",
        phase: "narration",
        requestedServiceTier: "standard",
        responseId: `resp_reroll_${slug(label)}`,
        serviceTier: "standard",
        usage,
      },
    ],
    calls: prior.trace.calls.map((call) => ({
      ...call,
      ...(call.phase === "narration"
        ? {
            estimatedCostUsd: 0.02,
            latencyMs: 175,
            model: "gpt-5.6-sol" as const,
            responseId: `resp_reroll_${slug(label)}_narration`,
            usage,
          }
        : {
            responseId: `resp_reroll_${slug(label)}_${call.phase}`,
          }),
    })),
    multiAgentOutputItems: [{ reroll: label }],
    runId: traceId,
    totalEstimatedCostUsd: 0.02,
    totalLatencyMs: 175,
    totalUsage: usage,
    validationFailures: [],
  };
  return { chapter, trace };
}

function rerollInput(
  turn: CommitTurnInput,
  replacement: Pick<CommitTurnInput, "chapter" | "trace">,
): ReplaceLatestChapterNarrationInput {
  return {
    chapter: replacement.chapter,
    expectedPriorProseHash: turn.chapter.proseHash,
    expectedPriorTraceId: turn.trace.runId,
    expectedWorldVersion: turn.state.version,
    trace: replacement.trace,
    worldId: turn.state.id,
  };
}

function expectUnchangedAfterRejectedReroll(
  store: StoryStore,
  worldId: string,
  turn: CommitTurnInput,
  rejectedTraceId: string,
): void {
  expect(store.loadWorldState(worldId)).toEqual(turn.state);
  expect(store.loadDelta(worldId, turn.state.version)).toEqual(turn.delta);
  expect(store.loadChapter(worldId, turn.chapter.chapter)).toEqual(turn.chapter);
  expect(store.loadTrace(turn.trace.runId)).toEqual(turn.trace);
  expect(store.loadTrace(rejectedTraceId)).toBeNull();
  expect(store.loadUsage(worldId, turn.chapter.chapter)).toEqual({
    chapterUsage: turn.chapter.usage,
    totalEstimatedCostUsd: turn.trace.totalEstimatedCostUsd,
    totalLatencyMs: turn.trace.totalLatencyMs,
    traceUsage: turn.trace.totalUsage,
  });
  expect(store.loadChapterRevisions(worldId, turn.chapter.chapter)).toEqual([]);
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_");
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

function withProse(turn: CommitTurnInput, prose: string): CommitTurnInput {
  const proseHash = createHash("sha256").update(prose).digest("hex");
  return {
    ...turn,
    chapter: {
      ...turn.chapter,
      narrativeAudit: { ...turn.chapter.narrativeAudit, proseHash },
      prose,
      proseHash,
    },
  };
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
