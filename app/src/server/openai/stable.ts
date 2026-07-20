import { ReasoningEffortSchema, type ModelCallTrace } from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { InputTokenCountParams } from "openai/resources/responses/input-tokens";
import type { Response } from "openai/resources/responses/responses";
import type { z } from "zod";

import { OpenAIRuntimeError } from "./errors";
import { parseRuntimeModel, type RuntimeModel, type RuntimeReasoningEffort } from "./models";
import { runRetriedRequest, type RuntimeCallResult, type RuntimePolicy } from "./policy";
import { estimateMaximumCountedRequestCostUsd, estimateMaximumRequestCostUsd } from "./usage";

export type StableOpenAIClient = Pick<OpenAI, "responses">;
export const NO_PROMPT_CACHE_OPTIONS = Object.freeze({ mode: "explicit" as const });

export interface StructuredResponseRequest<T> {
  readonly agentId?: string | null;
  readonly input: string;
  readonly instructions: string;
  readonly maxOutputTokens: number;
  readonly model: RuntimeModel;
  readonly onCandidate?: (candidate: T, context: StructuredResponseCandidateContext) => void;
  readonly onRawCandidate?: (context: StructuredResponseRawCandidateContext) => void;
  readonly policy: RuntimePolicy;
  readonly reasoningEffort: RuntimeReasoningEffort;
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  readonly validate?: (data: T) => void;
}

export interface StructuredResponseCandidateContext {
  readonly attempt: number;
  readonly responseId: string;
}

export interface StructuredResponseRawCandidateContext extends StructuredResponseCandidateContext {
  readonly rawOutputText: string;
  readonly status: Response["status"];
}

interface AttemptedStructuredResponse {
  readonly attempt: number;
  readonly response: Response;
}

export async function runStructuredResponse<T>(
  client: StableOpenAIClient,
  request: StructuredResponseRequest<T>,
): Promise<RuntimeCallResult<T>> {
  const model = parseRuntimeModel(request.model);
  const reasoningEffort = ReasoningEffortSchema.parse(request.reasoningEffort);
  validateGenerationSettings(request.schemaName, request.maxOutputTokens);
  const format = zodTextFormat(request.schema, request.schemaName);
  const maximumCostUsd = createStableMaximumCostResolver(client, {
    format,
    inputForAttempt: () => request.input,
    instructions: request.instructions,
    maxOutputTokens: request.maxOutputTokens,
    model,
    policy: request.policy,
    reasoningEffort,
  });

  return runRetriedRequest({
    agentId: request.agentId ?? null,
    evaluate: ({ attempt, response }: AttemptedStructuredResponse) => {
      assertStableResponseCompleted(response);
      const refusal = findStableRefusal(response);
      if (refusal !== null) {
        throw new OpenAIRuntimeError("REFUSAL", refusal, { retryable: true });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(response.output_text) as unknown;
      } catch (error) {
        throw new OpenAIRuntimeError("INVALID_OUTPUT", "Structured output was not valid JSON", {
          cause: error,
          retryable: true,
        });
      }
      const parsed = request.schema.safeParse(raw);
      if (!parsed.success) {
        throw new OpenAIRuntimeError(
          "INVALID_OUTPUT",
          "Structured response failed Zod validation",
          {
            cause: parsed.error,
            retryable: true,
          },
        );
      }
      invokeEvidenceHook(
        () => request.onCandidate?.(parsed.data, { attempt, responseId: response.id }),
        "Structured response candidate-evidence hook failed",
      );
      try {
        request.validate?.(parsed.data);
      } catch (error) {
        if (error instanceof OpenAIRuntimeError) throw error;
        throw new OpenAIRuntimeError("INVALID_OUTPUT", "Structured response failed validation", {
          cause: error,
          retryable: true,
        });
      }
      return { data: parsed.data, responseId: response.id };
    },
    getResponseId: ({ response }) => response.id,
    getUsage: ({ response }) => response.usage,
    invoke: async (signal, attempt): Promise<AttemptedStructuredResponse> => ({
      attempt,
      response: await client.responses.create(
        {
          input: request.input,
          instructions: request.instructions,
          max_output_tokens: request.maxOutputTokens,
          model,
          prompt_cache_options: NO_PROMPT_CACHE_OPTIONS,
          reasoning: { effort: reasoningEffort },
          store: false,
          text: { format },
        },
        { signal },
      ),
    }),
    model,
    maximumCostUsd,
    observe: ({ attempt, response }) => {
      invokeEvidenceHook(
        () =>
          request.onRawCandidate?.({
            attempt,
            rawOutputText: response.output_text,
            responseId: response.id,
            status: response.status,
          }),
        "Structured response raw-evidence hook failed",
      );
    },
    policy: request.policy,
  });
}

function invokeEvidenceHook(callback: () => void, message: string): void {
  try {
    callback();
  } catch (error) {
    throw new OpenAIRuntimeError("INVALID_POLICY", message, { cause: error });
  }
}

