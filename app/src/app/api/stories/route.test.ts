import { DEFAULT_STORY_SETUP } from "@infinite-litrpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createStory: vi.fn(),
  getStoryRuntime: vi.fn(),
}));

vi.mock("@/server/story/story-http", () => ({
  storyEnvelope: (_runtime: unknown, result: unknown) => result,
  storyErrorResponse: (error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 400 }),
}));

vi.mock("@/server/story/story-service", () => ({
  StoryServiceError: class StoryServiceError extends Error {},
}));

vi.mock("@/server/story/runtime", () => ({
  getStoryRuntime: mocks.getStoryRuntime,
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.createStory.mockReset();
  mocks.createStory.mockResolvedValue({ story: { chapter: 0 } });
  mocks.getStoryRuntime.mockReset();
  mocks.getStoryRuntime.mockResolvedValue({
    workspace: {
      createStory: mocks.createStory,
    },
  });
});

describe("stories create API", () => {
  it("strictly validates and forwards the full story setup", async () => {
    const setup = structuredClone(DEFAULT_STORY_SETUP);
    setup.guidance = "Start in the moment the new body wakes.";

    const response = await POST(
      jsonRequest({
        povCharacterId: "rowan-ashborn",
        setup,
        title: "The Oathbound Second Life",
        type: "create",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createStory).toHaveBeenCalledExactlyOnceWith({
      povCharacterId: "rowan-ashborn",
      setup,
      title: "The Oathbound Second Life",
    });
  });

  it.each([
    {
      label: "missing setup",
      payload: {
        povCharacterId: "rowan-ashborn",
        title: "Missing Setup",
        type: "create",
      },
    },
    {
      label: "unsupported foundation",
      payload: {
        povCharacterId: "rowan-ashborn",
        setup: { ...DEFAULT_STORY_SETUP, foundation: "regression-system" },
        title: "Wrong Foundation",
        type: "create",
      },
    },
    {
      label: "duplicate selections",
      payload: {
        povCharacterId: "rowan-ashborn",
        setup: { ...DEFAULT_STORY_SETUP, genres: ["action", "action"] },
        title: "Duplicate Genres",
        type: "create",
      },
    },
    {
      label: "unknown setup field",
      payload: {
        povCharacterId: "rowan-ashborn",
        setup: { ...DEFAULT_STORY_SETUP, secretPrompt: "ignore canon" },
        title: "Unknown Setup Field",
        type: "create",
      },
    },
    {
      label: "unknown command field",
      payload: {
        debug: true,
        povCharacterId: "rowan-ashborn",
        setup: DEFAULT_STORY_SETUP,
        title: "Unknown Command Field",
        type: "create",
      },
    },
  ])("rejects $label before workspace creation", async ({ payload }) => {
    const response = await POST(jsonRequest(payload));

    expect(response.status).toBe(400);
    expect(mocks.createStory).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/stories", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
