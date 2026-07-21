import type { Response, ResponseUsage } from "openai/resources/responses/responses";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { OpenAIRuntimeError } from "./errors";
import { ChapterCostBudget } from "./policy";
import {
  createAuditedNarrationReplay,
  runStructuredResponse,
  type StableOpenAIClient,
  type StructuredResponseRequest,
} from "./stable";

const ResultSchema = z.object({ answer: z.string() }).strict();

describe("stable Responses adapter", () => {
  it("calls raw responses.create with zodTextFormat and returns locally parsed data", async () => {
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
      prompt_cache_options: { mode: string };
      store: boolean;
      text: { format: { name: string; strict: boolean; type: string } };
    };
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body).not.toHaveProperty("prompt_cache_key");
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({
      name: "test_result",
      strict: true,
      type: "json_schema",
    });
    expect((body as { service_tier?: string }).service_tier).toBe("default");
  });

  it("opts a structured request into stable implicit prompt caching", async () => {
    const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "cached ash" }));
    const request = structuredRequest({ maxRetries: 0 });
    request.promptCacheKey = "story.ashen-crown:frame-01";

    await runStructuredResponse(stableClient({ parse }), request);

    expect(parse.mock.calls[0]?.[0]).toMatchObject({
      prompt_cache_key: "story.ashen-crown:frame-01",
      prompt_cache_options: { mode: "implicit", ttl: "30m" },
    });
  });

  it.each(["", " leading", "contains space", "story/path", "a".repeat(65)])(
    "rejects an unsafe structured prompt cache key: %j",
    async (promptCacheKey) => {
      const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "never called" }));
      const request = structuredRequest({ maxRetries: 0 });
      request.promptCacheKey = promptCacheKey;

      await expectRuntimeError(
        runStructuredResponse(stableClient({ parse }), request),
        "INVALID_POLICY",
      );
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it("requests, verifies, traces, and half-prices explicit Flex processing", async () => {
    const parse = vi
      .fn()
      .mockResolvedValue(parsedResponse({ answer: "ash" }, { service_tier: "flex" }));
    const client = stableClient({ parse });
    const request = structuredRequest({ maxRetries: 0 });
    request.policy = {
      budget: new ChapterCostBudget(0.01),
      maxRetries: 0,
      serviceTier: "flex",
    };

    const result = await runStructuredResponse(client, request);

    expect((parse.mock.calls[0]?.[0] as { service_tier?: string }).service_tier).toBe("flex");
    expect(result).toMatchObject({ requestedServiceTier: "flex", serviceTier: "flex" });
    expect(result.estimatedCostUsd).toBeCloseTo(0.0002646875, 12);
  });

  it("rejects a provider tier that disagrees with explicit Flex", async () => {
    const parse = vi
      .fn()
      .mockResolvedValue(parsedResponse({ answer: "ash" }, { service_tier: "default" }));
    const request = structuredRequest({ maxRetries: 0 });
    request.policy = {
      budget: new ChapterCostBudget(0.01),
      maxRetries: 0,
      serviceTier: "flex",
    };

    await expectRuntimeError(
      runStructuredResponse(stableClient({ parse }), request),
      "INVALID_USAGE",
    );
  });

  it.each([
    ["missing", undefined],
    ["auto", "auto"],
  ])("rejects %s provider tier evidence", async (_label, serviceTier) => {
    const response =
      serviceTier === undefined
        ? ({ ...parsedResponse({ answer: "ash" }), service_tier: undefined } as unknown as Response)
        : parsedResponse(
            { answer: "ash" },
            {
              service_tier: serviceTier as Exclude<Response["service_tier"], undefined>,
            },
          );
    const parse = vi.fn().mockResolvedValue(response);

    await expectRuntimeError(
      runStructuredResponse(stableClient({ parse }), structuredRequest({ maxRetries: 0 })),
      "INVALID_USAGE",
    );
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

    const request = structuredRequest();
    request.promptCacheKey = "story-ashen-crown-frame";
    const result = await runStructuredResponse(stableClient({ parse }), request);

    expect(parse).toHaveBeenCalledTimes(3);
    expect(
      parse.mock.calls.map(([body]) =>
        Object.fromEntries(
          Object.entries(body as Record<string, unknown>).filter(([key]) =>
            key.startsWith("prompt_cache"),
          ),
        ),
      ),
    ).toEqual([
      {
        prompt_cache_key: "story-ashen-crown-frame",
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
      },
      {
        prompt_cache_key: "story-ashen-crown-frame",
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
      },
      {
        prompt_cache_key: "story-ashen-crown-frame",
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
      },
    ]);
    expect(result.retries).toBe(2);
    expect(result.usage.inputTokens).toBe(300);
    expect(result.estimatedCostUsd).toBeCloseTo(0.001588125, 10);
  });

  it("reports each parsed candidate with its exact attempt and response id", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse({ answer: "bad" }, { id: "resp_bad" }))
      .mockResolvedValueOnce(parsedResponse({ answer: "good" }, { id: "resp_good" }));
    const request = structuredRequest();
    const onCandidate = vi.fn();
    request.onCandidate = onCandidate;
    request.validate = ({ answer }) => {
      if (answer === "bad") throw new Error("bad candidate");
    };

    const result = await runStructuredResponse(stableClient({ parse }), request);

    expect(result.data).toEqual({ answer: "good" });
    expect(onCandidate.mock.calls).toEqual([
      [{ answer: "bad" }, { attempt: 0, responseId: "resp_bad" }],
      [{ answer: "good" }, { attempt: 1, responseId: "resp_good" }],
    ]);
  });

  it("records raw structured output before parsing and across a malformed retry", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce(
        parsedResponse(null, { id: "resp_malformed", output_text: '{"answer":' }),
      )
      .mockResolvedValueOnce(
        parsedResponse({ answer: "good" }, { id: "resp_good", output_text: '{"answer":"good"}' }),
      );
    const request = structuredRequest();
    const onCandidate = vi.fn();
    const onRawCandidate = vi.fn();
    request.onCandidate = onCandidate;
    request.onRawCandidate = onRawCandidate;

    const result = await runStructuredResponse(stableClient({ parse }), request);

    expect(result.data).toEqual({ answer: "good" });
    expect(onRawCandidate.mock.calls).toEqual([
      [
        {
          attempt: 0,
          rawOutputText: '{"answer":',
          responseId: "resp_malformed",
          status: "completed",
        },
      ],
      [
        {
          attempt: 1,
          rawOutputText: '{"answer":"good"}',
          responseId: "resp_good",
          status: "completed",
        },
      ],
    ]);
    expect(onCandidate).toHaveBeenCalledTimes(1);
  });

  it("records raw output before an incomplete response is rejected", async () => {
    const parse = vi.fn().mockResolvedValue(
      parsedResponse(null, {
        id: "resp_incomplete_raw",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: '{"answer":"partial"}',
        status: "incomplete",
      }),
    );
    const request = structuredRequest({ maxRetries: 0 });
    const onRawCandidate = vi.fn();
    request.onRawCandidate = onRawCandidate;

    await expectRuntimeError(
      runStructuredResponse(stableClient({ parse }), request),
      "INCOMPLETE_RESPONSE",
    );
    expect(onRawCandidate).toHaveBeenCalledWith({
      attempt: 0,
      rawOutputText: '{"answer":"partial"}',
      responseId: "resp_incomplete_raw",
      status: "incomplete",
    });
  });

  it("keeps raw JSON when Zod refinement rejects before a retry", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedResponse({ answer: "bad" }, { id: "resp_refined_bad" }))
      .mockResolvedValueOnce(parsedResponse({ answer: "good" }, { id: "resp_refined_good" }));
    const request = structuredRequest();
    request.schema = ResultSchema.refine(({ answer }) => answer === "good");
    const onRawCandidate = vi.fn();
    request.onRawCandidate = onRawCandidate;

    const result = await runStructuredResponse(stableClient({ parse }), request);

    expect(result.data).toEqual({ answer: "good" });
    expect(onRawCandidate.mock.calls.map(([context]) => context.responseId)).toEqual([
      "resp_refined_bad",
      "resp_refined_good",
    ]);
  });

  it("does not retry when a structured evidence hook fails", async () => {
    const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "ash" }));
    const request = structuredRequest();
    request.onRawCandidate = () => {
      throw new Error("disk unavailable");
    };

    await expectRuntimeError(
      runStructuredResponse(stableClient({ parse }), request),
      "INVALID_POLICY",
    );
    expect(parse).toHaveBeenCalledTimes(1);
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

  it("uses the official input count when the byte bound would block a safe request", async () => {
    const count = vi.fn().mockResolvedValue(countResponse(100));
    const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "counted" }));
    const request = structuredRequest({ maxRetries: 0 });
    request.input = "x".repeat(5_000);
    request.policy = { budget: new ChapterCostBudget(0.005), maxRetries: 0 };

    const result = await runStructuredResponse(stableClient({ count, parse }), request);

    expect(result.data).toEqual({ answer: "counted" });
    expect(count).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]?.[0]).toMatchObject({
      input: request.input,
      instructions: request.instructions,
      model: "gpt-5.6-terra",
      reasoning: { effort: "none" },
      text: { format: { name: "test_result", strict: true, type: "json_schema" } },
    });
    expect(count.mock.calls[0]?.[1]).toEqual({ maxRetries: 0, timeout: 10_000 });
  });

  it("reserves the cache-write rate and never assumes a structured cache hit", async () => {
    const input = "x".repeat(5_000);
    const uncachedCount = vi.fn().mockResolvedValue(countResponse(100));
    const uncachedParse = vi.fn().mockResolvedValue(parsedResponse({ answer: "uncached" }));
    const uncachedRequest = structuredRequest({ maxRetries: 0 });
    uncachedRequest.input = input;
    uncachedRequest.policy = { budget: new ChapterCostBudget(0.0032), maxRetries: 0 };

    await runStructuredResponse(
      stableClient({ count: uncachedCount, parse: uncachedParse }),
      uncachedRequest,
    );

    const cachedCount = vi.fn().mockResolvedValue(countResponse(100));
    const cachedParse = vi.fn().mockResolvedValue(parsedResponse({ answer: "unsafe" }));
    const cachedRequest = structuredRequest({ maxRetries: 0 });
    cachedRequest.input = input;
    cachedRequest.policy = { budget: new ChapterCostBudget(0.0032), maxRetries: 0 };
    cachedRequest.promptCacheKey = "story-ashen-crown-cost-guard";

    await expectRuntimeError(
      runStructuredResponse(
        stableClient({ count: cachedCount, parse: cachedParse }),
        cachedRequest,
      ),
      "COST_CAP_EXCEEDED",
    );
    expect(uncachedCount).toHaveBeenCalledOnce();
    expect(uncachedParse).toHaveBeenCalledOnce();
    expect(cachedCount).toHaveBeenCalledOnce();
    expect(cachedParse).not.toHaveBeenCalled();
  });

  it("falls back to the byte bound when input counting fails", async () => {
    const count = vi.fn().mockRejectedValue(new Error("counter unavailable"));
    const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "blocked" }));
    const request = structuredRequest({ maxRetries: 0 });
    request.input = "x".repeat(5_000);
    request.policy = { budget: new ChapterCostBudget(0.005), maxRetries: 0 };

    await expectRuntimeError(
      runStructuredResponse(stableClient({ count, parse }), request),
      "COST_CAP_EXCEEDED",
    );
    expect(count).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong object", { input_tokens: 100, object: "wrong" }],
    ["zero", { input_tokens: 0, object: "response.input_tokens" }],
    ["fraction", { input_tokens: 1.5, object: "response.input_tokens" }],
    [
      "unsafe integer",
      { input_tokens: Number.MAX_SAFE_INTEGER + 1, object: "response.input_tokens" },
    ],
  ])("keeps the byte bound for a malformed count: %s", async (_label, countResponseValue) => {
    const count = vi.fn().mockResolvedValue(countResponseValue);
    const parse = vi.fn().mockResolvedValue(parsedResponse({ answer: "blocked" }));
    const request = structuredRequest({ maxRetries: 0 });
    request.input = "x".repeat(5_000);
    request.policy = { budget: new ChapterCostBudget(0.005), maxRetries: 0 };

    await expectRuntimeError(
      runStructuredResponse(stableClient({ count, parse }), request),
      "COST_CAP_EXCEEDED",
    );
    expect(count).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects actual usage above a counted reservation", async () => {
    const count = vi.fn().mockResolvedValue(countResponse(1));
    const onAttempt = vi.fn();
    const settle = vi.fn();
    const parse = vi.fn().mockResolvedValue(
      parsedResponse(
        { answer: "under-counted" },
        {
          usage: {
            input_tokens: 2_000,
            input_tokens_details: { cache_write_tokens: 2_000, cached_tokens: 0 },
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 2_020,
          },
        },
      ),
    );
    const request = structuredRequest({ maxRetries: 0 });
    const onRawCandidate = vi.fn();
    const validate = vi.fn();
    request.input = "x".repeat(5_000);
    request.onRawCandidate = onRawCandidate;
    request.policy = {
      budget: new ChapterCostBudget(0.005),
      costHooks: { markUncertain: vi.fn(), reserve: vi.fn(), settle },
      maxRetries: 0,
      onAttempt,
    };
    request.validate = validate;

    await expectRuntimeError(
      runStructuredResponse(stableClient({ count, parse }), request),
      "INVALID_USAGE",
    );
    expect(parse).toHaveBeenCalledTimes(1);
    expect(request.policy.budget.spentUsd).toBeCloseTo(0.00655, 10);
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ actualCostUsd: 0.00655 }));
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: 0.00655,
        errorCode: "INVALID_USAGE",
        usage: expect.objectContaining({ inputTokens: 2_000, outputTokens: 20 }),
      }),
    );
    expect(onRawCandidate).toHaveBeenCalledOnce();
    expect(validate).not.toHaveBeenCalled();
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
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      prompt_cache_options: { mode: "explicit" },
    });
    expect(stream.mock.calls[0]?.[0]).not.toHaveProperty("prompt_cache_key");
  });

  it("rejects an unsafe narration prompt cache key before streaming", async () => {
    const stream = vi.fn();

    await expectRuntimeError(
      createAuditedNarrationReplay(stableClient({ stream }), {
        audit: () => ({ accepted: true }),
        input: "safe POV context",
        instructions: "Narrate.",
        maxOutputTokens: 100,
        model: "gpt-5.6-terra",
        policy: { budget: new ChapterCostBudget(1), maxRetries: 0 },
        promptCacheKey: "unsafe cache key",
        reasoningEffort: "none",
      }),
      "INVALID_POLICY",
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it("requests and verifies Flex on the streaming narration path", async () => {
    const response = narrationResponse("Flex ash", { service_tier: "flex" });
    const stream = vi.fn().mockReturnValue(fakeStream(["Flex ash"], response));

    const result = await createAuditedNarrationReplay(stableClient({ stream }), {
      audit: () => ({ accepted: true }),
      input: "safe POV context",
      instructions: "Narrate.",
      maxOutputTokens: 100,
      model: "gpt-5.6-terra",
      policy: { budget: new ChapterCostBudget(1), maxRetries: 0, serviceTier: "flex" },
      reasoningEffort: "none",
    });

    expect(stream.mock.calls[0]?.[0]).toMatchObject({ service_tier: "flex" });
    expect(result).toMatchObject({ requestedServiceTier: "flex", serviceTier: "flex" });
  });

  it("gives the audit the exact narrator attempt and response id", async () => {
    const rejected = narrationResponse("rejected prose", { id: "resp_rejected" });
    const accepted = narrationResponse("accepted prose", { id: "resp_accepted" });
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(["rejected prose"], rejected))
      .mockReturnValueOnce(fakeStream(["accepted prose"], accepted));
    const audit = vi
      .fn()
      .mockReturnValueOnce({ accepted: false, reason: "retry" })
      .mockReturnValueOnce({ accepted: true });
    const onRawCandidate = vi.fn();

    await createAuditedNarrationReplay(stableClient({ stream }), {
      audit,
      input: "safe POV context",
      instructions: "Narrate.",
      maxOutputTokens: 100,
      model: "gpt-5.6-terra",
      onRawCandidate,
      policy: { budget: new ChapterCostBudget(1), maxRetries: 1 },
      reasoningEffort: "none",
    });

    expect(audit.mock.calls).toEqual([
      ["rejected prose", { attempt: 0, responseId: "resp_rejected" }],
      ["accepted prose", { attempt: 1, responseId: "resp_accepted" }],
    ]);
    expect(onRawCandidate.mock.calls).toEqual([
      [
        {
          attempt: 0,
          bufferedOutputText: "rejected prose",
          rawOutputText: "rejected prose",
          responseId: "resp_rejected",
          status: "completed",
        },
      ],
      [
        {
          attempt: 1,
          bufferedOutputText: "accepted prose",
          rawOutputText: "accepted prose",
          responseId: "resp_accepted",
          status: "completed",
        },
      ],
    ]);
  });

  it("counts the exact narration input before a byte-bound rejection", async () => {
    const input = "x".repeat(5_000);
    const count = vi.fn().mockResolvedValue(countResponse(100));
    const response = narrationResponse("Counted ash");
    const stream = vi.fn().mockReturnValue(fakeStream(["Counted ash"], response));

    const result = await createAuditedNarrationReplay(stableClient({ count, stream }), {
      audit: () => ({ accepted: true }),
      input,
      instructions: "Narrate.",
      maxOutputTokens: 100,
      model: "gpt-5.6-terra",
      policy: { budget: new ChapterCostBudget(0.005), maxRetries: 0 },
      reasoningEffort: "none",
    });

    expect(result.prose).toBe("Counted ash");
    expect(count).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]?.[0]).toMatchObject({
      input,
      instructions: "Narrate.",
      model: "gpt-5.6-terra",
      reasoning: { effort: "none" },
    });
    expect(count.mock.calls[0]?.[0]).not.toHaveProperty("text");
  });

  it("reserves the cache-write rate and never assumes a narration cache hit", async () => {
    const count = vi.fn().mockResolvedValue(countResponse(100));
    const stream = vi.fn();

    await expectRuntimeError(
      createAuditedNarrationReplay(stableClient({ count, stream }), {
        audit: () => ({ accepted: true }),
        input: "x".repeat(5_000),
        instructions: "Narrate.",
        maxOutputTokens: 100,
        model: "gpt-5.6-terra",
        policy: { budget: new ChapterCostBudget(0.0032), maxRetries: 0 },
        promptCacheKey: "story-ashen-crown-narration-cost",
        reasoningEffort: "none",
      }),
      "COST_CAP_EXCEEDED",
    );
    expect(count).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
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

  it("replays the exact prose accepted by an audit repair", async () => {
    const response = narrationResponse("Ash crown");
    const stream = vi.fn().mockReturnValue(fakeStream(["Ash crown"], response));

    const result = await createAuditedNarrationReplay(stableClient({ stream }), {
      audit: () => ({ accepted: true, auditedProse: "Ash crown settled." }),
      input: "safe POV context",
      instructions: "Narrate.",
      maxOutputTokens: 100,
      model: "gpt-5.6-terra",
      policy: { budget: new ChapterCostBudget(1), maxRetries: 0 },
      reasoningEffort: "none",
    });

    expect(result.prose).toBe("Ash crown settled.");
    const chunks: string[] = [];
    for await (const chunk of result.replay) chunks.push(chunk);
    expect(chunks.join("")).toBe("Ash crown settled.");
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
      promptCacheKey: "story-ashen-crown-narration",
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
    expect(stream.mock.calls.map(([body]) => body)).toEqual([
      expect.objectContaining({
        prompt_cache_key: "story-ashen-crown-narration",
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
      }),
      expect.objectContaining({
        prompt_cache_key: "story-ashen-crown-narration",
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
      }),
    ]);
  });

  it("counts and generates from one materialized input per narration attempt", async () => {
    const rejected = narrationResponse("rejected prose");
    const approved = narrationResponse("approved prose");
    const count = vi.fn().mockResolvedValue(countResponse(100));
    const stream = vi
      .fn()
      .mockReturnValueOnce(fakeStream(["rejected prose"], rejected))
      .mockReturnValueOnce(fakeStream(["approved prose"], approved));
    const audit = vi
      .fn()
      .mockReturnValueOnce({ accepted: false, reason: "retry" })
      .mockReturnValueOnce({ accepted: true });
    const inputForAttempt = vi.fn((attempt: number) => `${"x".repeat(5_000)}-${attempt}`);

    const result = await createAuditedNarrationReplay(stableClient({ count, stream }), {
      audit,
      input: inputForAttempt,
      instructions: "Narrate.",
      maxOutputTokens: 100,
      model: "gpt-5.6-terra",
      policy: { budget: new ChapterCostBudget(0.01), maxRetries: 1 },
      reasoningEffort: "none",
    });

    expect(result.prose).toBe("approved prose");
    expect(inputForAttempt.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1]);
    expect(count.mock.calls.map(([body]) => (body as { input: string }).input)).toEqual([
      `${"x".repeat(5_000)}-0`,
      `${"x".repeat(5_000)}-1`,
    ]);
    expect(stream.mock.calls.map(([body]) => (body as { input: string }).input)).toEqual([
      `${"x".repeat(5_000)}-0`,
      `${"x".repeat(5_000)}-1`,
    ]);
  });
});

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

