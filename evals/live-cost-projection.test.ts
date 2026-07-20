import { describe, expect, it } from "vitest";

import {
  PROMPT_1_4_11_PROJECTION_PROOF,
  assertPrompt1411FullMatrixFits,
  projectPrompt1411FullMatrixCostUsd,
} from "./live-cost-projection";

describe("prompt 1.4.11 full-matrix projection", () => {
  it("reproduces exact Standard and Flex evidence", () => {
    expect(PROMPT_1_4_11_PROJECTION_PROOF).toMatchObject({
      backgroundCallCount: 28,
      baselineStandardCostUsd: 0.223732,
      frameCount: 12,
      savedInputTokens: 6_608,
      savedOutputTokens: 1_356,
    });
    expect(projectPrompt1411FullMatrixCostUsd("standard")).toBe(0.208988);
    expect(projectPrompt1411FullMatrixCostUsd("flex")).toBe(0.104494);
  });

  it("blocks Standard and proves Flex against reconciled exposure", () => {
    expect(() => assertPrompt1411FullMatrixFits(2.811082175, "standard", 3)).toThrow(
      "$0.020070175",
    );
    expect(assertPrompt1411FullMatrixFits(2.811082175, "flex", 3)).toEqual({
      headroomAfterProjectionUsd: 0.084423825,
      projectedFinalExposureUsd: 2.915576175,
      projectedMatrixCostUsd: 0.104494,
    });
  });
});
