export const STORY_CHANGE_CATEGORIES = [
  "location",
  "knowledge",
  "capability",
  "relationship",
  "status",
  "threat",
  "milestone",
  "clock",
  "experience",
] as const;

export type StoryChangeCategory = (typeof STORY_CHANGE_CATEGORIES)[number];

export interface StoryTrajectoryStep {
  readonly actionSignature: string;
  readonly changeCategories: readonly StoryChangeCategory[];
}

export interface StoryTrajectoryResult {
  readonly issues: readonly string[];
  readonly ok: boolean;
}

export function validateStoryTrajectory(
  steps: readonly StoryTrajectoryStep[],
): StoryTrajectoryResult {
  const issues: string[] = [];
  if (steps.length < 10) issues.push("Trajectory requires at least ten chapters");
  for (let index = 2; index < steps.length; index += 1) {
    if (
      steps[index]!.actionSignature === steps[index - 1]!.actionSignature &&
      steps[index]!.actionSignature === steps[index - 2]!.actionSignature
    ) {
      issues.push(`Three identical action signatures end at chapter ${index + 1}`);
    }
  }
  let passiveRun = 0;
  for (const [index, step] of steps.entries()) {
    const meaningful = step.changeCategories.some(
      (category) => category !== "clock" && category !== "experience",
    );
    passiveRun = meaningful ? 0 : passiveRun + 1;
    if (passiveRun > 2) issues.push(`Clock-or-XP-only run exceeds two chapters at ${index + 1}`);
  }
  const meaningfulCategories = new Set(
    steps.flatMap(({ changeCategories }) =>
      changeCategories.filter((category) => category !== "clock" && category !== "experience"),
    ),
  );
  if (meaningfulCategories.size < 3)
    issues.push("Trajectory changes fewer than three meaningful categories");
  return { issues, ok: issues.length === 0 };
}
