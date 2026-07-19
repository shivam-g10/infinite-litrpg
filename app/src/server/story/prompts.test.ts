import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONTRACT_VERSION,
  PROMPT_VERSION,
  validateWorldState,
  type WorldDelta,
  type WorldState,
} from "@infinite-litrpg/shared";
import { describe, expect, it } from "vitest";

import {
  buildAuditPrompt,
  buildChapterFramePrompt,
  buildCustomActionPrompt,
  buildNarrationPrompt,
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
    expect(JSON.stringify(prompt)).toContain("Never narrate what that character found");
    expect(JSON.stringify(prompt)).toContain("Never combine an identity, threat, location");
    expect(prompt.instruction).toContain("Knowledge whitelist");
    expect(prompt.instruction).toContain(
      "unless one whitelist field states that exact relationship",
    );
    expect(JSON.stringify(prompt)).not.toContain("Malachar contained the Void beneath his throne");
    expect(JSON.stringify(prompt)).not.toContain("malachar-contained-the-void");
    expect(JSON.stringify(prompt)).not.toContain("viewpointCanon.facts");
    expect(JSON.stringify(prompt)).not.toContain("acceptedEvents");
    expect(prompt).toHaveProperty("afterTurnViewpointCanon.povCharacter.experience", 10);
    expect(prompt).toHaveProperty("beforeTurnEffectValues.experience", 0);
    expect(prompt).not.toHaveProperty("worldBefore");
    expect(prompt).toHaveProperty("currentChapterCanonicalEffects.stateMutations.0.amount", 10);
    expect(prompt.instruction).toContain("happen during this chapter");
  });

  it("audits against a minimal projection and treats POV knowledge as allowed", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
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
        emptyDelta(before),
        { choices: [], terminal: false, title: "A safe frame" },
        "Ash ".repeat(900),
        "a".repeat(64),
      ),
    ) as Record<string, unknown>;

    expect(prompt).not.toHaveProperty("stateBefore");
    expect(prompt).not.toHaveProperty("stateProspective");
    expect(JSON.stringify(prompt)).not.toContain("knowledgeLedgers");
    expect(prompt.instruction).toContain("Every field in afterTurnViewpointCanon");
    expect(prompt.instruction).toContain("Referring to an intention");
    expect(prompt.instruction).toContain("nextChoices are future options");
    expect((prompt.forbiddenFacts as readonly { id: string }[]).map(({ id }) => id)).not.toContain(
      "rowan-is-malachar-reincarnated",
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
        "a".repeat(64),
      ),
    ) as Record<string, unknown>;

    expect(prompt).not.toHaveProperty("canonicalDelta");
    expect(prompt).toHaveProperty(
      "forbiddenRemoteEffects.events.0.summary",
      "Varek secretly rang the eastern warning bell.",
    );
    expect(prompt).toHaveProperty(
      "forbiddenRemoteEffects.stateMutations.0.characterId",
      "varek-thorn",
    );
    expect(JSON.stringify(prompt.currentChapterCanonicalEffects)).not.toContain("varek-thorn");
    expect(prompt.instruction).toContain("paraphrasing any forbidden remote event");
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
        "a".repeat(64),
      ),
    ) as Record<string, unknown>;

    expect(prompt).toHaveProperty("beforeTurnEffectValues.experience", 0);
    expect(prompt).toHaveProperty("afterTurnViewpointCanon.povCharacter.experience", 10);
    expect(prompt).toHaveProperty("currentChapterCanonicalEffects.stateMutations.0.amount", 10);
    expect(prompt.instruction).toContain("Never call an exact listed effect pre-existing");
  });

  it("explains incomplete milestone targets and exposes two grounded action shapes", () => {
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

    for (const prompt of [frame, custom]) {
      expect(prompt).toHaveProperty("milestone.id", "act-one-survival");
      expect(prompt).toHaveProperty("milestone.completed", false);
      expect(prompt).toHaveProperty(
        "milestone.description",
        "Survive reincarnation and identify the first seal fracture.",
      );
      expect(prompt).toHaveProperty("legalActionTargets.investigate");
      expect(prompt).toHaveProperty("legalActionTargets.defend");
      expect(JSON.stringify(prompt)).toContain("directly target");
    }
    expect(custom.instruction).toContain("Never replace an explicit investigation with wait");
    expect(custom.instruction).toContain("first legalActionTargets.investigate ID");
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
