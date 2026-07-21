import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { MAX_CONSECUTIVE_CHAPTERS_IN_ONE_SCENE } from "@infinite-litrpg/shared";
import Database from "better-sqlite3";

export const STORY_QUALITY_EVAL_VERSION = "1.4.0";
export const DIALOGUE_PRESENCE_MIN_WORDS = 8;
export const OPENING_PHRASE_WORDS = 4;

export const STORY_QUALITY_SCENE_MOVEMENT_THRESHOLDS = Object.freeze({
  maxConsecutiveChaptersInSameScene: MAX_CONSECUTIVE_CHAPTERS_IN_ONE_SCENE,
});

export const STORY_QUALITY_THRESHOLDS = Object.freeze({
  action: Object.freeze({
    maxDominantSignatureRatio: 0.45,
    maxSameSignatureStreak: 2,
    minUniqueSignatureRatio: 0.35,
  }),
  characterDevelopment: Object.freeze({
    minDevelopmentChapterRatio: 0.4,
    minDistinctCategories: 3,
    minStrongDevelopmentChapterRatio: 0.2,
  }),
  dialogue: Object.freeze({
    maxDialogueFreeStreak: 2,
    minDialogueChapterRatio: 0.6,
    minOverallDialogueWordRatio: 0.05,
  }),
  litrpgSystem: Object.freeze({
    maxSystemFreeStreak: 3,
    minExplicitSystemChapterRatio: 0.3,
  }),
  novelty: Object.freeze({
    maxReusedSentenceRatio: 0.08,
    minAverageAdjacentLexicalNovelty: 0.45,
    minLowestAdjacentLexicalNovelty: 0.3,
  }),
  opening: Object.freeze({
    maxDominantFirstWordRatio: 0.35,
    maxOpeningPhraseRepeat: 2,
    minUniqueOpeningPhraseRatio: 0.7,
  }),
  progression: Object.freeze({
    maxDominantSignatureRatio: 0.45,
    maxSameSignatureStreak: 2,
    minNovelMarkerChapterRatio: 0.55,
    minUniqueSignatureRatio: 0.35,
  }),
  title: Object.freeze({
    maxConsecutiveSameTitle: 1,
    maxLoopReturnRatio: 0.15,
    maxTitleRepeat: 2,
    minUniqueTitleRatio: 0.8,
  }),
});

export const STORY_GOOD_ENOUGH_THRESHOLDS = Object.freeze({
  consequentialDialogueChapters: 3,
  consequentialSystemChapters: 4,
  endingChangedDimensions: 3,
  systemTradeoffChapters: 2,
});

export type DevelopmentCategory =
  "commitment" | "relationship" | "self_reassessment" | "vulnerability";

export interface StoryQualityChapter {
  readonly actionSignature: string;
  readonly chapter: number;
  readonly deltaSha256?: string;
  readonly progressionMarkers: readonly string[];
  readonly prose: string;
  readonly proseSha256?: string;
  readonly recordSha256?: string;
  readonly sceneLocationId: string;
  readonly title: string;
}

export interface StoryQualityChapterMetrics {
  readonly actionSignature: string;
  readonly chapter: number;
  readonly developmentCategories: readonly DevelopmentCategory[];
  readonly dialogueSpanCount: number;
  readonly dialogueWordCount: number;
  readonly dialogueWordRatio: number;
  readonly consequentialDialogueEvidence: readonly string[];
  readonly explicitSystemSignalCount: number;
  readonly firstWord: string;
  readonly hasDialogue: boolean;
  readonly hasConsequentialDialogue: boolean;
  readonly hasConsequentialSystem: boolean;
  readonly hasExplicitSystemSignal: boolean;
  readonly hasSystemTradeoff: boolean;
  readonly openingPhrase: string;
  readonly progressionMarkers: readonly string[];
  readonly progressionSignature: string;
  readonly sceneLocationId: string;
  readonly strongDevelopmentSignal: boolean;
  readonly systemConsequenceEvidence: readonly string[];
  readonly systemTradeoffEvidence: readonly string[];
  readonly title: string;
  readonly titleKey: string;
  readonly wordCount: number;
}

export interface FrequencyEntry {
  readonly count: number;
  readonly value: string;
}

export interface AdjacentNoveltyEntry {
  readonly fromChapter: number;
  readonly lexicalNovelty: number;
  readonly toChapter: number;
}

export interface StoryQualityMetrics {
  readonly action: {
    readonly dominantSignature: string;
    readonly dominantSignatureCount: number;
    readonly dominantSignatureRatio: number;
    readonly maxSameSignatureStreak: number;
    readonly uniqueSignatureCount: number;
    readonly uniqueSignatureRatio: number;
  };
  readonly chapterCount: number;
  readonly arcPhases: ArcPhaseMetrics;
  readonly characterDevelopment: {
    readonly categoryChapterCounts: Readonly<Record<DevelopmentCategory, number>>;
    readonly developmentChapterCount: number;
    readonly developmentChapterRatio: number;
    readonly distinctCategoryCount: number;
    readonly strongDevelopmentChapterCount: number;
    readonly strongDevelopmentChapterRatio: number;
  };
  readonly dialogue: {
    readonly chapterCountWithConsequentialDialogue: number;
    readonly chapterCountWithDialogue: number;
    readonly chapterRatioWithDialogue: number;
    readonly dialogueSpanCount: number;
    readonly dialogueWordCount: number;
    readonly dialogueWordRatio: number;
    readonly maxDialogueFreeStreak: number;
    readonly consequentialDialogueChapters: readonly number[];
    readonly totalWordCount: number;
  };
  readonly litrpgSystem: {
    readonly chapterCountWithConsequentialSystem: number;
    readonly chapterCountWithExplicitSystem: number;
    readonly chapterCountWithSystemTradeoff: number;
    readonly consequentialSystemChapters: readonly number[];
    readonly explicitSystemChapterRatio: number;
    readonly explicitSystemSignalCount: number;
    readonly maxSystemFreeStreak: number;
    readonly systemTradeoffChapters: readonly number[];
  };
  readonly endingChange: EndingChangeMetrics;
  readonly novelty: {
    readonly adjacent: readonly AdjacentNoveltyEntry[];
    readonly averageAdjacentLexicalNovelty: number;
    readonly eligibleSentenceCount: number;
    readonly lowestAdjacentLexicalNovelty: number;
    readonly reusedSentenceCount: number;
    readonly reusedSentenceRatio: number;
  };
  readonly opening: {
    readonly dominantFirstWord: string;
    readonly dominantFirstWordCount: number;
    readonly dominantFirstWordRatio: number;
    readonly firstWordFrequencies: readonly FrequencyEntry[];
    readonly maxOpeningPhraseRepeat: number;
    readonly openingPhraseFrequencies: readonly FrequencyEntry[];
    readonly uniqueOpeningPhraseCount: number;
    readonly uniqueOpeningPhraseRatio: number;
  };
  readonly progression: {
    readonly dominantSignature: string;
    readonly dominantSignatureCount: number;
    readonly dominantSignatureRatio: number;
    readonly maxSameSignatureStreak: number;
    readonly novelMarkerChapterCount: number;
    readonly novelMarkerChapterRatio: number;
    readonly uniqueSignatureCount: number;
    readonly uniqueSignatureRatio: number;
  };
  readonly sceneMovement: {
    readonly maxConsecutiveChaptersInSameScene: number;
  };
  readonly title: {
    readonly loopReturnCount: number;
    readonly loopReturnRatio: number;
    readonly maxConsecutiveSameTitle: number;
    readonly maxTitleRepeat: number;
    readonly repeatedTitles: readonly FrequencyEntry[];
    readonly uniqueTitleCount: number;
    readonly uniqueTitleRatio: number;
  };
}

