import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  STORY_QUALITY_EVAL_VERSION,
  STORY_QUALITY_SCENE_MOVEMENT_THRESHOLDS,
  STORY_QUALITY_THRESHOLDS,
  evaluateStoryQuality,
  type StoryQualityChapter,
  type StoryQualityGateId,
} from "./story-quality";

describe("provider-free story-quality gates", () => {
  it("passes a varied LitRPG story with dialogue, character movement, and novel progression", () => {
    const result = evaluateStoryQuality(passingStory());

    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(26);
    expect(result.gates.every((gate) => gate.passed)).toBe(true);
    expect(result.metrics.dialogue.maxDialogueFreeStreak).toBe(0);
    expect(result.metrics.characterDevelopment.distinctCategoryCount).toBe(4);
    expect(result.metrics.litrpgSystem.chapterCountWithExplicitSystem).toBe(4);
    expect(result.metrics.progression.novelMarkerChapterRatio).toBe(1);
    expect(result.grammarProxy).toEqual({
      evaluated: false,
      gated: false,
      reason:
        "No deterministic provider-free grammar proxy is reliable enough for stylized fiction. Grammar remains a human-review dimension.",
    });
  });

  it("fails every critique-linked family for a looping synthetic story", () => {
    const result = evaluateStoryQuality(failingStory());
    const failed = new Set(result.gates.filter((gate) => !gate.passed).map((gate) => gate.id));
    const expectedFailures = [
      "dialogue-presence",
      "dialogue-ratio",
      "dialogue-streak",
      "character-development-presence",
      "character-development-strength",
      "character-development-categories",
      "system-presence",
      "system-streak",
      "opening-first-word",
      "opening-phrase-uniqueness",
      "opening-phrase-repeat",
      "title-uniqueness",
      "title-repeat",
      "title-consecutive-repeat",
      "title-looping",
      "action-uniqueness",
      "action-dominance",
      "action-streak",
      "progression-uniqueness",
      "progression-dominance",
      "progression-streak",
      "progression-novel-markers",
      "scene-movement-streak",
      "novelty-average",
      "novelty-lowest",
      "novelty-reused-sentences",
    ] as const satisfies readonly StoryQualityGateId[];

    expect(result.passed).toBe(false);
    expect([...failed].sort()).toEqual([...expectedFailures].sort());
    expect(result.metrics.dialogue.maxDialogueFreeStreak).toBe(10);
    expect(result.metrics.opening.dominantFirstWordRatio).toBe(1);
    expect(result.metrics.title.loopReturnRatio).toBeGreaterThan(
      STORY_QUALITY_THRESHOLDS.title.maxLoopReturnRatio,
    );
    expect(result.metrics.action.maxSameSignatureStreak).toBe(10);
    expect(result.metrics.progression.novelMarkerChapterRatio).toBe(0.1);
    expect(result.metrics.sceneMovement.maxConsecutiveChaptersInSameScene).toBe(10);
    expect(result.metrics.novelty.averageAdjacentLexicalNovelty).toBe(0);
  });

  it("rejects a canonical same-scene loop despite cosmetic action and marker variation", () => {
    const story = passingStory().map((chapter) => ({
      ...chapter,
      sceneLocationId: "ash-road",
    }));

    const result = evaluateStoryQuality(story);
    const failed = result.gates.filter((entry) => !entry.passed);

    expect(failed.map((entry) => entry.id)).toEqual(["scene-movement-streak"]);
    expect(result.metrics.action.uniqueSignatureRatio).toBe(1);
    expect(result.metrics.progression.novelMarkerChapterRatio).toBe(1);
    expect(result.metrics.sceneMovement.maxConsecutiveChaptersInSameScene).toBe(10);
    expect(gate(result, "scene-movement-streak")).toMatchObject({
      actual: 10,
      passed: false,
      threshold: STORY_QUALITY_SCENE_MOVEMENT_THRESHOLDS.maxConsecutiveChaptersInSameScene,
    });
  });

  it("allows three consecutive chapters in one scene before movement is required", () => {
    const sceneLocations = [
      "storm-spire",
      "storm-spire",
      "storm-spire",
      "cedar-grove",
      "cedar-grove",
      "cedar-grove",
      "crimson-dunes",
      "crimson-dunes",
      "crimson-dunes",
      "abyssal-gate",
    ] as const;
    const story = passingStory().map((chapter, index) => ({
      ...chapter,
      sceneLocationId: sceneLocations[index]!,
    }));

    const result = evaluateStoryQuality(story);

    expect(result.passed).toBe(true);
    expect(result.metrics.sceneMovement.maxConsecutiveChaptersInSameScene).toBe(3);
    expect(gate(result, "scene-movement-streak").passed).toBe(true);
  });

  it("does not count a quoted skill name as meaningful dialogue", () => {
    const story = passingStory().map((chapter) => ({
      ...chapter,
      prose: chapter.prose.replace(/“[^”]+”/gu, "“Ember Sense.”"),
    }));

    const result = evaluateStoryQuality(story);

    expect(result.metrics.dialogue.chapterCountWithDialogue).toBe(0);
    expect(gate(result, "dialogue-presence").passed).toBe(false);
    expect(gate(result, "dialogue-streak").actual).toBe(10);
  });

  it("pins the immutable chapters 1-18 before-change baseline and thresholds", () => {
    const baselineText = readFileSync(
      resolve("evals/baselines/story-quality-chapters-1-18.json"),
      "utf8",
    );
    const baseline = JSON.parse(baselineText) as {
      readonly evalVersion: string;
      readonly failingGateCount: number;
      readonly grammarProxy: { readonly evaluated: boolean; readonly gated: boolean };
      readonly metrics: {
        readonly action: { readonly dominantSignatureCount: number };
        readonly chapterCount: number;
        readonly dialogue: { readonly chapterCountWithDialogue: number };
        readonly opening: { readonly dominantFirstWordRatio: number };
        readonly progression: { readonly novelMarkerChapterCount: number };
        readonly title: { readonly uniqueTitleCount: number };
      };
      readonly passed: boolean;
      readonly source: {
        readonly contentSha256: string;
        readonly firstChapter: number;
        readonly lastChapter: number;
        readonly worldId: string;
      };
      readonly thresholds: unknown;
    };

    expect(createHash("sha256").update(JSON.stringify(baseline)).digest("hex")).toBe(
      "d1f007a9ad3c3647c0ee4ede39048ea5553111068a298b1d3c7b2c134571b1f2",
    );
    expect(baseline).toMatchObject({
      evalVersion: "1.0.0",
      failingGateCount: 24,
      grammarProxy: { evaluated: false, gated: false },
      metrics: {
        action: { dominantSignatureCount: 13 },
        chapterCount: 18,
        dialogue: { chapterCountWithDialogue: 0 },
        opening: { dominantFirstWordRatio: 1 },
        progression: { novelMarkerChapterCount: 3 },
        title: { uniqueTitleCount: 4 },
      },
      passed: false,
      source: {
        contentSha256: "b8b7915fc4a97b090410466ce52d7536eb8e615e837d9ad1ffc243c886daaa8d",
        firstChapter: 1,
        lastChapter: 18,
        worldId: "ashen-crown-v1",
      },
    });
    expect(baseline.thresholds).toEqual(STORY_QUALITY_THRESHOLDS);
    expect(STORY_QUALITY_EVAL_VERSION).toBe("1.1.0");
  });

  it("rejects gaps and missing deterministic progression evidence", () => {
    const story = passingStory();
    expect(() => evaluateStoryQuality([story[0]!, story[2]!])).toThrow(/contiguous/iu);
    expect(() =>
      evaluateStoryQuality([{ ...story[0]!, progressionMarkers: [] }, story[1]!]),
    ).toThrow(/progression markers/iu);
    expect(() => evaluateStoryQuality([{ ...story[0]!, sceneLocationId: "" }, story[1]!])).toThrow(
      /scene location/iu,
    );
  });
});

