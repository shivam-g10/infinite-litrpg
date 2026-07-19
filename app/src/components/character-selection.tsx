"use client";

import type { CharacterId, PublicCharacterProfile } from "@infinite-litrpg/shared";
import { useState } from "react";

interface CharacterSelectionProps {
  readonly busy: boolean;
  readonly characters: readonly PublicCharacterProfile[];
  readonly error: string | null;
  readonly onLock: (characterId: CharacterId) => void;
  readonly onRetry: () => void;
}

export function CharacterSelection({
  busy,
  characters,
  error,
  onLock,
  onRetry,
}: CharacterSelectionProps) {
  const [selectedId, setSelectedId] = useState<CharacterId>("rowan-ashborn");
  const selectedCharacter =
    characters.find(({ id }) => id === selectedId) ?? characters.at(0) ?? null;

  if (!selectedCharacter) {
    return (
      <main className="empty-screen">
        <h1>No characters found.</h1>
      </main>
    );
  }

  return (
    <main className="selection-shell">
      <header className="topbar">
        <div className="brand-group">
          <span aria-hidden="true" className="brand-mark brand-mark--small">
            ᚱ
          </span>
          <span className="brand">Infinite LitRPG</span>
          <span className="story-name">Ashen Crown</span>
        </div>
        <button className="text-action" disabled type="button">
          Import save
        </button>
      </header>

      <section className="selection-intro" aria-labelledby="selection-heading">
        <h1 id="selection-heading">Choose one life.</h1>
        <p>The world moves without you. Your viewpoint cannot change after the story begins.</p>
      </section>

      <div className="selection-workspace">
        <ol className="character-list" aria-label="Selectable characters">
          {characters.map((character, index) => {
            const selected = character.id === selectedId;
            return (
              <li
                className={selected ? "character-row is-selected" : "character-row"}
                key={character.id}
              >
                <button
                  aria-pressed={selected}
                  className="character-choice"
                  disabled={busy}
                  onClick={() => setSelectedId(character.id)}
                  type="button"
                >
                  <span className="character-number">{index + 1}</span>
                  <span aria-hidden="true" className="selection-rune">
                    {selected ? "⌘" : ""}
                  </span>
                  <span className="character-copy">
                    <strong>{character.name}</strong>
                    <span>{character.publicRole}</span>
                    <small>
                      {character.characterClass} · Level {character.level} · {character.location}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <aside className="selection-detail" aria-live="polite">
          <h2>{selectedCharacter.name}</h2>
          <p className="detail-label">Public profile</p>
          <dl>
            <div>
              <dt>Role</dt>
              <dd>{selectedCharacter.publicRole}</dd>
            </div>
            <div>
              <dt>Class</dt>
              <dd>{selectedCharacter.characterClass}</dd>
            </div>
            <div>
              <dt>Level</dt>
              <dd>Level {selectedCharacter.level}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{selectedCharacter.location}</dd>
            </div>
          </dl>
          <div className="safe-goals">
            <h3>Safe starting goals</h3>
            <ul>
              {selectedCharacter.safeStartingGoals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          </div>
          <p className="lock-warning">
            <span aria-hidden="true">!</span>
            This viewpoint stays locked for all 350 chapters.
          </p>

          {error ? (
            <div className="error-rail" role="alert">
              <p>{error}</p>
              <button onClick={onRetry} type="button">
                Retry
              </button>
            </div>
          ) : null}

          <button
            aria-describedby="viewpoint-lock-warning"
            className="primary-action"
            disabled={busy}
            onClick={() => onLock(selectedCharacter.id)}
            type="button"
          >
            {busy ? "Locking viewpoint…" : `Begin as ${selectedCharacter.name.split(" ")[0]}`}
          </button>
          <span className="sr-only" id="viewpoint-lock-warning">
            Confirm permanent viewpoint lock.
          </span>
          <button
            className="secondary-action"
            disabled={busy}
            onClick={() => onLock(selectedCharacter.id)}
            type="button"
          >
            Load seeded world
          </button>
        </aside>
      </div>

      <footer className="selection-footer">
        Local save <span aria-hidden="true">·</span> Bring your own OpenAI API key{" "}
        <span aria-hidden="true">·</span> No account
      </footer>
    </main>
  );
}
