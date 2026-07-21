import type { ValidationIssue } from "./validation";

export interface NarrativeHistoryEntry {
  readonly prose: string;
  readonly title: string;
}

export interface NarrativeQualityInput {
  readonly dialogueRequired: boolean;
  readonly history: readonly NarrativeHistoryEntry[];
  readonly openingOriginRequired?: boolean;
  readonly prose: string;
  readonly systemName?: string;
  readonly systemNoticeRequired: boolean;
  readonly title: string;
}

export interface TenChapterQualityPlan {
  readonly arcNumber: number;
  readonly beats: {
    readonly characterTurn: boolean;
    readonly consequentialDialogue: boolean;
    readonly systemConsequence: boolean;
    readonly systemTradeoff: boolean;
  };
  readonly character: string;
  readonly dialogue: string;
  readonly novelty: string;
  readonly position: number;
  readonly sceneShape: string;
  readonly system: string;
  readonly targets: {
    readonly characterTurns: 4;
    readonly consequentialDialogueChapters: 6;
    readonly distinctFourWordOpenings: 7;
    readonly systemConsequenceChapters: 4;
    readonly systemTradeoffChapters: 2;
    readonly uniqueTitles: 8;
  };
}

const DIALOGUE_HISTORY_WINDOW = 20;
const OPENING_WORD_WINDOW = 3;
const OPENING_TEMPLATE_WORDS = 8;
const MIN_DIALOGUE_WORDS = 20;
const MIN_DIALOGUE_RATIO = 0.025;
const MIN_DIALOGUE_TURNS = 2;
const DIALOGUE_BEAT_POSITIONS = new Set([1, 2, 4, 6, 8, 10]);
const SYSTEM_CONSEQUENCE_POSITIONS = new Set([1, 3, 6, 9]);
const SYSTEM_TRADEOFF_POSITIONS = new Set([3, 6, 9]);
const CHARACTER_TURN_POSITIONS = new Set([1, 4, 7, 10]);
const SCENE_SHAPES = [
  "forced commitment",
  "discovery under interpersonal obstruction",
  "System constraint test",
  "relationship confrontation",
  "tactical complication",
  "tradeoff under time pressure",
  "costly reversal",
  "converging pursuit",
  "sacrifice before payoff",
  "earned payoff opening a stronger problem",
] as const;
const CHARACTER_BEAT_PATTERN =
  /\b(?:accept(?:ed|s)?|admit(?:ted|s)?|chose|confess(?:ed|es)?|decid(?:e|ed|es)|doubt(?:ed|s)?|fear(?:ed|s)?|flinch(?:ed|es)?|forgav(?:e|en)|hesitat(?:e|ed|es)|refus(?:e|ed|es)|regret(?:ted|s)?|relent(?:ed|s)?|trust(?:ed|s)?|want(?:ed|s)?|would not|could not)\b/iu;
const SYSTEM_NOTICE_PATTERN =
  /(?:\[(?=[^\]\n]{2,160}\])(?=[^\]\n]*\b(?:System|XP|Experience|Level|Skill|Stat|Quest|Class|Title|Status|Health|Mana)\b)[^\]\n]+\]|\b(?:the\s+)?System\s+(?:alert|announc(?:ed|es)|award(?:ed|s)|chimed|confirm(?:ed|s)|declar(?:ed|es)|display(?:ed|s)|flash(?:ed|es)|grant(?:ed|s)|mark(?:ed|s)|message|notice|notif(?:ied|ies)|panel|record(?:ed|s)|register(?:ed|s)|report(?:ed|s)|reveal(?:ed|s)|update(?:d|s)|window)\b)/iu;
const PRIOR_LIFE_PATTERN =
  /\b(?:died|death|execution|former life|last breath|old life|past life|previous life|prior life|reincarnat(?:ed|ion)|reborn|sacrifice|second life)\b/iu;
