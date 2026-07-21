"use client";

import {
  DEFAULT_STORY_SETUP,
  STORY_BACKGROUNDS,
  STORY_GENDERS,
  STORY_GENRES,
  STORY_MEMORIES,
  STORY_PERSONALITIES,
  STORY_POWER_PATHS,
  STORY_REBIRTH_CAUSES,
  STORY_STARTING_LIVES,
  STORY_SYSTEM_FOCUSES,
  StorySetupSchema,
  type StoryCast,
  type StorySetup,
  type StoryWorld,
} from "@infinite-litrpg/shared";
import { useId, useState, type FormEvent } from "react";

const DEFAULT_TITLE = "A Second Life, A Stronger Path";
const TITLE_LIMIT = 100;
const GUIDANCE_LIMIT = 500;

const MALE_NAMES = ["Kael", "Orin", "Dain", "Riven", "Tarin", "Aren", "Corin", "Soren"] as const;
const FEMALE_NAMES = [
  "Ilyra",
  "Selene",
  "Mira",
  "Neris",
  "Lyra",
  "Veya",
  "Talia",
  "Elowen",
] as const;
const FAMILY_NAMES = ["Venn", "Kest", "Marr", "Oris", "Vale", "Thorne", "Dusk", "Rook"] as const;
const OLD_NAMES = [
  "Azrath",
  "Vaelor",
  "Mordren",
  "Serath",
  "Kaivar",
  "Orvath",
  "Zareth",
  "Malvek",
] as const;

interface Choice<T extends string> {
  readonly label: string;
  readonly value: T;
}

const STARTING_LIFE_CHOICES = defineChoices(STORY_STARTING_LIVES, {
  adult: "Adult",
  birth: "Born again",
  child: "Child",
  teen: "Teen",
});

const POWER_PATH_CHOICES = defineChoices(STORY_POWER_PATHS, {
  overpowered: "Overpowered",
  "weak-to-strong": "Weak to strong",
});

const GENDER_CHOICES = defineChoices(STORY_GENDERS, {
  female: "Female",
  male: "Male",
});

const GENRE_CHOICES = defineChoices(STORY_GENRES, {
  action: "Action",
  adventure: "Adventure",
  "dark-fantasy": "Dark fantasy",
  drama: "Drama",
  mystery: "Mystery",
  romance: "Romance",
});

const PERSONALITY_CHOICES = defineChoices(STORY_PERSONALITIES, {
  ambitious: "Ambitious",
  curious: "Curious",
  pragmatic: "Pragmatic",
  protective: "Protective",
  ruthless: "Ruthless",
  warm: "Warm",
});

const BACKGROUND_CHOICES = defineChoices(STORY_BACKGROUNDS, {
  "former-ruler": "Former ruler",
  "hidden-heir": "Hidden heir",
  orphan: "Orphan",
  outcast: "Outcast",
});

const REBIRTH_CAUSE_CHOICES = defineChoices(STORY_REBIRTH_CAUSES, {
  accident: "Accident",
  betrayal: "Betrayal",
  execution: "Execution",
  "ritual-failure": "Ritual failure",
  sacrifice: "Sacrifice",
});

const MEMORY_CHOICES = defineChoices(STORY_MEMORIES, {
  fragments: "Fragments",
  full: "Full",
  sealed: "Sealed",
});

const SYSTEM_FOCUS_CHOICES = defineChoices(STORY_SYSTEM_FOCUSES, {
  "levels-and-class": "Levels and class",
  "skill-fusion": "Skill fusion",
  territory: "Territory",
  "titles-and-oaths": "Titles and oaths",
});

const STARTING_LIFE_PREMISE: Readonly<Record<StorySetup["startingLife"], string>> = {
  adult: "as an adult",
  birth: "from birth",
  child: "in a child's body",
  teen: "in a teenage body",
};

export interface StorySetupSubmission {
  readonly povCharacterId: "rowan-ashborn";
  readonly setup: StorySetup;
  readonly title: string;
}

interface StorySetupCreatorProps {
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly initialSetup?: StorySetup;
  readonly initialTitle?: string;
  readonly onCancel?: () => void;
  readonly onCreate: (submission: StorySetupSubmission) => void;
  readonly onOpenStory?: (storyId: string) => void;
  readonly savedStories?: readonly {
    readonly chapterCount: number;
    readonly id: string;
    readonly title: string;
  }[];
}

interface SingleChoiceGroupProps<T extends string> {
  readonly busy: boolean;
  readonly choices: readonly Choice<T>[];
  readonly label: string;
  readonly name: string;
  readonly onChange: (value: T) => void;
  readonly value: T;
}

