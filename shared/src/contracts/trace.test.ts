import { describe, expect, it } from "vitest";

import { ModelCallTraceSchema, RuntimeAttemptTraceSchema } from "./trace";

const USAGE = {
  cacheWriteTokens: 0,
  cachedInputTokens: 0,
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
};

describe("unbounded trace costs", () => {
  it("accepts call and attempt costs above the former three-dollar ceiling", () => {
    const common = {
      agentId: null,
      latencyMs: 1,
      model: "gpt-5.6-sol",
      phase: "narration",
      requestedServiceTier: "standard",
      responseId: "resp_cost",
      serviceTier: "standard",
      usage: USAGE,
    } as const;

    expect(
      ModelCallTraceSchema.parse({
        ...common,
        errorCode: null,
        estimatedCostUsd: 4,
        reasoningEffort: "high",
        refusal: false,
        retries: 0,
        timedOut: false,
      }).estimatedCostUsd,
    ).toBe(4);
    expect(
      RuntimeAttemptTraceSchema.parse({
        ...common,
        attempt: 0,
        costUsd: 4,
        errorCode: null,
      }).costUsd,
    ).toBe(4);
  });
});
