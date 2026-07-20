import type { ActNumber } from "../contracts";

export const DEMO_CHAPTER_LIMIT = 100;

export interface ClockPolicy {
  readonly choicesRequireMilestone: boolean;
  readonly convergencePressure: boolean;
  readonly currentAct: ActNumber;
  readonly currentChapter: number;
  readonly modelCallAllowed: boolean;
  readonly nextAct: ActNumber | null;
  readonly nextChapter: number | null;
  readonly postCommitAct: ActNumber;
  readonly terminal: boolean;
  readonly transitionRequired: boolean;
}

export function actForStateChapter(chapter: number): ActNumber {
  assertChapterRange(chapter);
  return Math.min(7, Math.floor(chapter / 50) + 1) as ActNumber;
}

export function actForNarrativeChapter(chapter: number): ActNumber {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 350) {
    throw new RangeError(`Narrative chapter must be between 1 and 350: ${chapter}`);
  }
  return Math.ceil(chapter / 50) as ActNumber;
}

export function getClockPolicy(currentChapter: number): ClockPolicy {
  assertChapterRange(currentChapter);

  const currentAct = actForStateChapter(currentChapter);
  if (currentChapter === 350) {
    return {
      choicesRequireMilestone: false,
      convergencePressure: true,
      currentAct,
      currentChapter,
      modelCallAllowed: false,
      nextAct: null,
      nextChapter: null,
      postCommitAct: 7,
      terminal: true,
      transitionRequired: false,
    };
  }

  const nextChapter = currentChapter + 1;
  const nextAct = actForNarrativeChapter(nextChapter);
  const localChapter = ((nextChapter - 1) % 50) + 1;
  const transitionRequired = localChapter === 50;
  const postCommitAct =
    transitionRequired && nextChapter < 350 ? ((nextAct + 1) as ActNumber) : nextAct;

  return {
    choicesRequireMilestone: localChapter >= 48,
    convergencePressure: localChapter >= 40,
    currentAct,
    currentChapter,
    modelCallAllowed: true,
    nextAct,
    nextChapter,
    postCommitAct,
    terminal: nextChapter === 350,
    transitionRequired,
  };
}

function assertChapterRange(chapter: number): void {
  if (!Number.isInteger(chapter) || chapter < 0 || chapter > 350) {
    throw new RangeError(`State chapter must be between 0 and 350: ${chapter}`);
  }
}
