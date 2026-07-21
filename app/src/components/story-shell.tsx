"use client";

import { DEMO_CHAPTER_LIMIT } from "@infinite-litrpg/shared";
import { forwardRef, useEffect, useRef, useState } from "react";

import { ChapterHistory } from "./chapter-history";
import { StoryLibrary } from "./story-library";
import type { ReaderChapterView, StorySummary, StoryView } from "./story-types";

const ACT_NAMES = [
  "Reincarnation and survival",
  "Awakening and alignment",
  "Faction and foundation",
  "Trials and revelations",
  "War and upheaval",
  "Ascension and choice",
  "Sovereignty and legacy",
] as const;

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

export type StoryCommand =
  | { readonly type: "take_action"; readonly choiceId: string }
  | { readonly type: "custom_action"; readonly description: string }
  | { readonly approvedThroughChapter: number; readonly type: "continue_story" }
  | { readonly type: "reroll_latest" };

interface StoryShellProps {
  readonly activeStory: StorySummary;
  readonly apiKeyConfigured: boolean;
  readonly automaticRun: boolean;
  readonly busy: boolean;
  readonly chapterSource: "live" | "local";
  readonly error: string | null;
  readonly generationChapter: number | null;
  readonly generationMode: "generate" | "rewrite";
  readonly libraryBusy: boolean;
  readonly libraryError: string | null;
  readonly libraryWarnings: readonly string[];
  readonly onActivateStory: (storyId: string) => void;
  readonly onCommand: (command: StoryCommand) => void;
  readonly onContinue: () => void;
  readonly onNewStory: () => void;
  readonly onReopenStory: (storyId: string) => void;
  readonly onReviewChapter: (chapter: number) => void;
  readonly onRestartStory: (storyId: string) => void;
  readonly onRetry: () => void;
  readonly onStop: () => void;
  readonly onTryAnother: (storyId: string) => void;
  readonly receivedProse: boolean;
  readonly reviewBusy: boolean;
  readonly reviewError: string | null;
  readonly reviewedChapter: ReaderChapterView | null;
  readonly runMessage: string | null;
  readonly stories: readonly StorySummary[];
  readonly story: StoryView;
  readonly stopRequested: boolean;
}

type Mode = "reader" | "god";

function BookIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 5.5c3.2-.8 6-.2 9 1.8v12c-3-2-5.8-2.6-9-1.8v-12Zm18 0c-3.2-.8-6-.2-9 1.8v12c3-2 5.8-2.6 9-1.8v-12Z" />
    </svg>
  );
}

function InspectIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 2.8 14.2 6l3.8-.5.4 3.8 3.4 1.8-1.8 3.4 1.8 3.4-3.4 1.8-.4 3.8-3.8-.5-2.2 3.2L9.8 23 6 23.5l-.4-3.8-3.4-1.8L4 14.5 2.2 11l3.4-1.8L6 5.5l3.8.5L12 2.8Z" />
      <circle cx="12" cy="14" r="3.2" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M14 3h7v7M21 3l-9 9M19 14v6H4V5h6" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function titleCase(value: string): string {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function percent(current: number, maximum: number): number {
  if (maximum <= 0) return 0;
  return Math.min(100, Math.max(0, (current / maximum) * 100));
}

