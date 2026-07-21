import {
  CHARACTER_IDS,
  GENERATED_PROTAGONIST_ID,
  StorySetupSchema,
  type StorySetup,
} from "@infinite-litrpg/shared";

import { getStoryRuntime } from "@/server/story/runtime";
import { storyEnvelope, storyErrorResponse } from "@/server/story/story-http";
import { StoryServiceError } from "@/server/story/story-service";
import { streamStoryOperation } from "../story/route";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runtime = await getStoryRuntime();
    return Response.json(storyEnvelope(runtime, await runtime.workspace.getActiveStory()));
  } catch (error) {
    return storyErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const command = parseCommand(await request.json());
    const runtime = await getStoryRuntime();

    if (command.type === "create") {
      requireApiKey(runtime.environment.openAiApiKey);
      const create = (
        onChunk?: (text: string) => void,
        onProgress?: Parameters<typeof runtime.workspace.createStory>[2],
      ) =>
        runtime.workspace.createStory(
          {
            povCharacterId: command.povCharacterId,
            requestId: command.requestId,
            setup: command.setup,
            title: command.title,
          },
          onChunk,
          onProgress,
        );
      if (request.headers.get("accept")?.includes("application/x-ndjson")) {
        return streamStoryOperation(runtime, (onChunk, onProgress) => create(onChunk, onProgress));
      }
      const result = await create();
      return Response.json(storyEnvelope(runtime, result));
    }

    if (command.type === "activate" || command.type === "reopen") {
      const result = await runtime.workspace.activateStory(command.storyId);
      return Response.json(storyEnvelope(runtime, result));
    }

    if (command.type === "restart") {
      const result = await runtime.workspace.restartStory(command.storyId);
      return Response.json(storyEnvelope(runtime, result.replacement));
    }

    await runtime.workspace.rejectStory(command.storyId);
    return Response.json(storyEnvelope(runtime, await runtime.workspace.getActiveStory()));
  } catch (error) {
    return storyErrorResponse(error);
  }
}

type StoryLifecycleCommand =
  | {
      readonly povCharacterId: typeof GENERATED_PROTAGONIST_ID;
      readonly requestId: string;
      readonly setup: StorySetup;
      readonly title: string;
      readonly type: "create";
    }
  | { readonly storyId: string; readonly type: "activate" | "reject" | "reopen" | "restart" };

function parseCommand(value: unknown): StoryLifecycleCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new StoryServiceError("Request body is invalid");
  }
  if (value.type === "create") {
    requireExactKeys(value, ["povCharacterId", "requestId", "setup", "title", "type"]);
    if (
      typeof value.povCharacterId !== "string" ||
      (value.povCharacterId !== GENERATED_PROTAGONIST_ID &&
        !CHARACTER_IDS.includes(value.povCharacterId as (typeof CHARACTER_IDS)[number]))
    ) {
      throw new StoryServiceError("Unknown viewpoint character");
    }
    const setup = StorySetupSchema.safeParse(value.setup);
    if (!setup.success) {
      throw new StoryServiceError("Story setup is invalid");
    }
    if (typeof value.requestId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/u.test(value.requestId)) {
      throw new StoryServiceError("requestId is invalid");
    }
    return {
      povCharacterId: GENERATED_PROTAGONIST_ID,
      requestId: value.requestId,
      setup: setup.data,
      title: parseTitle(value.title),
      type: "create",
    };
  }
  if (["activate", "reject", "reopen", "restart"].includes(value.type)) {
    requireExactKeys(value, ["storyId", "type"]);
    if (typeof value.storyId !== "string") throw new StoryServiceError("Story ID is required");
    return {
      storyId: value.storyId,
      type: value.type as "activate" | "reject" | "reopen" | "restart",
    };
  }
  throw new StoryServiceError("Unknown story command");
}

function requireApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey?.trim()) throw new StoryServiceError("OPENAI_API_KEY is not configured", 503);
}

function parseTitle(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 100 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new StoryServiceError("Story title must be 1 to 100 single-line characters");
  }
  return value;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new StoryServiceError("Request contains unsupported fields");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
