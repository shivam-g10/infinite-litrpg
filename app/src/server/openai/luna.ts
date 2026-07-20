import {
  BackgroundIntentBatchCandidateSchema,
  BackgroundIntentCandidateSchema,
  IntentBatchSchema,
  IdSchema,
  ReasoningEffortSchema,
  WorldVersionSchema,
  canonicalizeBackgroundIntentCandidate,
  type AssignedBackgroundIntentCandidate,
  type WorldIntent,
} from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  BetaResponse,
  BetaResponseOutputItem,
  BetaResponseOutputMessage,
} from "openai/resources/beta/responses/responses";
import type { z } from "zod";

import { OpenAIRuntimeError } from "./errors";
import type { RuntimeReasoningEffort } from "./models";
import { runRetriedRequest, type RuntimeCallResult, type RuntimePolicy } from "./policy";
import { NO_PROMPT_CACHE_OPTIONS, runStructuredResponse, type StableOpenAIClient } from "./stable";
import { estimateMaximumRequestCostUsd } from "./usage";

const LUNA_MODEL = "gpt-5.6-luna" as const;
const MULTI_AGENT_BETA = "responses_multi_agent=v1" as const;
const MAX_BACKGROUND_AGENTS = 3;
export const SEQUENTIAL_AGENT_MAX_OUTPUT_TOKENS = 256;

export type IntentBatch = z.infer<typeof IntentBatchSchema>;
export type NativeMultiAgentOutputItem = BetaResponseOutputItem;

export type LunaOpenAIClient = Pick<OpenAI, "beta" | "responses">;

export interface LunaAgentInput {
  readonly actorId: string;
  readonly instructions: string;
}

export interface LunaRuntimeCapabilities {
  readonly nativeMultiAgent: boolean;
}

export interface LunaWorldTickRequest {
  readonly agents: readonly LunaAgentInput[];
  readonly capabilities: LunaRuntimeCapabilities;
  readonly coordinatorInstructions: string;
  readonly maxOutputTokens: number;
  readonly policy: RuntimePolicy;
  readonly reasoningEffort: Extract<RuntimeReasoningEffort, "none" | "low">;
  readonly resolverInput: string;
  readonly rootAgentName?: string;
  readonly stateVersion: number;
}

export interface LunaCallSummary {
  readonly agentId: string | null;
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
  readonly responseId: string;
  readonly retries: number;
  readonly usage: RuntimeCallResult<unknown>["usage"];
}

export interface LunaWorldTickResult {
  readonly batch: IntentBatch;
  readonly calls: readonly LunaCallSummary[];
  readonly mode: "native-multi-agent" | "sequential";
  readonly multiAgentOutputItems: readonly NativeMultiAgentOutputItem[];
}

export async function runLunaWorldTick(
  client: LunaOpenAIClient,
  request: LunaWorldTickRequest,
): Promise<LunaWorldTickResult> {
  validateLunaRequest(request);
  if (request.capabilities.nativeMultiAgent) {
    return runNativeLunaWorldTick(client, request);
  }
  return runSequentialLunaWorldTick(client, request);
}

