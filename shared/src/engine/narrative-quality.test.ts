import { describe, expect, it } from "vitest";

import {
  buildTenChapterQualityPlan,
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
  it("distributes the fixed ten-chapter beats across early, middle, and late phases", () => {
    const plans = Array.from({ length: 10 }, (_, index) =>
      buildTenChapterQualityPlan(index + 1, true),
    );

    expect(
      plans.filter(({ beats }) => beats.consequentialDialogue).map(({ position }) => position),
    ).toEqual([1, 2, 4, 6, 8, 10]);
    expect(
      plans.filter(({ beats }) => beats.systemConsequence).map(({ position }) => position),
    ).toEqual([1, 3, 6, 9]);
    expect(
      plans.filter(({ beats }) => beats.systemTradeoff).map(({ position }) => position),
    ).toEqual([3, 6, 9]);
    expect(
      plans.filter(({ beats }) => beats.characterTurn).map(({ position }) => position),
    ).toEqual([1, 4, 7, 10]);
    expect(new Set(plans.map(({ sceneShape }) => sceneShape)).size).toBe(10);
    expect(plans[0]?.targets).toMatchObject({
      characterTurns: 4,
      consequentialDialogueChapters: 6,
      distinctFourWordOpenings: 7,
      systemConsequenceChapters: 4,
      systemTradeoffChapters: 2,
      uniqueTitles: 8,
    });
  });

  it("keeps the six-beat dialogue schedule without inventing an absent partner", () => {
    expect(buildTenChapterQualityPlan(1, false).beats.consequentialDialogue).toBe(true);
    expect(buildTenChapterQualityPlan(1, false).dialogue).toContain("Do not invent");
    expect(buildTenChapterQualityPlan(3, false).beats.consequentialDialogue).toBe(false);
  });

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

  it("requires chapter one to show the prior life, new-body awakening, and System pressure", () => {
    const missing = validateNarrativeQuality({
      dialogueRequired: false,
      history: [],
      openingOriginRequired: true,
      prose: "Rain crossed the road. Rowan chose the safer ridge and continued onward.",
      systemNoticeRequired: false,
      title: "Rain Before the Ridge",
    });
    const complete = validateNarrativeQuality({
      dialogueRequired: false,
      history: [],
      openingOriginRequired: true,
      prose: [
        "His last breath in the old life had tasted of iron.",
        "Rowan woke in a new body beneath an ash-dark sky and chose to crawl clear of the fire.",
        "[System notice: Survival quest accepted. Mana 10 of 10.]",
      ].join(" "),
      systemNoticeRequired: false,
      title: "A Second Breath in Ash",
    });

    expect(missing.some(({ code }) => code === "OPENING_ORIGIN_MISSING")).toBe(true);
    expect(complete.some(({ code }) => code === "OPENING_ORIGIN_MISSING")).toBe(false);
    expect(complete.some(({ code }) => code === "OPENING_WORLD_MISSING")).toBe(false);
  });

  it("accepts a fresh named System notice without requiring the literal word System", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history: [],
      openingOriginRequired: true,
      prose: [
        "His last breath ended his old life beneath a burning sky.",
        "Riven woke in a new body on the cold village floor and chose to stand.",
        "The Celestial Ledger chimed and revealed his first survival quest.",
      ].join(" "),
      systemName: "Celestial Ledger",
      systemNoticeRequired: true,
      title: "The Ledger Wakes",
    });

    expect(issues.some(({ code }) => code === "SYSTEM_NOTICE_MISSING")).toBe(false);
    expect(issues.some(({ code }) => code === "OPENING_ORIGIN_MISSING")).toBe(false);
  });

  it("requires chapter one to introduce the immediate world in-scene", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history: [],
      openingOriginRequired: true,
      prose:
        "His last breath ended his old life. Rowan awoke reincarnated in a new body. [System notice: Survival quest accepted.] He chose to continue.",
      systemNoticeRequired: false,
      title: "A Second Life Begins",
    });

    expect(issues.some(({ code }) => code === "OPENING_WORLD_MISSING")).toBe(true);
  });

  it("rejects internal planning and chapter deadline language", () => {
    const issues = validateNarrativeQuality({
      dialogueRequired: false,
      history: [],
      prose:
        "Rowan chose the eastern gate. [Quest: Cross the ward.] [Required by Chapter 50] The System waited.",
      systemNoticeRequired: true,
      title: "The Eastern Gate",
    });

    expect(issues.some(({ code }) => code === "INTERNAL_PLANNING_LEAK")).toBe(true);
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