export type StoryQualityGateId =
  | "action-dominance"
  | "action-streak"
  | "action-uniqueness"
  | "character-development-categories"
  | "character-development-presence"
  | "character-development-strength"
  | "dialogue-presence"
  | "dialogue-consequences"
  | "dialogue-ratio"
  | "dialogue-streak"
  | "novelty-average"
  | "novelty-lowest"
  | "novelty-reused-sentences"
  | "opening-first-word"
  | "opening-phrase-repeat"
  | "opening-phrase-uniqueness"
  | "progression-dominance"
  | "progression-novel-markers"
  | "progression-streak"
  | "progression-uniqueness"
  | "scene-movement-streak"
  | "arc-phase-early"
  | "arc-phase-middle"
  | "arc-phase-late"
  | "ending-material-change"
  | "system-consequences"
  | "system-presence"
  | "system-streak"
  | "system-tradeoffs"
  | "title-consecutive-repeat"
  | "title-looping"
  | "title-repeat"
  | "title-uniqueness";

export type ArcPhaseName = "early" | "middle" | "late";

export interface ArcPhaseEvidence {
  readonly chapter: number;
  readonly signal: string;
}

export interface ArcPhaseMetric {
  readonly covered: boolean;
  readonly evidence: readonly ArcPhaseEvidence[];
  readonly missingSignals: readonly string[];
  readonly observedSignals: readonly string[];
  readonly requiredSignals: readonly string[];
}

export interface ArcPhaseMetrics {
  readonly applicable: boolean;
  readonly early: ArcPhaseMetric;
  readonly late: ArcPhaseMetric;
  readonly middle: ArcPhaseMetric;
}

export type EndingChangeDimension =
  | "situation"
  | "location"
  | "relationship"
  | "capabilityOrResource"
  | "knowledge"
  | "objective"
  | "threat";

export interface EndingChangeMetrics {
  readonly applicable: boolean;
  readonly changedDimensions: readonly EndingChangeDimension[];
  readonly comparedChapters: readonly [number, number] | null;
  readonly evidence: readonly {
    readonly dimension: EndingChangeDimension;
    readonly from: readonly string[];
    readonly to: readonly string[];
  }[];
}

export interface StoryQualityGateResult {
  readonly actual: number;
  readonly comparator: ">=" | "<=";
  readonly id: StoryQualityGateId;
  readonly passed: boolean;
  readonly threshold: number;
}

export interface StoryQualityEvaluation {
  readonly chapters: readonly StoryQualityChapterMetrics[];
  readonly evalVersion: string;
  readonly gates: readonly StoryQualityGateResult[];
  readonly grammarProxy: {
    readonly evaluated: false;
    readonly gated: false;
    readonly reason: string;
  };
  readonly metrics: StoryQualityMetrics;
  readonly passed: boolean;
}

export interface LoadedStoryQualityStory {
  readonly chapters: readonly StoryQualityChapter[];
  readonly contentSha256: string;
  readonly databaseFileSha256: string;
  readonly worldId: string;
}

export interface StoryQualityDatabaseOptions {
  readonly firstChapter?: number;
  readonly lastChapter?: number;
  readonly worldId?: string;
}

interface ChapterDatabaseRow {
  readonly chapter: number;
  readonly delta_json: string;
  readonly record_json: string;
  readonly world_id: string;
}

interface WorldDatabaseRow {
  readonly world_id: string;
}

const DEVELOPMENT_PATTERNS: Readonly<Record<DevelopmentCategory, readonly RegExp[]>> = {
  commitment: [
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+(?:finally\s+)?(?:committed|decided|promised|resolved|vowed)\b/u,
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+chose to\b/u,
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+refused to\b/u,
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+would (?:never|no longer)\b/u,
  ],
  relationship: [
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+(?:admired|betrayed|confided in|distrusted|forgave|resented|trusted)\s+(?:her|him|me|them|us|\p{Lu}[\p{L}'’-]+)\b/u,
    /\b(?:alliance with|bond with|friendship with|loyalty to)\b/iu,
  ],
  self_reassessment: [
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+(?:admitted|recognized|realized|understood)\b/u,
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+accepted that\b/u,
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+could no longer\b/u,
    /\bfor the first time\b/iu,
    /\bhad been wrong\b/iu,
    /\bchanged (?:her|his|their) mind\b/iu,
  ],
  vulnerability: [
    /\b(?:I|[Hh]e|[Ss]he|[Tt]hey|\p{Lu}[\p{L}'’-]+)\s+(?:doubted|feared|grieved|hoped|missed|regretted)\b/u,
    /\b(?:ashamed|guilt|grief|loneliness|remorse|shame)\b/iu,
  ],
};

const DEVELOPMENT_CATEGORY_ORDER = Object.freeze([
  "commitment",
  "relationship",
  "self_reassessment",
  "vulnerability",
] as const satisfies readonly DevelopmentCategory[]);

const EXPLICIT_MECHANIC_PATTERNS = Object.freeze([
  /\b(?:experience|xp) (?:gained|increased)\s*:?\s*\d+\b/giu,
  /\blevel up\b/giu,
  /\b(?:class|quest|skill) (?:accepted|acquired|complete|completed|offered|unlocked)\b/giu,
  /\[[^\]\n]{0,120}\b(?:class|experience|health|level|mana|quest|skill|stat|xp)\b[^\]\n]{0,120}\]/giu,
]);

const EXPLICIT_SYSTEM_PATTERNS = Object.freeze([/\bsystem\b/giu, ...EXPLICIT_MECHANIC_PATTERNS]);

const SYSTEM_CONSEQUENCE_PATTERN =
  /\b(?:allowed|changed|closed|completed|demanded|evolved|exposed|forced|freed|gained|identified|lost|opened|revealed|rewarded|unlocked)\b/iu;
const SYSTEM_DECISION_PATTERN =
  /\b(?:accepted|chose|committed|declined|forwent|gave up|refused|risked|sacrificed|spent|surrendered|traded)\b/iu;
const SYSTEM_TRADEOFF_PATTERN =
  /\b(?:at the cost|but|cost|exposure|forfeit|forego|gave up|in return|instead|loss|only if|penalty|risk|sacrifice|surrender|trade)\b/iu;

const DIALOGUE_DECISION_PATTERN =
  /\b(?:accept|admit|agree|ask|choose|confess|decide|do not|don't|follow|forgive|give|go|guard|help|keep|leave|let|lower|meet|promise|read|refuse|rescue|run|share|show|stand|stay|steer|stop|strike|take|tell|trade|trust|wait|watch|will|won't)\b/iu;
const DIALOGUE_CONSEQUENCE_VERB_PATTERN =
  /\b(?:abandoned|accepted|agreed|broke|changed|chose|collapsed|decided|escaped|exposed|failed|fell|forgave|formed|freed|held|joined|left|opened|refused|rescued|retreated|revealed|sealed|shifted|split|stayed|surrendered|trusted|won)\b/iu;
const DIALOGUE_CONSEQUENCE_DOMAIN_PATTERN =
  /\b(?:agreement|alliance|ambush|approach|argument|attack|battle|bond|captives?|conflict|course|defen[cs]e|distrust|enemies|enemy|escape|foes?|formation|guard|loyalty|monsters?|pact|plan|prisoners?|refugees?|rescue|retreat|rivals?|route|siege|trust|truce|watch|wolves)\b/iu;

const CAUSAL_RELATION_MAX_CHARS = 360;
const DIALOGUE_EXCHANGE_MAX_GAP_CHARS = 240;
const DIALOGUE_CONSEQUENCE_MAX_GAP_CHARS = 280;
const QUOTED_SPEECH_PATTERN = /“([^”]+)”|"([^"\n]+)"/gu;