export async function runNativeLunaWorldTick(
  client: Pick<OpenAI, "beta">,
  request: LunaWorldTickRequest,
): Promise<LunaWorldTickResult> {
  validateLunaRequest(request);
  const reasoningEffort = ReasoningEffortSchema.parse(request.reasoningEffort);
  const schemaFormat = zodTextFormat(
    BackgroundIntentBatchCandidateSchema,
    "background_intent_batch",
  );
  const multiAgentOutputItems: NativeMultiAgentOutputItem[] = [];
  const allowedActors = new Set(request.agents.map(({ actorId }) => actorId));

  const call = await runRetriedRequest({
    evaluate: (response: BetaResponse) => {
      multiAgentOutputItems.push(...extractMultiAgentOutputItems(response.output));
      assertBetaResponseCompleted(response);
      const rootAgentName = request.rootAgentName ?? "root";
      const refusal = findRootRefusal(response.output, rootAgentName);
      if (refusal !== null) {
        throw new OpenAIRuntimeError("REFUSAL", refusal, { retryable: true });
      }

      const text = extractRootFinalText(response.output, rootAgentName);
      let raw: unknown;
      try {
        raw = JSON.parse(text) as unknown;
      } catch (error) {
        throw new OpenAIRuntimeError("INVALID_OUTPUT", "Luna root returned invalid JSON", {
          cause: error,
          retryable: true,
        });
      }
      const parsed = BackgroundIntentBatchCandidateSchema.safeParse(raw);
      if (!parsed.success) {
        throw new OpenAIRuntimeError(
          "INVALID_OUTPUT",
          "Luna root returned invalid background intent batch",
          {
            cause: parsed.error,
            retryable: true,
          },
        );
      }
      assertAssignedActors(parsed.data.intents, allowedActors);
      const intents = request.agents.map(({ actorId }, index) => {
        const assignedCandidate = parsed.data.intents.find((intent) => intent.c === actorId);
        if (!assignedCandidate) {
          throw new OpenAIRuntimeError(
            "INVALID_OUTPUT",
            `Luna root omitted assigned actor ${actorId}`,
            { retryable: true },
          );
        }
        const candidate = {
          a: assignedCandidate.a,
          e: assignedCandidate.e,
          g: assignedCandidate.g,
          r: assignedCandidate.r,
        };
        return canonicalizeBackgroundIntentCandidate(
          candidate,
          actorId,
          request.stateVersion,
          index + 1,
        );
      });
      return { data: IntentBatchSchema.parse({ intents }), responseId: response.id };
    },
    getResponseId: (response) => response.id,
    getUsage: (response) => response.usage,
    invoke: async (signal) =>
      client.beta.responses.create(
        {
          betas: [MULTI_AGENT_BETA],
          input: buildNativeCoordinatorInput(request.resolverInput, request.agents),
          instructions: request.coordinatorInstructions,
          max_output_tokens: request.maxOutputTokens,
          model: LUNA_MODEL,
          multi_agent: {
            enabled: true,
            max_concurrent_subagents: MAX_BACKGROUND_AGENTS,
          },
          prompt_cache_options: NO_PROMPT_CACHE_OPTIONS,
          reasoning: { effort: reasoningEffort },
          store: false,
          text: { format: schemaFormat },
        },
        { signal },
      ),
    model: LUNA_MODEL,
    maximumCostUsd: estimateMaximumRequestCostUsd(
      LUNA_MODEL,
      new TextEncoder().encode(
        `${request.coordinatorInstructions}\n${buildNativeCoordinatorInput(request.resolverInput, request.agents)}\n${JSON.stringify(schemaFormat)}`,
      ).byteLength,
      request.maxOutputTokens,
      { inputBilling: "uncached" },
    ),
    policy: request.policy,
  });

  return {
    batch: call.data,
    calls: [toCallSummary(null, call)],
    mode: "native-multi-agent",
    multiAgentOutputItems,
  };
}

export async function runSequentialLunaWorldTick(
  client: StableOpenAIClient,
  request: LunaWorldTickRequest,
): Promise<LunaWorldTickResult> {
  validateLunaRequest(request);
  const intents: WorldIntent[] = [];
  const calls: LunaCallSummary[] = [];

  for (const [index, agent] of request.agents.entries()) {
    const call = await runStructuredResponse(client, {
      agentId: agent.actorId,
      input: request.resolverInput,
      instructions: agent.instructions,
      maxOutputTokens: Math.min(request.maxOutputTokens, SEQUENTIAL_AGENT_MAX_OUTPUT_TOKENS),
      model: LUNA_MODEL,
      policy: request.policy,
      reasoningEffort: request.reasoningEffort,
      schema: BackgroundIntentCandidateSchema,
      schemaName: "background_intent",
      validate: (candidate) => {
        canonicalizeBackgroundIntentCandidate(
          candidate,
          agent.actorId,
          request.stateVersion,
          index + 1,
        );
      },
    });
    intents.push(
      canonicalizeBackgroundIntentCandidate(
        call.data,
        agent.actorId,
        request.stateVersion,
        index + 1,
      ),
    );
    calls.push(toCallSummary(agent.actorId, call));
  }

  const batch = IntentBatchSchema.safeParse({ intents });
  if (!batch.success) {
    throw new OpenAIRuntimeError("INVALID_OUTPUT", "Sequential Luna intents failed batch schema", {
      cause: batch.error,
    });
  }
  return {
    batch: batch.data,
    calls,
    mode: "sequential",
    multiAgentOutputItems: [],
  };
}

export function extractRootFinalText(
  output: readonly BetaResponseOutputItem[],
  rootAgentName = "root",
): string {
  const rootMessages = output.filter(
    (item): item is BetaResponseOutputMessage =>
      item.type === "message" && isRootAgent(item, rootAgentName),
  );
  const finalMessages = rootMessages.filter(({ phase }) => phase === "final_answer");
  const selected = finalMessages.at(-1) ?? rootMessages.at(-1);
  if (selected === undefined) {
    throw new OpenAIRuntimeError("INVALID_OUTPUT", "Luna response had no root final message", {
      retryable: true,
    });
  }
  const text = selected.content
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("");
  if (text.length === 0) {
    throw new OpenAIRuntimeError("INVALID_OUTPUT", "Luna root final message had no text", {
      retryable: true,
    });
  }
  return text;
}

