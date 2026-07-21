"use client";

import { DEMO_CHAPTER_LIMIT } from "@infinite-litrpg/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { StorySetupCreator, type StorySetupSubmission } from "./story-setup";
import { StoryShell, type StoryCommand } from "./story-shell";
import {
  errorMessageFromPayload,
  normalizeReaderChapterPayload,
  normalizeStoryEnvelope,
  type ReaderChapterView,
  type StoryGenerationView,
  type StoryLibraryView,
  type StoryView,
} from "./story-types";

interface StoryAppProps {
  readonly apiKeyConfigured: boolean;
}

type RequestDescriptor =
  | { readonly kind: "load" }
  | { readonly kind: "poll" }
  | { readonly kind: "create"; readonly submission: StorySetupSubmission }
  | {
      readonly command: {
        readonly storyId: string;
        readonly type: "activate" | "reject" | "reopen" | "restart";
      };
      readonly kind: "library";
      readonly openPickerAfter?: boolean;
    }
  | {
      readonly command: StoryCommand & {
        readonly expectedWorldVersion: number;
        readonly requestId: string;
      };
      readonly kind: "command";
    };

type BusyState = "library" | "loading" | "locking" | "turn" | null;
const EMPTY_LIBRARY: StoryLibraryView = { activeStoryId: null, stories: [] };

async function readPayload(
  response: Response,
  onChunk?: (chunk: string) => void,
  onStatus?: (generation: StoryGenerationView) => void,
): Promise<unknown> {
  if (response.headers.get("content-type")?.includes("application/x-ndjson")) {
    return readStoryStream(response, onChunk, onStatus);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Story server returned unreadable data.");
  }
}