const AWAKENING_PATTERN =
  /\b(?:awaken(?:ed|ing)?|born again|new body|newborn|opened (?:his|her|their) eyes|reincarnat(?:ed|ion)|reborn|second life|woke)\b/iu;
const OPENING_WORLD_PATTERN =
  /\b(?:air|ash|blood|cold|danger|door|earth|fire|floor|forest|heat|light|rain|road|room|sky|smoke|stone|street|village|wall|wind|world)\b/iu;
const INTERNAL_PLANNING_PATTERN =
  /\b(?:arc position|character autonomy|due by chapter|evaluation score|internal milestone|planning phase|quality rubric|required by chapter|scheduled beat|serial arc|ten[- ]chapter quality)\b|\bchapter\s+\d+\s+(?:deadline|target)\b/iu;
const TITLE_ACTION_VERBS = new Set([
  "awaken",
  "bind",
  "break",
  "burn",
  "challenge",
  "choose",
  "claim",
  "confront",
  "cross",
  "defend",
  "discover",
  "enter",
  "escape",
  "face",
  "find",
  "follow",
  "hunt",
  "name",
  "open",
  "raise",
  "read",
  "return",
  "seek",
  "shatter",
  "survive",
  "trace",
]);

export function buildTenChapterQualityPlan(
  chapter: number,
  dialoguePossible: boolean,
): TenChapterQualityPlan {
  if (!Number.isSafeInteger(chapter) || chapter < 1) {
    throw new RangeError("Chapter must be a positive safe integer");
  }
  const position = ((chapter - 1) % 10) + 1;
  const consequentialDialogue = DIALOGUE_BEAT_POSITIONS.has(position);
  const characterTurn = CHARACTER_TURN_POSITIONS.has(position);
  const systemConsequence = SYSTEM_CONSEQUENCE_POSITIONS.has(position);
  const systemTradeoff = SYSTEM_TRADEOFF_POSITIONS.has(position);
  return {
    arcNumber: Math.ceil(chapter / 10),
    beats: {
      characterTurn,
      consequentialDialogue,
      systemConsequence,
      systemTradeoff,
    },
    character: characterTurn
      ? "Use supplied beliefs, goals, plan, relationships, current effects, and prior behavior for a visible turn. Never invent durable character canon."
      : "Keep behavior consistent with supplied character anchors and prior choices.",
    dialogue:
      consequentialDialogue && dialoguePossible
        ? "Use a substantial present-character exchange that changes the current plan, relationship pressure, or conflict."
        : consequentialDialogue
          ? "Dialogue is due. Do not invent a remote speaker. Have the viewpoint speak a consequential choice aloud to the canonical System; it may answer only with supplied quest or mechanic language, never personality or a new fact. Route the next choice toward a reachable character."
          : dialoguePossible
            ? "Dialogue is optional this chapter; vary the scene shape and never allow three quiet chapters in sequence."
            : "Do not invent a remote speaker or impossible conversation.",
    novelty:
      "Use a new scene construction and a distinct first four words. Never reuse a prior title template or opening phrase.",
    position,
    sceneShape: SCENE_SHAPES[position - 1]!,
    system: systemTradeoff
      ? "Make supplied System information force a decision with a cost, risk, sacrifice, or foregone option."
      : systemConsequence
        ? "Make supplied System information change pressure, capability, risk, or the next objective."
        : "Keep mechanics scene-relevant; never add a decorative notice solely to mention the System.",
    targets: {
      characterTurns: 4,
      consequentialDialogueChapters: 6,
      distinctFourWordOpenings: 7,
      systemConsequenceChapters: 4,
      systemTradeoffChapters: 2,
      uniqueTitles: 8,
    },
  };
}

