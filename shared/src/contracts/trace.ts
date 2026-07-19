import { z } from "zod";

import {
  ChapterNumberSchema,
  CONTRACT_VERSION,
  HashSchema,
  IdSchema,
  ShortTextSchema,
  WorldVersionSchema,
} from "./primitives";
import { WorldDeltaSchema } from "./delta";
import { WorldIntentSchema } from "./intent";

export const RuntimeModelSchema = z.enum(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
export const ReasoningEffortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);

export const UsageSchema = z
  .object({
    cacheWriteTokens: z.number().int().min(0),
    cachedInputTokens: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    reasoningTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  })
  .strict();

export const ModelCallTraceSchema = z
  .object({
    agentId: IdSchema.nullable(),
    errorCode: ShortTextSchema.nullable(),
    estimatedCostUsd: z.number().min(0).max(3),
    latencyMs: z.number().int().min(0),
    model: RuntimeModelSchema,
    phase: z.enum(["intent", "narration", "audit", "genesis", "recovery", "finale"]),
    reasoningEffort: ReasoningEffortSchema,
    refusal: z.boolean(),
    responseId: z.string().regex(/^resp?_[A-Za-z0-9_-]+$/u),
    retries: z.number().int().min(0).max(2),
    timedOut: z.boolean(),
    usage: UsageSchema,
  })
  .strict();

export const RuntimeAttemptTraceSchema = z
  .object({
    agentId: IdSchema.nullable(),
    attempt: z.number().int().min(0).max(2),
    costUsd: z.number().min(0).max(3),
    errorCode: ShortTextSchema.nullable(),
    latencyMs: z.number().int().min(0),
    model: RuntimeModelSchema,
    phase: z.enum(["intent", "narration", "audit", "genesis", "recovery", "finale"]),
    responseId: z
      .string()
      .regex(/^resp?_[A-Za-z0-9_-]+$/u)
      .nullable(),
    usage: UsageSchema,
  })
  .strict();

export const TraceEnvelopeSchema = z
  .object({
    acceptedDelta: WorldDeltaSchema,
    adapterMode: z.enum(["native-multi-agent", "sequential"]),
    attempts: z.array(RuntimeAttemptTraceSchema).max(1_000).default([]),
    calls: z.array(ModelCallTraceSchema).min(1).max(12),
    contractVersion: z.literal(CONTRACT_VERSION),
    fixtureId: IdSchema,
    fixtureVersion: ShortTextSchema,
    gateResult: z.enum(["passed", "failed"]),
    gitSha: z.string().regex(/^[a-f0-9]{7,40}$/u),
    intents: z.array(WorldIntentSchema).max(4),
    multiAgentOutputItems: z.array(z.record(z.string(), z.unknown())).max(100),
    promptVersion: ShortTextSchema,
    pricingVersion: ShortTextSchema,
    runId: z.string().uuid(),
    schemaVersion: ShortTextSchema,
    seed: z.number().int().nonnegative(),
    stateAfterHash: HashSchema,
    stateBeforeHash: HashSchema,
    totalEstimatedCostUsd: z.number().min(0).max(3),
    totalLatencyMs: z.number().int().min(0),
    totalUsage: UsageSchema,
    validationFailures: z.array(ShortTextSchema).max(50),
  })
  .strict();

export const FailedTurnTraceSchema = z
  .object({
    attempts: z.array(RuntimeAttemptTraceSchema).min(1).max(50),
    attemptedChapter: ChapterNumberSchema.refine((chapter) => chapter >= 1),
    commandType: z.enum(["take_action", "custom_action"]),
    contractVersion: z.literal(CONTRACT_VERSION),
    errorCode: ShortTextSchema,
    fixtureId: IdSchema,
    fixtureVersion: ShortTextSchema,
    gateResult: z.literal("failed"),
    gitSha: z.string().regex(/^[a-f0-9]{7,40}$/u),
    pricingVersion: ShortTextSchema,
    promptVersion: ShortTextSchema,
    requestId: z.string().uuid(),
    runId: z.string().uuid(),
    schemaVersion: ShortTextSchema,
    stateBeforeHash: HashSchema,
    totalEstimatedCostUsd: z.number().min(0).max(3),
    totalLatencyMs: z.number().int().min(0),
    totalUsage: UsageSchema,
    worldVersion: WorldVersionSchema,
  })
  .strict();

export type ModelCallTrace = z.infer<typeof ModelCallTraceSchema>;
export type FailedTurnTrace = z.infer<typeof FailedTurnTraceSchema>;
export type TraceEnvelope = z.infer<typeof TraceEnvelopeSchema>;
