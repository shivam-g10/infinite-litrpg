"use client";

import { useState } from "react";

import type { StoryView } from "./story-types";

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
  | { readonly type: "custom_action"; readonly description: string };

interface StoryShellProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCommand: (command: StoryCommand) => void;
  readonly onRetry: () => void;
  readonly story: StoryView;
  readonly streamedProse: string;
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

function ExportMenu({ mobile = false, mode }: { readonly mobile?: boolean; readonly mode: Mode }) {
  return (
    <details className={mobile ? "export-menu export-menu--mobile" : "export-menu"}>
      <summary>
        <ExportIcon />
        Export
      </summary>
      <div className="export-options">
        <a download href="/api/story/export?format=markdown">
          Markdown
        </a>
        <a
          download
          href={
            mode === "god"
              ? "/api/story/export?format=json&scope=god"
              : "/api/story/export?format=json"
          }
        >
          {mode === "god" ? "God Mode JSON" : "Reader JSON"}
        </a>
      </div>
    </details>
  );
}

function StoryHeader({
  mode,
  onMode,
}: {
  readonly mode: Mode;
  readonly onMode: (mode: Mode) => void;
}) {
  return (
    <header className="story-header">
      <div className="story-header__brand">
        <span aria-hidden="true" className="brand-mark">
          ᚱ
        </span>
        <span className="brand">Infinite LitRPG</span>
        <span className="story-name">Ashen Crown</span>
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
        <button
          aria-current={mode === "god" ? "page" : undefined}
          className={mode === "god" ? "is-active" : ""}
          onClick={() => onMode("god")}
          type="button"
        >
          <InspectIcon />
          God Mode
        </button>
        <ExportMenu mode={mode} />
      </nav>
      <details className="mobile-menu">
        <summary aria-label="Open story menu">
          <MenuIcon />
        </summary>
        <ExportMenu mobile mode={mode} />
      </details>
    </header>
  );
}

