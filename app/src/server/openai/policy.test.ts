import { describe, expect, it, vi } from "vitest";

import { OpenAIRuntimeError } from "./errors";
import { ChapterCostBudget, runRetriedRequest, type RuntimeCostHooks } from "./policy";

const USAGE = {
  input_tokens: 100,
  input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 120,
};

const TERRA_FLEX_HALF_NANO_USAGE = {
  input_tokens: 3_170,
  input_tokens_details: { cache_write_tokens: 3_167, cached_tokens: 0 },
  output_tokens: 319,
  output_tokens_details: { reasoning_tokens: 266 },
  total_tokens: 3_489,
};

describe("durable runtime cost hooks", () => {
  it("canonicalizes each sub-nano Flex cost before traces and durable settlement", async () => {
    const reserve = vi.fn();
    const settle = vi.fn();
    const onAttempt = vi.fn();

    for (const id of ["resp_half_nano_one", "resp_half_nano_two"]) {
      const result = await runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => "flex",
        getUsage: () => TERRA_FLEX_HALF_NANO_USAGE,
        invoke: async () => ({ id }),
        maximumCostUsd: 0.025_821_875_5,
        model: "gpt-5.6-terra",
        policy: {
          budget: new ChapterCostBudget(0.1),
          costHooks: { markUncertain: vi.fn(), reserve, settle },
          maxRetries: 0,
          onAttempt,
          serviceTier: "flex",
        },
      });
      expect(result.estimatedCostUsd).toBe(0.007_344_688);
    }

    expect(reserve.mock.calls.map(([entry]) => entry.maximumCostUsd)).toEqual([
      0.025_821_876, 0.025_821_876,
    ]);
    expect(settle.mock.calls.map(([entry]) => entry.actualCostUsd)).toEqual([
      0.007_344_688, 0.007_344_688,
    ]);
    expect(onAttempt.mock.calls.map(([entry]) => entry.costUsd)).toEqual([
      0.007_344_688, 0.007_344_688,
    ]);
    expect(settle.mock.calls.reduce((sum, [entry]) => sum + entry.actualCostUsd, 0)).toBe(
      0.014_689_376,
    );
  });

  it.each([Number.NaN, -0.01, 0])(
    "keeps invalid request bound %s as a local policy failure",
    async (maximumCostUsd) => {
      const invoke = vi.fn();
      await expect(
        runRetriedRequest({
          evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
          getResponseId: (response: { id: string }) => response.id,
          getServiceTier: () => "default",
          getUsage: () => USAGE,
          invoke,
          maximumCostUsd,
          model: "gpt-5.6-terra",
          policy: { budget: new ChapterCostBudget(0.1), maxRetries: 0 },
        }),
      ).rejects.toMatchObject({ code: "INVALID_POLICY" });
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("never invokes the provider when durable reservation fails", async () => {
    const invoke = vi.fn();
    const hooks: RuntimeCostHooks = {
      markUncertain: vi.fn(),
      reserve: vi.fn(() => {
        throw new OpenAIRuntimeError("COST_CAP_EXCEEDED", "global cap reached");
      }),
      settle: vi.fn(),
    };

    await expect(
      runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => "default",
        getUsage: () => USAGE,
        invoke,
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        policy: { budget: new ChapterCostBudget(0.02), costHooks: hooks, maxRetries: 0 },
      }),
    ).rejects.toMatchObject({ code: "COST_CAP_EXCEEDED" });

    expect(invoke).not.toHaveBeenCalled();
    expect(hooks.settle).not.toHaveBeenCalled();
    expect(hooks.markUncertain).not.toHaveBeenCalled();
  });

  it("persists attempt evidence before settling known usage after output validation", async () => {
    const order: string[] = [];
    const reserve = vi.fn(() => order.push("reserve"));
    const settle = vi.fn(() => order.push("settle"));
    const markUncertain = vi.fn();

    await expect(
      runRetriedRequest({
        evaluate: () => {
          order.push("evaluate");
          throw new OpenAIRuntimeError("INVALID_OUTPUT", "bad schema");
        },
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => "default",
        getUsage: () => USAGE,
        invoke: async () => ({ id: "resp_known" }),
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        observe: () => order.push("observe"),
        policy: {
          budget: new ChapterCostBudget(0.02),
          costHooks: { markUncertain, reserve, settle },
          maxRetries: 0,
          onAttempt: () => order.push("attempt"),
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });

    expect(reserve).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostUsd: expect.any(Number) }),
    );
    expect(markUncertain).not.toHaveBeenCalled();
    expect(order).toEqual(["reserve", "observe", "evaluate", "attempt", "settle"]);
  });

  it("keeps the full reservation when transport usage is unknown", async () => {
    const reserve = vi.fn();
    const settle = vi.fn();
    const markUncertain = vi.fn();
    const onAttempt = vi.fn();

    await expect(
      runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => "flex",
        getUsage: () => USAGE,
        invoke: async () => {
          throw new OpenAIRuntimeError("TIMEOUT", "timed out");
        },
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        policy: {
          budget: new ChapterCostBudget(0.02),
          costHooks: { markUncertain, reserve, settle },
          maxRetries: 0,
          onAttempt,
          serviceTier: "flex",
        },
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    const reservation = reserve.mock.calls[0]?.[0];
    expect(reservation).toMatchObject({ serviceTier: "flex" });
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ requestedServiceTier: "flex", serviceTier: null }),
    );
    expect(markUncertain).toHaveBeenCalledWith(reservation?.id);
    expect(settle).not.toHaveBeenCalled();
  });

  it("settles recognized provider-tier mismatches at the returned tier price", async () => {
    const reserve = vi.fn();
    const settle = vi.fn();
    const markUncertain = vi.fn();
    const onAttempt = vi.fn();

    await expect(
      runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => "default",
        getUsage: () => USAGE,
        invoke: async () => ({ id: "resp_wrong_tier" }),
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        policy: {
          budget: new ChapterCostBudget(0.02),
          costHooks: { markUncertain, reserve, settle },
          maxRetries: 0,
          onAttempt,
          serviceTier: "flex",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_USAGE" });

    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: 0.00055,
        requestedServiceTier: "flex",
        serviceTier: "standard",
      }),
    );
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ actualCostUsd: 0.00055 }));
    expect(markUncertain).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["auto", "auto" as const],
  ])("keeps the full reservation when provider tier evidence is %s", async (_label, tier) => {
    const reserve = vi.fn();
    const settle = vi.fn();
    const markUncertain = vi.fn();
    const onAttempt = vi.fn();

    await expect(
      runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => tier,
        getUsage: () => USAGE,
        invoke: async () => ({ id: "resp_unpriced_tier" }),
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        policy: {
          budget: new ChapterCostBudget(0.02),
          costHooks: { markUncertain, reserve, settle },
          maxRetries: 0,
          onAttempt,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_USAGE" });

    const reservation = reserve.mock.calls[0]?.[0];
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: 0.01,
        requestedServiceTier: "standard",
        serviceTier: null,
        usage: expect.objectContaining({ inputTokens: 100, outputTokens: 20 }),
      }),
    );
    expect(markUncertain).toHaveBeenCalledWith(reservation?.id);
    expect(settle).not.toHaveBeenCalled();
  });

  it("does not retry or report twice when attempt evidence persistence fails", async () => {
    const invoke = vi.fn().mockResolvedValue({ id: "resp_attempt_hook" });
    const onAttempt = vi.fn(() => {
      throw new Error("disk unavailable");
    });

    await expect(
      runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => "default",
        getUsage: () => USAGE,
        invoke,
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        policy: {
          budget: new ChapterCostBudget(0.02),
          maxRetries: 2,
          onAttempt,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_POLICY" });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("keeps the durable reservation active when attempt evidence persistence fails", async () => {
    const settle = vi.fn();
    const markUncertain = vi.fn();

    await expect(
      runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
        getServiceTier: () => "default",
        getUsage: () => USAGE,
        invoke: async () => ({ id: "resp_uncheckpointed" }),
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        policy: {
          budget: new ChapterCostBudget(0.02),
          costHooks: { markUncertain, reserve: vi.fn(), settle },
          maxRetries: 0,
          onAttempt: () => {
            throw new Error("disk unavailable");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_POLICY" });

    expect(settle).not.toHaveBeenCalled();
    expect(markUncertain).not.toHaveBeenCalled();
  });
});
