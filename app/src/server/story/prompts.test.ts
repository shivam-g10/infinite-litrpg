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

import { buildAuditPrompt, buildNarrationPrompt, selectBackgroundActors } from "./prompts";

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
    expect(prompt).toHaveProperty("viewpointCanon");
    expect(prompt).not.toHaveProperty("stateBeforeViewpoint");
    expect(prompt).not.toHaveProperty("worldBefore");
    expect(prompt).toHaveProperty("canonicalEffects.stateMutations.0.amount", 10);
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
    expect(prompt.instruction).toContain("Every field in viewpointCanon");
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
    expect(JSON.stringify(prompt.allowedCanonicalEffects)).not.toContain("varek-thorn");
    expect(prompt.instruction).toContain("paraphrasing any forbidden remote event");
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
