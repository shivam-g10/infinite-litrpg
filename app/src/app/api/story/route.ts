import { CHARACTER_IDS, DEMO_CHAPTER_LIMIT } from "@infinite-litrpg/shared";

import { getServerEnvironment, redactSecret } from "@/server/env";
import { OpenAIRuntimeError } from "@/server/openai";
import { InvalidCommitError, StaleWorldVersionError } from "@/server/storage/story-store";
import { getStoryRuntime } from "@/server/story/runtime";
import { StoryServiceError, type TurnCommand } from "@/server/story/story-service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const chapter = new URL(request.url).searchParams.get("chapter");
    const service = getStoryRuntime().service;
    return chapter === null
      ? Response.json({ story: service.getStory() })
      : Response.json({ chapter: service.getReaderChapter(parseReaderChapterNumber(chapter)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const command = parseCommand(await request.json());
    const runtime = getStoryRuntime();
    if (command.type === "select_pov") {
      return Response.json({ story: runtime.service.selectPov(command.povCharacterId) });
    }
    requireApiKey(runtime.environment.openAiApiKey);
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return streamTurn(runtime.service, command);
    }
    const story = await runtime.service.takeTurn(command);
    return Response.json({ story });
  } catch (error) {
    return errorResponse(error);
  }
}

function requireApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey?.trim()) {
    throw new StoryServiceError("OPENAI_API_KEY is not configured", 503);
  }
}

function streamTurn(
  service: ReturnType<typeof getStoryRuntime>["service"],
  command: TurnCommand,
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
          const story = await service.takeTurn(command, (text) => {
            if (!cancelled && !enqueue(controller, encoder, { text, type: "chunk" })) {
              cancelled = true;
            }
          });
          if (!cancelled && !enqueue(controller, encoder, { story, type: "story" })) {
            cancelled = true;
          }
        } catch (error) {
          if (!cancelled) {
            const descriptor = describeError(error);
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
  | TurnCommand;

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
  throw new StoryServiceError("Unknown command type");
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

function errorResponse(error: unknown): Response {
  const descriptor = describeError(error);
  return Response.json(descriptor.body, { status: descriptor.status });
}

function describeError(error: unknown): {
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
  if (error instanceof InvalidCommitError) {
    return {
      body: { code: "INVALID_COMMIT", error: "Atomic commit rejected invalid output" },
      status: 500,
    };
  }
  return { body: { code: "INTERNAL_ERROR", error: "Story server failed safely" }, status: 500 };
}