export function validateNarrativeQuality(input: NarrativeQualityInput): ValidationIssue[] {
  const issues = validateTitleNovelty(input.title, input.history);
  const prose = input.prose.trim();
  const hasSystemNotice =
    SYSTEM_NOTICE_PATTERN.test(prose) || namedSystemMentionPattern(input.systemName).test(prose);
  const words = wordsIn(prose);
  const dialogueWords = countDialogueWords(prose);
  const dialogueTurns = dialogueSpans(prose).filter((span) => wordsIn(span).length >= 2).length;
  const recentHistory = input.history.slice(-DIALOGUE_HISTORY_WINDOW);
  const recentDialogueFree = recentHistory
    .slice(-2)
    .every(
      ({ prose: priorProse }) =>
        countDialogueWords(priorProse) < MIN_DIALOGUE_WORDS ||
        dialogueSpans(priorProse).filter((span) => wordsIn(span).length >= 2).length <
          MIN_DIALOGUE_TURNS,
    );

  if (
    (input.dialogueRequired || (recentHistory.length >= 2 && recentDialogueFree)) &&
    (dialogueTurns < MIN_DIALOGUE_TURNS ||
      dialogueWords < MIN_DIALOGUE_WORDS ||
      dialogueWords / Math.max(1, words.length) < MIN_DIALOGUE_RATIO)
  ) {
    issues.push(
      issue(
        "DIALOGUE_MISSING",
        "Chapter needs a consequential spoken exchange, not incidental quoted words",
        "prose",
      ),
    );
  }

  if (input.openingOriginRequired && !OPENING_WORLD_PATTERN.test(prose)) {
    issues.push(
      issue(
        "OPENING_WORLD_MISSING",
        "Chapter one must introduce the immediate new world through concrete in-scene detail",
        "prose",
      ),
    );
  }

  if (input.systemNoticeRequired && !hasSystemNotice) {
    issues.push(
      issue(
        "SYSTEM_NOTICE_MISSING",
        "Chapter must show the accepted LitRPG progression through an explicit System notice",
        "prose",
      ),
    );
  }

  if (
    input.openingOriginRequired &&
    (!PRIOR_LIFE_PATTERN.test(prose) || !AWAKENING_PATTERN.test(prose) || !hasSystemNotice)
  ) {
    issues.push(
      issue(
        "OPENING_ORIGIN_MISSING",
        "Chapter one must dramatize the prior life, awakening in the new body, and first System pressure",
        "prose",
      ),
    );
  }

  const planningLeakPath = INTERNAL_PLANNING_PATTERN.test(input.title)
    ? "title"
    : INTERNAL_PLANNING_PATTERN.test(prose)
      ? "prose"
      : null;
  if (planningLeakPath !== null) {
    issues.push(
      issue(
        "INTERNAL_PLANNING_LEAK",
        "Chapter exposes internal planning, deadlines, or evaluation language",
        planningLeakPath,
      ),
    );
  }

  if (!CHARACTER_BEAT_PATTERN.test(prose)) {
    issues.push(
      issue(
        "CHARACTER_BEAT_MISSING",
        "Chapter must dramatize a choice or vulnerable reaction anchored to canonical character state",
        "prose",
      ),
    );
  }

  const openingWord = words[0]?.toLocaleLowerCase("en-US") ?? "";
  const recentOpeningWords = recentHistory
    .slice(-OPENING_WORD_WINDOW)
    .map(({ prose: priorProse }) => wordsIn(priorProse)[0]?.toLocaleLowerCase("en-US") ?? "")
    .filter(Boolean);
  const openingPhrase = openingWords(prose, 5);
  const priorOpeningPhrases = new Set(
    input.history.map(({ prose: priorProse }) => openingWords(priorProse, 5)),
  );
  const nearOpeningTemplate = input.history.some(({ prose: priorProse }) =>
    openingsShareTemplate(prose, priorProse),
  );
  if (
    openingPhrase.length > 0 &&
    (priorOpeningPhrases.has(openingPhrase) ||
      nearOpeningTemplate ||
      (recentOpeningWords.length === OPENING_WORD_WINDOW &&
        recentOpeningWords.every((recentWord) => recentWord === openingWord)))
  ) {
    issues.push(
      issue(
        "OPENING_REPEATED",
        "Chapter opening repeats a prior first word or opening phrase",
        "prose",
      ),
    );
  }

  return issues;
}

