import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CHARACTER_IDS,
  CONTRACT_VERSION,
  PROMPT_VERSION,
  validateWorldState,
  type WorldDelta,
  type WorldState,
} from "@infinite-litrpg/shared";
import { describe, expect, it } from "vitest";

import { estimateMaximumRequestCostUsd } from "../openai";

import {
  buildAuditPrompt,
  buildChapterFramePrompt,
  buildCustomActionPrompt,
  buildNarrationPrompt,
  buildNarrationRecoveryPrompt,
  MAX_NARRATION_RECOVERY_PROMPT_BYTES,
  selectBackgroundActors,
} from "./prompts";

describe("background actor selection", () => {
  it("selects relevant actors only and never fills empty slots", () => {
    const state = seed();
    state.lockedPovId = "rowan-ashborn";

    expect(selectBackgroundActors(state).map(({ id }) => id)).toEqual(["nyra-vale"]);
  });

  it("never activates more than three actors", () => {
    const state = seed();
    for (const character of state.characters) {
      state.lockedPovId = character.id;
      expect(selectBackgroundActors(state).length).toBeLessThanOrEqual(3);
    }
  });

  it("binds narration to exact POV mutations and forbids plausible extra actions", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    prospective.chapter = 1;
    prospective.version += 1;
    prospective.characters[0]!.experience += 10;
    const prompt = JSON.parse(
      buildNarrationPrompt(
        before,
        prospective,
        {
          action: { type: "wait" },
          actorId: "rowan-ashborn",
          description: "Wait.",
          milestoneId: null,
          source: "suggested",
          stateVersion: before.version,
        },
        {
          acceptedIntentIds: ["player-intent"],
          clock: {
            convergencePressure: false,
            fromAct: 1,
            fromChapter: 0,
            terminal: false,
            toAct: 1,
            toChapter: 1,
            transitionRequired: false,
          },
          contractVersion: CONTRACT_VERSION,
          events: [],
          expectedWorldVersion: before.version,
          knowledgeMutations: [],
          promptVersion: PROMPT_VERSION,
          rejectedIntents: [],
          stateMutations: [{ amount: 10, characterId: "rowan-ashborn", type: "grant_experience" }],
          surfacedClueFactIds: [],
        },
      ),
    ) as Record<string, unknown>;

    expect(JSON.stringify(prompt)).toContain("No unlisted skill or item use");
    expect(JSON.stringify(prompt)).toContain("Another character event permits only its summary");
    expect(JSON.stringify(prompt)).toContain("No durable fact beyond the whitelist");
    expect(JSON.stringify(prompt)).toContain("a background intent is never a viewpoint action");
    expect(prompt.instruction).toContain("the exhaustive whitelist");
    expect(prompt.instruction).toContain("requires one exact whitelist field");
    expect(JSON.stringify(prompt)).not.toContain("Malachar contained the Void beneath his throne");
    expect(JSON.stringify(prompt)).not.toContain("malachar-contained-the-void");
    expect(JSON.stringify(prompt)).not.toContain("viewpointCanon.facts");
    expect(JSON.stringify(prompt)).not.toContain("acceptedEvents");
    expect(prompt).toHaveProperty("afterCanon.povCharacter.experience", 10);
    expect(prompt).toHaveProperty("beforeValues.experience", 0);
    expect(prompt).not.toHaveProperty("worldBefore");
    expect(prompt).toHaveProperty("currentEffects.stateMutations.0.amount", 10);
    expect(prompt).not.toHaveProperty("playerAction.source");
    expect(prompt).not.toHaveProperty("playerAction.stateVersion");
    expect(prompt.instruction).toContain("happen now");
  });

  it("audits against a minimal projection and treats POV knowledge as allowed", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const action = {
      action: { type: "wait" as const },
      actorId: "rowan-ashborn",
      description: "Wait.",
      milestoneId: null,
      source: "suggested" as const,
      stateVersion: before.version,
    };
    const delta = emptyDelta(before);
    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        before,
        action,
        delta,
        { choices: [], terminal: false, title: "A safe frame" },
        "Ash ".repeat(900),
      ),
    ) as Record<string, unknown>;
    const narration = JSON.parse(buildNarrationPrompt(before, before, action, delta)) as Record<
      string,
      unknown
    >;

    expect(prompt).not.toHaveProperty("stateBefore");
    expect(prompt).not.toHaveProperty("stateProspective");
    expect(JSON.stringify(prompt)).not.toContain("knowledgeLedgers");
    expect(prompt.instruction).toContain("Allowed canon is exactly afterCanon");
    expect(prompt.instruction).toContain("World fields may be restated or paraphrased");
    expect(prompt.instruction).toContain("despite forbiddenFacts overlap");
    expect(prompt.instruction).toContain("reject only exclusive details");
    expect(prompt.instruction).toContain("A plan or goal permits intent only");
    expect(prompt.instruction).toContain("nextChoices are future");
    expect(prompt.forbiddenFacts).not.toHaveProperty("rowan-is-malachar-reincarnated");
    expect(prompt.afterCanon).toEqual(narration.afterCanon);
    expect(prompt.world).toEqual(narration.world);
    expect(prompt).not.toHaveProperty("proseHash");
    expect(prompt).not.toHaveProperty("rubricDimensions");
    expect(prompt).not.toHaveProperty("allowedIssueCodes");
    expect(prompt).not.toHaveProperty("world.version");
    expect(prompt).not.toHaveProperty("world.factionsByIdAsNameGoal.solar-church");
    expect(prompt).not.toHaveProperty("afterCanon.povCharacter.equipmentItemIds");
    expect(prompt).not.toHaveProperty("afterCanon.povCharacter.secretFactIds");
    expect(prompt).not.toHaveProperty("afterCanon.facts");
    expect(prompt).toHaveProperty("afterCanon.povCharacter.classAsIdName.1", "Ashbound");
    expect(prompt).toHaveProperty(
      "afterCanon.povCharacter.inventoryAsItemIdNameQuantityEquippedUnique.0.0",
      "rusted-sword",
    );
    expect(prompt).toHaveProperty(
      "afterCanon.povCharacter.skillsAsIdNameRankManaCost.0.1",
      "Ember Sense",
    );
    expect(prompt).toHaveProperty("afterCanon.povCharacter.skillsAsIdNameRankManaCost.0", [
      "ember-sense",
      "Ember Sense",
      1,
      2,
    ]);
    expect(prompt).toHaveProperty(
      "afterCanon.factsByIdAsCertaintyClaim.rowan-is-malachar-reincarnated.1",
      "Rowan is Malachar reincarnated.",
    );
    expect(prompt).toHaveProperty(
      "afterCanon.factsByIdAsCertaintyClaim.rowan-is-malachar-reincarnated",
      ["certain", "Rowan is Malachar reincarnated."],
    );
    expect(prompt).toHaveProperty("world.factionsByIdAsNameGoal.cinder-survivors", [
      "Cinder Survivors",
      "Rebuild Cinder Village.",
    ]);
    expect(narration.instruction).toContain("afterCanon, visibleEvents, currentEffects, and world");
    expect(narration.instruction).toContain("Every world field is public canon");
    expect(prompt).toHaveProperty(
      "world.threat",
      "The seal beneath the old Demon Throne is weakening.",
    );
  });

  it("marks remote canon as forbidden audit context, not narratable canon", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const delta = emptyDelta(before);
    delta.events.push({
      id: "event-remote-bell",
      kind: "interact",
      locationId: "capital",
      observerIds: [],
      participantIds: ["varek-thorn"],
      summary: "Varek secretly rang the eastern warning bell.",
      visibility: "participants",
    });
    delta.stateMutations.push({
      characterId: "varek-thorn",
      fromLocationId: "black-march",
      toLocationIds: ["capital"],
      type: "set_location",
    });
    const remoteFact = {
      certainty: "likely" as const,
      claim: "The eastern bell has a hidden counterweight.",
      discoveredChapter: 1,
      id: "eastern-bell-counterweight",
      ownerCharacterId: "varek-thorn",
      source: "Varek's inspection",
      visibility: "private" as const,
    };
    delta.knowledgeMutations.push(
      { characterId: "varek-thorn", fact: remoteFact, type: "discover_fact" },
      {
        certainty: "uncertain",
        characterId: "varek-thorn",
        discoveredChapter: 1,
        factId: "malachar-publicly-dead",
        source: "A border rumor",
        type: "learn_existing_fact",
      },
    );

    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        before,
        {
          action: { type: "wait" },
          actorId: "rowan-ashborn",
          description: "Wait.",
          milestoneId: null,
          source: "suggested",
          stateVersion: before.version,
        },
        delta,
        { choices: [], terminal: false, title: "A safe frame" },
        "Across the ash, a distant bell seemed to ring. ".repeat(100),
      ),
    ) as Record<string, unknown>;

    expect(prompt).not.toHaveProperty("canonicalDelta");
    expect(prompt).toHaveProperty(
      "forbiddenRemote.eventsByIdAsKindLocationObserversParticipantsSummaryVisibility.event-remote-bell",
      [
        "interact",
        "capital",
        [],
        ["varek-thorn"],
        "Varek secretly rang the eastern warning bell.",
        "participants",
      ],
    );
    expect(prompt).toHaveProperty(
      "forbiddenRemote.discoveredFactsAsActorIdFactIdCertaintyClaimChapterOwnerSourceVisibility.0",
      [
        "varek-thorn",
        remoteFact.id,
        remoteFact.certainty,
        remoteFact.claim,
        remoteFact.discoveredChapter,
        remoteFact.ownerCharacterId,
        remoteFact.source,
        remoteFact.visibility,
      ],
    );
    expect(prompt).toHaveProperty(
      "forbiddenRemote.learnedFactsAsActorIdFactIdCertaintyChapterSource.0",
      ["varek-thorn", "malachar-publicly-dead", "uncertain", 1, "A border rumor"],
    );
    expect(prompt).toHaveProperty("forbiddenRemote.state.0.actorId", "varek-thorn");
    expect(JSON.stringify(prompt.currentEffects)).not.toContain("varek-thorn");
    expect(prompt.instruction).toContain("forbiddenFacts/forbiddenRemote are detection-only");
    expect(prompt.instruction).toContain("asserting or paraphrasing them makes povSafety 0");
  });

  it("sends a current visible event once while preserving older observed canon", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    const currentEvent = {
      id: "event-current-public",
      kind: "interact" as const,
      locationId: "ash-road",
      observerIds: [],
      participantIds: ["rowan-ashborn"],
      summary: "Rowan marks the fresh trail through the ash.",
      visibility: "public" as const,
    };
    prospective.activeEvents.push(currentEvent);
    const delta = emptyDelta(before);
    delta.events.push(currentEvent);
    const action = {
      action: { type: "wait" as const },
      actorId: "rowan-ashborn",
      description: "Wait.",
      milestoneId: null,
      source: "suggested" as const,
      stateVersion: before.version,
    };
    const narration = JSON.parse(
      buildNarrationPrompt(before, prospective, action, delta),
    ) as Record<string, unknown>;
    const audit = JSON.parse(
      buildAuditPrompt(
        before,
        prospective,
        action,
        delta,
        { choices: [], terminal: false, title: "A safe frame" },
        "Ash ".repeat(900),
      ),
    ) as Record<string, unknown>;

    for (const prompt of [narration, audit]) {
      expect(prompt).toHaveProperty("visibleEvents.0.id", currentEvent.id);
      expect(prompt).toHaveProperty("visibleEvents.0.kind", currentEvent.kind);
      expect(prompt).toHaveProperty("visibleEvents.0.visibility", currentEvent.visibility);
      expect(JSON.stringify(prompt.afterCanon)).not.toContain(currentEvent.id);
      expect(JSON.stringify(prompt)).toContain(currentEvent.id);
    }
  });

  it("deduplicates a discovered fact while retaining its claim and provenance", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    prospective.chapter = 1;
    const fact = {
      certainty: "certain" as const,
      claim: "Fresh claw marks cross the ash road.",
      discoveredChapter: 1,
      id: "fresh-claw-marks",
      ownerCharacterId: "rowan-ashborn",
      source: "Rowan's investigation",
      visibility: "observed" as const,
    };
    prospective.facts.push(fact);
    prospective.knowledgeLedgers
      .find(({ characterId }) => characterId === "rowan-ashborn")
      ?.entries.push({
        certainty: fact.certainty,
        discoveredChapter: fact.discoveredChapter,
        factId: fact.id,
        source: fact.source,
      });
    const delta = emptyDelta(before);
    delta.knowledgeMutations.push({
      characterId: "rowan-ashborn",
      fact,
      type: "discover_fact",
    });

    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        prospective,
        {
          action: { subjectId: "ash-road", type: "investigate" },
          actorId: "rowan-ashborn",
          description: "Inspect the ash road.",
          milestoneId: null,
          source: "custom",
          stateVersion: before.version,
        },
        delta,
        { choices: [], terminal: false, title: "Claws in Ash" },
        "Ash ".repeat(900),
      ),
    ) as Record<string, unknown>;

    expect(prompt).toHaveProperty(`afterCanon.factsByIdAsCertaintyClaim.${fact.id}`, [
      fact.certainty,
      fact.claim,
    ]);
    expect(prompt).toHaveProperty("currentEffects.knowledgeMutations.0", {
      discoveredChapter: fact.discoveredChapter,
      factId: fact.id,
      ownerCharacterId: fact.ownerCharacterId,
      source: fact.source,
      type: "discover_fact",
      visibility: fact.visibility,
    });
  });

  it("separates newly applied chapter effects from the after-turn state", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    prospective.chapter = 1;
    prospective.version += 1;
    prospective.characters[0]!.experience += 10;
    const delta = emptyDelta(before);
    delta.stateMutations.push({
      amount: 10,
      characterId: "rowan-ashborn",
      type: "grant_experience",
    });

    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        prospective,
        {
          action: { type: "wait" },
          actorId: "rowan-ashborn",
          description: "Wait.",
          milestoneId: null,
          source: "suggested",
          stateVersion: before.version,
        },
        delta,
        { choices: [], terminal: false, title: "A safe frame" },
        "Ash ".repeat(900),
      ),
    ) as Record<string, unknown>;

    expect(prompt).toHaveProperty("beforeValues.experience", 0);
    expect(prompt).toHaveProperty("afterCanon.povCharacter.experience", 10);
    expect(prompt).toHaveProperty("currentEffects.stateMutations.0.amount", 10);
    expect(prompt.instruction).toContain("a listed effect is not pre-existing");
  });

  it("exposes app-owned milestone options and exact custom-action targets", () => {
    const state = seed();
    state.lockedPovId = "rowan-ashborn";
    state.arcClock.convergencePressure = true;
    state.calendar.day = 48;
    state.calendar.label = "Year 1, Ashfall 48";
    state.chapter = 47;
    state.version = 48;

    const frame = JSON.parse(buildChapterFramePrompt(state)) as Record<string, unknown>;
    const custom = JSON.parse(buildCustomActionPrompt(state, "Resolve the fracture.")) as Record<
      string,
      unknown
    >;

    expect(frame).not.toHaveProperty("milestone");
    expect(frame).not.toHaveProperty("legalActionTargets");
    expect(frame).toHaveProperty("options.0.id", "option-1");
    expect(frame).toHaveProperty("options.1.id", "option-2");
    expect(JSON.stringify(frame)).toContain("urgent danger");
    expect(JSON.stringify(frame)).not.toContain("first seal fracture");
    expect(frame.instruction).toContain("Application code owns");
    expect(custom).toHaveProperty("milestone.id", "act-one-survival");
    expect(custom).toHaveProperty("milestone.completed", false);
    expect(custom).toHaveProperty("legalActionTargets.investigate");
    expect(custom).toHaveProperty("legalActionTargets.defend");
    expect(JSON.stringify(custom)).toContain("directly target");
    expect(custom.instruction).toContain("Never replace an explicit investigation with wait");
    expect(custom.instruction).toContain("first legalActionTargets.investigate ID");
  });

  it("keeps the hidden act-four history out of unauthorized frame prompts", () => {
    for (const characterId of CHARACTER_IDS.filter((id) => id !== "maelin-rook")) {
      const state = seed();
      state.act = 4;
      state.arcClock.convergencePressure = true;
      state.calendar.day = 198;
      state.calendar.label = "Year 1, Ashfall 198";
      state.chapter = 197;
      state.lockedPovId = characterId;
      state.version = 198;
      for (const milestone of state.arcClock.milestones) {
        milestone.completed = milestone.requiredByChapter <= state.chapter;
      }

      const prompt = buildChapterFramePrompt(state);
      expect(prompt).not.toContain("Malachar contained the Void");
      expect(prompt).not.toContain("malachar-contained-the-void");
      expect(prompt).not.toContain("Reveal why Malachar");
    }
  });

  it("bounds a tail-only 848-word narration recovery request", () => {
    const prose = Array.from({ length: 848 }, (_, index) => `ember${index}`).join(" ");
    const recovery = buildNarrationRecoveryPrompt(prose);
    const requestBytes = new TextEncoder().encode(
      `${recovery.instructions}\n${recovery.input}\n`,
    ).byteLength;

    expect(recovery.minimumAdditionalWords).toBe(52);
    expect(recovery.maximumAdditionalWords).toBe(67);
    expect(requestBytes).toBeLessThanOrEqual(MAX_NARRATION_RECOVERY_PROMPT_BYTES);
    expect(estimateMaximumRequestCostUsd("gpt-5.6-luna", requestBytes, 140)).toBeLessThanOrEqual(
      0.00298,
    );
    expect(recovery.input).not.toContain("ember0");
    expect(recovery.input).toContain("ember847");
    expect(() => buildNarrationRecoveryPrompt("ember ".repeat(839))).toThrow("840 and 899");
  });
});

function emptyDelta(state: WorldState): WorldDelta {
  return {
    acceptedIntentIds: [],
    clock: {
      convergencePressure: false,
      fromAct: 1,
      fromChapter: 0,
      terminal: false,
      toAct: 1,
      toChapter: 1,
      transitionRequired: false,
    },
    contractVersion: CONTRACT_VERSION,
    events: [],
    expectedWorldVersion: state.version,
    knowledgeMutations: [],
    promptVersion: PROMPT_VERSION,
    rejectedIntents: [],
    stateMutations: [],
    surfacedClueFactIds: [],
  };
}

function seed(): WorldState {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), "evals", "fixtures", "demon-king-world.json"), "utf8"),
  ) as unknown;
  const parsed = validateWorldState(raw);
  if (!parsed.ok) throw new Error("Seed fixture is invalid");
  return structuredClone(parsed.data);
}