function ActRail({ story }: { readonly story: StoryView }) {
  const activeActIndex = Math.max(0, Math.min(ACT_NAMES.length - 1, story.world.act - 1));
  const activeActName = ACT_NAMES[activeActIndex];
  const chapterProgress = Math.min(100, Math.max(0, story.progress * 100));

  return (
    <aside className="act-rail" aria-label="Story clock">
      <p className="rail-label">Story</p>
      <h2>
        Act {ROMAN_NUMERALS[activeActIndex]} · {activeActName}
      </h2>
      <p>Chapter {story.world.chapter} of 350</p>
      <div
        aria-label={`${Math.round(chapterProgress)} percent of story complete`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(chapterProgress)}
        className="progress-line"
        role="progressbar"
      >
        <span style={{ width: `${chapterProgress}%` }} />
      </div>
      <p className="rail-label rail-label--acts">The seven acts</p>
      <ol className="act-list">
        {ACT_NAMES.map((name, index) => {
          const active = index === activeActIndex;
          return (
            <li
              aria-current={active ? "step" : undefined}
              className={active ? "is-active" : ""}
              key={name}
            >
              <span>{ROMAN_NUMERALS[index]}</span>
              <p>{name}</p>
            </li>
          );
        })}
      </ol>
      <dl className="world-clock">
        <div>
          <dt>Calendar</dt>
          <dd>{story.world.calendar.label || `Day ${story.world.calendar.day}`}</dd>
        </div>
        <div>
          <dt>Threat</dt>
          <dd>{story.world.threat || "Unknown"}</dd>
        </div>
      </dl>
    </aside>
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
      <p className="rail-label">Character state</p>
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
  busy,
  onCommand,
  story,
}: {
  readonly busy: boolean;
  readonly onCommand: (command: StoryCommand) => void;
  readonly story: StoryView;
}) {
  const [customAction, setCustomAction] = useState("");
  const firstName = story.pov.name.split(" ")[0] || story.pov.name;

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

  return (
    <section className="reader-actions" aria-labelledby="action-heading">
      <h2 id="action-heading">What does {firstName} attempt?</h2>
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
      <form
        className="custom-action"
        onSubmit={(event) => {
          event.preventDefault();
          const description = customAction.trim();
          if (!description || busy) return;
          onCommand({ description, type: "custom_action" });
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
          {busy ? "Resolving…" : "Attempt"}
        </button>
      </form>
    </section>
  );
}

function ReaderView({ busy, error, onCommand, onRetry, story, streamedProse }: StoryShellProps) {
  const actIndex = Math.max(0, Math.min(ACT_NAMES.length - 1, story.world.act - 1));
  const streaming = busy && streamedProse.length > 0;
  const displayedProse = streaming ? streamedProse : (story.chapter?.prose ?? "");
  const paragraphs = displayedProse.split(/\n\s*\n/gu).filter(Boolean);

  return (
    <>
      <div className="mobile-story-context">
        <p>
          {story.pov.name} · Chapter {story.world.chapter} of 350
        </p>
        <h2>
          Act {ROMAN_NUMERALS[actIndex]} · {ACT_NAMES[actIndex]}
        </h2>
        <div className="progress-line">
          <span style={{ width: `${Math.min(100, Math.max(0, story.progress * 100))}%` }} />
        </div>
      </div>
      <main className="reader-layout">
        <ActRail story={story} />
        <article className="chapter-column">
          <header className="chapter-byline">
            <h1>{story.pov.name}</h1>
            <p>Viewpoint locked</p>
            <p>AI-generated chapter · deterministic canon audited</p>
          </header>
          {story.chapter ? (
            <div
              aria-live={streaming ? "polite" : undefined}
              className={streaming ? "chapter-copy chapter-copy--streaming" : "chapter-copy"}
            >
              <h2>{streaming ? "Validated chapter arriving" : story.chapter.title}</h2>
              {streaming ? (
                <p className="stream-status">Audit passed · replaying safe prose</p>
              ) : null}
              {paragraphs.map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 28)}`}>{paragraph}</p>
              ))}
            </div>
          ) : null}
          {error ? (
            <div className="error-rail error-rail--reader" role="alert">
              <p>{error}</p>
              <button onClick={onRetry} type="button">
                Retry
              </button>
            </div>
          ) : null}
          <ReaderActions busy={busy} onCommand={onCommand} story={story} />
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
        </article>
        <aside className="state-rail" aria-label="Visible character state">
          <CharacterState story={story} />
        </aside>
      </main>
      <section className="mobile-disclosures" aria-label="Story details">
        <details>
          <summary>
            Character state <ChevronIcon />
          </summary>
          <CharacterState story={story} />
        </details>
        <details>
          <summary>
            Story clock <ChevronIcon />
          </summary>
          <div className="mobile-detail-content">
            <p>
              Day {story.world.calendar.day} · {story.world.calendar.label}
            </p>
            <p>Threat: {story.world.threat}</p>
            <p>World v{story.world.version}</p>
          </div>
        </details>
        <details>
          <summary>
            Usage and trace <ChevronIcon />
          </summary>
          <div className="mobile-detail-content">
            <p>{titleCase(story.adapterMode)}</p>
            <p>{story.usage.totalTokens.toLocaleString()} tokens</p>
            <p>
              {formatLatency(story.latencyMs)} · {formatMoney(story.estimatedCostUsd)}
            </p>
          </div>
        </details>
      </section>
    </>
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
      <header className="god-context">
        <p>
          {story.pov.name} <span>·</span> Chapter {story.world.chapter} <span>·</span> World v
          {Math.max(1, story.world.version - 1)} → v{story.world.version}
        </p>
      </header>
      <div className="god-grid">
        <section className="intent-column" aria-labelledby="intents-heading">
          <h1 id="intents-heading">Background intents</h1>
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
              <h2>Rejected intents</h2>
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
          <h1 id="resolution-heading">Canonical resolution</h1>
          <div className="resolution-lead">
            <span>Committed WorldDelta</span>
            <strong>World v{story.world.version}</strong>
          </div>
          <JsonBlock defaultOpen label="Accepted delta" value={story.godMode.delta} />
          {story.visibleEvents.length > 0 ? (
            <section className="resolution-section">
              <h2>Observed events</h2>
              <ul>
                {story.visibleEvents.map((event) => (
                  <li key={event.id || event.summary}>{event.summary}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
        <section className="trace-column" aria-labelledby="trace-heading">
          <h1 id="trace-heading">Trace</h1>
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

function StoryStatus({ story }: { readonly story: StoryView }) {
  return (
    <footer className="story-status">
      <span>{titleCase(story.adapterMode)}</span>
      <span>{formatLatency(story.latencyMs)}</span>
      <span>{formatMoney(story.estimatedCostUsd)}</span>
      <span>{story.usage.totalTokens.toLocaleString()} tokens</span>
    </footer>
  );
}

function MobileNavigation({
  mode,
  onMode,
}: {
  readonly mode: Mode;
  readonly onMode: (mode: Mode) => void;
}) {
  return (
    <nav aria-label="Story views" className="mobile-bottom-nav">
      <button
        aria-current={mode === "reader" ? "page" : undefined}
        className={mode === "reader" ? "is-active" : ""}
        onClick={() => onMode("reader")}
        type="button"
      >
        <BookIcon />
        Reader
      </button>
      <button
        aria-current={mode === "god" ? "page" : undefined}
        className={mode === "god" ? "is-active" : ""}
        onClick={() => onMode("god")}
        type="button"
      >
        <InspectIcon />
        God Mode
      </button>
    </nav>
  );
}

export function StoryShell(props: StoryShellProps) {
  const [mode, setMode] = useState<Mode>("reader");

  return (
    <div className={`story-app story-app--${mode}`}>
      <StoryHeader mode={mode} onMode={setMode} />
      {mode === "reader" ? <ReaderView {...props} /> : <GodModeView story={props.story} />}
      <StoryStatus story={props.story} />
      <MobileNavigation mode={mode} onMode={setMode} />
      {props.busy ? (
        <div aria-live="polite" className="turn-progress" role="status">
          <span />
          {props.streamedProse ? "Replaying validated chapter…" : "Resolving world turn…"}
        </div>
      ) : null}
    </div>
  );
}