const ARC_PHASE_REQUIREMENTS = Object.freeze({
  early: Object.freeze(["commitment", "setup"]),
  middle: Object.freeze(["escalation", "cost", "reversal"]),
  late: Object.freeze(["payoff", "convergence", "hook"]),
} as const);

const ENDING_DIMENSION_ORDER = Object.freeze([
  "situation",
  "location",
  "relationship",
  "capabilityOrResource",
  "knowledge",
  "objective",
  "threat",
] as const satisfies readonly EndingChangeDimension[]);
const ENDING_MARKER_DIMENSION_ORDER = Object.freeze([
  "relationship",
  "capabilityOrResource",
  "knowledge",
  "objective",
  "threat",
] as const satisfies readonly Exclude<EndingChangeDimension, "situation" | "location">[]);

const CONTENT_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "among",
  "and",
  "another",
  "because",
  "been",
  "before",
  "being",
  "beneath",
  "between",
  "both",
  "could",
  "did",
  "does",
  "each",
  "even",
  "every",
  "from",
  "had",
  "has",
  "have",
  "her",
  "here",
  "him",
  "his",
  "into",
  "its",
  "just",
  "more",
  "most",
  "much",
  "not",
  "now",
  "only",
  "other",
  "our",
  "out",
  "over",
  "same",
  "she",
  "should",
  "some",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "through",
  "under",
  "until",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "would",
  "you",
]);

const GRAMMAR_PROXY_REASON =
  "No deterministic provider-free grammar proxy is reliable enough for stylized fiction. Grammar remains a human-review dimension.";

export function evaluateStoryQuality(
  inputChapters: readonly StoryQualityChapter[],
): StoryQualityEvaluation {
  const chapters = validateChapters(inputChapters);
  const chapterMetrics = chapters.map(analyzeChapter);
  const metrics = aggregateMetrics(chapters, chapterMetrics);
  const gates = buildGates(metrics);
  return {
    chapters: chapterMetrics,
    evalVersion: STORY_QUALITY_EVAL_VERSION,
    gates,
    grammarProxy: {
      evaluated: false,
      gated: false,
      reason: GRAMMAR_PROXY_REASON,
    },
    metrics,
    passed: gates.every((gate) => gate.passed),
  };
}

export function loadStoryQualityStoryFromDatabase(
  filename: string,
  options: StoryQualityDatabaseOptions = {},
): LoadedStoryQualityStory {
  const firstChapter = options.firstChapter ?? 1;
  const lastChapter = options.lastChapter ?? 18;
  if (
    !Number.isSafeInteger(firstChapter) ||
    !Number.isSafeInteger(lastChapter) ||
    firstChapter < 1 ||
    lastChapter < firstChapter ||
    lastChapter > 350
  ) {
    throw new RangeError("Story-quality chapter range is invalid");
  }

  const database = new Database(filename, { fileMustExist: true, readonly: true });
  try {
    const worldId = options.worldId ?? selectOnlyWorldId(database);
    const rows = database
      .prepare<[string, number, number], ChapterDatabaseRow>(
        `SELECT chapters.world_id,
                chapters.chapter,
                chapters.record_json,
                world_deltas.delta_json
           FROM chapters
           JOIN world_deltas
             ON world_deltas.world_id = chapters.world_id
            AND world_deltas.chapter = chapters.chapter
          WHERE chapters.world_id = ?
            AND chapters.chapter BETWEEN ? AND ?
          ORDER BY chapters.chapter`,
      )
      .all(worldId, firstChapter, lastChapter);
    const expectedCount = lastChapter - firstChapter + 1;
    if (rows.length !== expectedCount) {
      throw new Error(
        `Story-quality baseline requires chapters ${firstChapter}-${lastChapter}; found ${rows.length}`,
      );
    }

    const chapters = rows.map((row, index) => {
      const expectedChapter = firstChapter + index;
      if (row.chapter !== expectedChapter) {
        throw new Error(`Story-quality chapter sequence skips chapter ${expectedChapter}`);
      }
      return chapterFromDatabaseRow(row);
    });
    const contentSha256 = sha256(
      JSON.stringify(
        rows.map((row) => ({
          chapter: row.chapter,
          delta: JSON.parse(row.delta_json) as unknown,
          record: JSON.parse(row.record_json) as unknown,
          worldId: row.world_id,
        })),
      ),
    );
    return {
      chapters,
      contentSha256,
      databaseFileSha256: sha256(readFileSync(filename)),
      worldId,
    };
  } finally {
    database.close();
  }
}

function selectOnlyWorldId(database: Database.Database): string {
  const worlds = database
    .prepare<[], WorldDatabaseRow>("SELECT DISTINCT world_id FROM chapters ORDER BY world_id")
    .all();
  if (worlds.length !== 1) {
    throw new Error(
      `Story-quality database must contain exactly one chapter world; found ${worlds.length}`,
    );
  }
  return worlds[0]!.world_id;
}

function chapterFromDatabaseRow(row: ChapterDatabaseRow): StoryQualityChapter {
  const record = parseObject(row.record_json, `chapter ${row.chapter} record`);
  const delta = parseObject(row.delta_json, `chapter ${row.chapter} delta`);
  const chapter = requireNumber(record, "chapter");
  const title = requireString(record, "title");
  const prose = requireString(record, "prose");
  const povCharacterId = requireString(record, "povCharacterId");
  const playerAction = requireObject(record, "playerAction");
  const action = requireObject(playerAction, "action");
  if (chapter !== row.chapter) {
    throw new Error(`Chapter row ${row.chapter} does not match its record`);
  }
  return {
    actionSignature: stableStringify(action),
    chapter,
    deltaSha256: sha256(row.delta_json),
    progressionMarkers: deriveProgressionMarkers(delta, povCharacterId),
    prose,
    proseSha256: sha256(prose),
    recordSha256: sha256(row.record_json),
    sceneLocationId: derivePovSceneLocationId(delta, povCharacterId),
    title,
  };
}

function derivePovSceneLocationId(
  delta: Readonly<Record<string, unknown>>,
  povCharacterId: string,
): string {
  const locations = new Set<string>();
  for (const eventValue of requireArray(delta, "events")) {
    const event = asObject(eventValue, "event");
    const participantIds = requireStringArray(event, "participantIds");
    if (participantIds.includes(povCharacterId)) {
      locations.add(requireString(event, "locationId"));
    }
  }
  if (locations.size !== 1) {
    throw new Error(
      `Story-quality chapter must have exactly one POV scene location; found ${locations.size}`,
    );
  }
  return [...locations][0]!;
}

