import "server-only";

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import OpenAI from "openai";

import { getServerEnvironment, type ServerEnvironment } from "../env";
import { migrateLegacyStoryDatabase } from "./legacy-story-migration";
import { REVIEW_STORY_MODELS } from "./story-service";
import { StoryWorkspace } from "./story-workspace";

export interface StoryRuntime {
  readonly environment: ServerEnvironment;
  readonly workspace: StoryWorkspace;
}

const globalRuntime = globalThis as typeof globalThis & {
  __infiniteLitrpgWorkspaceRuntime?: Promise<StoryRuntime>;
};

export function getStoryRuntime(): Promise<StoryRuntime> {
  if (globalRuntime.__infiniteLitrpgWorkspaceRuntime) {
    return globalRuntime.__infiniteLitrpgWorkspaceRuntime;
  }

  const runtime = initializeRuntime().catch((error: unknown) => {
    delete globalRuntime.__infiniteLitrpgWorkspaceRuntime;
    throw error;
  });
  globalRuntime.__infiniteLitrpgWorkspaceRuntime = runtime;
  return runtime;
}

async function initializeRuntime(): Promise<StoryRuntime> {
  const environment = getServerEnvironment();
  const root = process.cwd().replace(/[\\/]app$/u, "");
  const storiesDirectory = resolve(root, "stories");
  mkdirSync(storiesDirectory, { recursive: true });

  const client = new OpenAI({
    apiKey: environment.openAiApiKey ?? "not-configured",
  });
  const workspace = new StoryWorkspace({
    client,
    rootDirectory: storiesDirectory,
    serviceOptions: (story) => ({
      enforceNarrativeQuality: true,
      maxBackgroundAgents: environment.maxBackgroundAgents,
      maxCostUsdPerChapter: null,
      modelConfig: REVIEW_STORY_MODELS,
      nativeMultiAgent: environment.nativeMultiAgent,
      promptCacheKey: storyPromptCacheKey(story.id),
      serviceTier: "standard",
    }),
  });
  await migrateLegacyStoryDatabase(workspace, resolve(root, "data", "ashen-crown.db"));
  return { environment, workspace };
}

function storyPromptCacheKey(storyId: string): string {
  const digest = createHash("sha256").update(storyId).digest("hex").slice(0, 24);
  return `story:${digest}`;
}