function formatMoney(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatLatency(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms`;
}

function ExportMenu({
  mobile = false,
  mode,
  storyId,
}: {
  readonly mobile?: boolean;
  readonly mode: Mode;
  readonly storyId: string;
}) {
  const encodedStoryId = encodeURIComponent(storyId);
  return (
    <details className={mobile ? "export-menu export-menu--mobile" : "export-menu"}>
      <summary>
        <ExportIcon />
        Export
      </summary>
      <div className="export-options">
        <a download href={`/api/story/export?format=markdown&storyId=${encodedStoryId}`}>
          Markdown
        </a>
        <a
          download
          href={
            mode === "god"
              ? `/api/story/export?format=json&scope=god&storyId=${encodedStoryId}`
              : `/api/story/export?format=json&storyId=${encodedStoryId}`
          }
        >
          {mode === "god" ? "Developer JSON" : "Reader JSON"}
        </a>
      </div>
    </details>
  );
}

function StoryHeader({
  activeStory,
  libraryBusy,
  libraryError,
  libraryWarnings,
  mode,
  onActivateStory,
  onMode,
  onNewStory,
  onReopenStory,
  onRestartStory,
  onRetry,
  onTryAnother,
  stories,
}: {
  readonly activeStory: StorySummary;
  readonly libraryBusy: boolean;
  readonly libraryError: string | null;
  readonly libraryWarnings: readonly string[];
  readonly mode: Mode;
  readonly onActivateStory: (storyId: string) => void;
  readonly onMode: (mode: Mode) => void;
  readonly onNewStory: () => void;
  readonly onReopenStory: (storyId: string) => void;
  readonly onRestartStory: (storyId: string) => void;
  readonly onRetry: () => void;
  readonly onTryAnother: (storyId: string) => void;
  readonly stories: readonly StorySummary[];
}) {
  return (
    <header className="story-header">
      <div className="story-header__brand">
        <span aria-hidden="true" className="brand-mark">
          ᚱ
        </span>
        <span className="brand">Infinite LitRPG</span>
        <StoryLibrary
          activeStoryId={activeStory.id}
          busy={libraryBusy}
          error={libraryError}
          onActivate={onActivateStory}
          onNewStory={onNewStory}
          onReopen={onReopenStory}
          onRestart={onRestartStory}
          onRetry={onRetry}
          onTryAnother={onTryAnother}
          stories={stories}
          warnings={libraryWarnings}
        />
      </div>
      <nav aria-label="Story views" className="desktop-nav">
        <button
          aria-current={mode === "reader" ? "page" : undefined}
          className={mode === "reader" ? "is-active" : ""}
          onClick={() => onMode("reader")}
          type="button"
        >
          <BookIcon />
          Reader
        </button>
        <ExportMenu mode={mode} storyId={activeStory.id} />
        <details className="developer-menu">
          <summary>More</summary>
          <button onClick={() => onMode(mode === "god" ? "reader" : "god")} type="button">
            <InspectIcon />
            {mode === "god" ? "Back to Reader" : "Developer details"}
          </button>
        </details>
      </nav>
      <details className="mobile-menu">
        <summary aria-label="Open story menu">
          <MenuIcon />
        </summary>
        <button onClick={() => onMode(mode === "god" ? "reader" : "god")} type="button">
          <InspectIcon />
          {mode === "god" ? "Back to Reader" : "Developer details"}
        </button>
        <ExportMenu mobile mode={mode} storyId={activeStory.id} />
      </details>
    </header>
  );
}

function ReaderContext({
  activeChapter,
  apiKeyConfigured,
  chapterSource,
  reviewingSavedChapter,
  story,
}: {
  readonly activeChapter: number;
  readonly apiKeyConfigured: boolean;
  readonly chapterSource: "live" | "local";
  readonly reviewingSavedChapter: boolean;
  readonly story: StoryView;
}) {
  const activeActIndex = Math.max(0, Math.min(ACT_NAMES.length - 1, story.world.act - 1));
  const chapterProgress = Math.min(100, Math.max(0, (activeChapter / DEMO_CHAPTER_LIMIT) * 100));

  return (
    <section className="reader-context" aria-label="Story position">
      <div>
        <strong>
          {story.pov.name}
          <small>Viewpoint locked</small>
        </strong>
        <span>
          Chapter {activeChapter} of {DEMO_CHAPTER_LIMIT}
        </span>
      </div>
      {reviewingSavedChapter ? (
        <p>Saved chapter · latest is chapter {story.world.chapter}</p>
      ) : (
        <p>
          Act {ROMAN_NUMERALS[activeActIndex]} · {ACT_NAMES[activeActIndex]}
        </p>
      )}
      <div
        aria-label={"Chapter " + activeChapter + " of " + DEMO_CHAPTER_LIMIT}
        aria-valuemax={DEMO_CHAPTER_LIMIT}
        aria-valuemin={0}
        aria-valuenow={Math.min(activeChapter, DEMO_CHAPTER_LIMIT)}
        className="progress-line"
        role="progressbar"
      >
        <span style={{ width: `${chapterProgress}%` }} />
      </div>
      <div className="chapter-source" role="status">
        <span aria-hidden="true" />
        <p>
          {reviewingSavedChapter ? (
            <>Loaded from your local save. Opening chapter history made no OpenAI call.</>
          ) : chapterSource === "live" ? (
            <>Chapter saved locally. OpenAI generation is complete.</>
          ) : apiKeyConfigured ? (
            <>Loaded from your local story. Opening this page made no OpenAI call.</>
          ) : (
            <>
              Loaded from your local save. Add your OpenAI API key to the server before creating
              another chapter.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function Meter({
  current,
  label,
  maximum,
  tone,
}: {
  readonly current: number;
  readonly label: string;
  readonly maximum: number;
  readonly tone: "health" | "mana" | "xp";
}) {
  return (
    <div className="meter">
      <div>
        <span>{label}</span>
        <strong>
          {current} / {maximum}
        </strong>
      </div>
      <div
        aria-label={`${label}: ${current} of ${maximum}`}
        aria-valuemax={maximum}
        aria-valuemin={0}
        aria-valuenow={current}
        className={`meter__line meter__line--${tone}`}
        role="progressbar"
      >
        <span style={{ width: `${percent(current, maximum)}%` }} />
      </div>
    </div>
  );
}

function CharacterState({ story }: { readonly story: StoryView }) {
  const { pov } = story;
  const experienceMaximum = pov.experienceToNextLevel || Math.max(100, pov.experience);
  const stats = Object.entries(pov.stats);

  return (
    <div className="state-content">
      <p className="rail-label">Ashen System</p>
      <dl className="state-summary">
        <div>
          <dt>Level</dt>
          <dd>{pov.level}</dd>
        </div>
        <div>
          <dt>Class</dt>
          <dd>{pov.characterClass}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{titleCase(pov.status)}</dd>
        </div>
      </dl>
      <div className="state-section state-meters">
        <Meter
          current={pov.health.current}
          label="Health"
          maximum={pov.health.maximum}
          tone="health"
        />
        <Meter current={pov.mana.current} label="Mana" maximum={pov.mana.maximum} tone="mana" />
        <Meter current={pov.experience} label="XP" maximum={experienceMaximum} tone="xp" />
      </div>
      <section className="state-section">
        <h3>Location</h3>
        <p className="state-lead">{pov.location}</p>
      </section>
      {stats.length > 0 ? (
        <section className="state-section">
          <h3>Stats</h3>
          <dl className="compact-list">
            {stats.map(([name, value]) => (
              <div key={name}>
                <dt>{titleCase(name)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {pov.skills.length > 0 ? (
        <section className="state-section">
          <h3>Skills</h3>
          <ul className="state-list">
            {pov.skills.map((skill) => (
              <li key={skill.id || skill.name}>
                <span>{skill.name}</span>
                <small>Rank {skill.rank}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pov.inventory.length > 0 ? (
        <section className="state-section">
          <h3>Inventory</h3>
          <ul className="state-list">
            {pov.inventory.map((item) => (
              <li key={item.id || item.name}>
                <span>
                  {item.name}
                  {item.equipped ? <small className="inline-note">Equipped</small> : null}
                </span>
                <small>× {item.quantity}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pov.conditions.length > 0 ? (
        <section className="state-section">
          <h3>Conditions</h3>
          <p>{pov.conditions.map(titleCase).join(", ")}</p>
        </section>
      ) : null}
      {pov.goals.length > 0 ? (
        <section className="state-section">
          <h3>Goals</h3>
          <ul className="prose-list">
            {pov.goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {pov.beliefs.length > 0 ? (
        <section className="state-section">
          <h3>Beliefs</h3>
          <ul className="prose-list">
            {pov.beliefs.map((belief) => (
              <li key={belief}>{belief}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {pov.relationships.length > 0 ? (
        <section className="state-section">
          <h3>Relationships</h3>
          <ul className="state-list">
            {pov.relationships.map((relationship) => (
              <li key={relationship.id || relationship.name}>
                <span>
                  {relationship.name}
                  <small className="inline-note">{relationship.label}</small>
                </span>
                <small>{relationship.score}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ReaderActions({
  automaticRun,
  busy,
  generationChapter,
  generationMode,
  onCommand,
  onContinue,
  onStop,
  receivedProse,
  runMessage,
  story,
  stopRequested,
}: {
  readonly automaticRun: boolean;
  readonly busy: boolean;
  readonly generationChapter: number | null;
  readonly generationMode: "generate" | "rewrite";
  readonly onCommand: (command: StoryCommand) => void;
  readonly onContinue: () => void;
  readonly onStop: () => void;
  readonly receivedProse: boolean;
  readonly runMessage: string | null;
  readonly story: StoryView;
  readonly stopRequested: boolean;
}) {
  const [customAction, setCustomAction] = useState("");
  const [confirmingContinuation, setConfirmingContinuation] = useState(false);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const generationPanel = useRef<HTMLElement>(null);
  const wasBusy = useRef(busy);
  const firstName = story.pov.name.split(" ")[0] || story.pov.name;

  useEffect(() => {
    if (busy && !wasBusy.current) generationPanel.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    if (confirmingContinuation) confirmationHeading.current?.focus();
  }, [confirmingContinuation]);

  if (story.world.terminal) {
    return (
      <section className="terminal-state">
        <h2>Story complete</h2>
        <p>{story.world.terminalReason || "This life has reached its ending."}</p>
      </section>
    );
  }

  if (!story.chapter) {
    return (
      <section className="terminal-state">
        <h2>World ready</h2>
        <p>No chapter has been committed yet.</p>
      </section>
    );
  }

  if (busy) {
    return (
      <GenerationStatus
        automaticRun={automaticRun}
        generationChapter={generationChapter}
        generationMode={generationMode}
        onStop={onStop}
        receivedProse={receivedProse}
        ref={generationPanel}
        story={story}
        stopRequested={stopRequested}
      />
    );
  }

  if (story.world.chapter >= DEMO_CHAPTER_LIMIT) {
    return (
      <section className="demo-complete">
        <h2>Chapter {DEMO_CHAPTER_LIMIT} ready</h2>
        <p>Review the story here or export the complete draft as Markdown.</p>
      </section>
    );
  }

  const routineChoice =
    story.chapter.choices.find(({ id }) => id === "choice-1") ?? story.chapter.choices.at(0);

  if (story.continuationPlan && routineChoice) {
    const plan = story.continuationPlan;
    return (
      <section
        className="reader-actions reader-actions--continue"
        aria-labelledby="continue-heading"
      >
        {runMessage ? (
          <p className="run-message" role="status">
            {runMessage}
          </p>
        ) : null}
        {confirmingContinuation ? (
          <>
            <p className="decision-label">Confirm generation</p>
            <h2 id="continue-heading" ref={confirmationHeading} tabIndex={-1}>
              Create up to {plan.chapterCount} {plan.chapterCount === 1 ? "chapter" : "chapters"}?
            </h2>
            <p className="continue-budget">
              Runs in the background through chapter {plan.endChapter}, then stops for your next
              decision.
            </p>
            <div className="continuation-confirmation-actions">
              <button
                className="continue-action"
                onClick={() => {
                  setConfirmingContinuation(false);
                  onContinue();
                }}
                type="button"
              >
                Start generation
              </button>
              <button onClick={() => setConfirmingContinuation(false)} type="button">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="decision-label">Next routine chapter</p>
            <h2 id="continue-heading">Continue {firstName}&apos;s story</h2>
            <button
              className="continue-action"
              onClick={() => onCommand({ choiceId: routineChoice.id, type: "take_action" })}
              type="button"
            >
              Create chapter {story.world.chapter + 1}
            </button>
            <p className="continue-note">Recommended next step: {routineChoice.description}</p>
            <details className="continuation-disclosure">
              <summary>Create several chapters</summary>
              <div>
                <p className="continue-budget">
                  Up to {plan.chapterCount} {plan.chapterCount === 1 ? "chapter" : "chapters"},
                  through chapter {plan.endChapter}
                </p>
                <button
                  className="batch-action"
                  onClick={() => setConfirmingContinuation(true)}
                  type="button"
                >
                  Continue to next decision
                </button>
                <p className="continue-note">
                  Uses your API key one chapter at a time. Keep this tab open. You can stop after
                  the active chapter.
                </p>
              </div>
            </details>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="reader-actions" aria-labelledby="action-heading">
      {runMessage ? (
        <p className="run-message" role="status">
          {runMessage}
        </p>
      ) : null}
      <p className="decision-label">Story decision</p>
      <h2 id="action-heading">What does {firstName} do next?</h2>
      <div className="choice-list">
        {story.chapter.choices.map((choice) => (
          <button
            disabled={busy}
            key={choice.id}
            onClick={() => onCommand({ choiceId: choice.id, type: "take_action" })}
            type="button"
          >
            <span aria-hidden="true" />
            {choice.description}
          </button>
        ))}
      </div>
      <details className="custom-action-disclosure">
        <summary>Write a different action</summary>
        <form
          className="custom-action"
          onSubmit={(event) => {
            event.preventDefault();
            const description = customAction.trim();
            if (!description || busy) return;
            onCommand({ description, type: "custom_action" });
            setCustomAction("");
          }}
        >
          <label className="sr-only" htmlFor="custom-action">
            Describe another attempt
          </label>
          <input
            autoComplete="off"
            disabled={busy}
            id="custom-action"
            maxLength={240}
            onChange={(event) => setCustomAction(event.target.value)}
            placeholder="Describe another attempt…"
            required
            value={customAction}
          />
          <button disabled={busy || customAction.trim().length === 0} type="submit">
            Attempt
          </button>
        </form>
      </details>
    </section>
  );
}

const GenerationStatus = forwardRef<
  HTMLElement,
  {
    readonly automaticRun: boolean;
    readonly generationChapter: number | null;
    readonly generationMode: "generate" | "rewrite";
    readonly onStop: () => void;
    readonly receivedProse: boolean;
    readonly story: StoryView;
    readonly stopRequested: boolean;
  }
>(function GenerationStatus(
  { automaticRun, generationChapter, generationMode, onStop, receivedProse, story, stopRequested },
  ref,
) {
  const chapter = generationChapter ?? story.world.chapter + 1;
  return (
    <section aria-live="polite" className="generation-panel" ref={ref} role="status" tabIndex={-1}>
      <span aria-hidden="true" className="generation-mark" />
      <div>
        <h2>
          {generationMode === "rewrite"
            ? `Rewriting chapter ${chapter}`
            : `Creating chapter ${chapter} of ${DEMO_CHAPTER_LIMIT}`}
        </h2>
        <p>
          {generationMode === "rewrite"
            ? receivedProse
              ? "Canon checked. Saving the revised chapter."
              : "Rewriting the prose and checking it against saved canon."
            : receivedProse
              ? "Canon checked. Saving the chapter in the background."
              : "Building and checking the next chapter in the background. Keep reading."}
        </p>
      </div>
      {automaticRun ? (
        <button disabled={stopRequested} onClick={onStop} type="button">
          {stopRequested ? "Stopping after this chapter…" : "Stop after this chapter"}
        </button>
      ) : null}
    </section>
  );
});

function ReaderView(props: StoryShellProps) {
  const {
    apiKeyConfigured,
    chapterSource,
    error,
    onReviewChapter,
    onRetry,
    reviewBusy,
    reviewError,
    reviewedChapter,
    runMessage,
    story,
  } = props;
  const chapterHeading = useRef<HTMLHeadingElement>(null);
  const latestChapter = story.chapter
    ? {
        chapter: story.world.chapter,
        prose: story.chapter.prose,
        title: story.chapter.title,
      }
    : null;
  const displayedChapter = reviewedChapter ?? latestChapter;
  const activeChapter = displayedChapter?.chapter ?? story.world.chapter;
  const reviewingSavedChapter = activeChapter !== story.world.chapter;
  const chapterSignature = `${activeChapter}:${displayedChapter?.title ?? ""}:${displayedChapter?.prose ?? ""}`;
  const previousChapterSignature = useRef(chapterSignature);
  const paragraphs = (displayedChapter?.prose ?? "").split(/\n\s*\n/gu).filter(Boolean);

  useEffect(() => {
    if (previousChapterSignature.current !== chapterSignature) chapterHeading.current?.focus();
    previousChapterSignature.current = chapterSignature;
  }, [chapterSignature]);

  return (
    <main className="reader-layout">
      <article className="chapter-column">
        <ReaderContext
          activeChapter={activeChapter}
          apiKeyConfigured={apiKeyConfigured}
          chapterSource={chapterSource}
          reviewingSavedChapter={reviewingSavedChapter}
          story={story}
        />
        <ChapterHistory
          activeChapter={activeChapter}
          busy={reviewBusy}
          chapters={story.chapterHistory}
          error={reviewError}
          onSelect={onReviewChapter}
        />
        {displayedChapter ? (
          <div className="chapter-copy">
            <h1 ref={chapterHeading} tabIndex={-1}>
              {displayedChapter.title}
            </h1>
            {paragraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 28)}`}>{paragraph}</p>
            ))}
          </div>
        ) : null}
        {!reviewingSavedChapter && displayedChapter ? (
          <section className="rewrite-chapter" aria-label="Rewrite latest chapter">
            <div>
              <strong>Want a different telling?</strong>
              <p>
                Rewrite chapter {activeChapter}. Story events and character state stay unchanged.
              </p>
            </div>
            <button
              disabled={props.busy || reviewBusy}
              onClick={() => props.onCommand({ type: "reroll_latest" })}
              type="button"
            >
              Rewrite latest chapter
            </button>
          </section>
        ) : null}
        {reviewingSavedChapter ? (
          <>
            {props.busy ? (
              <GenerationStatus
                automaticRun={props.automaticRun}
                generationChapter={props.generationChapter}
                generationMode={props.generationMode}
                onStop={props.onStop}
                receivedProse={props.receivedProse}
                story={story}
                stopRequested={props.stopRequested}
              />
            ) : null}
            <section className="saved-chapter-note">
              <h2>Reading saved chapter {activeChapter}</h2>
              <p>New chapters stay in the background until you choose to open them.</p>
              {runMessage ? <p role="status">{runMessage}</p> : null}
              <button onClick={() => onReviewChapter(story.world.chapter)} type="button">
                Return to chapter {story.world.chapter}
              </button>
            </section>
          </>
        ) : null}
        {error && !reviewingSavedChapter ? (
          <div className="error-rail error-rail--reader" role="alert">
            <p>{error}</p>
            <button onClick={onRetry} type="button">
              Retry same chapter
            </button>
          </div>
        ) : null}
        {!reviewingSavedChapter ? (
          <>
            <ReaderActions {...props} />
            <details className="reader-details">
              <summary>
                Story and character details <ChevronIcon />
              </summary>
              <div className="reader-details__grid">
                <CharacterState story={story} />
                <div className="world-detail">
                  <p className="rail-label">Story clock</p>
                  <dl className="compact-list">
                    <div>
                      <dt>Calendar</dt>
                      <dd>{story.world.calendar.label || `Day ${story.world.calendar.day}`}</dd>
                    </div>
                    <div>
                      <dt>Threat</dt>
                      <dd>{story.world.threat}</dd>
                    </div>
                    <div>
                      <dt>World</dt>
                      <dd>v{story.world.version}</dd>
                    </div>
                  </dl>
                  {story.visibleEvents.length > 0 ? (
                    <section className="visible-events">
                      <h2>Visible events</h2>
                      <ul>
                        {story.visibleEvents.map((event) => (
                          <li key={event.id || event.summary}>
                            <span>{event.summary}</span>
                            {event.location ? <small>{event.location}</small> : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              </div>
            </details>
          </>
        ) : null}
      </article>
    </main>
  );
}

function JsonBlock({
  defaultOpen = false,
  label,
  value,
}: {
  readonly defaultOpen?: boolean;
  readonly label: string;
  readonly value: unknown;
}) {
  return (
    <details className="json-block" open={defaultOpen}>
      <summary>
        {label} <ChevronIcon />
      </summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function GodModeView({ story }: { readonly story: StoryView }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const tracePayload = {
    adapterMode: story.adapterMode,
    costUsd: story.estimatedCostUsd,
    godMode: story.godMode,
    latencyMs: story.latencyMs,
    usage: story.usage,
    world: story.world,
  };

  async function copyTrace(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(tracePayload, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <main className="god-shell">
      <h1 className="sr-only">Developer details</h1>
      <header className="god-context">
        <p>
          {story.pov.name} <span>·</span> Chapter {story.world.chapter} <span>·</span> World v
          {Math.max(1, story.world.version - 1)} → v{story.world.version}
        </p>
      </header>
      <div className="god-grid">
        <section className="intent-column" aria-labelledby="intents-heading">
          <h2 id="intents-heading">Background intents</h2>
          {story.godMode.intents.length > 0 ? (
            <ol>
              {story.godMode.intents.map((intent, index) => (
                <li className={intent.accepted ? "is-accepted" : ""} key={intent.id || index}>
                  <header>
                    <strong>
                      {index + 1}. <span>{intent.actorName}</span>
                    </strong>
                    <em>{intent.accepted ? "Accepted" : "Deferred"}</em>
                  </header>
                  <p>{intent.goal}</p>
                  {intent.expectedEffect ? <p>{intent.expectedEffect}</p> : null}
                  <small>Phase: {intent.phase}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-copy">No background intents for this chapter.</p>
          )}
          {story.godMode.rejected.length > 0 ? (
            <section className="rejected-intents">
              <h3>Rejected intents</h3>
              <ul>
                {story.godMode.rejected.map((intent) => (
                  <li key={`${intent.id}-${intent.code}`}>
                    <strong>{intent.code}</strong>
                    <span>{intent.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
        <section className="resolution-column" aria-labelledby="resolution-heading">
          <h2 id="resolution-heading">Canonical resolution</h2>
          <div className="resolution-lead">
            <span>Committed WorldDelta</span>
            <strong>World v{story.world.version}</strong>
          </div>
          <JsonBlock defaultOpen label="Accepted delta" value={story.godMode.delta} />
          {story.visibleEvents.length > 0 ? (
            <section className="resolution-section">
              <h3>Observed events</h3>
              <ul>
                {story.visibleEvents.map((event) => (
                  <li key={event.id || event.summary}>{event.summary}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
        <section className="trace-column" aria-labelledby="trace-heading">
          <h2 id="trace-heading">Trace</h2>
          <p className="trace-mode">{titleCase(story.adapterMode)}</p>
          <dl className="trace-list">
            <div>
              <dt>Prompt version</dt>
              <dd>{story.godMode.promptVersion || "—"}</dd>
            </div>
            <div>
              <dt>Schema version</dt>
              <dd>{story.godMode.schemaVersion || "—"}</dd>
            </div>
            <div>
              <dt>Input</dt>
              <dd>{story.usage.inputTokens.toLocaleString()} tokens</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{story.usage.outputTokens.toLocaleString()} tokens</dd>
            </div>
            <div>
              <dt>Reasoning</dt>
              <dd>{story.usage.reasoningTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd>{formatLatency(story.latencyMs)}</dd>
            </div>
            <div>
              <dt>Estimated cost</dt>
              <dd>{formatMoney(story.estimatedCostUsd)}</dd>
            </div>
          </dl>
          <dl className="trace-list trace-hashes">
            <div>
              <dt>Before</dt>
              <dd>{story.godMode.stateBeforeHash || "—"}</dd>
            </div>
            <div>
              <dt>After</dt>
              <dd>{story.godMode.stateAfterHash || "—"}</dd>
            </div>
          </dl>
          {story.godMode.calls.length > 0 ? (
            <JsonBlock label="Model calls" value={story.godMode.calls} />
          ) : null}
          <button className="copy-trace" onClick={() => void copyTrace()} type="button">
            {copyState === "copied"
              ? "Trace copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy trace"}
          </button>
        </section>
      </div>
      <div className="commit-rail">
        <details>
          <summary>
            <span>Narrative audit</span>
            <strong className={story.godMode.gateResult === "failed" ? "is-danger" : "is-success"}>
              {story.godMode.gateResult === "failed" ? "Failed" : "Passed"}
            </strong>
            <ChevronIcon />
          </summary>
          <pre>{JSON.stringify(story.godMode.audit, null, 2)}</pre>
        </details>
        <details>
          <summary>
            <span>Atomic commit</span>
            <strong>Committed v{story.world.version}</strong>
            <ChevronIcon />
          </summary>
          <p>Chapter, world delta, knowledge, usage, and trace share one committed version.</p>
        </details>
      </div>
    </main>
  );
}

export function StoryShell(props: StoryShellProps) {
  const [mode, setMode] = useState<Mode>("reader");

  return (
    <div className={`story-app story-app--${mode}`}>
      <StoryHeader
        activeStory={props.activeStory}
        libraryBusy={props.libraryBusy}
        libraryError={props.libraryError}
        libraryWarnings={props.libraryWarnings}
        mode={mode}
        onActivateStory={props.onActivateStory}
        onMode={setMode}
        onNewStory={props.onNewStory}
        onReopenStory={props.onReopenStory}
        onRestartStory={props.onRestartStory}
        onRetry={props.onRetry}
        onTryAnother={props.onTryAnother}
        stories={props.stories}
      />
      {mode === "reader" ? <ReaderView {...props} /> : <GodModeView story={props.story} />}
      {props.busy && mode === "god" ? (
        <div aria-live="polite" className="turn-progress" role="status">
          <span />
          Creating chapter {props.generationChapter ?? props.story.world.chapter + 1}
        </div>
      ) : null}
    </div>
  );
}