function deriveProgressionMarkers(
  delta: Readonly<Record<string, unknown>>,
  povCharacterId: string,
): readonly string[] {
  const markers: string[] = [];
  const stateMutations = requireArray(delta, "stateMutations");
  for (const mutationValue of stateMutations) {
    const mutation = asObject(mutationValue, "state mutation");
    const characterId = optionalString(mutation, "characterId");
    if (characterId !== undefined && characterId !== povCharacterId) continue;
    markers.push(`state:${stableStringify(stripVolatileProgressionFields(mutation))}`);
  }
  const knowledgeMutations = requireArray(delta, "knowledgeMutations");
  for (const mutationValue of knowledgeMutations) {
    const mutation = asObject(mutationValue, "knowledge mutation");
    if (optionalString(mutation, "characterId") !== povCharacterId) continue;
    const factValue = mutation.fact;
    const fact =
      factValue === undefined ? undefined : asObject(factValue, "knowledge mutation fact");
    const marker = {
      certainty: fact === undefined ? undefined : optionalString(fact, "certainty"),
      claim: fact === undefined ? undefined : optionalString(fact, "claim"),
      type: optionalString(mutation, "type") ?? "unknown",
      visibility: fact === undefined ? undefined : optionalString(fact, "visibility"),
    };
    markers.push(`knowledge:${stableStringify(marker)}`);
  }
  return [...new Set(markers)].sort((left, right) => left.localeCompare(right));
}

function stripVolatileProgressionFields(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "chapter" || key === "discoveredChapter" || key === "expectedWorldVersion") {
      continue;
    }
    result[key] = entry;
  }
  return result;
}

function validateChapters(input: readonly StoryQualityChapter[]): readonly StoryQualityChapter[] {
  if (input.length < 2) {
    throw new Error("Story-quality evaluation requires at least two contiguous chapters");
  }
  const chapters = [...input].sort((left, right) => left.chapter - right.chapter);
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index]!;
    validateChapter(chapter);
    if (index > 0 && chapter.chapter !== chapters[index - 1]!.chapter + 1) {
      throw new Error("Story-quality evaluation requires contiguous chapters");
    }
  }
  return chapters;
}

function validateChapter(chapter: StoryQualityChapter): void {
  if (!Number.isSafeInteger(chapter.chapter) || chapter.chapter < 1 || chapter.chapter > 350) {
    throw new RangeError("Story-quality chapter number is invalid");
  }
  if (chapter.title.trim() === "" || chapter.prose.trim() === "") {
    throw new Error(`Story-quality chapter ${chapter.chapter} has empty title or prose`);
  }
  if (chapter.actionSignature.trim() === "") {
    throw new Error(`Story-quality chapter ${chapter.chapter} has no action signature`);
  }
  if (chapter.progressionMarkers.length === 0) {
    throw new Error(`Story-quality chapter ${chapter.chapter} has no progression markers`);
  }
  if (chapter.sceneLocationId.trim() === "") {
    throw new Error(`Story-quality chapter ${chapter.chapter} has no scene location`);
  }
}

function analyzeChapter(chapter: StoryQualityChapter): StoryQualityChapterMetrics {
  const chapterWords = words(chapter.prose);
  const dialogueSpans = findDialogueSpans(chapter.prose);
  const dialogueWordCount = dialogueSpans.reduce((total, span) => total + words(span).length, 0);
  const consequentialDialogueEvidence = findConsequentialDialogueEvidence(chapter.prose);
  const developmentCategories = DEVELOPMENT_CATEGORY_ORDER.filter((category) =>
    DEVELOPMENT_PATTERNS[category].some((pattern) => pattern.test(chapter.prose)),
  );
  const explicitSystemSignalCount = countPatternMatches(chapter.prose, EXPLICIT_SYSTEM_PATTERNS);
  const systemEvidence = findSystemEvidence(chapter.prose, explicitSystemSignalCount);
  const proseWords = words(chapter.prose);
  const progressionMarkers = [...new Set(chapter.progressionMarkers)].sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    actionSignature: chapter.actionSignature,
    chapter: chapter.chapter,
    developmentCategories,
    consequentialDialogueEvidence,
    dialogueSpanCount: dialogueSpans.length,
    dialogueWordCount,
    dialogueWordRatio: ratio(dialogueWordCount, chapterWords.length),
    explicitSystemSignalCount,
    firstWord: proseWords[0] ?? "",
    hasDialogue: dialogueWordCount >= DIALOGUE_PRESENCE_MIN_WORDS,
    hasConsequentialDialogue: consequentialDialogueEvidence.length > 0,
    hasConsequentialSystem: systemEvidence.consequences.length > 0,
    hasExplicitSystemSignal: explicitSystemSignalCount > 0,
    hasSystemTradeoff: systemEvidence.tradeoffs.length > 0,
    openingPhrase: proseWords.slice(0, OPENING_PHRASE_WORDS).join(" "),
    progressionMarkers,
    progressionSignature: progressionMarkers.join(" | "),
    sceneLocationId: chapter.sceneLocationId,
    strongDevelopmentSignal: developmentCategories.length >= 2,
    systemConsequenceEvidence: systemEvidence.consequences,
    systemTradeoffEvidence: systemEvidence.tradeoffs,
    title: chapter.title,
    titleKey: normalizePhrase(chapter.title),
    wordCount: chapterWords.length,
  };
}

