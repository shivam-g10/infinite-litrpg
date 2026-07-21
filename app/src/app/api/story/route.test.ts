import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoryRuntime } from "@/server/story/runtime";
import type { WorkspaceStoryResult } from "@/server/story/story-workspace";

vi.mock("@/server/story/story-http", () => ({
  defaultStoryTitle: vi.fn(),
  describeStoryError: () => ({
    body: { code: "INTERNAL_ERROR", error: "Story server failed safely" },
    status: 500,
  }),
  storyEnvelope: (_runtime: StoryRuntime, result: WorkspaceStoryResult) => ({
    library: { activeStoryId: "story-1", stories: [] },
    story: result.story,
    warnings: result.warnings,
  }),
  storyErrorResponse: vi.fn(),
}));

vi.mock("@/server/story/story-service", () => ({
  StoryServiceError: class StoryServiceError extends Error {},
}));

vi.mock("@/server/story/runtime", () => ({
  getStoryRuntime: vi.fn(),
}));

import { streamTurn } from "./route";

const command = {
  choiceId: "choice-1",
  expectedWorldVersion: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  type: "take_action",
} as const;

const result = {
  metadata: {
    chapterCount: 1,
    createdAt: "2026-07-21T00:00:00.000Z",
    id: "story-1",
    povCharacterId: "rowan-ashborn",
    status: "active",
    title: "Story",
    updatedAt: "2026-07-21T00:00:00.000Z",
  },
  story: { chapter: { prose: "Accepted prose" } },
  warnings: [],
} as unknown as WorkspaceStoryResult;

afterEach(() => {
  vi.useRealTimers();
});

describe("streamTurn", () => {
  it("sends immediate status and heartbeats while accepted prose stays buffered", async () => {
    vi.useFakeTimers();
    let emitAcceptedProse: (() => Promise<void>) | undefined;
    let finish: (() => void) | undefined;
    const takeTurn = vi.fn(
      async (
        _storyId: string,
        _command: typeof command,
        onChunk?: (chunk: string) => void | Promise<void>,
        onProgress?: (generation: {
          mode: "generate";
          phase: "writing";
          storyId: string;
          targetChapter: number;
        }) => void,
      ) =>
        new Promise<WorkspaceStoryResult>((resolve) => {
          onProgress?.({
            mode: "generate",
            phase: "writing",
            storyId: "story-1",
            targetChapter: 1,
          });
          emitAcceptedProse = async () => {
            await onChunk?.("Accepted prose");
          };
          finish = () => resolve(result);
        }),
    );
    const response = streamTurn(runtimeWith(takeTurn), "story-1", command);
    const reader = response.body!.getReader();

    await expect(readEvent(reader)).resolves.toEqual({ status: "generating", type: "status" });
    await expect(readEvent(reader)).resolves.toMatchObject({
      generation: { phase: "writing", storyId: "story-1", targetChapter: 1 },
      type: "status",
    });
    expect(emitAcceptedProse).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(9_999);
    const heartbeat = readEvent(reader);
    await vi.advanceTimersByTimeAsync(1);
    await expect(heartbeat).resolves.toEqual({ type: "heartbeat" });

    await emitAcceptedProse!();
    await expect(readEvent(reader)).resolves.toEqual({
      text: "Accepted prose",
      type: "chunk",
    });
    finish!();
    await expect(readEvent(reader)).resolves.toMatchObject({ type: "story" });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps generation running after the reader disconnects and clears its heartbeat", async () => {
    vi.useFakeTimers();
    let finishGeneration: (() => void) | undefined;
    let generationFinished = false;
    const takeTurn = vi.fn(
      async () =>
        new Promise<WorkspaceStoryResult>((resolve) => {
          finishGeneration = () => {
            generationFinished = true;
            resolve(result);
          };
        }),
    );
    const response = streamTurn(runtimeWith(takeTurn), "story-1", command);
    const reader = response.body!.getReader();

    await expect(readEvent(reader)).resolves.toEqual({ status: "generating", type: "status" });
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);

    finishGeneration!();
    await vi.waitFor(() => expect(generationFinished).toBe(true));
    expect(takeTurn).toHaveBeenCalledOnce();
  });
});

function runtimeWith(takeTurn: ReturnType<typeof vi.fn>): StoryRuntime {
  return {
    environment: { maxBackgroundAgents: 3, nativeMultiAgent: false },
    workspace: {
      getActiveStoryMetadata: () => ({ id: "story-1" }),
      listStories: () => [],
      takeTurn,
    },
  } as unknown as StoryRuntime;
}

async function readEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Record<string, unknown>> {
  const next = await reader.read();
  if (next.done) throw new Error("Stream ended before the next event");
  return JSON.parse(new TextDecoder().decode(next.value).trim()) as Record<string, unknown>;
}