export async function readStoryStream(
  response: Response,
  onChunk?: (chunk: string) => void,
  onStatus?: (generation: StoryGenerationView) => void,
): Promise<unknown> {
  if (!response.body) throw new Error("Story stream had no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
    if (event.type === "status") {
      if (event.status === "generating") return;
      if (isRecord(event.generation)) {
        const phase = event.generation.phase;
        const mode = event.generation.mode;
        const storyId = event.generation.storyId;
        const targetChapter = event.generation.targetChapter;
        if (
          typeof storyId !== "string" ||
          typeof targetChapter !== "number" ||
          (mode !== "generate" && mode !== "rewrite") ||
          !["preparing", "characters", "writing", "checking", "saving"].includes(String(phase))
        )
          throw new Error("Story stream status was invalid.");
        onStatus?.({ mode, phase: phase as StoryGenerationView["phase"], storyId, targetChapter });
        return;
      }
      throw new Error("Story stream status was invalid.");
    }
    if (event.type === "heartbeat") return;
    if (event.type === "story") {
      result = {
        generation: event.generation,
        generations: event.generations,
        library: event.library,
        story: event.story,
        storyId: event.storyId,
        warnings: event.warnings,
      };
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

export function StoryApp({ apiKeyConfigured }: StoryAppProps) {
  const [story, setStory] = useState<StoryView | null>(null);
  const [library, setLibrary] = useState<StoryLibraryView>(EMPTY_LIBRARY);
  const [libraryWarnings, setLibraryWarnings] = useState<readonly string[]>([]);
  const [showStoryPicker, setShowStoryPicker] = useState(false);
  const [receivedProse, setReceivedProse] = useState(false);
  const [busy, setBusy] = useState<BusyState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [chapterSource, setChapterSource] = useState<"live" | "local">("local");
  const [reviewedChapter, setReviewedChapter] = useState<ReaderChapterView | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [automaticRun, setAutomaticRun] = useState(false);
  const [automaticRunPaused, setAutomaticRunPaused] = useState(false);
  const [generationChapter, setGenerationChapter] = useState<number | null>(null);
  const [generationMode, setGenerationMode] = useState<"generate" | "rewrite">("generate");
  const [serverGenerations, setServerGenerations] = useState<readonly StoryGenerationView[]>([]);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [failedRequestKind, setFailedRequestKind] = useState<RequestDescriptor["kind"] | null>(
    null,
  );
  const lastRequest = useRef<RequestDescriptor>({ kind: "load" });
  const automaticRunActive = useRef(false);
  const stopRequestedRef = useRef(false);
  const chapterCache = useRef(new Map<number, ReaderChapterView>());
  const chapterReviewController = useRef<AbortController | null>(null);
  const activeStoryId = useRef<string | null>(null);

  const performRequest = useCallback(async (request: RequestDescriptor, signal?: AbortSignal) => {
    if (request.kind !== "poll") lastRequest.current = request;
    const keepReaderPosition =
      request.kind === "poll" || (request.kind === "command" && automaticRunActive.current);
    if (!keepReaderPosition) {
      chapterReviewController.current?.abort();
      chapterReviewController.current = null;
      setReviewBusy(false);
    }
    if (request.kind !== "poll") {
      setError(null);
      setFailedRequestKind(null);
    }
    if (request.kind === "command") setReceivedProse(false);

    const init: RequestInit =
      request.kind === "load" || request.kind === "poll"
        ? { cache: "no-store", method: "GET", ...(signal ? { signal } : {}) }
        : {
            body: JSON.stringify(
              request.kind === "create"
                ? { ...request.submission, type: "create" }
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
      const endpoint =
        request.kind === "create" || request.kind === "library" ? "/api/stories" : "/api/story";
      const response = await fetch(endpoint, init);
      const payload = await readPayload(
        response,
        request.kind === "command" ? () => setReceivedProse(true) : undefined,
        request.kind === "command"
          ? (generation) =>
              setServerGenerations((current) => [
                ...current.filter(({ storyId }) => storyId !== generation.storyId),
                generation,
              ])
          : undefined,
      );
      if (!response.ok) {
        throw new Error(
          errorMessageFromPayload(payload, `Story request failed (${response.status}).`),
        );
      }

      const envelope = normalizeStoryEnvelope(payload);
      const resultStory = envelope.story;
      const responseMatchesActive = envelope.storyId === envelope.library.activeStoryId;
      const nextStory = resultStory;
      if (
        (request.kind === "create" ||
          (request.kind === "library" && request.command.type !== "reject")) &&
        !nextStory
      ) {
        throw new Error("Story server did not return the active story.");
      }
      const storyChanged = activeStoryId.current !== envelope.library.activeStoryId;
      activeStoryId.current = envelope.library.activeStoryId;
      if (storyChanged) {
        chapterReviewController.current?.abort();
        chapterReviewController.current = null;
        chapterCache.current.clear();
        setReviewedChapter(null);
        setReviewBusy(false);
        setReviewError(null);
        setRunMessage(null);
        setAutomaticRunPaused(false);
      }
      if (responseMatchesActive) setStory(resultStory);
      setServerGenerations(envelope.generations);
      if (envelope.generation !== null) {
        setGenerationChapter(envelope.generation.targetChapter);
        setGenerationMode(envelope.generation.mode);
      } else if (request.kind === "poll") {
        setGenerationChapter(null);
      }
      setLibrary(envelope.library);
      setLibraryWarnings(envelope.warnings.map(({ message }) => message));
      setReceivedProse(false);
      if (!keepReaderPosition && !storyChanged) {
        setReviewedChapter(null);
        setReviewError(null);
      }
      if (request.kind === "create") setShowStoryPicker(false);
      if (request.kind === "library") setShowStoryPicker(Boolean(request.openPickerAfter));
      if (request.kind !== "poll") {
        setChapterSource(request.kind === "command" ? "live" : "local");
      }
      if (nextStory?.chapter && nextStory.world.chapter > 0) {
        chapterCache.current.set(nextStory.world.chapter, {
          chapter: nextStory.world.chapter,
          prose: nextStory.chapter.prose,
          title: nextStory.chapter.title,
        });
      }
      return { library: envelope.library, ok: true as const, story: resultStory };
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        return { aborted: true as const, ok: false as const };
      }
      if (request.kind !== "poll") {
        setReceivedProse(false);
        setFailedRequestKind(request.kind);
        setError(requestError instanceof Error ? requestError.message : "Story request failed.");
      }
      return { aborted: false as const, ok: false as const };
    }
  }, []);

  const runRequest = useCallback(
    async (request: RequestDescriptor, signal?: AbortSignal) => {
      setBusy(
        request.kind === "load"
          ? "loading"
          : request.kind === "create"
            ? "locking"
            : request.kind === "library"
              ? "library"
              : "turn",
      );
      if (request.kind === "command") setRunMessage(null);
      try {
        return await performRequest(request, signal);
      } finally {
        if (!signal?.aborted) {
          setBusy(null);
          if (request.kind !== "load" && request.kind !== "poll") setGenerationChapter(null);
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

  useEffect(() => {
    if (serverGenerations.length === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await performRequest({ kind: "poll" });
      if (!stopped) timer = setTimeout(() => void poll(), 2_000);
    };
    timer = setTimeout(() => void poll(), 2_000);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [performRequest, serverGenerations.length]);

  const retry = useCallback(() => {
    if (story?.world.chapter === 0) {
      const openingChoice =
        story.chapter?.choices.find(({ id }) => id === "choice-1") ?? story.chapter?.choices[0];
      if (!openingChoice) {
        setError("Opening action is missing. Restart this story from the library.");
        return;
      }
      setGenerationMode("generate");
      setGenerationChapter(1);
      void runRequest({
        command: {
          choiceId: openingChoice.id,
          expectedWorldVersion: story.world.version,
          requestId: crypto.randomUUID(),
          type: "take_action",
        },
        kind: "command",
      });
      return;
    }
    const request = lastRequest.current;
    if (request.kind === "command" && story) {
      const rewriting = request.command.type === "reroll_latest";
      setGenerationMode(rewriting ? "rewrite" : "generate");
      setGenerationChapter(rewriting ? story.world.chapter : story.world.chapter + 1);
    }
    void runRequest(request);
  }, [runRequest, story]);

  const startNewStory = useCallback(() => {
    setError(null);
    setFailedRequestKind(null);
    setShowStoryPicker(true);
  }, []);

  const createStoryAndOpening = useCallback(
    async (submission: StorySetupSubmission) => {
      setBusy("locking");
      const created = await performRequest({ kind: "create", submission });
      if (!created.ok || !created.story || !created.library.activeStoryId) {
        setBusy(null);
        return;
      }
      const openingChoice =
        created.story.chapter?.choices.find(({ id }) => id === "choice-1") ??
        created.story.chapter?.choices[0];
      if (!openingChoice) {
        setBusy(null);
        setFailedRequestKind("create");
        setError("Story was saved, but its opening action is missing.");
        return;
      }

      const generation = {
        mode: "generate",
        phase: "preparing",
        storyId: created.library.activeStoryId,
        targetChapter: 1,
      } as const;
      setServerGenerations((current) => [
        ...current.filter(({ storyId }) => storyId !== generation.storyId),
        generation,
      ]);
      setGenerationMode("generate");
      setGenerationChapter(1);
      setBusy("turn");
      try {
        await performRequest({
          command: {
            choiceId: openingChoice.id,
            expectedWorldVersion: created.story.world.version,
            requestId: crypto.randomUUID(),
            type: "take_action",
          },
          kind: "command",
        });
      } finally {
        setBusy(null);
      }
    },
    [performRequest],
  );

  const runLibraryCommand = useCallback(
    (
      type: "activate" | "reject" | "reopen" | "restart",
      storyId: string,
      openPickerAfter = false,
    ) => {
      void runRequest({
        command: { storyId, type },
        kind: "library",
        ...(openPickerAfter ? { openPickerAfter: true } : {}),
      });
    },
    [runRequest],
  );

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
    setGenerationMode("generate");
    if (!reviewedChapter && story.chapter) {
      const pinnedChapter = {
        chapter: story.world.chapter,
        prose: story.chapter.prose,
        title: story.chapter.title,
      };
      chapterCache.current.set(pinnedChapter.chapter, pinnedChapter);
      setReviewedChapter(pinnedChapter);
    }
    setAutomaticRun(true);
    setAutomaticRunPaused(false);
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
        const currentStoryId = library.activeStoryId;
        if (currentStoryId) {
          setServerGenerations((generations) => [
            ...generations.filter(({ storyId }) => storyId !== currentStoryId),
            {
              mode: "generate",
              phase: "preparing",
              storyId: currentStoryId,
              targetChapter: nextChapter,
            },
          ]);
        }
        const result = await performRequest({
          command: {
            approvedThroughChapter,
            expectedWorldVersion: current.world.version,
            requestId: crypto.randomUUID(),
            type: "continue_story",
          },
          kind: "command",
        });
        if (!result.ok || !result.story) {
          setAutomaticRunPaused(true);
          setRunMessage(
            `Generation paused before chapter ${nextChapter}. Saved chapters are safe.`,
          );
          break;
        }
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
  }, [library.activeStoryId, performRequest, reviewedChapter, story]);

  const stopAfterCurrentChapter = useCallback(() => {
    if (!automaticRunActive.current) return;
    stopRequestedRef.current = true;
    setStopRequested(true);
  }, []);

  const reviewChapter = useCallback(
    async (chapterNumber: number) => {
      chapterReviewController.current?.abort();
      chapterReviewController.current = null;
      if (!story || chapterNumber === story.world.chapter) {
        setReviewedChapter(null);
        setReviewError(null);
        setReviewBusy(false);
        return;
      }
      if (!story.chapterHistory.some(({ chapter }) => chapter === chapterNumber)) {
        setReviewError("That chapter is not in this saved story.");
        setReviewBusy(false);
        return;
      }
      const cached = chapterCache.current.get(chapterNumber);
      if (cached) {
        setReviewedChapter(cached);
        setReviewError(null);
        setReviewBusy(false);
        return;
      }
      const storyId = library.activeStoryId;
      if (!storyId) {
        setReviewError("No active story is available.");
        setReviewBusy(false);
        return;
      }
      const controller = new AbortController();
      chapterReviewController.current = controller;
      setReviewBusy(true);
      setReviewError(null);
      try {
        const response = await fetch(
          `/api/story?chapter=${chapterNumber}&storyId=${encodeURIComponent(storyId)}`,
          {
            cache: "no-store",
            method: "GET",
            signal: controller.signal,
          },
        );
        const payload = await readPayload(response);
        if (!response.ok) {
          throw new Error(
            errorMessageFromPayload(payload, `Chapter request failed (${response.status}).`),
          );
        }
        const chapter = normalizeReaderChapterPayload(payload);
        if (chapter.chapter !== chapterNumber) {
          throw new Error("Saved chapter response did not match the requested chapter.");
        }
        if (chapterReviewController.current !== controller) return;
        chapterCache.current.set(chapter.chapter, chapter);
        setReviewedChapter(chapter);
      } catch (chapterError) {
        if (chapterError instanceof DOMException && chapterError.name === "AbortError") return;
        if (chapterReviewController.current !== controller) return;
        setReviewError(
          chapterError instanceof Error ? chapterError.message : "Saved chapter did not open.",
        );
      } finally {
        if (chapterReviewController.current === controller) {
          chapterReviewController.current = null;
          setReviewBusy(false);
        }
      }
    },
    [library.activeStoryId, story],
  );

  const latestRejectedStory = library.stories
    .filter(({ status }) => status === "rejected")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const savedStories = library.stories.filter(
    ({ id, status }) => status === "active" && (!story || id !== library.activeStoryId),
  );

  if (busy === "loading" && !story && !error) {
    return (
      <main className="loading-screen" role="status">
        <span aria-hidden="true" className="loading-rune">
          ᚱ
        </span>
        <p>Opening your story library…</p>
      </main>
    );
  }

  if (!story && error && failedRequestKind === "load") {
    return (
      <main className="error-screen">
        <span aria-hidden="true" className="error-mark">
          !
        </span>
        <h1>Your story library did not open.</h1>
        <p role="alert">{error}</p>
        <button onClick={retry} type="button">
          Retry
        </button>
      </main>
    );
  }

  if (!story || showStoryPicker) {
    return (
      <StorySetupCreator
        busy={busy === "locking" || busy === "library"}
        error={error}
        {...(story && showStoryPicker
          ? { onCancel: () => setShowStoryPicker(false) }
          : !story && latestRejectedStory
            ? { onCancel: () => runLibraryCommand("reopen", latestRejectedStory.id) }
            : {})}
        onCreate={(submission) => void createStoryAndOpening(submission)}
        onOpenStory={(storyId) => runLibraryCommand("activate", storyId)}
        savedStories={savedStories}
      />
    );
  }

  const activeStory = library.stories.find(({ id }) => id === library.activeStoryId);
  if (!activeStory) {
    return (
      <main className="error-screen">
        <span aria-hidden="true" className="error-mark">
          !
        </span>
        <h1>Story library is out of sync.</h1>
        <button onClick={() => void runRequest({ kind: "load" })} type="button">
          Reload library
        </button>
      </main>
    );
  }
  const activeGeneration =
    serverGenerations.find(({ storyId }) => storyId === activeStory.id) ?? null;

  return (
    <StoryShell
      activeStory={activeStory}
      apiKeyConfigured={apiKeyConfigured}
      automaticRun={automaticRun}
      automaticRunPaused={automaticRunPaused}
      busy={activeGeneration !== null}
      chapterSource={chapterSource}
      error={failedRequestKind === "command" ? error : null}
      generationChapter={generationChapter ?? activeGeneration?.targetChapter ?? null}
      generationMode={activeGeneration?.mode ?? generationMode}
      generationPhase={activeGeneration?.phase ?? "preparing"}
      generations={serverGenerations}
      key={activeStory.id}
      libraryBusy={busy === "library" || busy === "locking"}
      libraryError={failedRequestKind === "library" ? error : null}
      libraryWarnings={libraryWarnings}
      onActivateStory={(storyId) => runLibraryCommand("activate", storyId)}
      onCommand={(command) => {
        setAutomaticRunPaused(false);
        const rewriting = command.type === "reroll_latest";
        setGenerationMode(rewriting ? "rewrite" : "generate");
        setGenerationChapter(rewriting ? story.world.chapter : story.world.chapter + 1);
        const currentStoryId = library.activeStoryId;
        if (currentStoryId) {
          setServerGenerations((generations) => [
            ...generations.filter(({ storyId }) => storyId !== currentStoryId),
            {
              mode: rewriting ? "rewrite" : "generate",
              phase: rewriting ? "writing" : "preparing",
              storyId: currentStoryId,
              targetChapter: rewriting ? story.world.chapter : story.world.chapter + 1,
            },
          ]);
        }
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
      onNewStory={startNewStory}
      onReopenStory={(storyId) => runLibraryCommand("reopen", storyId)}
      onReviewChapter={(chapter) => void reviewChapter(chapter)}
      onRestartStory={(storyId) => runLibraryCommand("restart", storyId)}
      onRetry={retry}
      onStop={stopAfterCurrentChapter}
      onTryAnother={(storyId) => runLibraryCommand("reject", storyId, true)}
      receivedProse={receivedProse}
      reviewBusy={reviewBusy}
      reviewError={reviewError}
      reviewedChapter={reviewedChapter}
      runMessage={runMessage}
      stories={library.stories}
      story={story}
      stopRequested={stopRequested}
    />
  );
}