function aggregateMetrics(
  chapters: readonly StoryQualityChapter[],
  chapterMetrics: readonly StoryQualityChapterMetrics[],
): StoryQualityMetrics {
  const chapterCount = chapterMetrics.length;
  const totalWordCount = sum(chapterMetrics.map((chapter) => chapter.wordCount));
  const dialogueWordCount = sum(chapterMetrics.map((chapter) => chapter.dialogueWordCount));
  const dialogueSpanCount = sum(chapterMetrics.map((chapter) => chapter.dialogueSpanCount));
  const dialoguePresence = chapterMetrics.map((chapter) => chapter.hasDialogue);
  const systemPresence = chapterMetrics.map((chapter) => chapter.hasExplicitSystemSignal);
  const consequentialDialogueChapters = chapterMetrics
    .filter((chapter) => chapter.hasConsequentialDialogue)
    .map((chapter) => chapter.chapter);
  const consequentialSystemChapters = chapterMetrics
    .filter((chapter) => chapter.hasConsequentialSystem)
    .map((chapter) => chapter.chapter);
  const systemTradeoffChapters = chapterMetrics
    .filter((chapter) => chapter.hasSystemTradeoff)
    .map((chapter) => chapter.chapter);
  const developmentChapterCount = chapterMetrics.filter(
    (chapter) => chapter.developmentCategories.length > 0,
  ).length;
  const strongDevelopmentChapterCount = chapterMetrics.filter(
    (chapter) => chapter.strongDevelopmentSignal,
  ).length;
  const categoryChapterCounts = Object.fromEntries(
    DEVELOPMENT_CATEGORY_ORDER.map((category) => [
      category,
      chapterMetrics.filter((chapter) => chapter.developmentCategories.includes(category)).length,
    ]),
  ) as Readonly<Record<DevelopmentCategory, number>>;
  const titleKeys = chapterMetrics.map((chapter) => chapter.titleKey);
  const titleFrequency = frequencies(titleKeys);
  const titleLoopReturnCount = countLoopReturns(titleKeys);
  const actionTypes = chapterMetrics.map((chapter) => normalizeActionType(chapter.actionSignature));
  const actionFrequency = frequencies(actionTypes);
  const progressionFrequency = frequencies(
    chapterMetrics.map((chapter) => chapter.progressionSignature),
  );
  const firstWordFrequency = frequencies(chapterMetrics.map((chapter) => chapter.firstWord));
  const openingPhraseFrequency = frequencies(
    chapterMetrics.map((chapter) => chapter.openingPhrase),
  );
  const adjacent = adjacentNovelty(chapters);
  const sentenceReuse = sentenceReuseMetrics(chapters);
  const novelMarkerChapterCount = countNovelMarkerChapters(chapterMetrics);
  const dominantAction = actionFrequency[0]!;
  const dominantProgression = progressionFrequency[0]!;
  const dominantFirstWord = firstWordFrequency[0]!;

  return {
    action: {
      dominantSignature: dominantAction.value,
      dominantSignatureCount: dominantAction.count,
      dominantSignatureRatio: ratio(dominantAction.count, chapterCount),
      maxSameSignatureStreak: longestSameValueStreak(actionTypes),
      uniqueSignatureCount: actionFrequency.length,
      uniqueSignatureRatio: ratio(actionFrequency.length, chapterCount),
    },
    chapterCount,
    arcPhases: buildArcPhaseMetrics(chapters, chapterMetrics),
    characterDevelopment: {
      categoryChapterCounts,
      developmentChapterCount,
      developmentChapterRatio: ratio(developmentChapterCount, chapterCount),
      distinctCategoryCount: DEVELOPMENT_CATEGORY_ORDER.filter(
        (category) => categoryChapterCounts[category] > 0,
      ).length,
      strongDevelopmentChapterCount,
      strongDevelopmentChapterRatio: ratio(strongDevelopmentChapterCount, chapterCount),
    },
    dialogue: {
      chapterCountWithConsequentialDialogue: consequentialDialogueChapters.length,
      chapterCountWithDialogue: dialoguePresence.filter(Boolean).length,
      chapterRatioWithDialogue: ratio(dialoguePresence.filter(Boolean).length, chapterCount),
      dialogueSpanCount,
      dialogueWordCount,
      dialogueWordRatio: ratio(dialogueWordCount, totalWordCount),
      maxDialogueFreeStreak: longestFalseStreak(dialoguePresence),
      consequentialDialogueChapters,
      totalWordCount,
    },
    litrpgSystem: {
      chapterCountWithConsequentialSystem: consequentialSystemChapters.length,
      chapterCountWithExplicitSystem: systemPresence.filter(Boolean).length,
      chapterCountWithSystemTradeoff: systemTradeoffChapters.length,
      consequentialSystemChapters,
      explicitSystemChapterRatio: ratio(systemPresence.filter(Boolean).length, chapterCount),
      explicitSystemSignalCount: sum(
        chapterMetrics.map((chapter) => chapter.explicitSystemSignalCount),
      ),
      maxSystemFreeStreak: longestFalseStreak(systemPresence),
      systemTradeoffChapters,
    },
    endingChange: buildEndingChangeMetrics(chapters),
    novelty: {
      adjacent,
      averageAdjacentLexicalNovelty: average(adjacent.map((entry) => entry.lexicalNovelty)),
      eligibleSentenceCount: sentenceReuse.eligibleSentenceCount,
      lowestAdjacentLexicalNovelty: Math.min(...adjacent.map((entry) => entry.lexicalNovelty)),
      reusedSentenceCount: sentenceReuse.reusedSentenceCount,
      reusedSentenceRatio: ratio(
        sentenceReuse.reusedSentenceCount,
        sentenceReuse.eligibleSentenceCount,
      ),
    },
    opening: {
      dominantFirstWord: dominantFirstWord.value,
      dominantFirstWordCount: dominantFirstWord.count,
      dominantFirstWordRatio: ratio(dominantFirstWord.count, chapterCount),
      firstWordFrequencies: firstWordFrequency,
      maxOpeningPhraseRepeat: openingPhraseFrequency[0]!.count,
      openingPhraseFrequencies: openingPhraseFrequency,
      uniqueOpeningPhraseCount: openingPhraseFrequency.length,
      uniqueOpeningPhraseRatio: ratio(openingPhraseFrequency.length, chapterCount),
    },
    progression: {
      dominantSignature: dominantProgression.value,
      dominantSignatureCount: dominantProgression.count,
      dominantSignatureRatio: ratio(dominantProgression.count, chapterCount),
      maxSameSignatureStreak: longestSameValueStreak(
        chapterMetrics.map((chapter) => chapter.progressionSignature),
      ),
      novelMarkerChapterCount,
      novelMarkerChapterRatio: ratio(novelMarkerChapterCount, chapterCount),
      uniqueSignatureCount: progressionFrequency.length,
      uniqueSignatureRatio: ratio(progressionFrequency.length, chapterCount),
    },
    sceneMovement: {
      maxConsecutiveChaptersInSameScene: longestSameValueStreak(
        chapterMetrics.map((chapter) => chapter.sceneLocationId),
      ),
    },
    title: {
      loopReturnCount: titleLoopReturnCount,
      loopReturnRatio: ratio(titleLoopReturnCount, chapterCount),
      maxConsecutiveSameTitle: longestSameValueStreak(titleKeys),
      maxTitleRepeat: titleFrequency[0]!.count,
      repeatedTitles: titleFrequency.filter((entry) => entry.count > 1),
      uniqueTitleCount: titleFrequency.length,
      uniqueTitleRatio: ratio(titleFrequency.length, chapterCount),
    },
  };
}