interface MultiChoiceGroupProps<T extends string> {
  readonly busy: boolean;
  readonly choices: readonly Choice<T>[];
  readonly label: string;
  readonly maximum: number;
  readonly onChange: (value: T) => void;
  readonly selected: readonly T[];
}

function defineChoices<T extends readonly string[]>(
  values: T,
  labels: Readonly<Record<T[number], string>>,
): readonly Choice<T[number]>[] {
  return values.map((value) => ({ label: labels[value as T[number]], value }));
}

function choiceLabel<T extends string>(choices: readonly Choice<T>[], value: T): string {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

function choiceLabels<T extends string>(
  choices: readonly Choice<T>[],
  values: readonly T[],
): string {
  return values.map((value) => choiceLabel(choices, value)).join(", ");
}

export function toggleLimitedSelection<T extends string>(
  current: readonly T[],
  value: T,
  maximum: number,
  minimum = 1,
): T[] {
  if (current.includes(value)) {
    return current.length > minimum ? current.filter((item) => item !== value) : [...current];
  }

  return current.length < maximum ? [...current, value] : [...current];
}

export function createStorySetupSubmission(
  title: string,
  setup: StorySetup,
  protagonistName = setup.cast.protagonist,
  cast = setup.cast,
): StorySetupSubmission | null {
  const normalizedTitle = title.trim();
  const normalizedName = protagonistName.trim() || cast.protagonist;
  const parsedSetup = StorySetupSchema.safeParse({
    ...setup,
    cast: { ...cast, protagonist: normalizedName },
    guidance: setup.guidance.trim(),
  });

  if (
    normalizedTitle.length === 0 ||
    normalizedTitle.length > TITLE_LIMIT ||
    !parsedSetup.success
  ) {
    return null;
  }

  return {
    povCharacterId: "rowan-ashborn",
    setup: parsedSetup.data,
    title: normalizedTitle,
  };
}

export function createStoryCast(seed: string, gender: StorySetup["protagonistGender"]): StoryCast {
  let state = [...seed].reduce(
    (value, character) => (value * 33 + character.codePointAt(0)!) >>> 0,
    5381,
  );
  const pick = <T,>(values: readonly T[]): T => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return values[state % values.length]!;
  };
  const used = new Set<string>();
  const fullName = (firstNames: readonly string[]): string => {
    let name = "";
    do name = `${pick(firstNames)} ${pick(FAMILY_NAMES)}`;
    while (used.has(name));
    used.add(name);
    return name;
  };
  const protagonist = fullName(gender === "female" ? FEMALE_NAMES : MALE_NAMES);
  return {
    pastLife: pick(OLD_NAMES),
    protagonist,
    supporting: {
      general: fullName(MALE_NAMES),
      hero: fullName(FEMALE_NAMES),
      prince: fullName(MALE_NAMES),
      rival: fullName(FEMALE_NAMES),
      saint: fullName(FEMALE_NAMES),
    },
  };
}

const STORY_WORLDS: readonly StoryWorld[] = [
  {
    calendarName: "Stormwake",
    crownName: "Tempest Crown",
    legionName: "Gale Legion",
    primarySkillName: "Pulse Reading",
    protagonistClassName: "Stormmarked",
    raiderName: "Gale Reavers",
    roadName: "Thunder Road",
    secondarySkillName: "Tyrant's Resonance",
    settlementName: "Havenreach",
    systemName: "Throne Protocol",
  },
  {
    calendarName: "Moonturn",
    crownName: "Eclipse Crown",
    legionName: "Silver Legion",
    primarySkillName: "Night Sight",
    protagonistClassName: "Moonbound",
    raiderName: "Veil Raiders",
    roadName: "Moonlit Way",
    secondarySkillName: "Monarch's Recall",
    settlementName: "Starhaven",
    systemName: "Celestial Ledger",
  },
  {
    calendarName: "Bloomtide",
    crownName: "Briar Crown",
    legionName: "Verdant Guard",
    primarySkillName: "Life Thread",
    protagonistClassName: "Rootsworn",
    raiderName: "Thorn Marauders",
    roadName: "Rootway",
    secondarySkillName: "Ancient Dominion",
    settlementName: "Greenhold",
    systemName: "World Loom",
  },
  {
    calendarName: "Highwater",
    crownName: "Pearl Crown",
    legionName: "Deep Legion",
    primarySkillName: "Current Sense",
    protagonistClassName: "Tideborn",
    raiderName: "Salt Reavers",
    roadName: "Tideway",
    secondarySkillName: "Abyssal Command",
    settlementName: "Breakwater",
    systemName: "Abyssal Interface",
  },
  {
    calendarName: "Runecycle",
    crownName: "Sigil Crown",
    legionName: "Iron Legion",
    primarySkillName: "Rune Sight",
    protagonistClassName: "Glyphbound",
    raiderName: "Rune Breakers",
    roadName: "Glyph Road",
    secondarySkillName: "Sovereign Script",
    settlementName: "Stonegate",
    systemName: "Pathfinder Matrix",
  },
  {
    calendarName: "Sunreach",
    crownName: "Radiant Crown",
    legionName: "Dawn Guard",
    primarySkillName: "Aura Reading",
    protagonistClassName: "Dawnmarked",
    raiderName: "Dusk Raiders",
    roadName: "Sunward Road",
    secondarySkillName: "Imperial Radiance",
    settlementName: "Brightwater",
    systemName: "Ascendant Record",
  },
] as const;

