import type { WorldIntent } from "@infinite-litrpg/shared";
import type {
  BetaResponse,
  BetaResponseOutputItem,
} from "openai/resources/beta/responses/responses";
import type { ParsedResponse, ResponseUsage } from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";

import { OpenAIRuntimeError } from "./errors";
import {
  extractRootFinalText,
  runLunaWorldTick,
  type LunaOpenAIClient,
  type LunaWorldTickRequest,
} from "./luna";
import { ChapterCostBudget } from "./policy";
import type { RuntimeAttempt } from "./policy";

describe("Luna world-tick adapters", () => {
  it("uses native beta create with exact capability settings and root final JSON", async () => {
    const childMessage = messageItem("not root JSON", "child-1", "final_answer");
    const callItem = {
      action: "spawn_agent",
      arguments: "{}",
      call_id: "call_1",
      id: "ma_1",
      type: "multi_agent_call",
    } as const;
    const rootMessage = messageItem(
      JSON.stringify({ intents: [intent("actor-one", "intent-one")] }),
      "root",
      "final_answer",
    );
    const create = vi.fn().mockResolvedValue(betaResponse([childMessage, callItem, rootMessage]));
    const parse = vi.fn();

    const result = await runLunaWorldTick(client({ create, parse }), request(true));

    expect(result.mode).toBe("native-multi-agent");
    expect(result.batch.intents.map(({ actorId }) => actorId)).toEqual(["actor-one"]);
    expect(result.multiAgentOutputItems).toEqual([childMessage, callItem, rootMessage]);
    expect(parse).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]?.[0] as {
      betas: string[];
      model: string;
      multi_agent: { enabled: boolean; max_concurrent_subagents: number };
      text: { format: { name: string; strict: boolean; type: string } };
    };
    expect(body).toMatchObject({
      betas: ["responses_multi_agent=v1"],
      model: "gpt-5.6-luna",
      multi_agent: { enabled: true, max_concurrent_subagents: 3 },
    });
    expect(body.text.format).toMatchObject({
      name: "intent_batch",
      strict: true,
      type: "json_schema",
    });
  });

  it("extracts only root final text", () => {
    const output = [
      messageItem("child answer", "child", "final_answer"),
      messageItem("root commentary", "root", "commentary"),
      messageItem("root answer", "root", "final_answer"),
    ];
    expect(extractRootFinalText(output as unknown as BetaResponseOutputItem[])).toBe("root answer");
  });

  it("does not silently fall back when native capability is enabled", async () => {
    const failure = Object.assign(new Error("beta unavailable"), { status: 403 });
    const create = vi.fn().mockRejectedValue(failure);
    const parse = vi.fn().mockResolvedValue(parsedIntent(intent("actor-one", "intent-one")));

    await expectRuntimeError(
      runLunaWorldTick(client({ create, parse }), request(true)),
      "TRANSPORT_ERROR",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it("runs explicit sequential fallback in order with same resolver input", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedIntent(intent("actor-one", "intent-one")))
      .mockResolvedValueOnce(parsedIntent(intent("actor-two", "intent-two")))
      .mockResolvedValueOnce(parsedIntent(intent("actor-three", "intent-three")));
    const create = vi.fn();
    const tickRequest = request(false, ["actor-one", "actor-two", "actor-three"]);

    const result = await runLunaWorldTick(client({ create, parse }), tickRequest);

    expect(result.mode).toBe("sequential");
    expect(result.batch.intents).toHaveLength(3);
    expect(result.calls.map(({ agentId }) => agentId)).toEqual([
      "actor-one",
      "actor-two",
      "actor-three",
    ]);
    expect(create).not.toHaveBeenCalled();
    expect(parse).toHaveBeenCalledTimes(3);
    expect(parse.mock.calls.map(([body]) => (body as { input: string }).input)).toEqual([
      "immutable resolver snapshot",
      "immutable resolver snapshot",
      "immutable resolver snapshot",
    ]);
  });

  it("identifies the sequential agent on a failed runtime attempt", async () => {
    const attempts: RuntimeAttempt[] = [];
    const parse = vi.fn().mockResolvedValue(parsedIntent(intent("actor-two", "intent-wrong")));
    const tickRequest = request(false, ["actor-one"]);
    tickRequest.policy = {
      budget: new ChapterCostBudget(1),
      maxRetries: 0,
      onAttempt: (attempt) => attempts.push(attempt),
    };

    await expectRuntimeError(
      runLunaWorldTick(client({ create: vi.fn(), parse }), tickRequest),
      "INVALID_OUTPUT",
    );
    expect(attempts).toEqual([
      expect.objectContaining({
        agentId: "actor-one",
        errorCode: "INVALID_OUTPUT",
        responseId: "resp_actor-two",
      }),
    ]);
  });

  it("rejects more than three background agents before transport", async () => {
    const create = vi.fn();
    const parse = vi.fn();
    await expectRuntimeError(
      runLunaWorldTick(
        client({ create, parse }),
        request(false, ["actor-one", "actor-two", "actor-three", "actor-four"]),
      ),
      "INVALID_POLICY",
    );
    expect(create).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("manually rejects invalid beta JSON without using stable parse", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(betaResponse([messageItem("```json\n{}\n```", "root", "final_answer")]));
    const parse = vi.fn();
    const invalidRequest = request(true);
    invalidRequest.policy = { budget: new ChapterCostBudget(1), maxRetries: 0 };

    await expectRuntimeError(
      runLunaWorldTick(client({ create, parse }), invalidRequest),
      "INVALID_OUTPUT",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });
});

function request(
  nativeMultiAgent: boolean,
  actorIds: readonly string[] = ["actor-one"],
): LunaWorldTickRequest & { policy: LunaWorldTickRequest["policy"] } {
  return {
    agents: actorIds.map((actorId) => ({ actorId, instructions: `Act as ${actorId}.` })),
    capabilities: { nativeMultiAgent },
    coordinatorInstructions: "Delegate once per listed actor. Return one intent batch as JSON.",
    maxOutputTokens: 1_000,
    policy: { budget: new ChapterCostBudget(1), maxRetries: 0 },
    reasoningEffort: "none",
    resolverInput: "immutable resolver snapshot",
  };
}

function intent(actorId: string, id: string): WorldIntent {
  return {
    action: { type: "wait" },
    actorId,
    contractVersion: "1.1.0",
    expectedEffect: "Observe the current situation.",
    goal: "Survive the chapter.",
    id,
    prerequisites: { requiredFactIds: [], requiredItemIds: [], requiredSkillIds: [] },
    promptVersion: "1.3.0",
    stateVersion: 1,
  };
}

function messageItem(text: string, agentName: string, phase: "commentary" | "final_answer") {
  return {
    agent: { agent_name: agentName },
    content: [{ annotations: [], text, type: "output_text" }],
    id: `msg_${agentName}_${phase}`,
    phase,
    role: "assistant",
    status: "completed",
    type: "message",
  } as const;
}

function betaResponse(output: readonly unknown[]): BetaResponse {
  return {
    error: null,
    id: "resp_beta",
    incomplete_details: null,
    output: output as BetaResponseOutputItem[],
    status: "completed",
    usage: openAIUsage(),
  } as unknown as BetaResponse;
}

function parsedIntent(value: WorldIntent): ParsedResponse<WorldIntent> {
  return {
    error: null,
    id: `resp_${value.actorId}`,
    incomplete_details: null,
    output: [],
    output_parsed: value,
    output_text: JSON.stringify(value),
    status: "completed",
    usage: openAIUsage(),
  } as unknown as ParsedResponse<WorldIntent>;
}

function openAIUsage(): ResponseUsage {
  return {
    input_tokens: 100,
    input_tokens_details: { cache_write_tokens: 0, cached_tokens: 10 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 2 },
    total_tokens: 120,
  };
}

function client(methods: { create: unknown; parse: unknown }): LunaOpenAIClient {
  return {
    beta: { responses: { create: methods.create } },
    responses: { parse: methods.parse },
  } as unknown as LunaOpenAIClient;
}

async function expectRuntimeError(
  operation: Promise<unknown>,
  code: OpenAIRuntimeError["code"] | string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(OpenAIRuntimeError);
    expect((error as OpenAIRuntimeError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}