function buildGates(metrics: StoryQualityMetrics): readonly StoryQualityGateResult[] {
  const thresholds = STORY_QUALITY_THRESHOLDS;
  const gates: StoryQualityGateResult[] = [
    atLeast(
      "dialogue-presence",
      metrics.dialogue.chapterRatioWithDialogue,
      thresholds.dialogue.minDialogueChapterRatio,
    ),
    atLeast(
      "dialogue-ratio",
      metrics.dialogue.dialogueWordRatio,
      thresholds.dialogue.minOverallDialogueWordRatio,
    ),
    atMost(
      "dialogue-streak",
      metrics.dialogue.maxDialogueFreeStreak,
      thresholds.dialogue.maxDialogueFreeStreak,
    ),
    atLeast(
      "dialogue-consequences",
      metrics.dialogue.chapterCountWithConsequentialDialogue,
      STORY_GOOD_ENOUGH_THRESHOLDS.consequentialDialogueChapters,
    ),
    atLeast(
      "character-development-presence",
      metrics.characterDevelopment.developmentChapterRatio,
      thresholds.characterDevelopment.minDevelopmentChapterRatio,
    ),
    atLeast(
      "character-development-strength",
      metrics.characterDevelopment.strongDevelopmentChapterRatio,
      thresholds.characterDevelopment.minStrongDevelopmentChapterRatio,
    ),
    atLeast(
      "character-development-categories",
      metrics.characterDevelopment.distinctCategoryCount,
      thresholds.characterDevelopment.minDistinctCategories,
    ),
    atLeast(
      "system-presence",
      metrics.litrpgSystem.explicitSystemChapterRatio,
      thresholds.litrpgSystem.minExplicitSystemChapterRatio,
    ),
    atMost(
      "system-streak",
      metrics.litrpgSystem.maxSystemFreeStreak,
      thresholds.litrpgSystem.maxSystemFreeStreak,
    ),
    atLeast(
      "system-consequences",
      metrics.litrpgSystem.chapterCountWithConsequentialSystem,
      STORY_GOOD_ENOUGH_THRESHOLDS.consequentialSystemChapters,
    ),
    atLeast(
      "system-tradeoffs",
      metrics.litrpgSystem.chapterCountWithSystemTradeoff,
      STORY_GOOD_ENOUGH_THRESHOLDS.systemTradeoffChapters,
    ),
    atMost(
      "opening-first-word",
      metrics.opening.dominantFirstWordRatio,
      thresholds.opening.maxDominantFirstWordRatio,
    ),
    atLeast(
      "opening-phrase-uniqueness",
      metrics.opening.uniqueOpeningPhraseRatio,
      thresholds.opening.minUniqueOpeningPhraseRatio,
    ),
    atMost(
      "opening-phrase-repeat",
      metrics.opening.maxOpeningPhraseRepeat,
      thresholds.opening.maxOpeningPhraseRepeat,
    ),
    atLeast(
      "title-uniqueness",
      metrics.title.uniqueTitleRatio,
      thresholds.title.minUniqueTitleRatio,
    ),
    atMost("title-repeat", metrics.title.maxTitleRepeat, thresholds.title.maxTitleRepeat),
    atMost(
      "title-consecutive-repeat",
      metrics.title.maxConsecutiveSameTitle,
      thresholds.title.maxConsecutiveSameTitle,
    ),
    atMost("title-looping", metrics.title.loopReturnRatio, thresholds.title.maxLoopReturnRatio),
    atLeast(
      "action-uniqueness",
      metrics.action.uniqueSignatureRatio,
      thresholds.action.minUniqueSignatureRatio,
    ),
    atMost(
      "action-dominance",
      metrics.action.dominantSignatureRatio,
      thresholds.action.maxDominantSignatureRatio,
    ),
    atMost(
      "action-streak",
      metrics.action.maxSameSignatureStreak,
      thresholds.action.maxSameSignatureStreak,
    ),
    atLeast(
      "progression-uniqueness",
      metrics.progression.uniqueSignatureRatio,
      thresholds.progression.minUniqueSignatureRatio,
    ),
    atMost(
      "progression-dominance",
      metrics.progression.dominantSignatureRatio,
      thresholds.progression.maxDominantSignatureRatio,
    ),
    atMost(
      "progression-streak",
      metrics.progression.maxSameSignatureStreak,
      thresholds.progression.maxSameSignatureStreak,
    ),
    atLeast(
      "progression-novel-markers",
      metrics.progression.novelMarkerChapterRatio,
      thresholds.progression.minNovelMarkerChapterRatio,
    ),
    atMost(
      "scene-movement-streak",
      metrics.sceneMovement.maxConsecutiveChaptersInSameScene,
      STORY_QUALITY_SCENE_MOVEMENT_THRESHOLDS.maxConsecutiveChaptersInSameScene,
    ),
    atLeast(
      "novelty-average",
      metrics.novelty.averageAdjacentLexicalNovelty,
      thresholds.novelty.minAverageAdjacentLexicalNovelty,
    ),
    atLeast(
      "novelty-lowest",
      metrics.novelty.lowestAdjacentLexicalNovelty,
      thresholds.novelty.minLowestAdjacentLexicalNovelty,
    ),
    atMost(
      "novelty-reused-sentences",
      metrics.novelty.reusedSentenceRatio,
      thresholds.novelty.maxReusedSentenceRatio,
    ),
  ];
  if (metrics.arcPhases.applicable) {
    gates.push(
      atLeast("arc-phase-early", Number(metrics.arcPhases.early.covered), 1),
      atLeast("arc-phase-middle", Number(metrics.arcPhases.middle.covered), 1),
      atLeast("arc-phase-late", Number(metrics.arcPhases.late.covered), 1),
    );
  }
  if (metrics.endingChange.applicable) {
    gates.push(
      atLeast(
        "ending-material-change",
        metrics.endingChange.changedDimensions.length,
        STORY_GOOD_ENOUGH_THRESHOLDS.endingChangedDimensions,
      ),
    );
  }
  return gates;
}

function findConsequentialDialogueEvidence(prose: string): readonly string[] {
  const evidence: string[] = [];
  const dialogueSpans = findDialogueSpanMatches(prose);
  for (let firstIndex = 0; firstIndex < dialogueSpans.length - 1; firstIndex += 1) {
    const first = dialogueSpans[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < dialogueSpans.length; secondIndex += 1) {
      const second = dialogueSpans[secondIndex]!;
      const exchangeGap = second.start - first.end;
      if (exchangeGap > DIALOGUE_EXCHANGE_MAX_GAP_CHARS) break;
      if (
        exchangeGap < 0 ||
        hasParagraphBreak(prose, first.end, second.start) ||
        words(first.value).length + words(second.value).length < DIALOGUE_PRESENCE_MIN_WORDS ||
        (!DIALOGUE_DECISION_PATTERN.test(first.value) &&
          !DIALOGUE_DECISION_PATTERN.test(second.value))
      ) {
        continue;
      }

      const following = localFollowingText(prose, second.end, DIALOGUE_CONSEQUENCE_MAX_GAP_CHARS);
      const consequence = DIALOGUE_CONSEQUENCE_VERB_PATTERN.exec(following)?.[0];
      const domain = DIALOGUE_CONSEQUENCE_DOMAIN_PATTERN.exec(following)?.[0];
      if (consequence !== undefined && domain !== undefined) {
        evidence.push(
          `exchange=${first.value.slice(0, 40)} | ${second.value.slice(0, 40)}; consequence=${consequence}; domain=${domain}`,
        );
        break;
      }
    }
  }
  return evidence;
}

