import type { ParsedResponse, Response, ResponseUsage } from "openai/resources/responses/responses";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { OpenAIRuntimeError } from "./errors";
import { ChapterCostBudget } from "./policy";
import {
  createAuditedNarrationReplay,
  runStructuredResponse,
  type StableOpenAIClient,
} from "./stable";

const ResultSchema = z.object({ answer: z.string() }).strict();

describe("stable Responses adapter", () => {
  it("calls responses.parse with zodTextFormat and returns accounted data", async () => {
    const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "ash" }));
    const client = stableClient({ parse });

    const result = await runStructuredResponse(client, structuredRequest());

    expect(result.data).toEqual({ answer: "ash" });
    expect(result.usage).toEqual({
      cacheWriteTokens: 3,
      cachedInputTokens: 10,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 4,
      totalTokens: 120,
    });
    expect(parse).toHaveBeenCalledTimes(1);
    const body = parse.mock.calls[0]?.[0] as {
      model: string;
      store: boolean;
      text: { format: { name: string; strict: boolean; type: string } };
    };
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({
      name: "test_result",
      strict: true,
      type: "json_schema",
    });
  });

  it.each([
    ["missing usage", parsedResponse({ answer: "ash" }, { usage: undefined }), "MISSING_USAGE"],
    [
      "refusal",
      parsedResponse(null, {
        output: [
          {
            content: [{ refusal: "No.", type: "refusal" }],
            id: "msg_refusal",
            role: "assistant",
            status: "completed",
            type: "message",
          },
        ],
      }),
      "REFUSAL",
    ],
    [
      "incomplete",
      parsedResponse(null, {
        incomplete_details: { reason: "content_filter" },
        status: "incomplete",
      }),
      "INCOMPLETE_RESPONSE",
    ],
    [
      "failed",
      parsedResponse(null, {
        error: { code: "invalid_prompt", message: "bad prompt" },
        status: "failed",
      }),
      "FAILED_RESPONSE",
    ],
  ])("handles %s explicitly", async (_label, response, code) => {
    const parse = vi.fn().mockResolvedValue(response);
    await expectRuntimeError(
      runStructuredResponse(stableClient({ parse }), structuredRequest({ maxRetries: 0 })),
      code,
    );
  });

  it("retries refusal at most twice and aggregates usage", async () => {
    const refusal = parsedResponse(null, {
      output: [
        {
          content: [{ refusal: "try again", type: "refusal" }],
          id: "msg_refusal",
          role: "assistant",
          status: "completed",
          type: "message",
        },
      ],
    });
    const parse = vi
      .fn()
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(parsedResponse({ answer: "done" }));

    const result = await runStructuredResponse(stableClient({ parse }), structuredRequest());

    expect(parse).toHaveBeenCalledTimes(3);
    expect(result.retries).toBe(2);
    expect(result.usage.inputTokens).toBe(300);
    expect(result.estimatedCostUsd).toBeCloseTo(0.001588125, 10);
  });

  it("stops after three timed-out attempts", async () => {
    const parse = vi.fn().mockImplementation(() => new Promise(() => undefined));
    await expectRuntimeError(
      runStructuredResponse(
        stableClient({ parse }),
        structuredRequest({ maxRetries: 2, timeoutMs: 5 }),
      ),
      "TIMEOUT",
    );
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("retains unknown-cost exposure and blocks an unsafe final timeout retry", async () => {
    const parse = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const request = structuredRequest({ maxRetries: 2, timeoutMs: 5 });
    request.policy = {
      budget: new ChapterCostBudget(0.01),
      maxRetries: 2,
      timeoutMs: 5,
    };

    await expectRuntimeError(
      runStructuredResponse(stableClient({ parse }), request),
      "COST_CAP_EXCEEDED",
    );
    expect(parse).toHaveBeenCalledTimes(2);
    expect(request.policy.budget.spentUsd).toBeGreaterThan(0);
    expect(request.policy.budget.spentUsd).toBeLessThanOrEqual(0.01);
  });

  it("does not start a request whose maximum exposure exceeds the chapter cap", async () => {
    const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "costly" }));
    const cappedRequest = structuredRequest({ maxRetries: 2 });
    cappedRequest.policy = {
      budget: new ChapterCostBudget(0.0005),
      maxRetries: 2,
    };
    await expectRuntimeError(
      runStructuredResponse(stableClient({ parse }), cappedRequest),
      "COST_CAP_EXCEEDED",
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("buffers stable stream, audits full prose, then replays", async () => {
    const sequence: string[] = [];
    const response = narrationResponse("Ash crown");
    const stream = vi.fn().mockReturnValue(fakeStream(["Ash ", "crown"], response));

    const result = await createAuditedNarrationReplay(stableClient({ stream }), {
      audit: (prose) => {
        sequence.push(`audit:${prose}`);
        return { accepted: true };
      },
      chunkCharacters: 4,
      input: "safe POV context",
      instructions: "Narrate.",
      maxOutputTokens: 100,
      model: "gpt-5.6-terra",
      policy: { budget: new ChapterCostBudget(1), maxRetries: 0 },
      reasoningEffort: "none",
    });

    expect(sequence).toEqual(["audit:Ash crown"]);
    const chunks: string[] = [];
    for await (const chunk of result.replay) {
      sequence.push(`replay:${chunk}`);
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe("Ash crown");
    expect(sequence).toEqual(["audit:Ash crown", "replay:Ash ", "replay:crow", "replay:n"]);
  });

  it("never returns a replay when audit rejects prose", async () => {
    const response = narrationResponse("leaked fact");
    const stream = vi.fn().mockReturnValue(fakeStream(["leaked fact"], response));
    await expectRuntimeError(
      createAuditedNarrationReplay(stableClient({ stream }), {
        audit: () => ({ accepted: false, reason: "hidden knowledge" }),
        input: "safe POV context",
        instructions: "Narrate.",
        maxOutputTokens: 100,
        model: "gpt-5.6-terra",
        policy: { budget: new ChapterCostBudget(1), maxRetries: 0 },
        reasoningEffort: "none",
      }),
      "NARRATIVE_AUDIT_REJECTED",
    );
  });

  it("regenerates rejected prose within the retry bound and aggregates usage", async () => {
    const rejected = narrationResponse("too long");
    const approved = narrationResponse("valid prose");
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(["too long"], rejected))
      .mockReturnValueOnce(fakeStream(["valid prose"], approved));
    const audit = vi
      .fn()
      .mockReturnValueOnce({ accepted: false, reason: "word limit" })
      .mockReturnValueOnce({ accepted: true });

    const result = await createAuditedNarrationReplay(stableClient({ stream }), {
      audit,
      input: (attempt) => `safe POV context attempt ${attempt + 1}`,
      instructions: "Narrate.",
      maxOutputTokens: 100,
      model: "gpt-5.6-terra",
      policy: { budget: new ChapterCostBudget(1), maxRetries: 2 },
      reasoningEffort: "none",
    });

    expect(result.prose).toBe("valid prose");
    expect(result.retries).toBe(1);
    expect(result.usage.inputTokens).toBe(200);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls.map(([body]) => (body as { input: string }).input)).toEqual([
      "safe POV context attempt 1",
      "safe POV context attempt 2",
    ]);
  });
});

