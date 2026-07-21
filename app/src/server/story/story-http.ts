import { PUBLIC_CHARACTERS } from "@infinite-litrpg/shared";

import { getServerEnvironment, redactSecret } from "../env";
import { OpenAIRuntimeError } from "../openai";
import {
  RejectedStoryError,
  StoryLibraryValidationError,
  StoryNotFoundError,
} from "../storage/story-library";
import {
  InvalidCommitError,
  StaleChapterNarrationError,
  StaleWorldVersionError,
} from "../storage/story-store";
import type { StoryRuntime } from "./runtime";
import { StoryServiceError } from "./story-service";
import {
  StoryWorkspaceDataError,
  StoryWorkspaceValidationError,
  type WorkspaceStoryResult,
} from "./story-workspace";

export function storyEnvelope(runtime: StoryRuntime, result: WorkspaceStoryResult | null) {
  return {
    library: {
      activeStoryId: runtime.workspace.getActiveStoryMetadata()?.id ?? null,
      stories: runtime.workspace.listStories(),
    },
    story: result?.story ?? null,
    warnings: result?.warnings ?? [],
  };
}

export function defaultStoryTitle(povCharacterId: string, existingStoryCount: number): string {
  if (existingStoryCount === 0) return "Ashen Crown";
  const character = PUBLIC_CHARACTERS.find(({ id }) => id === povCharacterId);
  return `${character?.name ?? "New hero"}'s Ashen Crown ${existingStoryCount + 1}`;
}

export function storyErrorResponse(error: unknown): Response {
  const descriptor = describeStoryError(error);
  return Response.json(descriptor.body, { status: descriptor.status });
}

export function describeStoryError(error: unknown): {
  readonly body: { readonly code: string; readonly error: string };
  readonly status: number;
} {
  const secret = getServerEnvironment().openAiApiKey;
  if (error instanceof StoryServiceError) {
    return {
      body: { code: "STORY_ERROR", error: redactSecret(error.message, secret) },
      status: error.status,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      body: { code: "INVALID_JSON", error: "Request body is not valid JSON" },
      status: 400,
    };
  }
  if (error instanceof OpenAIRuntimeError) {
    const status = error.code === "COST_CAP_EXCEEDED" ? 422 : 502;
    return {
      body: { code: error.code, error: `Model call failed: ${error.code}` },
      status,
    };
  }
  if (error instanceof StaleWorldVersionError) {
    return {
      body: { code: "STALE_WORLD_VERSION", error: "World changed before commit" },
      status: 409,
    };
  }
  if (error instanceof StaleChapterNarrationError) {
    return {
      body: { code: "STALE_CHAPTER_NARRATION", error: "Chapter changed before rewrite" },
      status: 409,
    };
  }
  if (error instanceof StoryNotFoundError) {
    return { body: { code: "STORY_NOT_FOUND", error: "Story was not found" }, status: 404 };
  }
  if (error instanceof RejectedStoryError) {
    return {
      body: { code: "STORY_REJECTED", error: "Reopen this story before changing it" },
      status: 409,
    };
  }
  if (
    error instanceof StoryLibraryValidationError ||
    error instanceof StoryWorkspaceValidationError
  ) {
    return { body: { code: "INVALID_STORY", error: "Story request is invalid" }, status: 400 };
  }
  if (error instanceof StoryWorkspaceDataError) {
    return {
      body: { code: "STORY_DATA_ERROR", error: "Local story data needs repair" },
      status: 500,
    };
  }
  if (error instanceof InvalidCommitError) {
    return {
      body: { code: "INVALID_COMMIT", error: "Atomic commit rejected invalid output" },
      status: 500,
    };
  }
  return { body: { code: "INTERNAL_ERROR", error: "Story server failed safely" }, status: 500 };
}
