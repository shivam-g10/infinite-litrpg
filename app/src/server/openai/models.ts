import {
  RuntimeModelSchema,
  RuntimeServiceTierSchema,
  type ModelCallTrace,
  type RuntimeServiceTier,
} from "@infinite-litrpg/shared";

import { OpenAIRuntimeError } from "./errors";

export type RuntimeModel = ModelCallTrace["model"];
export type RuntimeReasoningEffort = ModelCallTrace["reasoningEffort"];

export const RUNTIME_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export const GPT_5_6_MAX_OUTPUT_TOKENS = 128_000 as const;

export function parseRuntimeModel(input: unknown): RuntimeModel {
  const parsed = RuntimeModelSchema.safeParse(input);
  if (!parsed.success) {
    throw new OpenAIRuntimeError(
      "INVALID_MODEL",
      `Runtime model must be one of: ${RUNTIME_MODELS.join(", ")}`,
    );
  }
  return parsed.data;
}

export function parseRuntimeServiceTier(input: unknown): RuntimeServiceTier {
  const parsed = RuntimeServiceTierSchema.safeParse(input);
  if (!parsed.success) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "Runtime service tier must be standard or flex");
  }
  return parsed.data;
}
