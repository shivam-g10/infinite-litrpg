import type { ResponseUsage } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";

import { OpenAIRuntimeError } from "./errors";
import { parseRuntimeModel, RUNTIME_MODELS } from "./models";
import { ChapterCostBudget } from "./policy";
import {
  estimateMaximumCountedRequestCostUsd,
  estimateMaximumRequestCostUsd,
  estimateResponseCostUsd,
  FLEX_PRICING_VERSION,
  INPUT_TOKEN_COUNT_SAFETY_MARGIN,
  mapResponseUsage,
  MODEL_PRICES,
  PRICING_VERSION,
  pricingVersionForServiceTier,
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
    expect(PRICING_VERSION).toBe("openai-standard-explicit-no-cache-2026-07-20");
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

  it("prices Flex at half Standard and binds a distinct pricing version", () => {
    expect(FLEX_PRICING_VERSION).toBe("openai-flex-explicit-no-cache-2026-07-20");
    expect(pricingVersionForServiceTier("standard")).toBe(PRICING_VERSION);
    expect(pricingVersionForServiceTier("flex")).toBe(FLEX_PRICING_VERSION);
    const usage = mapResponseUsage(openAIUsage());
    for (const model of RUNTIME_MODELS) {
      const standard = estimateResponseCostUsd(model, usage);
      const flex = estimateResponseCostUsd(model, usage, { serviceTier: "flex" });
      expect(flex).toBeCloseTo(standard / 2, 12);
    }
    expect(
      estimateMaximumCountedRequestCostUsd("gpt-5.6-luna", 2_947, 450, {
        inputBilling: "uncached",
        serviceTier: "flex",
      }),
    ).toBeCloseTo(0.0030795, 10);
  });

  it("applies long-context input and output multipliers", () => {
    const usage = mapResponseUsage({
      input_tokens: 272_001,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 100,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 272_101,
    });
    const standard = estimateResponseCostUsd("gpt-5.6-luna", usage);
    expect(standard).toBeCloseTo(0.544902, 10);
    expect(estimateResponseCostUsd("gpt-5.6-luna", usage, { serviceTier: "flex" })).toBeCloseTo(
      standard / 2,
      12,
    );
  });

  it("bills cache writes at 1.25 times uncached input", () => {
    const cacheWriteUsage = {
      cacheWriteTokens: 100,
      cachedInputTokens: 0,
      inputTokens: 100,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 100,
    };
    const standard = estimateResponseCostUsd("gpt-5.6-luna", cacheWriteUsage);
    expect(standard).toBeCloseTo(0.000125, 10);
    expect(
      estimateResponseCostUsd("gpt-5.6-luna", cacheWriteUsage, { serviceTier: "flex" }),
    ).toBeCloseTo(standard / 2, 12);
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

  it("reserves ordinary input when explicit mode disables cache writes", () => {
    expect(
      estimateMaximumCountedRequestCostUsd("gpt-5.6-luna", 2_947, 450, {
        inputBilling: "uncached",
      }),
    ).toBeCloseTo(0.006159, 10);
    expect(
      estimateMaximumRequestCostUsd("gpt-5.6-luna", 2_947, 450, {
        inputBilling: "uncached",
      }),
    ).toBeCloseTo(0.006159, 10);
    const standardByteBound = estimateMaximumRequestCostUsd("gpt-5.6-luna", 2_947, 450, {
      inputBilling: "uncached",
    });
    expect(
      estimateMaximumRequestCostUsd("gpt-5.6-luna", 2_947, 450, {
        inputBilling: "uncached",
        serviceTier: "flex",
      }),
    ).toBeCloseTo(standardByteBound / 2, 12);
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

  it("tracks unlimited chapter spend without raising a cost-cap error", () => {
    const budget = new ChapterCostBudget(null);

    budget.assertRequestAllowed(10_000);
    budget.reserve(10_000);
    budget.settleReservation(10_000, 4_000);
    budget.charge(7_000);

    expect(budget.capUsd).toBeNull();
    expect(budget.remainingUsd).toBe(Number.POSITIVE_INFINITY);
    expect(budget.spentUsd).toBe(11_000);
    budget.assertRequestAllowed(1_000_000);
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