function structuredRequest(
  overrides: { maxRetries?: number; timeoutMs?: number } = {},
): Mutable<StructuredResponseRequest<z.infer<typeof ResultSchema>>> {
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

function stableClient(methods: {
  count?: unknown;
  parse?: unknown;
  stream?: unknown;
}): StableOpenAIClient {
  return {
    responses: {
      create: methods.parse,
      inputTokens: { count: methods.count },
      stream: methods.stream,
    },
  } as unknown as StableOpenAIClient;
}

function countResponse(inputTokens: number) {
  return { input_tokens: inputTokens, object: "response.input_tokens" as const };
}

function parsedResponse<T>(
  data: T,
  overrides: Omit<Partial<Response>, "usage"> & {
    usage?: ResponseUsage | undefined;
  } = {},
): Response {
  return {
    error: null,
    id: "resp_test",
    incomplete_details: null,
    output: [],
    output_text: JSON.stringify(data),
    service_tier: "default",
    status: "completed",
    usage: openAIUsage(),
    ...overrides,
  } as unknown as Response;
}

function narrationResponse(outputText: string, overrides: Partial<Response> = {}): Response {
  return {
    error: null,
    id: "resp_narration",
    incomplete_details: null,
    output: [],
    output_text: outputText,
    service_tier: "default",
    status: "completed",
    usage: openAIUsage(),
    ...overrides,
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
