import { describe, expect, it } from "vitest";

import { sanitizeReaderProse } from "./reader-safety";

describe("sanitizeReaderProse", () => {
  it("removes internal deadlines while preserving reader-facing quest text", () => {
    expect(
      sanitizeReaderProse(
        "[Quest: Act One Survival] [Objective: Find shelter.] [Required by Chapter 50] [Status: Incomplete]",
      ),
    ).toBe("[Quest: Act One Survival] [Objective: Find shelter.] [Status: Incomplete]");
  });

  it("removes legacy inline deadline wording", () => {
    expect(sanitizeReaderProse("The seal was due by chapter 12. Rowan refused.")).toBe(
      "The seal was . Rowan refused.",
    );
  });
});
