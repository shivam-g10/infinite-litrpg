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

describe("durable runtime cost hooks", () => {
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

  it("settles known usage before output validation", async () => {
    const reserve = vi.fn();
    const settle = vi.fn();
    const markUncertain = vi.fn();

    await expect(
      runRetriedRequest({
        evaluate: () => {
          throw new OpenAIRuntimeError("INVALID_OUTPUT", "bad schema");
        },
        getResponseId: (response: { id: string }) => response.id,
        getUsage: () => USAGE,
        invoke: async () => ({ id: "resp_known" }),
        maximumCostUsd: 0.01,
        model: "gpt-5.6-terra",
        policy: {
          budget: new ChapterCostBudget(0.02),
          costHooks: { markUncertain, reserve, settle },
          maxRetries: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });

    expect(reserve).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostUsd: expect.any(Number) }),
    );
    expect(markUncertain).not.toHaveBeenCalled();
  });

  it("keeps the full reservation when transport usage is unknown", async () => {
    const reserve = vi.fn();
    const settle = vi.fn();
    const markUncertain = vi.fn();

    await expect(
      runRetriedRequest({
        evaluate: (response: { id: string }) => ({ data: response.id, responseId: response.id }),
        getResponseId: (response: { id: string }) => response.id,
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
        },
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    const reservation = reserve.mock.calls[0]?.[0];
    expect(markUncertain).toHaveBeenCalledWith(reservation?.id);
    expect(settle).not.toHaveBeenCalled();
  });
});
