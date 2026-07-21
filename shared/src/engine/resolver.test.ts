import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION, PROMPT_VERSION, type WorldIntent, type WorldState } from "../contracts";
import { stageWorldDelta } from "./delta";
import { getClockPolicy } from "./clock";
import { buildPovContext } from "./knowledge";
import { canonicalizeBackgroundIntentCandidate, resolveTurn } from "./resolver";
import { validateWorldState } from "./validation";

describe("deterministic turn resolution", () => {
  it("application-owns background intent identity, versions, and direct prerequisites", () => {
    const intent = canonicalizeBackgroundIntentCandidate(
      {
        a: { t: "use_skill", v: ["grave-command", "rowan-ashborn"] },
        e: "Hold the ash road.",
        g: "Protect the survivors.",
        r: {
          f: ["cinder-village-raided"],
          i: ["ember-key"],
          s: ["grave-command"],
        },
      },
      "nyra-vale",
      7,
      2,
    );

    expect(intent).toEqual({
      action: { skillId: "grave-command", targetId: "rowan-ashborn", type: "use_skill" },
      actorId: "nyra-vale",
      contractVersion: CONTRACT_VERSION,
      expectedEffect: "Hold the ash road.",
      goal: "Protect the survivors.",
      id: "intent-background-7-2",
      prerequisites: {
        requiredFactIds: ["cinder-village-raided"],
        requiredItemIds: ["ember-key"],
        requiredSkillIds: ["grave-command"],
      },
      promptVersion: PROMPT_VERSION,
      stateVersion: 7,
    });
    expect(() =>
      canonicalizeBackgroundIntentCandidate(
        {
          a: { t: "wait", v: [] },
          e: "Wait.",
          extra: true,
          g: "Wait.",
          r: { f: [], i: [], s: [] },
        },
        "nyra-vale",
        7,
        1,
      ),
    ).toThrow();
    expect(() =>
      canonicalizeBackgroundIntentCandidate(
        { a: { t: "wait", v: [] }, e: "Wait.", g: "Wait.", r: { f: [], i: [], s: [] } },
        "nyra-vale",
        7,
        4,
      ),
    ).toThrow("between one and three");
  });

  it.each([
    [
      { t: "move", v: ["ash-road"] },
      { destinationId: "ash-road", type: "move" },
    ],
    [
      { t: "use_item", v: ["ember-key", 2, null] },
      { itemId: "ember-key", quantity: 2, targetId: null, type: "use_item" },
    ],
    [
      { t: "use_skill", v: ["grave-command", "rowan-ashborn"] },
      { skillId: "grave-command", targetId: "rowan-ashborn", type: "use_skill" },
    ],
    [
      { t: "investigate", v: ["cinder-raid-aftermath"] },
      { subjectId: "cinder-raid-aftermath", type: "investigate" },
    ],
    [
      { t: "interact", v: ["nyra-vale", "Offer a guarded truce."] },
      { approach: "Offer a guarded truce.", targetId: "nyra-vale", type: "interact" },
    ],
    [
      { t: "defend", v: ["nyra-vale"] },
      { targetId: "nyra-vale", type: "defend" },
    ],
    [
      { t: "rally", v: ["cinder-survivors", "cinder-village"] },
      { factionId: "cinder-survivors", locationId: "cinder-village", type: "rally" },
    ],
    [{ t: "wait", v: [] }, { type: "wait" }],
  ])("losslessly decodes compact background action %#", (actionCandidate, expectedAction) => {
    const intent = canonicalizeBackgroundIntentCandidate(
      {
        a: actionCandidate,
        e: "Preserve the opening.",
        g: "Hold position.",
        r: { f: [], i: [], s: [] },
      },
      "nyra-vale",
      7,
      1,
    );

    expect(intent.action).toEqual(expectedAction);
  });

  it.each([
    ["missing move destination", { t: "move", v: [] }],
    ["invalid item quantity", { t: "use_item", v: ["ember-key", 0, null] }],
    ["extra wait argument", { t: "wait", v: ["extra"] }],
    ["unknown action", { t: "teleport", v: ["capital"] }],
  ])("rejects malformed compact background action: %s", (_label, actionCandidate) => {
    expect(() =>
      canonicalizeBackgroundIntentCandidate(
        {
          a: actionCandidate,
          e: "Preserve the opening.",
          g: "Hold position.",
          r: { f: [], i: [], s: [] },
        },
        "nyra-vale",
        7,
        1,
      ),
    ).toThrow();
  });

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

  it("awards action-sensitive experience but never pays experience for waiting", () => {
    const waitingState = seedState();
    const waiting = resolveTurn(waitingState, playerAction(waitingState, { type: "wait" }), []);
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    expect(waiting.data.delta.stateMutations).not.toContainEqual(
      expect.objectContaining({ type: "grant_experience" }),
    );
    const waited = stageWorldDelta(waitingState, waiting.data.intents, waiting.data.delta);
    expect(waited.ok).toBe(true);
    if (!waited.ok) return;
    expect(waited.data.state.characters.find(({ id }) => id === "rowan-ashborn")?.experience).toBe(
      0,
    );

    const movingState = seedState();
    const moving = resolveTurn(
      movingState,
      playerAction(movingState, { destinationId: "ash-road", type: "move" }),
      [],
    );
    expect(moving.ok).toBe(true);
    if (!moving.ok) return;
    expect(moving.data.delta.stateMutations).toContainEqual({
      amount: 10,
      characterId: "rowan-ashborn",
      type: "grant_experience",
    });

    const investigatingState = seedState();
    const investigating = resolveTurn(
      investigatingState,
      playerAction(investigatingState, {
        subjectId: "cinder-village",
        type: "investigate",
      }),
      [],
    );
    expect(investigating.ok).toBe(true);
    if (!investigating.ok) return;
    expect(investigating.data.delta.stateMutations).toContainEqual({
      amount: 15,
      characterId: "rowan-ashborn",
      type: "grant_experience",
    });
  });

  it("turns repeated Ash Road investigation into a finite four-clue progression", () => {
    let state = seedState();
    const moved = resolveTurn(
      state,
      playerAction(state, { destinationId: "ash-road", type: "move" }),
      [],
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const movedStage = stageWorldDelta(state, moved.data.intents, moved.data.delta);
    expect(movedStage.ok).toBe(true);
    if (!movedStage.ok) return;
    state = movedStage.data.state;

    const claims: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const resolved = resolveTurn(
        state,
        playerAction(state, { subjectId: "ash-road", type: "investigate" }),
        [],
      );
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      const discovery = resolved.data.delta.knowledgeMutations.find(
        ({ type }) => type === "discover_fact",
      );
      const experience = resolved.data.delta.stateMutations.find(
        ({ type }) => type === "grant_experience",
      );
      if (attempt < 4) {
        expect(discovery?.type === "discover_fact" ? discovery.fact.claim : null).toBeTruthy();
        if (discovery?.type === "discover_fact") claims.push(discovery.fact.claim);
        expect(experience).toMatchObject({ amount: 15, characterId: "rowan-ashborn" });
      } else {
        expect(discovery).toBeUndefined();
        expect(experience).toBeUndefined();
      }
      const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);
      expect(staged.ok).toBe(true);
      if (!staged.ok) return;
      state = staged.data.state;
    }

    expect(claims).toHaveLength(4);
    expect(new Set(claims).size).toBe(4);
    expect(claims.join(" ")).not.toContain("found corroborating traces tied to");
    expect(claims.some((claim) => claim.includes("System"))).toBe(true);
    expect(
      state.facts.filter(
        ({ ownerCharacterId, source }) =>
          ownerCharacterId === "rowan-ashborn" && source === "Investigation of ash-road",
      ),
    ).toHaveLength(4);
  });

  it("applies action experience through the existing level progression rule", () => {
    const state = seedState();
    const rowan = state.characters.find(({ id }) => id === "rowan-ashborn");
    if (!rowan) throw new Error("Rowan missing");
    rowan.experience = 95;

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
    expect(staged.data.state.characters.find(({ id }) => id === "rowan-ashborn")).toMatchObject({
      experience: 10,
      level: 2,
    });
    expect(validateWorldState(staged.data.state).ok).toBe(true);
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
        forgedResult.issues.some(
          ({ code, message }) =>
            code === "MUTATION_UNSUPPORTED" &&
            message === "State mutations must exactly match deterministic turn resolution",
        ),
      ).toBe(true);
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

  it("rejects a duplicate mutation even when each copy matches one accepted intent", () => {
    const state = seedState();
    const before = structuredClone(state);
    const resolved = resolveTurn(
      state,
      playerAction(state, {
        itemId: "copper-coin",
        quantity: 1,
        targetId: null,
        type: "use_item",
      }),
      [],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const duplicated = structuredClone(resolved.data.delta);
    const spend = duplicated.stateMutations.find(({ type }) => type === "adjust_inventory");
    expect(spend).toBeDefined();
    if (!spend) return;
    duplicated.stateMutations.push(structuredClone(spend));

    const staged = stageWorldDelta(state, resolved.data.intents, duplicated);
    expect(staged.ok).toBe(false);
    if (!staged.ok) {
      expect(staged.issues.some(({ code }) => code === "MUTATION_UNSUPPORTED")).toBe(true);
    }
    expect(state).toEqual(before);
  });

  it("rejects caller-selected intent disposition that drops the valid player action", () => {
    const state = seedState();
    const before = structuredClone(state);
    const resolved = resolveTurn(
      state,
      playerAction(state, { destinationId: "ash-road", type: "move" }),
      [],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const forged = structuredClone(resolved.data.delta);
    forged.acceptedIntentIds = [];
    forged.rejectedIntents = [
      {
        code: "PRECONDITION_FAILED",
        intentId: resolved.data.playerIntent.id,
        reason: "Caller tried to erase a valid player action.",
      },
    ];
    forged.events = [];
    forged.knowledgeMutations = [];
    forged.stateMutations = [];
    forged.surfacedClueFactIds = [];

    const staged = stageWorldDelta(state, resolved.data.intents, forged);
    expect(staged.ok).toBe(false);
    if (!staged.ok) {
      expect(
        staged.issues.some(
          ({ code, message }) =>
            code === "INTENT_UNKNOWN" && message.includes("deterministic disposition"),
        ),
      ).toBe(true);
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
    const unrelated = resolveTurn(
      state,
      playerAction(state, { subjectId: "cinder-village", type: "investigate" }),
      [],
    );
    expect(unrelated.ok).toBe(true);
    if (!unrelated.ok) return;
    const forgedEnding = structuredClone(unrelated.data.delta);
    forgedEnding.clock.terminal = true;
    forgedEnding.stateMutations.push({
      reason: "A copied claim cannot end the story.",
      resolvedEndingConstraints: [...state.endingConstraints],
      type: "end_story",
    });
    expect(stageWorldDelta(state, unrelated.data.intents, forgedEnding).ok).toBe(false);

    const resolved = resolveTurn(
      state,
      playerAction(state, { subjectId: "act-seven-ending", type: "investigate" }),
      [],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.data.delta.clock.terminal).toBe(true);
    expect(resolved.data.delta.stateMutations.some(({ type }) => type === "end_story")).toBe(true);

    const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);
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

  it("rejects a milestone that cannot offer two distinct direct-target choices", () => {
    const state = seedState();
    const milestone = state.arcClock.milestones[0];
    if (milestone) milestone.compatibleActionTypes = ["move", "rally", "investigate"];

    const result = validateWorldState(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(({ code }) => code === "MILESTONE_ACTION_DEADLOCK")).toBe(true);
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

    const unrelated = resolveTurn(
      state,
      playerAction(state, { subjectId: "cinder-village", type: "investigate" }),
      [],
    );
    expect(unrelated.ok).toBe(false);
    if (!unrelated.ok) {
      expect(unrelated.issues.some(({ code }) => code === "MILESTONE_REQUIRED")).toBe(true);
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
      expect(
        resolveTurn(staged.data.state, playerAction(staged.data.state, { type: "wait" }), []).ok,
      ).toBe(false);
      expect(
        resolveTurn(
          staged.data.state,
          playerAction(staged.data.state, {
            subjectId: "cinder-village",
            type: "investigate",
          }),
          [],
        ).ok,
      ).toBe(true);
    }

    const defending = resolveTurn(
      state,
      playerAction(state, { targetId: "act-one-survival", type: "defend" }),
      [],
    );
    expect(defending.ok).toBe(true);
    if (defending.ok) {
      expect(stageWorldDelta(state, defending.data.intents, defending.data.delta).ok).toBe(true);
    }

    const background = backgroundIntent(state, "nyra-vale", "intent-background-milestone");
    background.action = { targetId: "act-one-survival", type: "defend" };
    const backgroundRejected = resolveTurn(
      state,
      playerAction(state, { subjectId: "act-one-survival", type: "investigate" }),
      [background],
    );
    expect(backgroundRejected.ok).toBe(true);
    if (backgroundRejected.ok) {
      expect(backgroundRejected.data.delta.rejectedIntents).toContainEqual(
        expect.objectContaining({ intentId: background.id }),
      );
    }
  });

  it("stops at chapter 350 and never resolves chapter 351", () => {
    let state = seedState();
    let commits = 0;

    while (state.chapter < 350) {
      const policy = getClockPolicy(state.chapter);
      const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
      const action = policy.choicesRequireMilestone
        ? {
            subjectId: milestone?.completed ? "cinder-village" : (milestone?.id ?? "missing"),
            type: "investigate",
          }
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
  const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  const milestoneId = policy.choicesRequireMilestone ? (milestone?.id ?? null) : null;
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
