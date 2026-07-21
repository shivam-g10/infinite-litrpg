import { CHARACTER_IDS, DEMO_CHAPTER_LIMIT } from "@infinite-litrpg/shared";

import { getStoryRuntime, type StoryRuntime } from "@/server/story/runtime";
import {
  defaultStoryTitle,
  describeStoryError,
  storyEnvelope,
  storyErrorResponse,
} from "@/server/story/story-http";
import {
  StoryServiceError,
  type RerollLatestCommand,
  type TurnCommand,
} from "@/server/story/story-service";
import type { WorkspaceStoryResult } from "@/server/story/story-workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const chapter = parameters.get("chapter");
    const runtime = await getStoryRuntime();
    if (chapter !== null) {
      const storyId = parameters.get("storyId") ?? requireActiveStoryId(runtime);
      return Response.json({
        chapter: await runtime.workspace.getReaderChapter(
          storyId,
          parseReaderChapterNumber(chapter),
        ),
      });
    }
    const result = await runtime.workspace.getActiveStory();
    return Response.json(storyEnvelope(runtime, result));
  } catch (error) {
    return storyErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const command = parseCommand(await request.json());
    const runtime = await getStoryRuntime();
    if (command.type === "select_pov") {
      const active = runtime.workspace.getActiveStoryMetadata();
      const result =
        active === null
          ? await runtime.workspace.createStory({
              povCharacterId: command.povCharacterId,
              title: defaultStoryTitle(
                command.povCharacterId,
                runtime.workspace.listStories().length,
              ),
            })
          : await requireMatchingActiveStory(
              runtime,
              active.povCharacterId,
              command.povCharacterId,
            );
      return Response.json(storyEnvelope(runtime, result));
    }
    requireApiKey(runtime.environment.openAiApiKey);
    const storyId = requireActiveStoryId(runtime);
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return streamTurn(runtime, storyId, command);
    }
    const result = await dispatchStoryCommand(runtime, storyId, command);
    return Response.json(storyEnvelope(runtime, result));
  } catch (error) {
    return storyErrorResponse(error);
  }
}

function requireApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey?.trim()) {
    throw new StoryServiceError("OPENAI_API_KEY is not configured", 503);
  }
}