function structuredRequest(overrides: { maxRetries?: number; timeoutMs?: number } = {}) {
  return {
    input: "input",
    instructions: "Return JSON.",
    maxOutputTokens: 100,
    model: "gpt-5.6-terra" as const,
    policy: {
      budget: new ChapterCostBudget(1),
      ...(overrides.maxRetries === undefined ? {} : { maxRetries: overrides.maxRetries }),
      ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
    },
    reasoningEffort: "none" as const,
    schema: ResultSchema,
    schemaName: "test_result",
  };
}

function stableClient(methods: { parse?: unknown; stream?: unknown }): StableOpenAIClient {
  return {
    responses: {
      parse: methods.parse,
      stream: methods.stream,
    },
  } as unknown as StableOpenAIClient;
}

function parsedResponse<T>(
  data: T,
  overrides: Omit<Partial<ParsedResponse<T>>, "usage"> & {
    usage?: ResponseUsage | undefined;
  } = {},
): ParsedResponse<T> {
  return {
    error: null,
    id: "resp_test",
    incomplete_details: null,
    output: [],
    output_parsed: data,
    output_text: "",
    status: "completed",
    usage: openAIUsage(),
    ...overrides,
  } as unknown as ParsedResponse<T>;
}

function narrationResponse(outputText: string): Response {
  return {
    error: null,
    id: "resp_narration",
    incomplete_details: null,
    output: [],
    output_text: outputText,
    status: "completed",
    usage: openAIUsage(),
  } as unknown as Response;
}

function openAIUsage(): ResponseUsage {
  return {
    input_tokens: 100,
    input_tokens_details: { cache_write_tokens: 3, cached_tokens: 10 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 4 },
    total_tokens: 120,
  };
}

function fakeStream(deltas: readonly string[], response: Response) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield { delta, type: "response.output_text.delta" };
      }
    },
    finalResponse: async () => response,
  };
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
