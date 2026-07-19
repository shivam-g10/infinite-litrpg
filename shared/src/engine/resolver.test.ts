import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION, PROMPT_VERSION, type WorldIntent, type WorldState } from "../contracts";
import { stageWorldDelta } from "./delta";
import { getClockPolicy } from "./clock";
import { buildPovContext } from "./knowledge";
import { resolveTurn } from "./resolver";
import { validateWorldState } from "./validation";

describe("deterministic turn resolution", () => {
  it("stages a legal player move without mutating the input", () => {
    const state = seedState();
    const before = structuredClone(state);
    const resolved = resolveTurn(
      state,
      playerAction(state, { destinationId: "ash-road", type: "move" }),
      [],
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);

    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(state).toEqual(before);
    expect(staged.data.state.chapter).toBe(1);
    expect(staged.data.state.version).toBe(2);
    expect(staged.data.state.characters.find(({ id }) => id === "rowan-ashborn")?.locationId).toBe(
      "ash-road",
    );
  });

  it("gives the player priority when a background intent uses the same actor", () => {
    const state = seedState();
    const background = backgroundIntent(state, "rowan-ashborn", "intent-background-rowan");
    const resolved = resolveTurn(state, playerAction(state, { type: "wait" }), [background]);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.data.delta.acceptedIntentIds).toEqual(["intent-player-1-1"]);
    expect(resolved.data.delta.rejectedIntents).toEqual([
      expect.objectContaining({ code: "CONFLICT_LOST", intentId: background.id }),
    ]);
  });

  it("rejects stale background intent but preserves a valid player turn", () => {
    const state = seedState();
    const background = {
      ...backgroundIntent(state, "nyra-vale", "intent-background-nyra"),
      stateVersion: 99,
    };
    const resolved = resolveTurn(state, playerAction(state, { type: "wait" }), [background]);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.data.delta.rejectedIntents[0]?.code).toBe("STALE_WORLD_VERSION");
    expect(stageWorldDelta(state, resolved.data.intents, resolved.data.delta).ok).toBe(true);
  });

  it("rejects more than three background agents", () => {
    const state = seedState();
    const background = Array.from({ length: 4 }, (_, index) =>
      backgroundIntent(state, "nyra-vale", `intent-overflow-${index}`),
    );

    const resolved = resolveTurn(state, playerAction(state, { type: "wait" }), background);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.issues.some(({ code }) => code === "INVALID_SCHEMA")).toBe(true);
  });

  it("rejects a staged multi-location mutation and leaves canon unchanged", () => {
    const state = seedState();
    const before = structuredClone(state);
    const resolved = resolveTurn(
      state,
      playerAction(state, { destinationId: "ash-road", type: "move" }),
      [],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const invalidDelta = structuredClone(resolved.data.delta);
    const locationMutation = invalidDelta.stateMutations.find(
      ({ type }) => type === "set_location",
    );
    if (locationMutation?.type === "set_location") {
      locationMutation.toLocationIds.push("guild-outpost");
    }
    const staged = stageWorldDelta(state, resolved.data.intents, invalidDelta);

    expect(staged.ok).toBe(false);
    if (staged.ok) return;
    expect(staged.issues.some(({ code }) => code === "MULTIPLE_LOCATIONS")).toBe(true);
    expect(state).toEqual(before);
  });

  it("rejects a move delta that omits or rewrites the required location change", () => {
    const state = seedState();
    const resolved = resolveTurn(
      state,
      playerAction(state, { destinationId: "ash-road", type: "move" }),
      [],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const missing = structuredClone(resolved.data.delta);
    missing.stateMutations = [];
    const missingResult = stageWorldDelta(state, resolved.data.intents, missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.issues.some(({ code }) => code === "MUTATION_MISSING")).toBe(true);
    }

    const teleported = structuredClone(resolved.data.delta);
    const mutation = teleported.stateMutations.find(({ type }) => type === "set_location");
    if (mutation?.type === "set_location") {
      mutation.toLocationIds = ["capital"];
    }
    const teleportResult = stageWorldDelta(state, resolved.data.intents, teleported);
    expect(teleportResult.ok).toBe(false);
    if (!teleportResult.ok) {
      expect(teleportResult.issues.some(({ code }) => code === "MUTATION_UNSUPPORTED")).toBe(true);
    }
  });

  it("rejects arbitrary canon mutations and rewritten resolved events", () => {
    const state = seedState();
    const before = structuredClone(state);
    const resolved = resolveTurn(state, playerAction(state, { type: "wait" }), []);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const forged = structuredClone(resolved.data.delta);
    forged.stateMutations.push(
      { amount: 100_000, characterId: "rowan-ashborn", type: "grant_experience" },
      { characterId: "varek-thorn", status: "dead", type: "set_status" },
    );
    const forgedResult = stageWorldDelta(state, resolved.data.intents, forged);
    expect(forgedResult.ok).toBe(false);
    if (!forgedResult.ok) {
      expect(
        forgedResult.issues.filter(({ code }) => code === "MUTATION_UNSUPPORTED"),
      ).toHaveLength(2);
    }

    const rewritten = structuredClone(resolved.data.delta);
    const event = rewritten.events[0];
    if (event) event.summary = "A forged event rewrites canon.";
    const rewrittenResult = stageWorldDelta(state, resolved.data.intents, rewritten);
    expect(rewrittenResult.ok).toBe(false);
    if (!rewrittenResult.ok) {
      expect(rewrittenResult.issues.some(({ code }) => code === "EVENT_MISSING")).toBe(true);
    }
    expect(state).toEqual(before);
  });

  it("rejects hidden-fact action references even with empty caller prerequisites", () => {
    const state = seedState();
    const resolved = resolveTurn(
      state,
      playerAction(state, {
        subjectId: "malachar-contained-the-void",
        type: "investigate",
      }),
      [],
    );

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.issues.some(({ code }) => code === "KNOWLEDGE_MISSING")).toBe(true);
  });

  it("rejects invented action targets before they can become canon", () => {
    const state = seedState();
    const resolved = resolveTurn(
      state,
      playerAction(state, { subjectId: "invented-black-crown", type: "investigate" }),
      [],
    );

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.issues.some(({ code }) => code === "TARGET_MISSING")).toBe(true);
  });

  it("rejects duplicate background IDs and player-ID collisions", () => {
    const state = seedState();
    const duplicate = backgroundIntent(state, "nyra-vale", "intent-duplicate");
    const duplicateResult = resolveTurn(state, playerAction(state, { type: "wait" }), [
      duplicate,
      { ...duplicate, actorId: "elara-voss" },
    ]);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.issues.some(({ code }) => code === "INVALID_SCHEMA")).toBe(true);
    }

    const collision = backgroundIntent(state, "nyra-vale", "intent-player-1-1");
    const collisionResult = resolveTurn(state, playerAction(state, { type: "wait" }), [collision]);
    expect(collisionResult.ok).toBe(false);
    if (!collisionResult.ok) {
      expect(collisionResult.issues.some(({ code }) => code === "DUPLICATE_INTENT_RESULT")).toBe(
        true,
      );
    }
  });

  it("creates one deterministic investigation clue and rejects forged knowledge", () => {
    const state = seedState();
    const resolved = resolveTurn(
      state,
      playerAction(state, { subjectId: "cinder-village", type: "investigate" }),
      [],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const clueId = "clue-1-0-rowan-ashborn";
    expect(staged.data.state.facts.find(({ id }) => id === clueId)).toMatchObject({
      discoveredChapter: 1,
      ownerCharacterId: "rowan-ashborn",
      visibility: "observed",
    });
    expect(
      staged.data.state.knowledgeLedgers
        .find(({ characterId }) => characterId === "rowan-ashborn")
        ?.entries.some(({ factId }) => factId === clueId),
    ).toBe(true);

    const waited = resolveTurn(state, playerAction(state, { type: "wait" }), []);
    expect(waited.ok).toBe(true);
    if (!waited.ok) return;
    const forged = structuredClone(waited.data.delta);
    forged.knowledgeMutations.push({
      certainty: "certain",
      characterId: "rowan-ashborn",
      discoveredChapter: 1,
      factId: "malachar-contained-the-void",
      source: "A witnessed seal echo",
      type: "learn_existing_fact",
    });
    forged.surfacedClueFactIds.push("malachar-contained-the-void");
    expect(stageWorldDelta(state, waited.data.intents, forged).ok).toBe(false);
  });

  it("does not let a moving character observe a same-turn event at the old location", () => {
    const state = seedState();
    const nyra = backgroundIntent(state, "nyra-vale", "intent-nyra-investigates");
    nyra.action = { subjectId: "cinder-village", type: "investigate" };

    const resolved = resolveTurn(
      state,
      playerAction(state, { destinationId: "ash-road", type: "move" }),
      [nyra],
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const nyraEvent = resolved.data.delta.events.find(({ participantIds }) =>
      participantIds.includes("nyra-vale"),
    );
    expect(nyraEvent?.observerIds).not.toContain("rowan-ashborn");
    const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(
      staged.data.state.activeEvents
        .filter(({ participantIds }) => participantIds.includes("nyra-vale"))
        .some(({ observerIds }) => observerIds.includes("rowan-ashborn")),
    ).toBe(false);
    const rowanContext = buildPovContext(staged.data.state, "rowan-ashborn");
    expect(rowanContext.observedEvents.some(({ id }) => id === nyraEvent?.id)).toBe(false);
    expect(rowanContext.factIds).not.toContain("clue-1-1-nyra-vale");
  });

  it("keeps investigation turns valid when fact or knowledge capacity is exhausted", () => {
    const factFull = seedState();
    const templateFact = factFull.facts[0];
    if (!templateFact) throw new Error("Seed fact missing");
    while (factFull.facts.length < 1_000) {
      const index = factFull.facts.length;
      factFull.facts.push({
        ...templateFact,
        claim: `Capacity fact ${index}`,
        id: `capacity-fact-${index}`,
        ownerCharacterId: null,
        visibility: "public",
      });
    }
    const factFullTurn = resolveTurn(
      factFull,
      playerAction(factFull, { subjectId: "cinder-village", type: "investigate" }),
      [],
    );
    expect(factFullTurn.ok).toBe(true);
    if (!factFullTurn.ok) return;
    expect(factFullTurn.data.delta.knowledgeMutations).toEqual([]);
    const factFullStage = stageWorldDelta(
      factFull,
      factFullTurn.data.intents,
      factFullTurn.data.delta,
    );
    expect(factFullStage.ok).toBe(true);
    if (factFullStage.ok) expect(factFullStage.data.state.facts).toHaveLength(1_000);

    const ledgerFull = seedState();
    const rowanLedger = ledgerFull.knowledgeLedgers.find(
      ({ characterId }) => characterId === "rowan-ashborn",
    );
    if (!rowanLedger) throw new Error("Rowan ledger missing");
    while (rowanLedger.entries.length < 500) {
      const index = rowanLedger.entries.length;
      const factId = `ledger-capacity-fact-${index}`;
      ledgerFull.facts.push({
        ...templateFact,
        claim: `Ledger capacity fact ${index}`,
        id: factId,
        ownerCharacterId: "rowan-ashborn",
        visibility: "observed",
      });
      rowanLedger.entries.push({
        certainty: "certain",
        discoveredChapter: 0,
        factId,
        source: "Capacity regression fixture",
      });
    }
    const ledgerFullTurn = resolveTurn(
      ledgerFull,
      playerAction(ledgerFull, { subjectId: "cinder-village", type: "investigate" }),
      [],
    );
    expect(ledgerFullTurn.ok).toBe(true);
    if (!ledgerFullTurn.ok) return;
    expect(ledgerFullTurn.data.delta.knowledgeMutations).toEqual([]);
  });

  it("permits an explicit early terminal ending only when all ending constraints resolve", () => {
    const prematureState = seedState();
    const prematureResolved = resolveTurn(
      prematureState,
      playerAction(prematureState, { type: "wait" }),
      [],
    );
    expect(prematureResolved.ok).toBe(true);
    if (!prematureResolved.ok) return;
    const prematureDelta = structuredClone(prematureResolved.data.delta);
    prematureDelta.clock.terminal = true;
    prematureDelta.stateMutations.push({
      reason: "A copied claim of resolution cannot end the story.",
      resolvedEndingConstraints: [...prematureState.endingConstraints],
      type: "end_story",
    });
    expect(stageWorldDelta(prematureState, prematureResolved.data.intents, prematureDelta).ok).toBe(
      false,
    );

    const state = seedState();
    state.act = 7;
    state.arcClock.convergencePressure = true;
    state.calendar.day = 349;
    state.calendar.label = "Year 1, Ashfall 349";
    state.chapter = 348;
    state.version = 349;
    for (const milestone of state.arcClock.milestones) milestone.completed = true;
    const resolved = resolveTurn(
      state,
      playerAction(state, { subjectId: "act-seven-ending", type: "investigate" }),
      [],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const delta = structuredClone(resolved.data.delta);
    delta.clock.terminal = true;
    delta.stateMutations.push({
      reason: "The Void seal, Ashen Crown, and Rowan's chosen life resolved together.",
      resolvedEndingConstraints: [...state.endingConstraints],
      type: "end_story",
    });

    const staged = stageWorldDelta(state, resolved.data.intents, delta);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.data.state).toMatchObject({ chapter: 349, terminal: true });
    expect(
      resolveTurn(staged.data.state, playerAction(staged.data.state, { type: "wait" }), []).ok,
    ).toBe(false);
  });

  it("rejects duplicate unique items across character inventories", () => {
    const state = seedState();
    const nyra = state.characters.find(({ id }) => id === "nyra-vale");
    nyra?.inventory.push({
      equipped: false,
      itemId: "rusted-sword",
      name: "Impossible second rusted sword",
      quantity: 1,
      unique: true,
    });
    const result = validateWorldState(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(({ code }) => code === "DUPLICATE_UNIQUE_ITEM")).toBe(true);
    }
  });

  it("rejects dangling world references and asymmetric travel edges", () => {
    const state = seedState();
    const rowan = state.characters.find(({ id }) => id === "rowan-ashborn");
    if (rowan) {
      rowan.factionId = "missing-faction";
      rowan.relationships[0] = {
        characterId: "missing-character",
        label: "impossible",
        score: 0,
      };
    }
    state.locations.find(({ id }) => id === "ash-road")?.adjacentLocationIds.splice(0, 1);
    const fact = state.facts[0];
    if (fact) fact.ownerCharacterId = "missing-character";

    const result = validateWorldState(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(({ code }) => code === "FACTION_MISSING")).toBe(true);
      expect(result.issues.some(({ code }) => code === "RELATIONSHIP_TARGET_MISSING")).toBe(true);
      expect(result.issues.some(({ code }) => code === "CHARACTER_MISSING")).toBe(true);
      expect(result.issues.some(({ code }) => code === "ASYMMETRIC_ADJACENCY")).toBe(true);
    }
  });

  it("requires a canon-compatible action before completing an act milestone", () => {
    const state = seedState();
    state.arcClock.convergencePressure = true;
    state.calendar.day = 48;
    state.calendar.label = "Year 1, Ashfall 48";
    state.chapter = 47;
    state.version = 48;

    const waiting = resolveTurn(state, playerAction(state, { type: "wait" }), []);
    expect(waiting.ok).toBe(false);
    if (!waiting.ok) {
      expect(waiting.issues.some(({ code }) => code === "MILESTONE_REQUIRED")).toBe(true);
    }

    const advancing = resolveTurn(
      state,
      playerAction(state, { subjectId: "act-one-survival", type: "investigate" }),
      [],
    );
    expect(advancing.ok).toBe(true);
    if (!advancing.ok) return;
    const staged = stageWorldDelta(state, advancing.data.intents, advancing.data.delta);
    expect(staged.ok).toBe(true);
    if (staged.ok) {
      expect(staged.data.state.arcClock.milestones[0]?.completed).toBe(true);
    }
  });

  it("stops at chapter 350 and never resolves chapter 351", () => {
    let state = seedState();
    let commits = 0;

    while (state.chapter < 350) {
      const policy = getClockPolicy(state.chapter);
      const action = policy.choicesRequireMilestone
        ? { subjectId: "cinder-village", type: "investigate" }
        : { type: "wait" };
      const resolved = resolveTurn(state, playerAction(state, action), []);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);
      expect(staged.ok).toBe(true);
      if (!staged.ok) return;
      state = staged.data.state;
      commits += 1;
    }

    expect(commits).toBe(350);
    expect(state).toMatchObject({ act: 7, chapter: 350, terminal: true, version: 351 });
    expect(state.arcClock.milestones.every(({ completed }) => completed)).toBe(true);
    const forbidden = resolveTurn(state, playerAction(state, { type: "wait" }), []);
    expect(forbidden.ok).toBe(false);
    if (forbidden.ok) return;
    expect(forbidden.issues[0]?.code).toBe("STORY_TERMINAL");
  });
});

function seedState(): WorldState {
  const raw = JSON.parse(
    readFileSync(resolve("evals/fixtures/demon-king-world.json"), "utf8"),
  ) as unknown;
  const result = validateWorldState(raw);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.issues));
  }
  result.data.lockedPovId = "rowan-ashborn";
  return result.data;
}

function playerAction(state: WorldState, action: Readonly<Record<string, unknown>>) {
  const policy = getClockPolicy(state.chapter);
  const milestoneId = policy.choicesRequireMilestone
    ? (state.arcClock.milestones.find(({ act }) => act === policy.currentAct)?.id ?? null)
    : null;
  return {
    action,
    actorId: "rowan-ashborn",
    description: "Follow the safest available course.",
    milestoneId,
    source: "suggested",
    stateVersion: state.version,
  };
}

function backgroundIntent(state: WorldState, actorId: string, id: string): WorldIntent {
  return {
    action: { type: "wait" },
    actorId,
    contractVersion: CONTRACT_VERSION,
    expectedEffect: "Watch the changing situation.",
    goal: "Protect current interests.",
    id,
    prerequisites: { requiredFactIds: [], requiredItemIds: [], requiredSkillIds: [] },
    promptVersion: PROMPT_VERSION,
    stateVersion: state.version,
  };
}
