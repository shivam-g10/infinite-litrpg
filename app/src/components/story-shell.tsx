"use client";

import { DEMO_CHAPTER_LIMIT } from "@infinite-litrpg/shared";
import { forwardRef, useEffect, useRef, useState } from "react";

import { ChapterMarkdown } from "./chapter-markdown";
import { ChapterHistory } from "./chapter-history";
import { StoryLibrary } from "./story-library";
import type {
  ReaderChapterView,
  StoryGenerationView,
  StorySummary,
  StoryView,
} from "./story-types";

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
  readonly automaticRunPaused: boolean;
  readonly busy: boolean;
  readonly chapterSource: "live" | "local";
  readonly error: string | null;
  readonly generationChapter: number | null;
  readonly generationMode: "generate" | "rewrite";
  readonly generationPhase:
    "world" | "world-checking" | "preparing" | "characters" | "writing" | "checking" | "saving";
  readonly generations: readonly StoryGenerationView[];
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

function BookIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 5.5c3.2-.8 6-.2 9 1.8v12c-3-2-5.8-2.6-9-1.8v-12Zm18 0c-3.2-.8-6-.2-9 1.8v12c3-2 5.8-2.6 9-1.8v-12Z" />
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

function ExportMenu({
  mobile = false,
  storyId,
}: {
  readonly mobile?: boolean;
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
        <a download href={`/api/story/export?format=json&storyId=${encodedStoryId}`}>
          Reader JSON
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
  generations,
  onActivateStory,
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
  readonly generations: readonly StoryGenerationView[];
  readonly onActivateStory: (storyId: string) => void;
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
          generations={generations}
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
        <span aria-current="page" className="reader-label">
          <BookIcon />
          Reader
        </span>
        <ExportMenu storyId={activeStory.id} />
      </nav>
      <details className="mobile-menu">
        <summary aria-label="Open story menu">
          <MenuIcon />
        </summary>
        <ExportMenu mobile storyId={activeStory.id} />
      </details>
    </header>
  );
}

function ReaderContext({
  activeChapter,
  reviewingSavedChapter,
  story,
}: {
  readonly activeChapter: number;
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
        <span>Chapter {activeChapter}</span>
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
      <p className="rail-label">{story.systemName}</p>
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
  generationPhase,
  onCommand,
  onContinue,
  onRetry,
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
  readonly generationPhase: StoryShellProps["generationPhase"];
  readonly onCommand: (command: StoryCommand) => void;
  readonly onContinue: () => void;
  readonly onRetry: () => void;
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
        generationPhase={generationPhase}
        onStop={onStop}
        receivedProse={receivedProse}
        ref={generationPanel}
        story={story}
        stopRequested={stopRequested}
      />
    );
  }

  if (story.world.chapter === 0) {
    return (
      <section className="terminal-state">
        <h2>Chapter 1 is not ready</h2>
        <p>Retry the opening chapter. No placeholder text has been saved.</p>
        <button onClick={onRetry} type="button">
          Create chapter 1
        </button>
      </section>
    );
  }

  if (story.world.chapter >= DEMO_CHAPTER_LIMIT) {
    return (
      <section className="demo-complete">
        <h2>Chapter {DEMO_CHAPTER_LIMIT} ready</h2>
        <p>
          Demo auto-stop reached. Review or export this draft. The viewpoint remains locked for the
          full 350-chapter canon.
        </p>
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
    readonly generationPhase: StoryShellProps["generationPhase"];
    readonly onStop: () => void;
    readonly receivedProse: boolean;
    readonly story: StoryView;
    readonly stopRequested: boolean;
  }
>(function GenerationStatus(
  {
    automaticRun,
    generationChapter,
    generationMode,
    generationPhase,
    onStop,
    receivedProse,
    story,
    stopRequested,
  },
  ref,
) {
  const chapter = generationChapter ?? story.world.chapter + 1;
  return (
    <section aria-live="polite" className="generation-panel" ref={ref} role="status" tabIndex={-1}>
      <span aria-hidden="true" className="generation-mark" />
      <div>
        <h2>Chapter {chapter}</h2>
        <p>
          {receivedProse || generationPhase === "saving"
            ? "Saving the finished chapter."
            : generationPhase === "world"
              ? "Building the world and opening situation."
              : generationPhase === "world-checking"
                ? "Checking the world, cast, System, and opening action."
                : generationPhase === "checking"
                  ? "Checking story continuity and quality."
                  : generationPhase === "writing"
                    ? generationMode === "rewrite"
                      ? "Writing a new version."
                      : "Writing the chapter."
                    : generationPhase === "characters"
                      ? "Resolving character actions."
                      : "Preparing the next scene."}
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
  const latestChapter =
    story.chapter && story.world.chapter > 0
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

  useEffect(() => {
    if (previousChapterSignature.current !== chapterSignature) chapterHeading.current?.focus();
    previousChapterSignature.current = chapterSignature;
  }, [chapterSignature]);

  return (
    <main className="reader-layout">
      <article className="chapter-column">
        <ReaderContext
          activeChapter={
            story.world.chapter === 0 && props.busy ? (props.generationChapter ?? 1) : activeChapter
          }
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
            <ChapterMarkdown prose={displayedChapter.prose} />
          </div>
        ) : null}
        {!reviewingSavedChapter && displayedChapter && activeChapter > 0 ? (
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
                generationPhase={props.generationPhase}
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
              {error ? (
                <div className="error-rail error-rail--reader" role="alert">
                  <p>{error}</p>
                  <button disabled={props.busy} onClick={props.onContinue} type="button">
                    Retry and resume generation
                  </button>
                </div>
              ) : null}
              <button onClick={() => onReviewChapter(story.world.chapter)} type="button">
                Return to chapter {story.world.chapter}
              </button>
            </section>
          </>
        ) : null}
        {error && !reviewingSavedChapter ? (
          <div className="error-rail error-rail--reader" role="alert">
            <p>{error}</p>
            <button onClick={props.automaticRunPaused ? props.onContinue : onRetry} type="button">
              {props.automaticRunPaused ? "Retry and resume generation" : "Retry same chapter"}
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

export function StoryShell(props: StoryShellProps) {
  return (
    <div className="story-app story-app--reader">
      <StoryHeader
        activeStory={props.activeStory}
        libraryBusy={props.libraryBusy}
        libraryError={props.libraryError}
        libraryWarnings={props.libraryWarnings}
        generations={props.generations}
        onActivateStory={props.onActivateStory}
        onNewStory={props.onNewStory}
        onReopenStory={props.onReopenStory}
        onRestartStory={props.onRestartStory}
        onRetry={props.onRetry}
        onTryAnother={props.onTryAnother}
        stories={props.stories}
      />
      <ReaderView {...props} />
    </div>
  );
}
