import { describe, expect, it } from "vitest";

import { normalizeStoryPayload } from "./story-types";

function storyPayload(continuationPlan: unknown): Record<string, unknown> {
  return {
    continuationPlan,
    pov: { id: "rowan-ashborn", name: "Rowan Ashborn" },
    world: { chapter: 1, id: "ashen-crown" },
  };
}

describe("story continuation plan", () => {
  it("normalizes chapter-only generation bounds", () => {
    const story = normalizeStoryPayload(storyPayload({ chapterCount: 46, endChapter: 47 }));

    expect(story?.continuationPlan).toEqual({ chapterCount: 46, endChapter: 47 });
  });

  it("keeps the chapter-100 demo horizon", () => {
    expect(() =>
      normalizeStoryPayload(storyPayload({ chapterCount: 100, endChapter: 101 })),
    ).toThrow("Story response has an invalid continuation plan.");
  });
});
