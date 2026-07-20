import { UsageSchema } from "@infinite-litrpg/shared";
import type { BetaResponseUsage } from "openai/resources/beta/responses/responses";
import type { ResponseUsage } from "openai/resources/responses/responses";
import { z } from "zod";

import { OpenAIRuntimeError } from "./errors";
import type { RuntimeModel } from "./models";

export const PRICING_VERSION = "openai-standard-explicit-no-cache-2026-07-20" as const;
export const INPUT_TOKEN_COUNT_SAFETY_MARGIN = 512 as const;

export interface MaximumRequestCostOptions {
  readonly inputBilling?: "cache-write" | "uncached";
}

export type RuntimeUsage = z.infer<typeof UsageSchema>;

export interface ModelPrice {
  readonly cacheWriteInputMultiplier: number;
  readonly cachedInputUsdPerMillion: number;
  readonly inputUsdPerMillion: number;
  readonly longContextInputMultiplier: number;
  readonly longContextOutputMultiplier: number;
  readonly longContextThresholdTokens: number;
  readonly outputUsdPerMillion: number;
}

export const MODEL_PRICES: Readonly<Record<RuntimeModel, ModelPrice>> = Object.freeze({
  "gpt-5.6-luna": Object.freeze({
    cacheWriteInputMultiplier: 1.25,
    cachedInputUsdPerMillion: 0.1,
    inputUsdPerMillion: 1,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
    longContextThresholdTokens: 272_000,
    outputUsdPerMillion: 6,
  }),
  "gpt-5.6-sol": Object.freeze({
    cacheWriteInputMultiplier: 1.25,
    cachedInputUsdPerMillion: 0.5,
    inputUsdPerMillion: 5,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
    longContextThresholdTokens: 272_000,
    outputUsdPerMillion: 30,
  }),
  "gpt-5.6-terra": Object.freeze({
    cacheWriteInputMultiplier: 1.25,
    cachedInputUsdPerMillion: 0.25,
    inputUsdPerMillion: 2.5,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
    longContextThresholdTokens: 272_000,
    outputUsdPerMillion: 15,
  }),
});

export const ZERO_USAGE: RuntimeUsage = Object.freeze({
  cacheWriteTokens: 0,
  cachedInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

export function mapResponseUsage(
  usage: ResponseUsage | BetaResponseUsage | null | undefined,
): RuntimeUsage {
  if (usage === null || usage === undefined) {
    throw new OpenAIRuntimeError("MISSING_USAGE", "OpenAI response omitted token usage");
  }

  const parsed = UsageSchema.safeParse({
    cacheWriteTokens: usage.input_tokens_details.cache_write_tokens,
    cachedInputTokens: usage.input_tokens_details.cached_tokens,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
    totalTokens: usage.total_tokens,
  });
  if (!parsed.success) {
    throw new OpenAIRuntimeError("INVALID_USAGE", "OpenAI response returned invalid token usage", {
      cause: parsed.error,
    });
  }
  if (
    parsed.data.cachedInputTokens > parsed.data.inputTokens ||
    parsed.data.cacheWriteTokens > parsed.data.inputTokens ||
    parsed.data.cachedInputTokens + parsed.data.cacheWriteTokens > parsed.data.inputTokens
  ) {
    throw new OpenAIRuntimeError(
      "INVALID_USAGE",
      "Cached or cache-write tokens exceed total input tokens",
    );
  }
  return parsed.data;
}

export function addUsage(left: RuntimeUsage, right: RuntimeUsage): RuntimeUsage {
  return {
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

export function estimateResponseCostUsd(model: RuntimeModel, usage: RuntimeUsage): number {
  const price = MODEL_PRICES[model];
  const ordinaryInputTokens = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
  if (ordinaryInputTokens < 0) {
    throw new OpenAIRuntimeError(
      "INVALID_USAGE",
      "Cached and cache-write input tokens exceed total input tokens",
    );
  }

  const longContext = usage.inputTokens > price.longContextThresholdTokens;
  const inputMultiplier = longContext ? price.longContextInputMultiplier : 1;
  const outputMultiplier = longContext ? price.longContextOutputMultiplier : 1;

  return (
    ((ordinaryInputTokens * price.inputUsdPerMillion +
      usage.cacheWriteTokens * price.inputUsdPerMillion * price.cacheWriteInputMultiplier +
      usage.cachedInputTokens * price.cachedInputUsdPerMillion) *
      inputMultiplier +
      usage.outputTokens * price.outputUsdPerMillion * outputMultiplier) /
    1_000_000
  );
}

export function estimateMaximumRequestCostUsd(
  model: RuntimeModel,
  promptUtf8Bytes: number,
  maxOutputTokens: number,
  options: MaximumRequestCostOptions = {},
): number {
  validateMaximumCostInputs(promptUtf8Bytes, maxOutputTokens);
  return estimateMaximumCostFromInputUpperBound(
    model,
    promptUtf8Bytes + INPUT_TOKEN_COUNT_SAFETY_MARGIN,
    maxOutputTokens,
    options,
  );
}

export function estimateMaximumCountedRequestCostUsd(
  model: RuntimeModel,
  countedInputTokens: number,
  maxOutputTokens: number,
  options: MaximumRequestCostOptions = {},
): number {
  validateMaximumCostInputs(countedInputTokens, maxOutputTokens);
  return estimateMaximumCostFromInputUpperBound(
    model,
    countedInputTokens + INPUT_TOKEN_COUNT_SAFETY_MARGIN,
    maxOutputTokens,
    options,
  );
}

function estimateMaximumCostFromInputUpperBound(
  model: RuntimeModel,
  inputTokenUpperBound: number,
  maxOutputTokens: number,
  options: MaximumRequestCostOptions,
): number {
  const price = MODEL_PRICES[model];
  const longContext = inputTokenUpperBound > price.longContextThresholdTokens;
  const inputMultiplier = longContext ? price.longContextInputMultiplier : 1;
  const outputMultiplier = longContext ? price.longContextOutputMultiplier : 1;
  const inputBillingMultiplier =
    options.inputBilling === "uncached" ? 1 : price.cacheWriteInputMultiplier;
  return (
    (inputTokenUpperBound * price.inputUsdPerMillion * inputBillingMultiplier * inputMultiplier +
      maxOutputTokens * price.outputUsdPerMillion * outputMultiplier) /
    1_000_000
  );
}

function validateMaximumCostInputs(inputSize: number, maxOutputTokens: number): void {
  if (
    !Number.isSafeInteger(inputSize) ||
    inputSize < 0 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1
  ) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "Request cost bound inputs are invalid");
  }
}
