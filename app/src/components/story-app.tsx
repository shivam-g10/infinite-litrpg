"use client";

import {
  DEMO_CHAPTER_LIMIT,
  type CharacterId,
  type PublicCharacterProfile,
} from "@infinite-litrpg/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { CharacterSelection } from "./character-selection";
import { StoryShell, type StoryCommand } from "./story-shell";
import { errorMessageFromPayload, normalizeStoryPayload, type StoryView } from "./story-types";

interface StoryAppProps {
  readonly characters: readonly PublicCharacterProfile[];
}

type RequestDescriptor =
  | { readonly kind: "load" }
  | { readonly characterId: CharacterId; readonly kind: "lock" }
  | {
      readonly command: StoryCommand & {
        readonly expectedWorldVersion: number;
        readonly requestId: string;
      };
      readonly kind: "command";
    };

type BusyState = "loading" | "locking" | "turn" | null;
const MAX_STREAM_BYTES = 1_000_000;

async function readPayload(
  response: Response,
  onChunk?: (chunk: string) => void,
): Promise<unknown> {
  if (response.headers.get("content-type")?.includes("application/x-ndjson")) {
    return readStoryStream(response, onChunk);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Story server returned unreadable data.");
  }
}

async function readStoryStream(
  response: Response,
  onChunk?: (chunk: string) => void,
): Promise<unknown> {
  if (!response.body) throw new Error("Story stream had no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let result: unknown;
  let sawStory = false;

  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      throw new Error("Story stream returned unreadable data.");
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      throw new Error("Story stream returned an invalid event.");
    }
    if (event.type === "chunk") {
      if (typeof event.text !== "string") throw new Error("Story stream chunk was invalid.");
      onChunk?.(event.text);
      return;
    }
    if (event.type === "story") {
      result = { story: event.story };
      sawStory = true;
      return;
    }
    if (event.type === "error") {
      throw new Error(
        typeof event.error === "string" ? event.error : "Story stream failed safely.",
      );
    }
    throw new Error("Story stream returned an unknown event.");
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_STREAM_BYTES) throw new Error("Story stream exceeded its safe size.");
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  buffer += decoder.decode();
  consume(buffer);
  if (!sawStory) throw new Error("Story stream ended before the committed world arrived.");
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function StoryApp({ characters }: StoryAppProps) {
  const [story, setStory] = useState<StoryView | null>(null);
  const [streamedProse, setStreamedProse] = useState("");
  const [busy, setBusy] = useState<BusyState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [automaticRun, setAutomaticRun] = useState(false);
  const [generationChapter, setGenerationChapter] = useState<number | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [failedRequestKind, setFailedRequestKind] = useState<RequestDescriptor["kind"] | null>(
    null,
  );
  const lastRequest = useRef<RequestDescriptor>({ kind: "load" });
  const automaticRunActive = useRef(false);
  const stopRequestedRef = useRef(false);

  const performRequest = useCallback(async (request: RequestDescriptor, signal?: AbortSignal) => {
    lastRequest.current = request;
    setError(null);
    setFailedRequestKind(null);
    if (request.kind === "command") setStreamedProse("");

    const init: RequestInit =
      request.kind === "load"
        ? { cache: "no-store", method: "GET", ...(signal ? { signal } : {}) }
        : {
            body: JSON.stringify(
              request.kind === "lock"
                ? { povCharacterId: request.characterId, type: "select_pov" }
                : request.command,
            ),
            headers: {
              ...(request.kind === "command" ? { Accept: "application/x-ndjson" } : {}),
              "Content-Type": "application/json",
            },
            method: "POST",
            ...(signal ? { signal } : {}),
          };

    try {
      const response = await fetch("/api/story", init);
      const payload = await readPayload(
        response,
        request.kind === "command"
          ? (chunk) => setStreamedProse((prose) => prose + chunk)
          : undefined,
      );
      if (!response.ok) {
        throw new Error(
          errorMessageFromPayload(payload, `Story request failed (${response.status}).`),
        );
      }

      const nextStory = normalizeStoryPayload(payload);
      if (request.kind !== "load" && !nextStory) {
        throw new Error("Story server did not return the locked world.");
      }
      setStory(nextStory);
      setStreamedProse("");
      return { ok: true as const, story: nextStory };
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        return { aborted: true as const, ok: false as const };
      }
      setStreamedProse("");
      setFailedRequestKind(request.kind);
      setError(requestError instanceof Error ? requestError.message : "Story request failed.");
      return { aborted: false as const, ok: false as const };
    }
  }, []);

  const runRequest = useCallback(
    async (request: RequestDescriptor, signal?: AbortSignal) => {
      setBusy(request.kind === "load" ? "loading" : request.kind === "lock" ? "locking" : "turn");
      if (request.kind === "command") setRunMessage(null);
      try {
        return await performRequest(request, signal);
      } finally {
        if (!signal?.aborted) {
          setBusy(null);
          setGenerationChapter(null);
        }
      }
    },
    [performRequest],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void runRequest({ kind: "load" }, controller.signal));
    return () => controller.abort();
  }, [runRequest]);

  const retry = useCallback(() => {
    void runRequest(lastRequest.current);
  }, [runRequest]);

  const continueToDecision = useCallback(async () => {
    if (
      automaticRunActive.current ||
      !story?.continuationPlan ||
      story.world.chapter >= DEMO_CHAPTER_LIMIT ||
      story.world.terminal
    ) {
      return;
    }
    automaticRunActive.current = true;
    stopRequestedRef.current = false;
    setAutomaticRun(true);
    setStopRequested(false);
    setRunMessage(null);
    setBusy("turn");
    let current = story;
    const approvedThroughChapter = story.continuationPlan.endChapter;
    try {
      while (
        current.continuationPlan?.endChapter === approvedThroughChapter &&
        current.world.chapter < approvedThroughChapter &&
        !current.world.terminal
      ) {
        const nextChapter = current.world.chapter + 1;
        setGenerationChapter(nextChapter);
        const result = await performRequest({
          command: {
            approvedThroughChapter,
            expectedWorldVersion: current.world.version,
            requestId: crypto.randomUUID(),
            type: "continue_story",
          },
          kind: "command",
        });
        if (!result.ok || !result.story) break;
        current = result.story;
        if (stopRequestedRef.current) {
          setRunMessage(`Stopped after chapter ${current.world.chapter}.`);
          break;
        }
        if (current.world.chapter >= approvedThroughChapter) {
          if (approvedThroughChapter < DEMO_CHAPTER_LIMIT) {
            setRunMessage(`Decision ready at chapter ${current.world.chapter}.`);
            break;
          }
          setRunMessage(`Chapter ${DEMO_CHAPTER_LIMIT} is ready for review.`);
          break;
        }
        if (!current.continuationPlan) {
          setRunMessage(`Decision ready at chapter ${current.world.chapter}.`);
          break;
        }
        if (current.continuationPlan.endChapter !== approvedThroughChapter) {
          setRunMessage("Stopped because the continuation plan changed.");
          break;
        }
      }
    } finally {
      automaticRunActive.current = false;
      stopRequestedRef.current = false;
      setAutomaticRun(false);
      setStopRequested(false);
      setBusy(null);
      setGenerationChapter(null);
    }
  }, [performRequest, story]);

  const stopAfterCurrentChapter = useCallback(() => {
    if (!automaticRunActive.current) return;
    stopRequestedRef.current = true;
    setStopRequested(true);
  }, []);

  if (busy === "loading" && !story && !error) {
    return (
      <main className="loading-screen" role="status">
        <span aria-hidden="true" className="loading-rune">
          ᚱ
        </span>
        <p>Opening Ashen Crown…</p>
      </main>
    );
  }

  if (!story && error && failedRequestKind === "load") {
    return (
      <main className="error-screen">
        <span aria-hidden="true" className="error-mark">
          !
        </span>
        <h1>Ashen Crown did not open.</h1>
        <p role="alert">{error}</p>
        <button onClick={retry} type="button">
          Retry
        </button>
      </main>
    );
  }

  if (!story) {
    return (
      <CharacterSelection
        busy={busy === "locking"}
        characters={characters}
        error={error}
        onLock={(characterId) => void runRequest({ characterId, kind: "lock" })}
        onRetry={retry}
      />
    );
  }

  return (
    <StoryShell
      busy={busy === "turn"}
      automaticRun={automaticRun}
      error={error}
      generationChapter={generationChapter}
      onCommand={(command) => {
        setGenerationChapter(story.world.chapter + 1);
        void runRequest({
          command: {
            ...command,
            expectedWorldVersion: story.world.version,
            requestId: crypto.randomUUID(),
          },
          kind: "command",
        });
      }}
      onContinue={() => void continueToDecision()}
      onRetry={retry}
      onStop={stopAfterCurrentChapter}
      runMessage={runMessage}
      story={story}
      stopRequested={stopRequested}
      streamedProse={streamedProse}
    />
  );
}