function findSystemEvidence(
  prose: string,
  explicitSystemSignalCount: number,
): { readonly consequences: readonly string[]; readonly tradeoffs: readonly string[] } {
  if (explicitSystemSignalCount === 0) {
    return { consequences: [], tradeoffs: [] };
  }

  const mechanics = findPatternMatches(prose, EXPLICIT_MECHANIC_PATTERNS);
  if (mechanics.length === 0) return { consequences: [], tradeoffs: [] };
  const excludedRanges = [...mechanics, ...findPatternMatches(prose, [/\[[^\]\n]{0,260}\]/gu])];
  const decisions = findPatternMatches(prose, [SYSTEM_DECISION_PATTERN]).filter(
    (match) => !overlapsAny(match, excludedRanges),
  );
  const consequences = findPatternMatches(prose, [SYSTEM_CONSEQUENCE_PATTERN]).filter(
    (match) => !overlapsAny(match, excludedRanges),
  );
  const tradeoffs = findPatternMatches(prose, [SYSTEM_TRADEOFF_PATTERN]).filter(
    (match) => !overlapsAny(match, excludedRanges),
  );
  const consequenceEvidence: string[] = [];
  const tradeoffEvidence: string[] = [];
  for (const mechanic of mechanics) {
    const decision = decisions.find((candidate) => areLocallyRelated(prose, [mechanic, candidate]));
    if (decision === undefined) continue;
    const consequence = consequences.find(
      (candidate) =>
        candidate.start >= decision.end &&
        !rangesOverlap(candidate, decision) &&
        areLocallyRelated(prose, [mechanic, decision, candidate]),
    );
    if (consequence !== undefined) {
      consequenceEvidence.push(
        `mechanic=${mechanic.value}; decision=${decision.value}; consequence=${consequence.value}`,
      );
    }
    const tradeoff = tradeoffs.find(
      (candidate) =>
        !rangesOverlap(candidate, decision) &&
        areLocallyRelated(prose, [mechanic, decision, candidate]),
    );
    if (tradeoff !== undefined) {
      tradeoffEvidence.push(
        `mechanic=${mechanic.value}; decision=${decision.value}; tradeoff=${tradeoff.value}`,
      );
    }
  }
  return {
    consequences: [...new Set(consequenceEvidence)],
    tradeoffs: [...new Set(tradeoffEvidence)],
  };
}

function buildArcPhaseMetrics(
  chapters: readonly StoryQualityChapter[],
  chapterMetrics: readonly StoryQualityChapterMetrics[],
): ArcPhaseMetrics {
  const applicable = chapterMetrics.length === 10;
  return {
    applicable,
    early: buildArcPhaseMetric(
      chapters.slice(0, 3),
      chapterMetrics.slice(0, 3),
      ARC_PHASE_REQUIREMENTS.early,
      "early",
    ),
    middle: buildArcPhaseMetric(
      chapters.slice(3, 7),
      chapterMetrics.slice(3, 7),
      ARC_PHASE_REQUIREMENTS.middle,
      "middle",
    ),
    late: buildArcPhaseMetric(
      chapters.slice(7, 10),
      chapterMetrics.slice(7, 10),
      ARC_PHASE_REQUIREMENTS.late,
      "late",
    ),
  };
}

function buildArcPhaseMetric(
  chapters: readonly StoryQualityChapter[],
  chapterMetrics: readonly StoryQualityChapterMetrics[],
  requiredSignals: readonly string[],
  phase: ArcPhaseName,
): ArcPhaseMetric {
  const evidence = chapterMetrics.flatMap((chapter, index) =>
    arcSignals(chapter, chapters[index]!.prose, phase).map((signal) => ({
      chapter: chapter.chapter,
      signal,
    })),
  );
  const observedSignals = requiredSignals.filter((signal) =>
    evidence.some((entry) => entry.signal === signal),
  );
  const missingSignals = requiredSignals.filter((signal) => !observedSignals.includes(signal));
  return {
    covered: missingSignals.length === 0,
    evidence,
    missingSignals,
    observedSignals,
    requiredSignals,
  };
}

function arcSignals(
  chapter: StoryQualityChapterMetrics,
  prose: string,
  phase: ArcPhaseName,
): readonly string[] {
  if (phase === "early") {
    return compactSignals([
      chapter.developmentCategories.includes("commitment") ||
      /\b(?:accepted|chose|committed|decided|promised|resolved|vowed)\b/iu.test(prose)
        ? "commitment"
        : undefined,
      chapter.hasConsequentialSystem ||
      /\b(?:goal|map|objective|quest|threat|wanted|needed|envoy|captives|record)\b/iu.test(prose)
        ? "setup"
        : undefined,
    ]);
  }
  if (phase === "middle") {
    return compactSignals([
      /\b(?:assassin|closed|danger|enemy|poison|stalked|threat|trapped|worse)\b/iu.test(prose)
        ? "escalation"
        : undefined,
      /\b(?:before claiming|cost|cruelty|destroyed|lose|losing|loss|poison|regretted|restitution|surrender|trapped)\b/iu.test(
        prose,
      )
        ? "cost"
        : undefined,
      /\b(?:but|exposed|identified|instead|opened|revealed|shut|uncovered|yet)\b/iu.test(prose)
        ? "reversal"
        : undefined,
    ]);
  }
  return compactSignals([
    /\b(?:closed|completed|evolved|forged|fulfilled|reached|restored|sealed|won)\b/iu.test(prose)
      ? "payoff"
      : undefined,
    /\b(?:both|joined|pact|share|shared|together|their|our)\b/iu.test(prose)
      ? "convergence"
      : undefined,
    /\b(?:coming|new (?:danger|enemy|problem|quest|road|threat)|next|opened home|stronger)\b/iu.test(
      prose,
    )
      ? "hook"
      : undefined,
  ]);
}

function compactSignals(values: readonly (string | undefined)[]): readonly string[] {
  return values.filter((value): value is string => value !== undefined);
}

function buildEndingChangeMetrics(chapters: readonly StoryQualityChapter[]): EndingChangeMetrics {
  if (chapters.length !== 10) {
    return { applicable: false, changedDimensions: [], comparedChapters: null, evidence: [] };
  }
  const first = chapters[0]!;
  const last = chapters[9]!;
  const values = new Map<EndingChangeDimension, readonly [readonly string[], readonly string[]]>([
    ["situation", [[first.actionSignature], [last.actionSignature]]],
    ["location", [[first.sceneLocationId], [last.sceneLocationId]]],
    ...ENDING_MARKER_DIMENSION_ORDER.map(
      (dimension) =>
        [
          dimension,
          [
            markerValues(first.progressionMarkers, dimension),
            markerValues(last.progressionMarkers, dimension),
          ],
        ] as const,
    ),
  ]);
  const evidence = ENDING_DIMENSION_ORDER.flatMap((dimension) => {
    const [from, to] = values.get(dimension)!;
    if ((from.length === 0 && to.length === 0) || arraysEqual(from, to)) return [];
    return [{ dimension, from, to }];
  });
  return {
    applicable: true,
    changedDimensions: evidence.map((entry) => entry.dimension),
    comparedChapters: [first.chapter, last.chapter],
    evidence,
  };
}

function markerValues(
  markers: readonly string[],
  dimension: Exclude<EndingChangeDimension, "situation" | "location">,
): readonly string[] {
  const patternByDimension: Readonly<Record<typeof dimension, RegExp>> = {
    relationship: /\b(?:relationship|set_relationship)\b/iu,
    capabilityOrResource:
      /\b(?:adjust_inventory|adjust_stat|class|experience|grant_experience|inventory|resource|skill|unlock_skill|xp)\b/iu,
    knowledge: /^(?:knowledge:)|\bknowledge\b/iu,
    objective: /\b(?:milestone|objective|quest)\b/iu,
    threat: /\b(?:set_threat|threat)\b/iu,
  };
  return markers.filter((marker) => patternByDimension[dimension].test(marker));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function adjacentNovelty(
  chapters: readonly StoryQualityChapter[],
): readonly AdjacentNoveltyEntry[] {
  const entries: AdjacentNoveltyEntry[] = [];
  for (let index = 1; index < chapters.length; index += 1) {
    const previous = chapters[index - 1]!;
    const current = chapters[index]!;
    entries.push({
      fromChapter: previous.chapter,
      lexicalNovelty: round(
        1 -
          cosineSimilarity(
            contentTermFrequency(previous.prose),
            contentTermFrequency(current.prose),
          ),
      ),
      toChapter: current.chapter,
    });
  }
  return entries;
}

function contentTermFrequency(text: string): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const word of words(text)) {
    if (word.length < 3 || CONTENT_STOP_WORDS.has(word)) continue;
    result.set(word, (result.get(word) ?? 0) + 1);
  }
  return result;
}

