"use client";

import type { ChapterHistoryItem } from "./story-types";

interface ChapterHistoryProps {
  readonly activeChapter: number;
  readonly busy: boolean;
  readonly chapters: readonly ChapterHistoryItem[];
  readonly error: string | null;
  readonly onSelect: (chapter: number) => void;
}

export function ChapterHistory({
  activeChapter,
  busy,
  chapters,
  error,
  onSelect,
}: ChapterHistoryProps) {
  if (chapters.length === 0) return null;

  const activeIndex = Math.max(
    0,
    chapters.findIndex(({ chapter }) => chapter === activeChapter),
  );
  const previous = chapters[activeIndex - 1];
  const next = chapters[activeIndex + 1];

  return (
    <nav aria-label="Saved chapters" className="chapter-history">
      <div className="chapter-history__label">
        <span>Saved chapters</span>
        <strong>
          {activeIndex + 1} of {chapters.length}
        </strong>
      </div>
      <div className="chapter-history__controls">
        <button
          aria-label="Previous saved chapter"
          disabled={busy || !previous}
          onClick={() => previous && onSelect(previous.chapter)}
          type="button"
        >
          ← Previous
        </button>
        <label className="sr-only" htmlFor="saved-chapter">
          Jump to saved chapter
        </label>
        <select
          aria-busy={busy}
          disabled={busy}
          id="saved-chapter"
          onChange={(event) => onSelect(Number(event.target.value))}
          value={activeChapter}
        >
          {chapters.map(({ chapter, title }) => (
            <option key={chapter} value={chapter}>
              Chapter {chapter}: {title}
            </option>
          ))}
        </select>
        <button
          aria-label="Next saved chapter"
          disabled={busy || !next}
          onClick={() => next && onSelect(next.chapter)}
          type="button"
        >
          Next →
        </button>
      </div>
      {busy ? (
        <p aria-live="polite" className="chapter-history__message" role="status">
          Opening saved chapter…
        </p>
      ) : null}
      {error ? (
        <p className="chapter-history__message chapter-history__message--error" role="alert">
          {error}
        </p>
      ) : null}
    </nav>
  );
}
