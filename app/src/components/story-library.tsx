"use client";

import { useEffect, useRef, useState } from "react";

import type { StoryGenerationView, StorySummary } from "./story-types";

interface StoryLibraryProps {
  readonly activeStoryId: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly generations: readonly StoryGenerationView[];
  readonly onActivate: (storyId: string) => void;
  readonly onNewStory: () => void;
  readonly onReopen: (storyId: string) => void;
  readonly onRestart: (storyId: string) => void;
  readonly onRetry: () => void;
  readonly onTryAnother: (storyId: string) => void;
  readonly stories: readonly StorySummary[];
  readonly warnings: readonly string[];
}

function chapterLabel(chapterCount: number): string {
  if (chapterCount === 0) return "Ready to begin";
  return `${chapterCount} ${chapterCount === 1 ? "chapter" : "chapters"}`;
}

export function StoryLibrary({
  activeStoryId,
  busy,
  error,
  generations,
  onActivate,
  onNewStory,
  onReopen,
  onRestart,
  onRetry,
  onTryAnother,
  stories,
  warnings,
}: StoryLibraryProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const activeStory = stories.find(({ id }) => id === activeStoryId);
  const otherStories = stories.filter(
    ({ id, status }) => id !== activeStoryId && status === "active",
  );
  const rejectedStories = stories.filter(({ status }) => status === "rejected");
  const generationFor = (storyId: string) => generations.find((item) => item.storyId === storyId);

  useEffect(() => {
    if (error) details.current?.setAttribute("open", "");
  }, [error]);

  if (!activeStory) return null;

  const act = (action: () => void) => {
    details.current?.removeAttribute("open");
    setConfirmingRestart(false);
    action();
  };

  return (
    <details className="story-library" ref={details}>
      <summary aria-label={`Open story library. Current story: ${activeStory.title}`}>
        <span>
          <small>Current story</small>
          <strong>{activeStory.title}</strong>
        </span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="story-library__panel">
        <div className="story-library__header">
          <div>
            <p>Story library</p>
            <h2>{activeStory.title}</h2>
          </div>
          <span>
            {generationFor(activeStory.id)
              ? `Chapter ${generationFor(activeStory.id)!.targetChapter} in progress`
              : chapterLabel(activeStory.chapterCount)}
          </span>
        </div>

        {confirmingRestart ? (
          <section className="story-library__confirmation" aria-labelledby="restart-story-heading">
            <h3 id="restart-story-heading">Restart from the beginning?</h3>
            <p>Current draft moves to Rejected. You can reopen it later.</p>
            <div>
              <button
                disabled={busy}
                onClick={() => act(() => onRestart(activeStory.id))}
                type="button"
              >
                Restart story
              </button>
              <button disabled={busy} onClick={() => setConfirmingRestart(false)} type="button">
                Cancel
              </button>
            </div>
          </section>
        ) : (
          <div className="story-library__actions">
            <button disabled={busy} onClick={() => act(onNewStory)} type="button">
              Start new story
            </button>
            <button
              disabled={busy}
              onClick={() => act(() => onTryAnother(activeStory.id))}
              type="button"
            >
              Try another
            </button>
            <button disabled={busy} onClick={() => setConfirmingRestart(true)} type="button">
              Restart from beginning
            </button>
          </div>
        )}

        {otherStories.length > 0 ? (
          <section className="story-library__group">
            <h3>Other stories</h3>
            <ul>
              {otherStories.map((story) => (
                <li key={story.id}>
                  <span>
                    <strong>{story.title}</strong>
                    <small>
                      {generationFor(story.id)
                        ? `Chapter ${generationFor(story.id)!.targetChapter} in progress`
                        : chapterLabel(story.chapterCount)}
                    </small>
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => act(() => onActivate(story.id))}
                    type="button"
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {rejectedStories.length > 0 ? (
          <section className="story-library__group story-library__group--rejected">
            <h3>Rejected</h3>
            <ul>
              {rejectedStories.map((story) => (
                <li key={story.id}>
                  <span>
                    <strong>{story.title}</strong>
                    <small>{chapterLabel(story.chapterCount)}</small>
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => act(() => onReopen(story.id))}
                    type="button"
                  >
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {warnings.map((warning, index) => (
          <p className="story-library__warning" key={`${index}-${warning}`} role="status">
            {warning}
          </p>
        ))}
        {error ? (
          <div className="story-library__error" role="alert">
            <p>{error}</p>
            <button disabled={busy} onClick={onRetry} type="button">
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
