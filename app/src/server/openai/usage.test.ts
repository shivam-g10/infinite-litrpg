import type { ResponseUsage } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";

import { OpenAIRuntimeError } from "./errors";
import { parseRuntimeModel, RUNTIME_MODELS } from "./models";
import { ChapterCostBudget } from "./policy";
import {
  estimateMaximumCountedRequestCostUsd,
  estimateResponseCostUsd,
  INPUT_TOKEN_COUNT_SAFETY_MARGIN,
  mapResponseUsage,
  MODEL_PRICES,
  PRICING_VERSION,
} from "./usage";

describe("OpenAI runtime models and accounting", () => {
  it("allows only exact Sol, Terra, and Luna slugs", () => {
    expect(RUNTIME_MODELS.map(parseRuntimeModel)).toEqual(RUNTIME_MODELS);
    for (const model of ["gpt-5.6", "gpt-5.6-mini", "gpt-4o", "gpt-5.6-sol-latest"]) {
      expectRuntimeError(() => parseRuntimeModel(model), "INVALID_MODEL");
    }
  });

  it("maps every OpenAI 6.48 usage detail", () => {
    expect(mapResponseUsage(openAIUsage())).toEqual({
      cacheWriteTokens: 50,
      cachedInputTokens: 400,
      inputTokens: 1_000,
      outputTokens: 200,
      reasoningTokens: 25,
      totalTokens: 1_200,
    });
    expectRuntimeError(() => mapResponseUsage(undefined), "MISSING_USAGE");
  });

  it("uses versioned model prices and discounts cached input", () => {
    expect(PRICING_VERSION).toBe("openai-standard-2026-07-19");
    expect(Object.keys(MODEL_PRICES).sort()).toEqual([...RUNTIME_MODELS].sort());
    expect(estimateResponseCostUsd("gpt-5.6-luna", mapResponseUsage(openAIUsage()))).toBeCloseTo(
      0.0018525,
      10,
    );
    expect(estimateResponseCostUsd("gpt-5.6-terra", mapResponseUsage(openAIUsage()))).toBeCloseTo(
      0.00463125,
      10,
    );
    expect(estimateResponseCostUsd("gpt-5.6-sol", mapResponseUsage(openAIUsage()))).toBeCloseTo(
      0.0092625,
      10,
    );
  });

  it("applies long-context input and output multipliers", () => {
    const usage = mapResponseUsage({
      input_tokens: 272_001,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 100,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 272_101,
    });
    expect(estimateResponseCostUsd("gpt-5.6-luna", usage)).toBeCloseTo(0.544902, 10);
  });

  it("bills cache writes at 1.25 times uncached input", () => {
    expect(
      estimateResponseCostUsd("gpt-5.6-luna", {
        cacheWriteTokens: 100,
        cachedInputTokens: 0,
        inputTokens: 100,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 100,
      }),
    ).toBeCloseTo(0.000125, 10);
  });

  it("reserves counted input with a 512-token margin and maximum output", () => {
    expect(INPUT_TOKEN_COUNT_SAFETY_MARGIN).toBe(512);
    expect(estimateMaximumCountedRequestCostUsd("gpt-5.6-luna", 2_947, 450)).toBeCloseTo(
      0.00702375,
      10,
    );
    expect(estimateMaximumCountedRequestCostUsd("gpt-5.6-terra", 1_308, 1_400)).toBeCloseTo(
      0.0266875,
      10,
    );
  });

  it("locks the failed Rowan audit boundary at the remaining release budget", () => {
    const fits = new ChapterCostBudget(0.0424);
    fits.charge(0.031564875);
    fits.assertRequestAllowed(estimateMaximumCountedRequestCostUsd("gpt-5.6-luna", 5_996, 450));

    const blocks = new ChapterCostBudget(0.0424);
    blocks.charge(0.031564875);
    expectRuntimeError(
      () =>
        blocks.assertRequestAllowed(
          estimateMaximumCountedRequestCostUsd("gpt-5.6-luna", 5_997, 450),
        ),
      "COST_CAP_EXCEEDED",
    );
  });

  it("records actual spend and stops a chapter above its cap", () => {
    const budget = new ChapterCostBudget(0.01);
    budget.charge(0.006);
    expect(budget.remainingUsd).toBeCloseTo(0.004);
    expectRuntimeError(() => budget.charge(0.005), "COST_CAP_EXCEEDED");
    expect(budget.spentUsd).toBeCloseTo(0.011);
    expectRuntimeError(() => budget.assertRequestAllowed(0.001), "COST_CAP_EXCEEDED");
  });

  it("rejects impossible usage", () => {
    const usage = openAIUsage();
    usage.input_tokens_details.cached_tokens = usage.input_tokens + 1;
    expectRuntimeError(() => mapResponseUsage(usage), "INVALID_USAGE");

    const overlapping = openAIUsage();
    overlapping.input_tokens_details.cached_tokens = 600;
    overlapping.input_tokens_details.cache_write_tokens = 500;
    expectRuntimeError(() => mapResponseUsage(overlapping), "INVALID_USAGE");
  });
});

function openAIUsage(): ResponseUsage {
  return {
    input_tokens: 1_000,
    input_tokens_details: { cache_write_tokens: 50, cached_tokens: 400 },
    output_tokens: 200,
    output_tokens_details: { reasoning_tokens: 25 },
    total_tokens: 1_200,
  };
}

function expectRuntimeError(operation: () => unknown, code: OpenAIRuntimeError["code"]): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(OpenAIRuntimeError);
    expect((error as OpenAIRuntimeError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}
