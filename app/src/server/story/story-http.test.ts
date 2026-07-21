import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StoryGenesisError } from "./genesis-service";
import { describeStoryError } from "./story-http";

describe("story HTTP errors", () => {
  it.each([
    ["GENESIS_FAILED", 502, "World generation failed after three attempts"],
    ["GENESIS_GUIDANCE_UNSATISFIED", 422, "could not satisfy all concrete guidance"],
  ] as const)("returns an actionable %s stream error", (code, status, message) => {
    expect(
      describeStoryError(new StoryGenesisError(code, "candidate map was disconnected")),
    ).toEqual({
      body: {
        code,
        error: expect.stringMatching(new RegExp(`${message}.*candidate map was disconnected`, "u")),
      },
      status,
    });
  });
});
