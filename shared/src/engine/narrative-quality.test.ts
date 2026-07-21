import { describe, expect, it } from "vitest";

import {
  countDialogueWords,
  validateNarrativeQuality,
  validateTitleNovelty,
  type NarrativeHistoryEntry,
} from "./narrative-quality";

const repetitiveHistory: NarrativeHistoryEntry[] = [
  { prose: "Ash road lay gray beneath Rowan's boots.", title: "Read the Ash Trail" },
  { prose: "Ash road held the same marks.", title: "Read the Ash Road" },
  { prose: "Ash road received Rowan in silence.", title: "Follow the Ash Trail" },
];

describe("narrative quality gates", () => {
  it("rejects the observed repetitive, dialogue-free, System-free pattern", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: true,
      history: repetitiveHistory,
      prose:
        "Ash road lay gray before Rowan. He examined another mark and continued without speaking or changing his mind.",
      systemNoticeRequired: true,
      title: "Trace the Ash Trail",
    });

    expect(issues.map(({ code }) => code).sort()).toEqual([
      "CHARACTER_BEAT_MISSING",
      "DIALOGUE_MISSING",
      "OPENING_REPEATED",
      "SYSTEM_NOTICE_MISSING",
      "TITLE_REPEATED",
    ]);
  });

  it("accepts a distinct title, opening, System notice, decision, and spoken conflict", () => {
    const prose = [
      "Nyra blocked the milestone stone before Rowan could touch it.",
      "“Tell me why the System calls you Ashbound,” she said. “And do not give me another half-truth about that crown.”",
      "“Because I chose restraint once and failed,” Rowan admitted. “This time I trust you with the first piece.”",
      "[Quest advanced: Name the Fracture. Experience +15. Level 2 reached.]",
    ].join(" ");

    expect(
      validateNarrativeQuality({
        dialogueRequired: true,
        history: repetitiveHistory,
        prose,
        systemNoticeRequired: true,
        title: "The Name Beneath the Seal",
      }),
    ).toEqual([]);
    expect(countDialogueWords(prose)).toBeGreaterThanOrEqual(20);
  });

  it("rejects exact and near-duplicate recent titles", () => {
    expect(validateTitleNovelty("Read the Ash Road", repetitiveHistory)[0]?.code).toBe(
      "TITLE_REPEATED",
    );
    expect(validateTitleNovelty("Read Ash Road", repetitiveHistory)[0]?.code).toBe(
      "TITLE_REPEATED",
    );
    expect(validateTitleNovelty("The Crown's First Answer", repetitiveHistory)).toEqual([]);
  });

  it("forces dialogue after two quiet chapters even in a nominally solo scene", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history: repetitiveHistory.slice(-2),
      prose:
        "Wind opened a new route. Rowan chose the eastern ridge. [Experience +5.] The decision cost him the safer road.",
      systemNoticeRequired: true,
      title: "East of Safety",
    });

    expect(issues.some(({ code }) => code === "DIALOGUE_MISSING")).toBe(true);
  });

  it("requires two spoken turns instead of accepting one long monologue", () => {
    const prose = [
      "Rowan chose to tell Nyra the truth.",
      '"I carried the crown through fire because I feared what you would see in me, and now I want you to judge the choice before us."',
      "The confession left no room for another voice.",
    ].join(" ");

    const issues = validateNarrativeQuality({
      dialogueRequired: true,
      history: [],
      prose,
      systemNoticeRequired: false,
      title: "Judgment at the Cairn",
    });

    expect(countDialogueWords(prose)).toBeGreaterThanOrEqual(20);
    expect(issues.some(({ code }) => code === "DIALOGUE_MISSING")).toBe(true);
  });

  it("does not mistake generic bracketed narration for a System notice", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history: [],
      prose:
        "Rowan chose the exposed ridge. [Cold rain crossed the empty road.] The risk left him afraid but moving.",
      systemNoticeRequired: true,
      title: "Rain on the Empty Ridge",
    });

    expect(issues.some(({ code }) => code === "SYSTEM_NOTICE_MISSING")).toBe(true);
  });

  it("rejects a near-template opening with cosmetic word changes", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history: [
        {
          prose: "Ash road lay gray beneath Rowan's boots while the watchfires faded.",
          title: "Cinders Before Dawn",
        },
      ],
      prose:
        "Ash road lay black beneath Rowan's boots when he chose to leave the watchfires behind.",
      systemNoticeRequired: false,
      title: "The Unwatched Mile",
    });

    expect(issues.some(({ code }) => code === "OPENING_REPEATED")).toBe(true);
  });

  it("allows a reused function word when recent openings are otherwise distinct", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history: [
        { prose: "At dawn, Rowan crossed the ford.", title: "The Ford at Dawn" },
        { prose: "Wind worried the banner above camp.", title: "A Banner in Wind" },
        { prose: "The gate opened without warning.", title: "An Unasked Entrance" },
      ],
      prose: "At dusk, Nyra chose the western stairs and refused the torch.",
      systemNoticeRequired: false,
      title: "Darkness on the Stairs",
    });

    expect(issues.some(({ code }) => code === "OPENING_REPEATED")).toBe(false);
  });

  it("rejects repeated action-object title templates despite new middle words", () => {
    const history: NarrativeHistoryEntry[] = [
      {
        prose: "Rain crossed the wardstone.",
        title: "Shatter Beneath the Crowned Seal",
      },
    ];

    expect(validateTitleNovelty("Shatter Through the Forgotten Seal", history)[0]?.code).toBe(
      "TITLE_REPEATED",
    );
    expect(validateTitleNovelty("The Seal Breaks at Dawn", history)).toEqual([]);
  });

  it("rejects titles and opening templates reused after more than twenty chapters", () => {
    const distantChapter = {
      prose: "Cinders rattled across the crown gate before Rowan chose the eastern road.",
      title: "The Crown Gate Answers",
    };
    const history = [
      distantChapter,
      ...Array.from({ length: 24 }, (_, index) => ({
        prose: `Opening ${index} moved the story to landmark ${index}.`,
        title: `Landmark ${index} Changes Course`,
      })),
    ];

    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history,
      prose:
        "Cinders rattled across the crown gate while Rowan decided the old route could not hold him.",
      systemNoticeRequired: false,
      title: distantChapter.title,
    });

    expect(issues.some(({ code }) => code === "OPENING_REPEATED")).toBe(true);
    expect(issues.some(({ code }) => code === "TITLE_REPEATED")).toBe(true);
  });
});
