import { randomUUID } from "node:crypto";

import type { BetaResponseUsage } from "openai/resources/beta/responses/responses";
import type { ResponseUsage } from "openai/resources/responses/responses";
import type { RuntimeServiceTier } from "@infinite-litrpg/shared";

import { asRuntimeError, OpenAIRuntimeError } from "./errors";
import type { RuntimeModel } from "./models";
import { parseRuntimeServiceTier } from "./models";
import {
  addUsage,
  estimateResponseCostUsd,
  mapResponseUsage,
  ZERO_USAGE,
  type RuntimeUsage,
} from "./usage";

export const MAX_RETRIES = 2 as const;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_CHAPTER_COST_CAP_USD = 0.1;

export interface RuntimePolicy {
  readonly budget: ChapterCostBudget;
  readonly costHooks?: RuntimeCostHooks;
  readonly maxRetries?: number;
  readonly onAttempt?: (attempt: RuntimeAttempt) => void;
  readonly serviceTier?: RuntimeServiceTier;
  readonly timeoutMs?: number;
}

export interface RuntimeCostReservation {
  readonly agentId: string | null;
  readonly attempt: number;
  readonly id: string;
  readonly maximumCostUsd: number;
  readonly model: RuntimeModel;
  readonly serviceTier: RuntimeServiceTier;
}

export interface RuntimeCostSettlement {
  readonly actualCostUsd: number;
  readonly id: string;
}

export interface RuntimeCostHooks {
  readonly markUncertain: (reservationId: string) => void;
  readonly reserve: (reservation: RuntimeCostReservation) => void;
  readonly settle: (settlement: RuntimeCostSettlement) => void;
}

export interface RuntimeAttempt {
  readonly agentId: string | null;
  readonly attempt: number;
  readonly costUsd: number;
  readonly errorCode: OpenAIRuntimeError["code"] | null;
  readonly latencyMs: number;
  readonly model: RuntimeModel;
  readonly requestedServiceTier: RuntimeServiceTier;
  readonly responseId: string | null;
  readonly serviceTier: RuntimeServiceTier | null;
  readonly usage: RuntimeUsage;
}

export interface RuntimeCallResult<T> {
  readonly data: T;
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
  readonly requestedServiceTier: RuntimeServiceTier;
  readonly responseId: string;
  readonly retries: number;
  readonly serviceTier: RuntimeServiceTier;
  readonly usage: RuntimeUsage;
}

export interface EvaluatedResponse<T> {
  readonly data: T;
  readonly responseId: string;
}

export class ChapterCostBudget {
  readonly capUsd: number;
  #spentUsd = 0;

  constructor(capUsd = DEFAULT_CHAPTER_COST_CAP_USD) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) {
      throw new OpenAIRuntimeError("INVALID_POLICY", "Chapter cost cap must be positive");
    }
    this.capUsd = capUsd;
  }

  get remainingUsd(): number {
    return Math.max(0, this.capUsd - this.#spentUsd);
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  assertRequestAllowed(maximumCostUsd: number): void {
    if (!Number.isFinite(maximumCostUsd) || maximumCostUsd <= 0) {
      throw new OpenAIRuntimeError("INVALID_POLICY", "Request cost bound must be positive");
    }
    if (this.#spentUsd + maximumCostUsd > this.capUsd) {
      throw new OpenAIRuntimeError(
        "COST_CAP_EXCEEDED",
        `Chapter has $${this.remainingUsd.toFixed(6)} left but request may cost $${maximumCostUsd.toFixed(6)}`,
      );
    }
  }

  reserve(maximumCostUsd: number): void {
    this.assertRequestAllowed(maximumCostUsd);
    this.#spentUsd += maximumCostUsd;
  }

  settleReservation(reservedCostUsd: number, actualCostUsd: number): void {
    if (
      !Number.isFinite(reservedCostUsd) ||
      reservedCostUsd <= 0 ||
      !Number.isFinite(actualCostUsd) ||
      actualCostUsd < 0
    ) {
      throw new OpenAIRuntimeError(
        "INVALID_USAGE",
        "Actual request cost or its reservation is invalid",
      );
    }
    if (actualCostUsd > reservedCostUsd + Number.EPSILON) {
      this.#spentUsd -= reservedCostUsd;
      this.#spentUsd += actualCostUsd;
      throw new OpenAIRuntimeError(
        "INVALID_USAGE",
        "Actual request cost exceeds its reserved bound",
      );
    }
    this.#spentUsd -= reservedCostUsd;
    this.charge(actualCostUsd);
  }

  charge(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      throw new OpenAIRuntimeError("INVALID_USAGE", "Estimated response cost is invalid");
    }
    this.#spentUsd += costUsd;
    if (this.#spentUsd > this.capUsd) {
      throw new OpenAIRuntimeError(
        "COST_CAP_EXCEEDED",
        `Chapter cost $${this.#spentUsd.toFixed(6)} exceeds cap $${this.capUsd.toFixed(6)}`,
      );
    }
  }
}