function streamTurn(
  runtime: StoryRuntime,
  storyId: string,
  command: StoryMutationCommand,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    start(controller) {
      void (async () => {
        try {
          const result = await dispatchStoryCommand(runtime, storyId, command, (text) => {
            if (!cancelled && !enqueue(controller, encoder, { text, type: "chunk" })) {
              cancelled = true;
            }
          });
          if (
            !cancelled &&
            !enqueue(controller, encoder, { ...storyEnvelope(runtime, result), type: "story" })
          ) {
            cancelled = true;
          }
        } catch (error) {
          if (!cancelled) {
            const descriptor = describeStoryError(error);
            if (
              !enqueue(controller, encoder, {
                ...descriptor.body,
                status: descriptor.status,
                type: "error",
              })
            ) {
              cancelled = true;
            }
          }
        } finally {
          if (!cancelled) {
            try {
              controller.close();
            } catch {
              cancelled = true;
            }
          }
        }
      })();
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function enqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: Readonly<Record<string, unknown>>,
): boolean {
  try {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    return true;
  } catch {
    return false;
  }
}

type ApiCommand =
  | { readonly povCharacterId: (typeof CHARACTER_IDS)[number]; readonly type: "select_pov" }
  | StoryMutationCommand;

type StoryMutationCommand =
  TurnCommand | (RerollLatestCommand & { readonly type: "reroll_latest" });

function parseCommand(value: unknown): ApiCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new StoryServiceError("Request body is invalid");
  }
  if (value.type === "select_pov") {
    requireExactKeys(value, ["povCharacterId", "type"]);
    if (
      typeof value.povCharacterId !== "string" ||
      !CHARACTER_IDS.includes(value.povCharacterId as (typeof CHARACTER_IDS)[number])
    ) {
      throw new StoryServiceError("Unknown viewpoint character");
    }
    return {
      povCharacterId: value.povCharacterId as (typeof CHARACTER_IDS)[number],
      type: "select_pov",
    };
  }
  if (value.type === "take_action") {
    requireExactKeys(value, ["choiceId", "expectedWorldVersion", "requestId", "type"]);
    if (typeof value.choiceId !== "string" || value.choiceId.length < 1) {
      throw new StoryServiceError("Choice ID is required");
    }
    return {
      choiceId: value.choiceId,
      expectedWorldVersion: parseWorldVersion(value.expectedWorldVersion),
      requestId: parseRequestId(value.requestId),
      type: "take_action",
    };
  }
  if (value.type === "custom_action") {
    requireExactKeys(value, ["description", "expectedWorldVersion", "requestId", "type"]);
    if (typeof value.description !== "string") {
      throw new StoryServiceError("Custom action description is required");
    }
    return {
      description: value.description,
      expectedWorldVersion: parseWorldVersion(value.expectedWorldVersion),
      requestId: parseRequestId(value.requestId),
      type: "custom_action",
    };
  }
  if (value.type === "continue_story") {
    requireExactKeys(value, [
      "approvedThroughChapter",
      "expectedWorldVersion",
      "requestId",
      "type",
    ]);
    return {
      approvedThroughChapter: parseApprovedChapter(value.approvedThroughChapter),
      expectedWorldVersion: parseWorldVersion(value.expectedWorldVersion),
      requestId: parseRequestId(value.requestId),
      type: "continue_story",
    };
  }
  if (value.type === "reroll_latest") {
    requireExactKeys(value, ["expectedWorldVersion", "requestId", "type"]);
    return {
      expectedWorldVersion: parseWorldVersion(value.expectedWorldVersion),
      requestId: parseRequestId(value.requestId),
      type: "reroll_latest",
    };
  }
  throw new StoryServiceError("Unknown command type");
}

async function dispatchStoryCommand(
  runtime: StoryRuntime,
  storyId: string,
  command: StoryMutationCommand,
  onNarrationChunk?: (chunk: string) => void | Promise<void>,
): Promise<WorkspaceStoryResult> {
  if (command.type === "reroll_latest") {
    return runtime.workspace.rerollLatest(
      storyId,
      {
        expectedWorldVersion: command.expectedWorldVersion,
        requestId: command.requestId,
      },
      onNarrationChunk,
    );
  }
  return runtime.workspace.takeTurn(storyId, command, onNarrationChunk);
}

function requireActiveStoryId(runtime: StoryRuntime): string {
  const active = runtime.workspace.getActiveStoryMetadata();
  if (active === null) throw new StoryServiceError("No active story exists", 404);
  return active.id;
}

async function requireMatchingActiveStory(
  runtime: StoryRuntime,
  activePovCharacterId: string,
  requestedPovCharacterId: string,
): Promise<WorkspaceStoryResult> {
  if (activePovCharacterId !== requestedPovCharacterId) {
    throw new StoryServiceError("Viewpoint is permanently locked for this story", 409);
  }
  const result = await runtime.workspace.getActiveStory();
  if (result === null) throw new StoryServiceError("No active story exists", 404);
  return result;
}

function parseApprovedChapter(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > DEMO_CHAPTER_LIMIT
  ) {
    throw new StoryServiceError("Approved continuation chapter is invalid");
  }
  return value as number;
}

function parseReaderChapterNumber(value: string): number {
  if (!/^\d{1,3}$/u.test(value)) {
    throw new StoryServiceError("Chapter number is invalid");
  }
  const chapter = Number(value);
  if (!Number.isSafeInteger(chapter) || chapter < 1 || chapter > DEMO_CHAPTER_LIMIT) {
    throw new StoryServiceError("Chapter number is invalid");
  }
  return chapter;
}

function parseWorldVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new StoryServiceError("Expected world version is invalid");
  }
  return value as number;
}

function parseRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new StoryServiceError("Request ID must be a UUID");
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