export function createStoryWorld(seed: string): StoryWorld {
  const index = [...seed].reduce(
    (value, character) => (Math.imul(value, 31) + character.codePointAt(0)!) >>> 0,
    17,
  );
  return structuredClone(STORY_WORLDS[index % STORY_WORLDS.length]!);
}

export function buildStoryPremise(setup: StorySetup): string {
  const gender = choiceLabel(GENDER_CHOICES, setup.protagonistGender).toLowerCase();
  const powerPath = choiceLabel(POWER_PATH_CHOICES, setup.powerPath).toLowerCase();
  const genres = choiceLabels(GENRE_CHOICES, setup.genres).toLowerCase();
  const personalities = choiceLabels(PERSONALITY_CHOICES, setup.personalityTraits).toLowerCase();

  return `A ${gender} protagonist is reincarnated ${STARTING_LIFE_PREMISE[setup.startingLife]} and guided by a System. This ${powerPath} story blends ${genres}, shaped by a ${personalities} nature.`;
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m4.5 10.4 3.3 3.3 7.7-8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="10" rx="1.5" width="14" x="5" y="10" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
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

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

function SingleChoiceGroup<T extends string>({
  busy,
  choices,
  label,
  name,
  onChange,
  value,
}: SingleChoiceGroupProps<T>) {
  return (
    <fieldset className="creator-fieldset creator-fieldset--single">
      <legend>
        {label} <span>Choose one</span>
      </legend>
      <div
        className={`creator-choice-grid creator-choice-grid--${choices.length}`}
        role="presentation"
      >
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <label
              className={selected ? "creator-choice is-selected" : "creator-choice"}
              key={choice.value}
            >
              <input
                checked={selected}
                className="sr-only"
                disabled={busy}
                name={name}
                onChange={() => onChange(choice.value)}
                type="radio"
                value={choice.value}
              />
              <span>{choice.label}</span>
              <span aria-hidden="true" className="creator-choice__mark">
                {selected ? <CheckIcon /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function MultiChoiceGroup<T extends string>({
  busy,
  choices,
  label,
  maximum,
  onChange,
  selected,
}: MultiChoiceGroupProps<T>) {
  const atMaximum = selected.length >= maximum;

  return (
    <fieldset className="creator-fieldset creator-fieldset--multi">
      <legend>
        {label} <span>Choose up to {maximum}</span>
      </legend>
      <div
        className={`creator-choice-grid creator-choice-grid--${choices.length}`}
        role="presentation"
      >
        {choices.map((choice) => {
          const checked = selected.includes(choice.value);
          const disabled = busy || (atMaximum && !checked);
          return (
            <label
              className={checked ? "creator-choice is-selected" : "creator-choice"}
              key={choice.value}
            >
              <input
                checked={checked}
                className="sr-only"
                disabled={disabled}
                onChange={() => onChange(choice.value)}
                type="checkbox"
                value={choice.value}
              />
              <span>{choice.label}</span>
              <span aria-hidden="true" className="creator-choice__mark">
                {checked ? <CheckIcon /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function StorySetupCreator({
  busy = false,
  error = null,
  initialSetup = DEFAULT_STORY_SETUP,
  initialTitle = DEFAULT_TITLE,
  onCancel,
  onCreate,
  onOpenStory,
  savedStories = [],
}: StorySetupCreatorProps) {
  const formId = useId();
  const [title, setTitle] = useState(initialTitle.slice(0, TITLE_LIMIT));
  const [protagonistName, setProtagonistName] = useState("");
  const [setup, setSetup] = useState<StorySetup>(() => ({
    ...initialSetup,
    backgrounds: [...initialSetup.backgrounds],
    genres: [...initialSetup.genres],
    personalityTraits: [...initialSetup.personalityTraits],
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const [premiseOpen, setPremiseOpen] = useState(true);
  const submissionError = formError ?? error;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submission = createStorySetupSubmission(
      title,
      { ...setup, world: createStoryWorld(crypto.randomUUID()) },
      protagonistName,
      createStoryCast(crypto.randomUUID(), setup.protagonistGender),
    );

    if (!submission) {
      setFormError("Add a title and keep every selection within its stated limit.");
      return;
    }

    setFormError(null);
    onCreate(submission);
  };

  return (
    <main className="creator-shell">
      <header className="creator-header">
        <span className="creator-brand">
          <span aria-hidden="true" className="creator-brand__desktop">
            INFINITE LITRPG
          </span>
          <span className="creator-brand__mobile">Infinite LitRPG</span>
        </span>
        {onCancel ? (
          <button
            aria-label="Back to library"
            className="creator-back"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <BackIcon />
            <span className="creator-back__desktop">Back to library</span>
            <span className="creator-back__mobile">Back</span>
          </button>
        ) : null}
        <span className="creator-saved">
          <CheckIcon /> Saved locally
        </span>
      </header>

      <section className="creator-lead" aria-labelledby={`${formId}-heading`}>
        <h1 id={`${formId}-heading`}>Create your story</h1>
        <p>Choose the bones. We will build the world, protagonist, and opening chapter.</p>
      </section>

      {savedStories.length > 0 && onOpenStory ? (
        <section className="creator-library" aria-labelledby={`${formId}-library`}>
          <h2 id={`${formId}-library`}>Continue a saved story</h2>
          <div>
            {savedStories.map((story) => (
              <button
                disabled={busy}
                key={story.id}
                onClick={() => onOpenStory(story.id)}
                type="button"
              >
                <strong>{story.title}</strong>
                <span>Chapter {story.chapterCount}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <form className="creator-form" onSubmit={handleSubmit}>
        <div className="creator-fields">
          <label className="creator-text-field" htmlFor={`${formId}-title`}>
            <span>Story title</span>
            <input
              autoComplete="off"
              disabled={busy}
              id={`${formId}-title`}
              maxLength={TITLE_LIMIT}
              onChange={(event) => {
                setTitle(event.target.value);
                setFormError(null);
              }}
              required
              type="text"
              value={title}
            />
            <small>
              {title.length} / {TITLE_LIMIT}
            </small>
          </label>

          <label className="creator-text-field" htmlFor={`${formId}-protagonist-name`}>
            <span>
              Main character name <small>Optional</small>
            </span>
            <input
              autoComplete="off"
              disabled={busy}
              id={`${formId}-protagonist-name`}
              maxLength={60}
              onChange={(event) => setProtagonistName(event.target.value)}
              placeholder="Leave blank to generate a fresh name"
              type="text"
              value={protagonistName}
            />
            <small>{protagonistName.trim() ? "Your name" : "Generated when created"}</small>
          </label>

          <section className="creator-foundation" aria-labelledby={`${formId}-foundation`}>
            <h2 id={`${formId}-foundation`}>
              Foundation <span>Fixed</span>
            </h2>
            <div>
              <span>
                <LockIcon /> Reincarnation
              </span>
              <span>
                <LockIcon /> System
              </span>
              <small>Available in this demo</small>
            </div>
          </section>

          <div className="creator-single-row">
            <SingleChoiceGroup
              busy={busy}
              choices={STARTING_LIFE_CHOICES}
              label="Starting life"
              name={`${formId}-starting-life`}
              onChange={(startingLife) => setSetup((current) => ({ ...current, startingLife }))}
              value={setup.startingLife}
            />
            <SingleChoiceGroup
              busy={busy}
              choices={POWER_PATH_CHOICES}
              label="Power path"
              name={`${formId}-power-path`}
              onChange={(powerPath) => setSetup((current) => ({ ...current, powerPath }))}
              value={setup.powerPath}
            />
            <SingleChoiceGroup
              busy={busy}
              choices={GENDER_CHOICES}
              label="Main character"
              name={`${formId}-gender`}
              onChange={(protagonistGender) =>
                setSetup((current) => ({ ...current, protagonistGender }))
              }
              value={setup.protagonistGender}
            />
          </div>

          <MultiChoiceGroup
            busy={busy}
            choices={GENRE_CHOICES}
            label="Story mix"
            maximum={3}
            onChange={(genre) =>
              setSetup((current) => ({
                ...current,
                genres: toggleLimitedSelection(current.genres, genre, 3),
              }))
            }
            selected={setup.genres}
          />
          <MultiChoiceGroup
            busy={busy}
            choices={PERSONALITY_CHOICES}
            label="Personality"
            maximum={3}
            onChange={(personality) =>
              setSetup((current) => ({
                ...current,
                personalityTraits: toggleLimitedSelection(
                  current.personalityTraits,
                  personality,
                  3,
                ),
              }))
            }
            selected={setup.personalityTraits}
          />
          <MultiChoiceGroup
            busy={busy}
            choices={BACKGROUND_CHOICES}
            label="Background"
            maximum={2}
            onChange={(background) =>
              setSetup((current) => ({
                ...current,
                backgrounds: toggleLimitedSelection(current.backgrounds, background, 2),
              }))
            }
            selected={setup.backgrounds}
          />

          <details className="creator-advanced">
            <summary>
              <span>
                Shape the opening
                <small>Optional detail</small>
              </span>
              <ChevronIcon />
            </summary>
            <div>
              <SingleChoiceGroup
                busy={busy}
                choices={REBIRTH_CAUSE_CHOICES}
                label="Rebirth cause"
                name={`${formId}-rebirth-cause`}
                onChange={(rebirthCause) => setSetup((current) => ({ ...current, rebirthCause }))}
                value={setup.rebirthCause}
              />
              <SingleChoiceGroup
                busy={busy}
                choices={MEMORY_CHOICES}
                label="Past-life memory"
                name={`${formId}-memory`}
                onChange={(memory) => setSetup((current) => ({ ...current, memory }))}
                value={setup.memory}
              />
              <SingleChoiceGroup
                busy={busy}
                choices={SYSTEM_FOCUS_CHOICES}
                label="System focus"
                name={`${formId}-system-focus`}
                onChange={(systemFocus) => setSetup((current) => ({ ...current, systemFocus }))}
                value={setup.systemFocus}
              />
            </div>
          </details>

          <label
            className="creator-text-field creator-text-field--guidance"
            htmlFor={`${formId}-guidance`}
          >
            <span>
              Optional guidance <small>Anything you want us to keep in mind</small>
            </span>
            <textarea
              disabled={busy}
              id={`${formId}-guidance`}
              maxLength={GUIDANCE_LIMIT}
              onChange={(event) =>
                setSetup((current) => ({ ...current, guidance: event.target.value }))
              }
              placeholder="Focus on character growth and meaningful relationships."
              rows={3}
              value={setup.guidance}
            />
            <small>
              Optional · {setup.guidance.length} / {GUIDANCE_LIMIT}
            </small>
          </label>
        </div>

        <details
          className="creator-premise"
          onToggle={(event) => setPremiseOpen(event.currentTarget.open)}
          open={premiseOpen}
        >
          <summary>
            <span>Your story premise</span>
            <ChevronIcon />
          </summary>
          <div className="creator-premise__body" aria-live="polite">
            <dl>
              <div>
                <dt>Title</dt>
                <dd>{title.trim() || "Untitled story"}</dd>
              </div>
              <div>
                <dt>Foundation</dt>
                <dd>Reincarnation + System</dd>
              </div>
              <div>
                <dt>Starting life</dt>
                <dd>{choiceLabel(STARTING_LIFE_CHOICES, setup.startingLife)}</dd>
              </div>
              <div>
                <dt>Power path</dt>
                <dd>{choiceLabel(POWER_PATH_CHOICES, setup.powerPath)}</dd>
              </div>
              <div>
                <dt>Main character</dt>
                <dd>
                  {protagonistName.trim() ||
                    `Fresh ${choiceLabel(GENDER_CHOICES, setup.protagonistGender).toLowerCase()} name`}
                </dd>
              </div>
              <div>
                <dt>Story mix</dt>
                <dd>{choiceLabels(GENRE_CHOICES, setup.genres)}</dd>
              </div>
              <div>
                <dt>Personality</dt>
                <dd>{choiceLabels(PERSONALITY_CHOICES, setup.personalityTraits)}</dd>
              </div>
              <div>
                <dt>Background</dt>
                <dd>{choiceLabels(BACKGROUND_CHOICES, setup.backgrounds)}</dd>
              </div>
            </dl>
            <p>{buildStoryPremise(setup)}</p>
          </div>
        </details>

        {submissionError ? (
          <p className="creator-error" role="alert">
            {submissionError}
          </p>
        ) : null}

        <div className="creator-actions">
          <button className="creator-submit" disabled={busy} type="submit">
            {busy ? "Creating chapter one…" : "Create chapter one"}
          </button>
          {onCancel ? (
            <button className="creator-cancel" disabled={busy} onClick={onCancel} type="button">
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
}