type ResponseUsageValue = ResponseUsage | BetaResponseUsage | null | undefined;

interface RetriedRequestOptions<TResponse, TData> {
  readonly agentId?: string | null;
  readonly evaluate: (
    response: TResponse,
  ) => EvaluatedResponse<TData> | Promise<EvaluatedResponse<TData>>;
  readonly getUsage: (response: TResponse) => ResponseUsageValue;
  readonly getResponseId: (response: TResponse) => string;
  readonly getServiceTier: (response: TResponse) => ProviderResponseServiceTier;
  readonly invoke: (signal: AbortSignal, attempt: number) => Promise<TResponse>;
  readonly maximumCostUsd: number | ((attempt: number) => number | Promise<number>);
  readonly model: RuntimeModel;
  readonly observe?: (response: TResponse) => void;
  readonly policy: RuntimePolicy;
}

type ProviderResponseServiceTier =
  "auto" | "default" | "flex" | "priority" | "scale" | null | undefined;

export async function runRetriedRequest<TResponse, TData>({
  agentId = null,
  evaluate,
  getResponseId,
  getServiceTier,
  getUsage,
  invoke,
  maximumCostUsd,
  model,
  observe,
  policy,
}: RetriedRequestOptions<TResponse, TData>): Promise<RuntimeCallResult<TData>> {
  const maxRetries = validateMaxRetries(policy.maxRetries ?? MAX_RETRIES);
  const timeoutMs = validateTimeout(policy.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const requestedServiceTier = parseRuntimeServiceTier(policy.serviceTier ?? "standard");
  const startedAt = performance.now();
  let aggregateUsage = ZERO_USAGE;
  let aggregateCostUsd = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const attemptStartedAt = performance.now();
    const reservedCostUsd =
      typeof maximumCostUsd === "function" ? await maximumCostUsd(attempt) : maximumCostUsd;
    policy.budget.reserve(reservedCostUsd);
    const reservationId = randomUUID();
    if (policy.costHooks) {
      invokeCostHook(() =>
        policy.costHooks?.reserve({
          agentId,
          attempt,
          id: reservationId,
          maximumCostUsd: reservedCostUsd,
          model,
          serviceTier: requestedServiceTier,
        }),
      );
    }
    let durableReservationActive = policy.costHooks !== undefined;
    let attemptReported = false;
    let attemptEvidenceFailed = false;
    let attemptCostUsd = reservedCostUsd;
    let attemptUsage = ZERO_USAGE;
    let providerUsageKnown = false;
    let responseId: string | null = null;
    let responseServiceTier: RuntimeServiceTier | null = null;
    aggregateCostUsd += reservedCostUsd;
    try {
      const response = await withTimeout((signal) => invoke(signal, attempt), timeoutMs);
      responseId = getResponseId(response);
      observe?.(response);
      const usage = mapResponseUsage(getUsage(response));
      attemptUsage = usage;
      responseServiceTier = canonicalResponseServiceTier(getServiceTier(response));
      const costUsd = estimateResponseCostUsd(model, usage, {
        serviceTier: responseServiceTier,
      });
      attemptCostUsd = costUsd;
      providerUsageKnown = true;
      aggregateUsage = addUsage(aggregateUsage, usage);
      aggregateCostUsd += costUsd - reservedCostUsd;
      let localSettlementError: unknown = null;
      try {
        policy.budget.settleReservation(reservedCostUsd, costUsd);
      } catch (error) {
        localSettlementError = error;
      }
      if (localSettlementError !== null) throw localSettlementError;
      if (responseServiceTier !== requestedServiceTier) {
        throw new OpenAIRuntimeError(
          "INVALID_USAGE",
          `OpenAI returned ${responseServiceTier} processing for a ${requestedServiceTier} request`,
        );
      }
      const evaluated = await evaluate(response);

      attemptReported = true;
      try {
        invokeAttemptHook(policy, {
          agentId,
          attempt,
          costUsd: attemptCostUsd,
          errorCode: null,
          latencyMs: Math.max(0, Math.round(performance.now() - attemptStartedAt)),
          model,
          requestedServiceTier,
          responseId,
          serviceTier: responseServiceTier,
          usage: attemptUsage,
        });
      } catch (error) {
        attemptEvidenceFailed = true;
        throw error;
      }
      if (policy.costHooks) {
        invokeCostHook(() =>
          policy.costHooks?.settle({ actualCostUsd: costUsd, id: reservationId }),
        );
        durableReservationActive = false;
      }
      return {
        data: evaluated.data,
        estimatedCostUsd: aggregateCostUsd,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        requestedServiceTier,
        responseId: evaluated.responseId,
        retries: attempt,
        serviceTier: responseServiceTier,
        usage: aggregateUsage,
      };
    } catch (error) {
      let runtimeError = asRuntimeError(error);
      if (!attemptReported) {
        attemptReported = true;
        try {
          invokeAttemptHook(policy, {
            agentId,
            attempt,
            costUsd: attemptCostUsd,
            errorCode: runtimeError.code,
            latencyMs: Math.max(0, Math.round(performance.now() - attemptStartedAt)),
            model,
            requestedServiceTier,
            responseId,
            serviceTier: responseServiceTier,
            usage: attemptUsage,
          });
        } catch (hookError) {
          attemptEvidenceFailed = true;
          runtimeError = asRuntimeError(hookError);
        }
      }
      if (
        durableReservationActive &&
        policy.costHooks &&
        !attemptEvidenceFailed &&
        runtimeError.code !== "INVALID_POLICY"
      ) {
        try {
          if (providerUsageKnown) {
            invokeCostHook(() =>
              policy.costHooks?.settle({ actualCostUsd: attemptCostUsd, id: reservationId }),
            );
          } else {
            invokeCostHook(() => policy.costHooks?.markUncertain(reservationId));
          }
          durableReservationActive = false;
        } catch (hookError) {
          runtimeError = asRuntimeError(hookError);
        }
      }
      if (!runtimeError.retryable || attempt === maxRetries) throw runtimeError;
    }
  }

  throw new OpenAIRuntimeError("TRANSPORT_ERROR", "OpenAI retry loop ended unexpectedly");
}

