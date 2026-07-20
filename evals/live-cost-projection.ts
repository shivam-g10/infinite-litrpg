import type { RuntimeServiceTier } from "@infinite-litrpg/shared";

import {
  estimateResponseCostUsd,
  serviceTierPriceMultiplier,
} from "../app/src/server/openai/usage";

const NANO_USD = 1_000_000_000;

export const PROMPT_1_4_11_PROJECTION_PROOF = Object.freeze({
  backgroundCallCount: 28,
  baselineStandardCostUsd: 0.223732,
  frameCount: 12,
  savedInputTokens: 28 * 221 + 420,
  savedOutputTokens: 28 * 48 + 12,
});

export function projectPrompt1411FullMatrixCostUsd(serviceTier: RuntimeServiceTier): number {
  const baselineCostUsd =
    PROMPT_1_4_11_PROJECTION_PROOF.baselineStandardCostUsd *
    serviceTierPriceMultiplier(serviceTier);
  const savingCostUsd = estimateResponseCostUsd(
    "gpt-5.6-luna",
    {
      cacheWriteTokens: 0,
      cachedInputTokens: 0,
      inputTokens: PROMPT_1_4_11_PROJECTION_PROOF.savedInputTokens,
      outputTokens: PROMPT_1_4_11_PROJECTION_PROOF.savedOutputTokens,
      reasoningTokens: 0,
      totalTokens:
        PROMPT_1_4_11_PROJECTION_PROOF.savedInputTokens +
        PROMPT_1_4_11_PROJECTION_PROOF.savedOutputTokens,
    },
    { serviceTier },
  );
  return roundNanoUsd(baselineCostUsd - savingCostUsd);
}

export function assertPrompt1411FullMatrixFits(
  priorExposureUsd: number,
  serviceTier: RuntimeServiceTier,
  totalCapUsd: number,
): {
  readonly headroomAfterProjectionUsd: number;
  readonly projectedFinalExposureUsd: number;
  readonly projectedMatrixCostUsd: number;
} {
  const projectedMatrixCostUsd = projectPrompt1411FullMatrixCostUsd(serviceTier);
  const projectedFinalExposureUsd = roundNanoUsd(priorExposureUsd + projectedMatrixCostUsd);
  const headroomAfterProjectionUsd = roundNanoUsd(totalCapUsd - projectedFinalExposureUsd);
  if (headroomAfterProjectionUsd < 0) {
    throw new Error(
      `Prompt 1.4.11 ${serviceTier} matrix exceeds the live cap by $${Math.abs(headroomAfterProjectionUsd).toFixed(9)}`,
    );
  }
  return { headroomAfterProjectionUsd, projectedFinalExposureUsd, projectedMatrixCostUsd };
}

function roundNanoUsd(value: number): number {
  return Math.round(value * NANO_USD) / NANO_USD;
}
