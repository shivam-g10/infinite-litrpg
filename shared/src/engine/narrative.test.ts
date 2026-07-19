import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTRACT_VERSION,
  NARRATIVE_AUDIT_DIMENSIONS,
  NarrativeAuditCandidateSchema,
  NarrativeAuditSchema,
  type WorldState,
} from "../contracts";
import {
  validateChapterDraft,
  validateChapterFrameSafety,
  validateSuggestedChoices,
} from "./narrative";
import { validateWorldState } from "./validation";

describe("narrative gates", () => {
  it("accepts two distinct, legal choices and a 900-word safe draft", () => {
    const state = seedState();
    const choices = legalChoices();

    expect(validateSuggestedChoices(state, choices).ok).toBe(true);
    expect(
      validateChapterDraft(state, {
        choices,
        contractVersion: CONTRACT_VERSION,
        prose: words("Ash moved across the road while Rowan watched", 900),
        terminal: false,
        title: "The Road Watches Back",
      }).ok,
    ).toBe(true);
  });

  it("accepts two distinct direct-target choices during an incomplete milestone lock", () => {
    const state = seedState();
    state.arcClock.convergencePressure = true;
    state.calendar.day = 48;
    state.calendar.label = "Year 1, Ashfall 48";
    state.chapter = 47;
    state.version = 48;

    const result = validateSuggestedChoices(state, [
      {
        action: { subjectId: "act-one-survival", type: "investigate" },
        description: "Trace the first seal fracture directly.",
        id: "choice-1",
        milestoneId: "act-one-survival",
      },
      {
        action: { targetId: "act-one-survival", type: "defend" },
        description: "Defend the survival milestone against collapse.",
        id: "choice-2",
        milestoneId: "act-one-survival",
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it("rejects duplicate attempts and literal hidden-fact leakage", () => {
    const state = seedState();
    const duplicate = [legalChoices()[0], { ...legalChoices()[0], id: "choice-2" }];
    const choiceResult = validateSuggestedChoices(state, duplicate);
    expect(choiceResult.ok).toBe(false);
    if (!choiceResult.ok) {
      expect(choiceResult.issues.some(({ code }) => code === "CHOICES_NOT_DISTINCT")).toBe(true);
    }

    const leaked = validateChapterDraft(state, {
      choices: legalChoices(),
      contractVersion: CONTRACT_VERSION,
      prose: words("Malachar contained the Void beneath his throne.", 900),
      terminal: false,
      title: "Forbidden Knowledge",
    });
    expect(leaked.ok).toBe(false);
    if (!leaked.ok) {
      expect(leaked.issues.some(({ code }) => code === "POV_LEAK")).toBe(true);
    }
  });

  it("rejects an approving audit with a hard-zero score", () => {
    const candidate = {
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
        detail: "The chapter contradicts the committed location.",
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
    expect(NarrativeAuditCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(NarrativeAuditSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects failure evidence attached to a positive audit score", () => {
    const candidate = {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "Checked against supplied canon.",
        dimension,
        issueCode: dimension === "povSafety" ? "hidden-knowledge" : "pass",
      })),
      leakedFactIds: [],
      proseHash: "a".repeat(64),
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

    expect(NarrativeAuditCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(NarrativeAuditSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects hidden facts in generated titles and choice descriptions", () => {
    const state = seedState();
    const result = validateChapterFrameSafety(state, {
      choices: legalChoices(),
      terminal: false,
      title: "Malachar contained the Void beneath his throne.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(({ code }) => code === "POV_LEAK")).toBe(true);
    }
  });
});

function legalChoices() {
  return [
    {
      action: { destinationId: "ash-road", type: "move" },
      description: "Follow the raiders onto Ash Road.",
      id: "choice-1",
      milestoneId: null,
    },
    {
      action: { skillId: "ember-sense", targetId: null, type: "use_skill" },
      description: "Read the surviving cinders with Ember Sense.",
      id: "choice-2",
      milestoneId: null,
    },
  ] as const;
}

function seedState(): WorldState {
  const raw = JSON.parse(
    readFileSync(resolve("evals/fixtures/demon-king-world.json"), "utf8"),
  ) as unknown;
  const result = validateWorldState(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  result.data.lockedPovId = "rowan-ashborn";
  return result.data;
}

function words(seed: string, count: number): string {
  const tokens = seed.split(/\s+/u);
  return Array.from({ length: count }, (_, index) => tokens[index % tokens.length]).join(" ");
}