function namedSystemMentionPattern(systemName: string | undefined): RegExp {
  if (!systemName?.trim()) return /(?!)/u;
  const escapedName = systemName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escapedName}\\b`, "iu");
}

export function validateTitleNovelty(
  title: string,
  history: readonly NarrativeHistoryEntry[],
): ValidationIssue[] {
  const normalized = normalizeWords(title);
  if (normalized.length === 0) {
    return [issue("TITLE_REPEATED", "Chapter title has no meaningful words", "title")];
  }
  const duplicate = history.find(({ title: priorTitle }) => {
    const prior = normalizeWords(priorTitle);
    return (
      prior === normalized ||
      tokenSimilarity(prior, normalized) >= 0.6 ||
      sharesVerbObjectTemplate(prior, normalized)
    );
  });
  return duplicate
    ? [
        issue(
          "TITLE_REPEATED",
          `Chapter title is too close to prior title: ${duplicate.title}`,
          "title",
        ),
      ]
    : [];
}

export function countDialogueWords(prose: string): number {
  return dialogueSpans(prose).reduce((total, span) => total + wordsIn(span).length, 0);
}

function dialogueSpans(prose: string): string[] {
  return [...prose.matchAll(/[“"]([^“”"\n]{2,})[”"]/gu)].map((match) => match[1] ?? "");
}

function wordsIn(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

function openingWords(prose: string, count: number): string {
  return wordsIn(prose).slice(0, count).join(" ").toLocaleLowerCase("en-US");
}

function normalizeWords(value: string): string {
  return wordsIn(value).join(" ").toLocaleLowerCase("en-US");
}

function openingsShareTemplate(left: string, right: string): boolean {
  const leftWords = wordsIn(left)
    .slice(0, OPENING_TEMPLATE_WORDS)
    .map((word) => word.toLocaleLowerCase("en-US"));
  const rightWords = wordsIn(right)
    .slice(0, OPENING_TEMPLATE_WORDS)
    .map((word) => word.toLocaleLowerCase("en-US"));
  const comparableLength = Math.min(leftWords.length, rightWords.length);
  if (comparableLength < 4) return false;

  let commonPrefix = 0;
  while (commonPrefix < comparableLength && leftWords[commonPrefix] === rightWords[commonPrefix]) {
    commonPrefix += 1;
  }
  if (commonPrefix >= 3) return true;

  const positionalMatches = leftWords
    .slice(0, comparableLength)
    .filter((word, index) => word === rightWords[index]).length;
  const sharedBigrams = adjacentPairs(leftWords).filter((pair) =>
    adjacentPairs(rightWords).includes(pair),
  ).length;
  return (
    sharedBigrams >= 2 &&
    (positionalMatches / comparableLength >= 0.5 ||
      tokenSimilarity(leftWords.join(" "), rightWords.join(" ")) >= 0.6)
  );
}

function adjacentPairs(words: readonly string[]): string[] {
  return words.slice(1).map((word, index) => `${words[index]}\u0000${word}`);
}

function sharesVerbObjectTemplate(left: string, right: string): boolean {
  const leftWords = left.split(" ").filter(Boolean);
  const rightWords = right.split(" ").filter(Boolean);
  const leftVerb = leftWords[0];
  const rightVerb = rightWords[0];
  const leftObject = leftWords.at(-1);
  const rightObject = rightWords.at(-1);
  return (
    leftWords.length >= 3 &&
    rightWords.length >= 3 &&
    leftVerb !== undefined &&
    leftVerb === rightVerb &&
    TITLE_ACTION_VERBS.has(leftVerb) &&
    leftObject !== undefined &&
    leftObject === rightObject
  );
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function issue(code: ValidationIssue["code"], message: string, path: string): ValidationIssue {
  return { code, message, path };
}
