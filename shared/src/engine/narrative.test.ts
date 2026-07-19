import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CHARACTER_IDS } from "../characters";
import {
  CONTRACT_VERSION,
  NARRATIVE_AUDIT_DIMENSIONS,
  NarrativeAuditCandidateSchema,
  NarrativeAuditSchema,
  type WorldState,
} from "../contracts";
import {
  buildChapterChoiceOptions,
  canonicalizeChapterFrameCandidate,
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

  it("canonicalizes model option rankings into legal app-owned choices", () => {
    for (const characterId of CHARACTER_IDS) {
      const state = seedState();
      state.lockedPovId = characterId;
      const options = buildChapterChoiceOptions(state);
      expect(options.length).toBeGreaterThanOrEqual(2);
      const frame = canonicalizeChapterFrameCandidate(state, {
        optionIds: [options[1]!.id, options[1]!.id],
        title: "A Canonical Turn",
      });
      expect(frame.ok).toBe(true);
      if (frame.ok) {
        expect(frame.data.choices.map(({ id }) => id)).toEqual(["choice-1", "choice-2"]);
        expect(validateSuggestedChoices(state, frame.data.choices).ok).toBe(true);
      }
    }
  });

  it("keeps app-owned choices legal with maximum-length source names", () => {
    const state = seedState();
    for (const location of state.locations) location.name = "L".repeat(240);
    for (const character of state.characters) {
      character.name = "C".repeat(240);
      for (const skill of character.skills) skill.name = "S".repeat(240);
      for (const item of character.inventory) item.name = "I".repeat(240);
    }
    expect(validateWorldState(state).ok).toBe(true);

    const options = buildChapterChoiceOptions(state);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.every(({ description }) => description.length <= 240)).toBe(true);
    expect(
      canonicalizeChapterFrameCandidate(state, {
        optionIds: options.slice(0, 2).map(({ id }) => id),
        title: "Long Names",
      }).ok,
    ).toBe(true);
  });

  it("builds direct milestone choices and a zero-choice terminal frame", () => {
    for (const chapter of [47, 97, 147, 197, 247, 297, 347]) {
      const locked = seedState();
      locked.act = (Math.floor(chapter / 50) + 1) as WorldState["act"];
      locked.arcClock.convergencePressure = true;
      locked.calendar.day = chapter + 1;
      locked.calendar.label = `Year 1, Ashfall ${chapter + 1}`;
      locked.chapter = chapter;
      locked.version = chapter + 1;
      for (const milestone of locked.arcClock.milestones) {
        milestone.completed = milestone.requiredByChapter <= chapter;
      }
      const expectedMilestone = locked.arcClock.milestones.find(({ act }) => act === locked.act);
      const lockedOptions = buildChapterChoiceOptions(locked);
      expect(lockedOptions.length).toBeGreaterThanOrEqual(2);
      expect(
        lockedOptions.slice(0, 2).every(({ milestoneId }) => milestoneId === expectedMilestone?.id),
      ).toBe(true);
    }

    const terminal = seedState();
    terminal.act = 7;
    terminal.calendar.day = 351;
    terminal.calendar.label = "Year 1, Ashfall 351";
    terminal.chapter = 350;
    terminal.terminal = true;
    terminal.terminalReason = "Chapter 350 terminal resolution";
    terminal.version = 351;
    for (const milestone of terminal.arcClock.milestones) milestone.completed = true;
    const frame = canonicalizeChapterFrameCandidate(terminal, {
      optionIds: ["invented-option"],
      title: "The Last Crown",
    });
    expect(frame).toMatchObject({ ok: true, data: { choices: [], terminal: true } });
  });

  it("rejects duplicate attempts and literal hidden-fact leakage", () => {
    const state = seedState();
    const duplicate = [legalChoices()[0], { ...legalChoices()[0], id: "choice-2" }];
    const choiceResult = validateSuggestedChoices(state, duplicate);
    expect(choiceResult.ok).toBe(false);
    if (!choiceResult.ok) {
      expect(choiceResult.issues.some(({ code }) => code === "CHOICES_NOT_DISTINCT")).toBe(true);
    }
    const duplicateIds = [legalChoices()[0], { ...legalChoices()[1], id: "choice-1" }];
    const duplicateIdResult = validateSuggestedChoices(state, duplicateIds);
    expect(duplicateIdResult.ok).toBe(false);
    if (!duplicateIdResult.ok) {
      expect(duplicateIdResult.issues.some(({ code }) => code === "INVALID_SCHEMA")).toBe(true);
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
      evidence: [
        "choiceFulfillment",
        "characterAutonomy",
        "povSafety",
        "litrpgMechanics",
        "continuity",
        "arcProgress",
        "prose",
      ].map(() => "The chapter contradicts the committed location."),
      leakedFactIds: [],
      scores: [2, 2, 2, 2, 0, 2, 2],
    };
    expect(NarrativeAuditCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(
      NarrativeAuditSchema.safeParse({
        approved: true,
        evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
          detail: "The chapter contradicts the committed location.",
          dimension,
          issueCode: dimension === "continuity" ? "contradiction" : "pass",
        })),
        leakedFactIds: candidate.leakedFactIds,
        proseHash: "a".repeat(64),
        scores: {
          arcProgress: candidate.scores[5],
          characterAutonomy: candidate.scores[1],
          choiceFulfillment: candidate.scores[0],
          continuity: candidate.scores[4],
          litrpgMechanics: candidate.scores[3],
          povSafety: candidate.scores[2],
          prose: candidate.scores[6],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects failure evidence attached to a positive audit score", () => {
    const candidate = {
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map(() => "Checked against supplied canon."),
      leakedFactIds: [],
      scores: [2, 2, 2, 2, 2, 2, 2],
    };

    expect(NarrativeAuditCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(
      NarrativeAuditSchema.safeParse({
        approved: true,
        evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
          detail: "Checked against supplied canon.",
          dimension,
          issueCode: dimension === "povSafety" ? "hidden-knowledge" : "pass",
        })),
        leakedFactIds: candidate.leakedFactIds,
        proseHash: "a".repeat(64),
        scores: {
          arcProgress: candidate.scores[5],
          characterAutonomy: candidate.scores[1],
          choiceFulfillment: candidate.scores[0],
          continuity: candidate.scores[4],
          litrpgMechanics: candidate.scores[3],
          povSafety: candidate.scores[2],
          prose: candidate.scores[6],
        },
      }).success,
    ).toBe(false);

    expect(
      NarrativeAuditCandidateSchema.safeParse({
        ...candidate,
        approved: true,
        proseHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      NarrativeAuditCandidateSchema.safeParse({
        ...candidate,
        scores: candidate.scores.slice(0, -1),
      }).success,
    ).toBe(false);
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
