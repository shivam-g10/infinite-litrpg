import { describe, expect, it } from "vitest";

import { validateStoryTrajectory, type StoryTrajectoryStep } from "./trajectory";

const healthy: StoryTrajectoryStep[] = Array.from({ length: 10 }, (_, index) => ({
  actionSignature: ["investigate:place", "interact:actor", "move:place"][index % 3]!,
  changeCategories: [["knowledge"], ["relationship"], ["location", "threat"]][
    index % 3
  ] as StoryTrajectoryStep["changeCategories"],
}));

describe("ten-chapter trajectory gate", () => {
  it("accepts varied action and change progression", () => {
    expect(validateStoryTrajectory(healthy)).toEqual({ issues: [], ok: true });
  });

  it("rejects repeated actions, passive progression, and narrow change", () => {
    const stalled = Array.from({ length: 10 }, () => ({
      actionSignature: "wait",
      changeCategories: ["clock", "experience"] as const,
    }));
    const result = validateStoryTrajectory(stalled);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/identical|Clock-or-XP|fewer than three/u);
  });
});