function buildNativeCoordinatorInput(
  resolverInput: string,
  agents: readonly LunaAgentInput[],
): string {
  return JSON.stringify({
    agents: agents.map(({ actorId, instructions }) => ({ actorId, instructions })),
    resolverInput,
  });
}

function extractMultiAgentOutputItems(
  output: readonly BetaResponseOutputItem[],
): NativeMultiAgentOutputItem[] {
  return [...output];
}

function findRootRefusal(
  output: readonly BetaResponseOutputItem[],
  rootAgentName: string,
): string | null {
  for (const item of output) {
    if (item.type !== "message" || !isRootAgent(item, rootAgentName)) continue;
    for (const content of item.content) {
      if (content.type === "refusal") return content.refusal;
    }
  }
  return null;
}

function isRootAgent(message: BetaResponseOutputMessage, rootAgentName: string): boolean {
  return (
    message.agent === null ||
    message.agent === undefined ||
    message.agent.agent_name === rootAgentName
  );
}

function assertAssignedActors(
  intents: readonly AssignedBackgroundIntentCandidate[],
  allowedActors: ReadonlySet<string>,
): void {
  const seenActors = new Set<string>();
  for (const intent of intents) {
    const actorId = intent.c;
    if (!allowedActors.has(actorId)) {
      throw new OpenAIRuntimeError(
        "INVALID_OUTPUT",
        `Luna root emitted intent for unassigned actor ${actorId}`,
        { retryable: true },
      );
    }
    if (seenActors.has(actorId)) {
      throw new OpenAIRuntimeError(
        "INVALID_OUTPUT",
        `Luna root emitted multiple intents for actor ${actorId}`,
        { retryable: true },
      );
    }
    seenActors.add(actorId);
  }
  if (seenActors.size !== allowedActors.size) {
    const missingActors = [...allowedActors].filter((actorId) => !seenActors.has(actorId));
    throw new OpenAIRuntimeError(
      "INVALID_OUTPUT",
      `Luna root omitted assigned actors: ${missingActors.join(", ")}`,
      { retryable: true },
    );
  }
}

function assertBetaResponseCompleted(response: BetaResponse): void {
  if (response.status === "completed") return;
  if (response.status === "failed") {
    const message = response.error?.message ?? "OpenAI beta response failed";
    const code = response.error?.code;
    const retryable =
      code === "server_error" || code === "rate_limit_exceeded" || code === "vector_store_timeout";
    throw new OpenAIRuntimeError("FAILED_RESPONSE", message, { retryable });
  }
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? "unknown reason";
    throw new OpenAIRuntimeError(
      "INCOMPLETE_RESPONSE",
      `OpenAI beta response incomplete: ${reason}`,
      {
        retryable: reason !== "content_filter",
      },
    );
  }
  throw new OpenAIRuntimeError(
    "RESPONSE_NOT_COMPLETED",
    `OpenAI beta response status was ${response.status ?? "missing"}`,
    { retryable: response.status === "queued" || response.status === "in_progress" },
  );
}

function validateLunaRequest(request: LunaWorldTickRequest): void {
  if (request.agents.length < 1 || request.agents.length > MAX_BACKGROUND_AGENTS) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "Luna world tick requires one to three agents");
  }
  if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "maxOutputTokens must be a positive integer");
  }
  if (!WorldVersionSchema.safeParse(request.stateVersion).success) {
    throw new OpenAIRuntimeError("INVALID_POLICY", "Luna state version must be valid");
  }
  const actorIds = new Set<string>();
  for (const agent of request.agents) {
    if (!IdSchema.safeParse(agent.actorId).success || agent.instructions.trim().length === 0) {
      throw new OpenAIRuntimeError("INVALID_POLICY", "Luna agent input cannot be empty");
    }
    if (actorIds.has(agent.actorId)) {
      throw new OpenAIRuntimeError("INVALID_POLICY", `Duplicate Luna actor ${agent.actorId}`);
    }
    actorIds.add(agent.actorId);
  }
}

function toCallSummary(agentId: string | null, call: RuntimeCallResult<unknown>): LunaCallSummary {
  return {
    agentId,
    estimatedCostUsd: call.estimatedCostUsd,
    latencyMs: call.latencyMs,
    responseId: call.responseId,
    retries: call.retries,
    usage: call.usage,
  };
}