export interface NarrativeAuditVerdict {
  readonly accepted: boolean;
  readonly auditedProse?: string;
  readonly reason?: string;
}

export interface NarrativeAuditContext {
  readonly attempt: number;
  readonly responseId: string;
}

export interface NarrationRawCandidateContext extends NarrativeAuditContext {
  readonly bufferedOutputText: string;
  readonly rawOutputText: string;
  readonly status: Response["status"];
}

export interface BufferedNarrationRequest {
  readonly audit: (
    completeProse: string,
    context: NarrativeAuditContext,
  ) => NarrativeAuditVerdict | Promise<NarrativeAuditVerdict>;
  readonly chunkCharacters?: number;
  readonly input: string | ((attempt: number) => string);
  readonly instructions: string;
  readonly maxOutputTokens: number;
  readonly model: RuntimeModel;
  readonly onRawCandidate?: (context: NarrationRawCandidateContext) => void;
  readonly policy: RuntimePolicy;
  readonly reasoningEffort: RuntimeReasoningEffort;
}

export interface AuditedNarrationResult extends Omit<RuntimeCallResult<string>, "data"> {
  readonly audit: NarrativeAuditVerdict;
  readonly prose: string;
  readonly replay: AsyncIterable<string>;
}

interface BufferedStreamResponse {
  readonly attempt: number;
  readonly bufferedDelta: string;
  readonly response: Response;
}

export async function createAuditedNarrationReplay(
  client: StableOpenAIClient,
  request: BufferedNarrationRequest,
): Promise<AuditedNarrationResult> {
  const model = parseRuntimeModel(request.model);
  const reasoningEffort = ReasoningEffortSchema.parse(request.reasoningEffort);
  validateGenerationSettings("narration", request.maxOutputTokens);
  const chunkCharacters = request.chunkCharacters ?? 512;
  if (!Number.isInteger(chunkCharacters) || chunkCharacters < 1 || chunkCharacters > 4_096) {
    throw new OpenAIRuntimeError(
      "INVALID_POLICY",
      "chunkCharacters must be an integer between 1 and 4096",
    );
  }
  const attemptInputs = new Map<number, string>();
  const inputForAttempt = (attempt: number): string => {
    const cached = attemptInputs.get(attempt);
    if (cached !== undefined) return cached;
    const input = typeof request.input === "function" ? request.input(attempt) : request.input;
    attemptInputs.set(attempt, input);
    return input;
  };
  const maximumCostUsd = createStableMaximumCostResolver(client, {
    inputForAttempt,
    instructions: request.instructions,
    maxOutputTokens: request.maxOutputTokens,
    model,
    policy: request.policy,
    reasoningEffort,
  });

  const call = await runRetriedRequest({
    evaluate: async ({ attempt, bufferedDelta, response }: BufferedStreamResponse) => {
      assertStableResponseCompleted(response);
      const refusal = findStableRefusal(response);
      if (refusal !== null) {
        throw new OpenAIRuntimeError("REFUSAL", refusal, { retryable: true });
      }
      if (response.output_text.length === 0) {
        throw new OpenAIRuntimeError("INVALID_OUTPUT", "Narration response had no prose", {
          retryable: true,
        });
      }
      if (bufferedDelta.length > 0 && bufferedDelta !== response.output_text) {
        throw new OpenAIRuntimeError(
          "INVALID_OUTPUT",
          "Buffered narration did not match final response",
          { retryable: true },
        );
      }
      const audit = await request.audit(response.output_text, {
        attempt,
        responseId: response.id,
      });
      if (!audit.accepted) {
        throw new OpenAIRuntimeError(
          "NARRATIVE_AUDIT_REJECTED",
          audit.reason ?? "Narrative audit rejected prose",
          { retryable: true },
        );
      }
      const auditedProse = audit.auditedProse ?? response.output_text;
      if (auditedProse.trim().length === 0) {
        throw new OpenAIRuntimeError("INVALID_OUTPUT", "Audited narration had no prose", {
          retryable: true,
        });
      }
      return {
        data: { audit, prose: auditedProse },
        responseId: response.id,
      };
    },
    getResponseId: ({ response }) => response.id,
    getUsage: ({ response }) => response.usage,
    invoke: async (signal, attempt): Promise<BufferedStreamResponse> => {
      const stream = client.responses.stream(
        {
          input: inputForAttempt(attempt),
          instructions: request.instructions,
          max_output_tokens: request.maxOutputTokens,
          model,
          prompt_cache_options: NO_PROMPT_CACHE_OPTIONS,
          reasoning: { effort: reasoningEffort },
          store: false,
        },
        { signal },
      );
      let bufferedDelta = "";
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") bufferedDelta += event.delta;
      }
      const response = await stream.finalResponse();
      return { attempt, bufferedDelta, response };
    },
    model,
    maximumCostUsd,
    observe: ({ attempt, bufferedDelta, response }) => {
      invokeEvidenceHook(
        () =>
          request.onRawCandidate?.({
            attempt,
            bufferedOutputText: bufferedDelta,
            rawOutputText: response.output_text,
            responseId: response.id,
            status: response.status,
          }),
        "Narration raw-evidence hook failed",
      );
    },
    policy: request.policy,
  });

  return {
    audit: call.data.audit,
    estimatedCostUsd: call.estimatedCostUsd,
    latencyMs: call.latencyMs,
    prose: call.data.prose,
    replay: replayBufferedText(call.data.prose, chunkCharacters),
    responseId: call.responseId,
    retries: call.retries,
    usage: call.usage,
  };
}