function cosineSimilarity(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const value of left.values()) leftMagnitude += value * value;
  for (const value of right.values()) rightMagnitude += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) ?? 0);
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function sentenceReuseMetrics(chapters: readonly StoryQualityChapter[]): {
  readonly eligibleSentenceCount: number;
  readonly reusedSentenceCount: number;
} {
  const firstChapterBySentence = new Map<string, number>();
  let eligibleSentenceCount = 0;
  let reusedSentenceCount = 0;
  for (const chapter of chapters) {
    for (const sentence of sentences(chapter.prose)) {
      const normalized = words(sentence).join(" ");
      if (words(sentence).length < 8) continue;
      eligibleSentenceCount += 1;
      const firstChapter = firstChapterBySentence.get(normalized);
      if (firstChapter !== undefined && firstChapter !== chapter.chapter) {
        reusedSentenceCount += 1;
      } else if (firstChapter === undefined) {
        firstChapterBySentence.set(normalized, chapter.chapter);
      }
    }
  }
  return { eligibleSentenceCount, reusedSentenceCount };
}

function countNovelMarkerChapters(chapters: readonly StoryQualityChapterMetrics[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const chapter of chapters) {
    const novel = chapter.progressionMarkers.some((marker) => !seen.has(marker));
    if (novel) count += 1;
    for (const marker of chapter.progressionMarkers) seen.add(marker);
  }
  return count;
}

interface TextMatch {
  readonly end: number;
  readonly start: number;
  readonly value: string;
}

function findDialogueSpans(text: string): readonly string[] {
  return findDialogueSpanMatches(text).map((match) => match.value);
}

function findDialogueSpanMatches(text: string): readonly TextMatch[] {
  const spans: TextMatch[] = [];
  for (const match of text.matchAll(QUOTED_SPEECH_PATTERN)) {
    const span = match[1] ?? match[2];
    if (span === undefined || match.index === undefined) continue;
    spans.push({
      end: match.index + match[0].length,
      start: match.index,
      value: span,
    });
  }
  return spans;
}

function findPatternMatches(text: string, patterns: readonly RegExp[]): readonly TextMatch[] {
  return patterns.flatMap((pattern) => {
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    return [...text.matchAll(globalPattern)].flatMap((match) =>
      match.index === undefined
        ? []
        : [
            {
              end: match.index + match[0].length,
              start: match.index,
              value: match[0],
            },
          ],
    );
  });
}

function areLocallyRelated(text: string, matches: readonly TextMatch[]): boolean {
  const start = Math.min(...matches.map((match) => match.start));
  const end = Math.max(...matches.map((match) => match.end));
  return end - start <= CAUSAL_RELATION_MAX_CHARS && !hasParagraphBreak(text, start, end);
}

function hasParagraphBreak(text: string, start: number, end: number): boolean {
  return /\n\s*\n/u.test(text.slice(start, end));
}

function localFollowingText(text: string, start: number, maxLength: number): string {
  const bounded = text.slice(start, start + maxLength);
  const paragraphBreak = bounded.search(/\n\s*\n/u);
  return paragraphBreak === -1 ? bounded : bounded.slice(0, paragraphBreak);
}

function overlapsAny(match: TextMatch, ranges: readonly TextMatch[]): boolean {
  return ranges.some((range) => rangesOverlap(match, range));
}

function rangesOverlap(left: TextMatch, right: TextMatch): boolean {
  return left.start < right.end && right.start < left.end;
}

function normalizeActionType(actionSignature: string): string {
  const normalized = actionSignature.trim().toLocaleLowerCase("en-US");
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const type = (parsed as Readonly<Record<string, unknown>>).type;
      if (typeof type === "string" && type.trim() !== "") {
        return type.trim().toLocaleLowerCase("en-US");
      }
    }
  } catch {
    // Synthetic and legacy fixtures may use a compact type:target signature.
  }
  return /^([a-z][a-z0-9_-]*)(?=[:|/])/u.exec(normalized)?.[1] ?? normalized;
}

function countPatternMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((total, pattern) => total + [...text.matchAll(pattern)].length, 0);
}

function words(text: string): readonly string[] {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/\p{L}+(?:['’\-]\p{L}+)*|\p{N}+/gu) ?? []
  );
}

function sentences(text: string): readonly string[] {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? [];
}

function normalizePhrase(value: string): string {
  return words(value).join(" ");
}

function frequencies(values: readonly string[]): readonly FrequencyEntry[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ count, value }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function longestFalseStreak(values: readonly boolean[]): number {
  let longest = 0;
  let current = 0;
  for (const value of values) {
    current = value ? 0 : current + 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function longestSameValueStreak(values: readonly string[]): number {
  let longest = 0;
  let current = 0;
  let previous: string | undefined;
  for (const value of values) {
    current = value === previous ? current + 1 : 1;
    previous = value;
    longest = Math.max(longest, current);
  }
  return longest;
}

function countLoopReturns(values: readonly string[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (seen.has(value) && index > 0 && values[index - 1] !== value) count += 1;
    seen.add(value);
  }
  return count;
}

function atLeast(
  id: StoryQualityGateId,
  actual: number,
  threshold: number,
): StoryQualityGateResult {
  return { actual, comparator: ">=", id, passed: actual >= threshold, threshold };
}

function atMost(id: StoryQualityGateId, actual: number, threshold: number): StoryQualityGateResult {
  return { actual, comparator: "<=", id, passed: actual <= threshold, threshold };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: readonly number[]): number {
  return round(sum(values) / values.length);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort((left, right) => left.localeCompare(right))
    .filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

function parseObject(value: string, label: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return asObject(parsed, label);
}

function asObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireObject(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  return asObject(value[key], key);
}

function requireArray(value: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const entry = value[key];
  if (!Array.isArray(entry)) throw new Error(`${key} must be an array`);
  return entry;
}

function requireStringArray(
  value: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const entries = requireArray(value, key);
  if (!entries.every((entry): entry is string => typeof entry === "string")) {
    throw new Error(`${key} must contain only strings`);
  }
  return entries;
}

function requireString(value: Readonly<Record<string, unknown>>, key: string): string {
  const entry = value[key];
  if (typeof entry !== "string" || entry.trim() === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return entry;
}

function optionalString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  if (typeof entry !== "string") throw new Error(`${key} must be a string`);
  return entry;
}

function requireNumber(value: Readonly<Record<string, unknown>>, key: string): number {
  const entry = value[key];
  if (typeof entry !== "number" || !Number.isFinite(entry)) {
    throw new Error(`${key} must be a finite number`);
  }
  return entry;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
