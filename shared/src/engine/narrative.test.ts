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
  decodeChapterFrameModelCandidate,
  validateChapterDraft,
  validateChapterFrameSafety,
  validateNarrativeStateClaims,
  validateSuggestedChoices,
} from "./narrative";
import { validateWorldState } from "./validation";

describe("narrative gates", () => {
  it("decodes the compact frame candidate without losing title or option IDs", () => {
    expect(
      decodeChapterFrameModelCandidate({
        o: ["option-2", "option-1"],
        t: "The Ash Road",
      }),
    ).toEqual({
      optionIds: ["option-2", "option-1"],
      title: "The Ash Road",
    });
  });

  it("rejects malformed compact frame candidates", () => {
    expect(() =>
      decodeChapterFrameModelCandidate({
        extra: true,
        o: ["option-1"],
        t: "The Ash Road",
      }),
    ).toThrow();
    expect(() => decodeChapterFrameModelCandidate({ o: "option-1", t: "The Ash Road" })).toThrow();
  });

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
      leakEvidence: [],
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
        leakedFactIds: candidate.leakEvidence.map(({ factId }) => factId),
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
      leakEvidence: [],
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
        leakedFactIds: candidate.leakEvidence.map(({ factId }) => factId),
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

  it("allows POV-safety failure without a canonical fact ID but binds listed leaks", () => {
    const base = {
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map(() => "Exact prose evidence."),
      leakEvidence: [],
      scores: [2, 2, 0, 2, 2, 2, 2],
    };

    expect(NarrativeAuditCandidateSchema.safeParse(base).success).toBe(true);
    expect(
      NarrativeAuditCandidateSchema.safeParse({
        ...base,
        leakEvidence: [{ factId: "hidden-fact", proseQuote: "Exact hidden prose evidence." }],
        scores: [2, 2, 2, 2, 2, 2, 2],
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

  it("rejects Rowan's exact uncommitted mana-spend claim", () => {
    const before = seedState();
    before.characters.find(({ id }) => id === "rowan-ashborn")!.locationId = "ash-road";
    const after = structuredClone(before);
    after.chapter = 2;
    after.version = 3;

    const result = validateNarrativeStateClaims(
      before,
      after,
      "Two mana left him in a measured thread. His mana settled at sixteen of eighteen.",
    );

    expect(result).toEqual([
      expect.objectContaining({
        code: "INVALID_SCHEMA",
        message: expect.stringContaining("mana as 16/18"),
        path: "prose",
      }),
    ]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "Ember Sense would cost two mana. His mana remained eighteen of eighteen.",
      ),
    ).toEqual([]);
  });

  it("rejects Rowan's uncommitted mana transition without a slash snapshot", () => {
    const before = seedState();
    before.characters.find(({ id }) => id === "rowan-ashborn")!.locationId = "ash-road";
    const after = structuredClone(before);
    after.chapter = 2;
    after.version = 3;

    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "The skill answered with a small expenditure of mana, and Rowan felt his reserve lessen from eighteen to sixteen.",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "INVALID_SCHEMA",
        message: expect.stringContaining("mana transition 18 to 16"),
        path: "prose",
      }),
    ]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "If he used Ember Sense, his mana reserve could fall from eighteen to sixteen.",
      ),
    ).toEqual([]);

    after.characters.find(({ id }) => id === "rowan-ashborn")!.mana.current = 16;
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "His mana reserve fell from eighteen to sixteen.",
      ),
    ).toEqual([]);
  });

  it("rejects explicit resource transitions with trailing resource names and drain verbs", () => {
    const before = seedState();
    before.characters.find(({ id }) => id === "rowan-ashborn")!.health.current = 24;
    const after = structuredClone(before);
    after.chapter = 1;
    after.version = 2;

    for (const prose of [
      "His reserve fell from eighteen to sixteen mana.",
      "His mana reserve drained from eighteen to sixteen.",
      "His health drained from 24 to 20.",
      "He spent mana from 18 to 16.",
    ]) {
      expect(validateNarrativeStateClaims(before, after, prose)).toEqual([
        expect.objectContaining({ code: "INVALID_SCHEMA", path: "prose" }),
      ]);
    }

    after.characters.find(({ id }) => id === "rowan-ashborn")!.health.current = 20;
    expect(
      validateNarrativeStateClaims(before, after, "His health drained from 24 to 20."),
    ).toEqual([]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "He spent time comparing mana from eighteen to sixteen on the training chart.",
      ),
    ).toEqual([]);
  });

  it("catches common POV transitions without treating denials or remote resources as canon", () => {
    const before = seedState();
    const after = structuredClone(before);
    after.chapter = 1;
    after.version = 2;

    for (const prose of [
      "His mana dwindled from eighteen to sixteen.",
      "His mana went from eighteen to sixteen.",
      "His mana dropped from eighteen down to sixteen.",
      "His mana was now sixteen, down from eighteen.",
    ]) {
      expect(validateNarrativeStateClaims(before, after, prose)).toEqual([
        expect.objectContaining({ code: "INVALID_SCHEMA", path: "prose" }),
      ]);
    }

    for (const prose of [
      "His mana did not fall from eighteen to sixteen.",
      "His mana didn't fall from eighteen to sixteen.",
      "He kept his mana from falling from eighteen to sixteen.",
      "His mana refused to fall from eighteen to sixteen.",
      "His mana remained steady, not falling from eighteen to sixteen.",
      "His reserve did not fall from eighteen to sixteen mana.",
      "Rather than let his reserve fall from eighteen to sixteen mana, Rowan held back.",
      "If his reserve fell from eighteen to sixteen mana, he would stagger.",
      "Rather than let his mana fall from eighteen to sixteen, Rowan held back.",
      "Nyra's mana fell from twelve to ten.",
      "Her mana fell from twelve to ten.",
      "Nyra's mana remained 12/84.",
      "Nyra's reserve fell from twelve to ten mana.",
    ]) {
      expect(validateNarrativeStateClaims(before, after, prose)).toEqual([]);
    }

    const elaraBefore = seedState();
    elaraBefore.lockedPovId = "elara-voss";
    const elaraAfter = structuredClone(elaraBefore);
    elaraAfter.chapter = 1;
    elaraAfter.version = 2;
    expect(
      validateNarrativeStateClaims(
        elaraBefore,
        elaraAfter,
        "Her mana fell from ninety-six to ninety-four.",
      ),
    ).toEqual([expect.objectContaining({ code: "INVALID_SCHEMA", path: "prose" })]);
  });

  it("scopes resource owners and denials to the claimed transition", () => {
    const before = seedState();
    const after = structuredClone(before);
    after.chapter = 1;
    after.version = 2;

    for (const prose of [
      "He did not hesitate as his mana fell from eighteen to sixteen.",
      "He could feel his mana fall from eighteen to sixteen.",
      "Never had his mana fallen from eighteen to sixteen so quickly.",
      "Rowan left Nyra behind as his mana fell from eighteen to sixteen.",
      "Rowan watched Nyra as his mana fell from eighteen to sixteen.",
      "He fought without hesitation as his mana fell from eighteen to sixteen.",
      "He asked if Nyra was safe as his mana fell from eighteen to sixteen.",
      "He refused to retreat as his mana fell from eighteen to sixteen.",
      "He avoided Nyra as his mana fell from eighteen to sixteen.",
      "Rowan left Varek behind as his mana fell from eighteen to sixteen.",
      "He could feel his mana settle at sixteen of eighteen.",
      "His mana was sixteen, down from eighteen.",
      "His mana stood at sixteen, down from eighteen.",
      "His mana dropped to sixteen.",
      "His mana decreased by two to sixteen.",
      "His mana slipped from eighteen to sixteen.",
      "His mana declined from eighteen to sixteen.",
    ]) {
      expect(validateNarrativeStateClaims(before, after, prose)).toEqual([
        expect.objectContaining({ code: "INVALID_SCHEMA", path: "prose" }),
      ]);
    }

    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "Nyra warned Rowan as her mana fell from twelve to ten.",
      ),
    ).toEqual([]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "Varek warned Rowan as his mana fell from twelve to ten.",
      ),
    ).toEqual([]);
    for (const prose of [
      "His mana almost fell from eighteen to sixteen.",
      "His mana will fall from eighteen to sixteen.",
      "He imagined his mana falling from eighteen to sixteen.",
      "The mana drill changed from 18 to 16 rounds.",
      "His mana cost changed from 18 to 16 gold.",
    ]) {
      expect(validateNarrativeStateClaims(before, after, prose)).toEqual([]);
    }
  });

  it("rejects Elara's exact arrival beyond the committed destination", () => {
    const before = seedState();
    before.lockedPovId = "elara-voss";
    const elaraBefore = before.characters.find(({ id }) => id === "elara-voss")!;
    elaraBefore.locationId = "capital";
    const after = structuredClone(before);
    after.characters.find(({ id }) => id === "elara-voss")!.locationId = "capital-road";
    after.chapter = 1;
    after.version = 2;

    const result = validateNarrativeStateClaims(
      before,
      after,
      "She crossed beneath them into the shadow of Aurelis Capital. Stone replaced packed earth.",
    );

    expect(result).toEqual([
      expect.objectContaining({
        code: "INVALID_SCHEMA",
        message: expect.stringContaining("arrival at Aurelis Capital"),
        path: "prose",
      }),
    ]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "Aurelis Capital waited beyond its gates. She crossed fully onto Capital Road.",
      ),
    ).toEqual([]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "She crossed onto Capital Road toward Aurelis Capital.",
      ),
    ).toEqual([]);
    expect(
      validateNarrativeStateClaims(
        seedState(),
        seedState(),
        "The old battlefields widened and the road divided toward Capital Road and the Black March.",
      ),
    ).toEqual([]);
  });

  it("rejects Lucan's exact reversed route and private-plan attribution", () => {
    const before = seedState();
    before.lockedPovId = "lucan-aurelis";
    const lucanBefore = before.characters.find(({ id }) => id === "lucan-aurelis")!;
    lucanBefore.locationId = "capital";
    const after = structuredClone(before);
    after.characters.find(({ id }) => id === "lucan-aurelis")!.locationId = "capital-road";
    after.chapter = 1;
    after.version = 2;

    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "Behind him lay Ash Road. Ahead waited Aurelis Capital.",
      ),
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("departed location Aurelis Capital"),
      }),
    ]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "Lucan judged it likely that Varek Thorn planned to stage a border coup.",
      ),
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("Lucan Aurelis's canon to Varek Thorn"),
      }),
    ]);
    expect(
      validateNarrativeStateClaims(
        before,
        after,
        "Aurelis Capital fell behind him. Lucan planned to stage a border coup.",
      ),
    ).toEqual([]);
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
