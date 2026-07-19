import { ReasoningEffortSchema, type ModelCallTrace } from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ParsedResponse, Response, ResponseInput } from "openai/resources/responses/responses";
import type { z } from "zod";

import { OpenAIRuntimeError } from "./errors";
import { parseRuntimeModel, type RuntimeModel, type RuntimeReasoningEffort } from "./models";
import { runRetriedRequest, type RuntimeCallResult, type RuntimePolicy } from "./policy";
import { estimateMaximumRequestCostUsd } from "./usage";

export type StableOpenAIClient = Pick<OpenAI, "responses">;

export interface StructuredResponseRequest<T> {
  readonly agentId?: string | null;
  readonly input: string | ResponseInput;
  readonly instructions: string;
  readonly maxOutputTokens: number;
  readonly model: RuntimeModel;
  readonly policy: RuntimePolicy;
  readonly reasoningEffort: RuntimeReasoningEffort;
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  readonly validate?: (data: T) => void;
}

export async function runStructuredResponse<T>(
  client: StableOpenAIClient,
  request: StructuredResponseRequest<T>,
): Promise<RuntimeCallResult<T>> {
  const model = parseRuntimeModel(request.model);
  const reasoningEffort = ReasoningEffortSchema.parse(request.reasoningEffort);
  validateGenerationSettings(request.schemaName, request.maxOutputTokens);
  const format = zodTextFormat(request.schema, request.schemaName);

  return runRetriedRequest({
    agentId: request.agentId ?? null,
    evaluate: (response: ParsedResponse<T>) => {
      assertStableResponseCompleted(response);
      const refusal = findStableRefusal(response);
      if (refusal !== null) {
        throw new OpenAIRuntimeError("REFUSAL", refusal, { retryable: true });
      }
      if (response.output_parsed === null) {
        throw new OpenAIRuntimeError("INVALID_OUTPUT", "Structured response had no parsed output", {
          retryable: true,
        });
      }

      const parsed = request.schema.safeParse(response.output_parsed);
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
    getResponseId: (response) => response.id,
    getUsage: (response) => response.usage,
    invoke: async (signal) =>
      client.responses.parse(
        {
          input: request.input,
          instructions: request.instructions,
          max_output_tokens: request.maxOutputTokens,
          model,
          reasoning: { effort: reasoningEffort },
          store: false,
          text: { format },
        },
        { signal },
      ),
    model,
    maximumCostUsd: estimateMaximumRequestCostUsd(
      model,
      promptBytes(request.input, request.instructions, format),
      request.maxOutputTokens,
    ),
    policy: request.policy,
  });
}

export interface NarrativeAuditVerdict {
  readonly accepted: boolean;
  readonly auditedProse?: string;
  readonly reason?: string;
}

export interface BufferedNarrationRequest {
  readonly audit: (completeProse: string) => NarrativeAuditVerdict | Promise<NarrativeAuditVerdict>;
  readonly chunkCharacters?: number;
  readonly input: string | ResponseInput | ((attempt: number) => string | ResponseInput);
  readonly instructions: string;
  readonly maxOutputTokens: number;
  readonly model: RuntimeModel;
  readonly policy: RuntimePolicy;
  readonly reasoningEffort: RuntimeReasoningEffort;
}

export interface AuditedNarrationResult extends Omit<RuntimeCallResult<string>, "data"> {
  readonly audit: NarrativeAuditVerdict;
  readonly prose: string;
  readonly replay: AsyncIterable<string>;
}

interface BufferedStreamResponse {
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

  const call = await runRetriedRequest({
    evaluate: async ({ bufferedDelta, response }: BufferedStreamResponse) => {
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
      const audit = await request.audit(response.output_text);
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
          input: typeof request.input === "function" ? request.input(attempt) : request.input,
          instructions: request.instructions,
          max_output_tokens: request.maxOutputTokens,
          model,
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
      return { bufferedDelta, response };
    },
    model,
    maximumCostUsd: (attempt) =>
      estimateMaximumRequestCostUsd(
        model,
        promptBytes(
          typeof request.input === "function" ? request.input(attempt) : request.input,
          request.instructions,
        ),
        request.maxOutputTokens,
      ),
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

function promptBytes(
  input: string | ResponseInput,
  instructions: string,
  format?: unknown,
): number {
  const serializedInput = typeof input === "string" ? input : JSON.stringify(input);
  const serializedFormat = format === undefined ? "" : JSON.stringify(format);
  return new TextEncoder().encode(`${instructions}\n${serializedInput}\n${serializedFormat}`)
    .byteLength;
}

export type RuntimePhase = ModelCallTrace["phase"];