function canonicalResponseServiceTier(value: ProviderResponseServiceTier): RuntimeServiceTier {
  if (value === "default") return "standard";
  if (value === "flex") return "flex";
  throw new OpenAIRuntimeError(
    "INVALID_USAGE",
    `OpenAI returned unpriced service tier ${value ?? "missing"}`,
  );
}

function invokeCostHook(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    if (error instanceof OpenAIRuntimeError) throw error;
    throw new OpenAIRuntimeError("INVALID_POLICY", "Durable cost ledger operation failed", {
      cause: error,
    });
  }
}

function invokeAttemptHook(policy: RuntimePolicy, attempt: RuntimeAttempt): void {
  try {
    policy.onAttempt?.(attempt);
  } catch (error) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "Runtime attempt evidence hook failed", {
      cause: error,
    });
  }
}

function validateMaxRetries(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_RETRIES) {
    throw new OpenAIRuntimeError(
      "INVALID_POLICY",
      `maxRetries must be between 0 and ${MAX_RETRIES}`,
    );
  }
  return value;
}

function validateTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "timeoutMs must be positive");
  }
  return value;
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new OpenAIRuntimeError("TIMEOUT", `OpenAI request exceeded ${timeoutMs}ms`, {
          retryable: true,
        }),
      );
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
