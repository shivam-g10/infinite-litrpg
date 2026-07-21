import { CHARACTER_IDS } from "@infinite-litrpg/shared";

import { getStoryRuntime } from "@/server/story/runtime";
import { defaultStoryTitle, storyEnvelope, storyErrorResponse } from "@/server/story/story-http";
import { StoryServiceError } from "@/server/story/story-service";

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
      const result = await runtime.workspace.createStory({
        povCharacterId: command.povCharacterId,
        title:
          command.title ??
          defaultStoryTitle(command.povCharacterId, runtime.workspace.listStories().length),
      });
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
      readonly povCharacterId: (typeof CHARACTER_IDS)[number];
      readonly title?: string;
      readonly type: "create";
    }
  | { readonly storyId: string; readonly type: "activate" | "reject" | "reopen" | "restart" };

function parseCommand(value: unknown): StoryLifecycleCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new StoryServiceError("Request body is invalid");
  }
  if (value.type === "create") {
    requireAllowedKeys(value, ["povCharacterId", "title", "type"]);
    if (
      typeof value.povCharacterId !== "string" ||
      !CHARACTER_IDS.includes(value.povCharacterId as (typeof CHARACTER_IDS)[number])
    ) {
      throw new StoryServiceError("Unknown viewpoint character");
    }
    const title = value.title === undefined ? undefined : parseTitle(value.title);
    return {
      povCharacterId: value.povCharacterId as (typeof CHARACTER_IDS)[number],
      ...(title === undefined ? {} : { title }),
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

function requireAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new StoryServiceError("Request contains unsupported fields");
  }
  if (!Object.hasOwn(value, "povCharacterId") || !Object.hasOwn(value, "type")) {
    throw new StoryServiceError("Request body is invalid");
  }
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