function gate(result: ReturnType<typeof evaluateStoryQuality>, id: StoryQualityGateId) {
  const match = result.gates.find((entry) => entry.id === id);
  if (match === undefined) throw new Error(`Missing story-quality gate ${id}`);
  return match;
}

function passingStory(): readonly StoryQualityChapter[] {
  const prose = [
    "Rain hammered copper rooftops while Rowan climbed the storm spire. He realized pride had isolated him, and he vowed to ask Nyra for help. “I feared this summit yesterday, but I will face its thunder beside you today.” [System: Quest accepted — Break the Tempest Crown.] Lightning revealed a stair hidden inside the bell tower.",
    "Moss softened every footfall in the moonlit cedar grove. He trusted Nyra with the scar-map, though he regretted hiding it for so long. “Take the northern path and keep the silver owl in sight; I will guard our retreat.” Ancient roots opened around a glass spring, revealing the dryad envoy and her stolen seed.",
    "Sand hissed across the crimson dunes as scorpions circled the caravan. Rowan decided to surrender his royal seal, while Nyra confided in him about her vanished brother. “Trade the seal for the captives, then ride before the sun turns these chains into brands.” The bargain freed three scouts and exposed a buried obelisk beneath the wagons.",
    "Parchment dust swirled through the forbidden archive when the bronze doors shut. He understood that command was not the same as loyalty to his companions. “Read the violet marginalia aloud; its cipher names whoever altered the succession record.” [System: Skill unlocked — Echo Script.] Glowing annotations identified Chancellor Merek as the forger.",
    "Reeds bent over the flooded delta where black boats stalked the refugees. Rowan feared losing another village, yet he chose to trust Nyra with the helm. “Steer between those cypress shadows while I cut the chain across the eastern channel.” Their maneuver opened an escape route and won the ferrymaster’s alliance with the Ashbound.",
    "Crystal dust glittered inside the abandoned mine as distant pickaxes answered themselves. He admitted the crown could not excuse his earlier cruelty, and he promised the miners restitution. “Leave the sapphires untouched; we rescue the trapped crew before claiming a single shard.” The rescue uncovered a living crystal heart and restored six workers to their families.",
    "Silk banners concealed poisoned needles throughout the winter banquet hall. Nyra distrusted Merek, while Rowan hoped her suspicion was wrong. “Watch his left hand when the toast begins, because the assassin’s signal will come before the bells.” [System: Quest completed — Unmask the Glass Viper.] The exposed minister surrendered his coded ledger.",
    "Blue ice groaned beneath the glacier bridge as white wolves closed from both cliffs. Rowan recognized that fear made him reckless, and he resolved to protect rather than dominate. “Lower your spear and mirror my steps; the pack follows sound across these hollow shelves.” Their quiet crossing spared the wolves and reached the observatory before dusk.",
    "Sparks leaped from the volcanic forge while the cracked anvil sang in two voices. He forgave Nyra for breaking the seal, though she grieved for the memories it destroyed. “Strike after the red pulse, and our joined rhythm will temper the blade without waking its curse.” Together they forged Dawncleaver and sealed the furnace spirit inside its willing steel.",
    "Stars wheeled beneath the abyssal gate where gravity pulled toward an empty throne. Rowan could no longer mistake solitude for strength, and he committed to share the coming rule. “Stand with me when the void answers; no crown matters unless we both return to our people.” [System: Class evolved — Ashbound Sovereign.] The gate closed, their pact endured, and a new road opened home.",
  ] as const;
  const titles = [
    "Thunder Above Copper",
    "The Dryad's Missing Seed",
    "Ransom Under Red Sand",
    "Marginalia of Treason",
    "Black Boats at Cypress Bend",
    "The Heart Below the Mine",
    "Toast of the Glass Viper",
    "Wolves Beneath Blue Ice",
    "Two Hammers, One Flame",
    "A Crown Shared at the Abyss",
  ] as const;
  const actions = [
    "climb",
    "parley",
    "trade",
    "decode",
    "sail",
    "rescue",
    "expose",
    "cross",
    "craft",
    "seal",
  ] as const;
  return prose.map((chapterProse, index) => ({
    actionSignature: actions[index]!,
    chapter: index + 1,
    progressionMarkers: [`milestone:${index + 1}:${titles[index]!.toLocaleLowerCase("en-US")}`],
    prose: chapterProse,
    sceneLocationId: [
      "storm-spire",
      "cedar-grove",
      "crimson-dunes",
      "forbidden-archive",
      "flooded-delta",
      "abandoned-mine",
      "winter-banquet-hall",
      "glacier-bridge",
      "volcanic-forge",
      "abyssal-gate",
    ][index]!,
    title: titles[index]!,
  }));
}

function failingStory(): readonly StoryQualityChapter[] {
  return Array.from({ length: 10 }, (_, index) => ({
    actionSignature: "investigate:ash-road",
    chapter: index + 1,
    progressionMarkers: ["xp:10"],
    prose:
      "Ash Road lay gray beneath the morning while Rowan inspected the same cold trail. He found no answer and returned to the same stone without changing his plan.",
    sceneLocationId: "ash-road",
    title: index < 2 || index % 2 === 1 ? "Read the Ash Road" : "Read the Ash Trail",
  }));
}
