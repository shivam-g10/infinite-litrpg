import "server-only";

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import OpenAI from "openai";

import { getServerEnvironment, type ServerEnvironment } from "../env";
import { StoryStore } from "../storage/story-store";
import { StoryService } from "./story-service";

interface StoryRuntime {
  readonly environment: ServerEnvironment;
  readonly service: StoryService;
}

const globalRuntime = globalThis as typeof globalThis & {
  __infiniteLitrpgRuntime?: StoryRuntime;
};

export function getStoryRuntime(): StoryRuntime {
  if (globalRuntime.__infiniteLitrpgRuntime) return globalRuntime.__infiniteLitrpgRuntime;

  const environment = getServerEnvironment();
  const root = process.cwd().replace(/[\\/]app$/u, "");
  const dataDirectory = resolve(root, "data");
  mkdirSync(dataDirectory, { recursive: true });

  const store = new StoryStore(resolve(dataDirectory, "ashen-crown.db"));
  const client = new OpenAI({
    apiKey: environment.openAiApiKey ?? "not-configured",
  });
  const service = new StoryService(store, client, {
    maxBackgroundAgents: environment.maxBackgroundAgents,
    maxCostUsdPerChapter: environment.maxCostUsdPerChapter,
    nativeMultiAgent: environment.nativeMultiAgent,
    serviceTier: "standard",
  });

  const runtime = { environment, service };
  globalRuntime.__infiniteLitrpgRuntime = runtime;
  return runtime;
}