function assertStableResponseCompleted(response: Response): void {
  if (response.status === "completed") return;
  if (response.status === "failed") {
    const message = response.error?.message ?? "OpenAI response failed";
    const code = response.error?.code;
    const retryable =
      code === "server_error" || code === "rate_limit_exceeded" || code === "vector_store_timeout";
    throw new OpenAIRuntimeError("FAILED_RESPONSE", message, { retryable });
  }
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? "unknown reason";
    throw new OpenAIRuntimeError("INCOMPLETE_RESPONSE", `OpenAI response incomplete: ${reason}`, {
      retryable: reason !== "content_filter",
    });
  }
  throw new OpenAIRuntimeError(
    "RESPONSE_NOT_COMPLETED",
    `OpenAI response status was ${response.status ?? "missing"}`,
    { retryable: response.status === "queued" || response.status === "in_progress" },
  );
}

function findStableRefusal(response: Response): string | null {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type === "refusal") return content.refusal;
    }
  }
  return null;
}

async function* replayBufferedText(text: string, chunkCharacters: number): AsyncIterable<string> {
  for (let offset = 0; offset < text.length; offset += chunkCharacters) {
    yield text.slice(offset, offset + chunkCharacters);
  }
}

function validateGenerationSettings(schemaName: string, maxOutputTokens: number): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(schemaName)) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "Schema name is invalid");
  }
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "maxOutputTokens must be a positive integer");
  }
}

function promptBytes(input: string, instructions: string, format?: unknown): number {
  return new TextEncoder().encode(serializePrompt(input, instructions, format)).byteLength;
}

function serializePrompt(input: string, instructions: string, format?: unknown): string {
  const serializedFormat = format === undefined ? "" : JSON.stringify(format);
  return `${instructions}\n${input}\n${serializedFormat}`;
}

type InputTokenFormat = NonNullable<InputTokenCountParams["text"]>["format"];

interface StableMaximumCostRequest {
  readonly format?: InputTokenFormat;
  readonly inputForAttempt: (attempt: number) => string;
  readonly instructions: string;
  readonly maxOutputTokens: number;
  readonly model: RuntimeModel;
  readonly policy: RuntimePolicy;
  readonly reasoningEffort: RuntimeReasoningEffort;
}

function createStableMaximumCostResolver(
  client: StableOpenAIClient,
  request: StableMaximumCostRequest,
): (attempt: number) => Promise<number> {
  const countedCostByPrompt = new Map<string, Promise<number>>();
  return async (attempt) => {
    const input = request.inputForAttempt(attempt);
    const byteBound = estimateMaximumRequestCostUsd(
      request.model,
      promptBytes(input, request.instructions, request.format),
      request.maxOutputTokens,
      { inputBilling: "uncached" },
    );
    if (byteBound <= request.policy.budget.remainingUsd) return byteBound;

    const promptKey = serializePrompt(input, request.instructions, request.format);
    let countedCost = countedCostByPrompt.get(promptKey);
    if (countedCost === undefined) {
      countedCost = countMaximumRequestCost(client, request, input, byteBound);
      countedCostByPrompt.set(promptKey, countedCost);
    }
    return countedCost;
  };
}

async function countMaximumRequestCost(
  client: StableOpenAIClient,
  request: StableMaximumCostRequest,
  input: string,
  byteBound: number,
): Promise<number> {
  const inputTokens = client.responses.inputTokens;
  if (inputTokens === undefined || typeof inputTokens.count !== "function") return byteBound;
  try {
    const counted = await inputTokens.count(
      {
        input,
        instructions: request.instructions,
        model: request.model,
        reasoning: { effort: request.reasoningEffort },
        ...(request.format === undefined ? {} : { text: { format: request.format } }),
      },
      { maxRetries: 0, timeout: 10_000 },
    );
    if (
      counted.object !== "response.input_tokens" ||
      !Number.isSafeInteger(counted.input_tokens) ||
      counted.input_tokens < 1
    ) {
      return byteBound;
    }
    return estimateMaximumCountedRequestCostUsd(
      request.model,
      counted.input_tokens,
      request.maxOutputTokens,
      { inputBilling: "uncached" },
    );
  } catch {
    return byteBound;
  }
}

export type RuntimePhase = ModelCallTrace["phase"];
