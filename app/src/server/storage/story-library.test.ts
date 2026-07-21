import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InvalidStoryLibraryError,
  RejectedStoryError,
  StoryAlreadyExistsError,
  StoryLibrary,
  StoryLibraryValidationError,
  StoryNotFoundError,
  type CreateStoryInput,
  type StoryMetadata,
  type UpdateStoryInput,
} from "./story-library";

const FIRST_TIME = "2026-07-21T10:00:00.000Z";
const SECOND_TIME = "2026-07-21T10:01:00.000Z";
const THIRD_TIME = "2026-07-21T10:02:00.000Z";

let temporaryRoot = "";

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), "infinite-litrpg-library-"));
});

afterEach(() => {
  rmSync(temporaryRoot, { force: true, recursive: true });
});

describe("StoryLibrary creation and paths", () => {
  it("treats a missing index as an empty library without creating files", () => {
    const storiesRoot = join(temporaryRoot, "stories");
    const library = new StoryLibrary({ rootDirectory: storiesRoot });

    expect(library.listStories()).toEqual([]);
    expect(library.listActiveStories()).toEqual([]);
    expect(library.getStory("missing-story")).toBeNull();
    expect(library.getActiveStory()).toBeNull();
    expect(existsSync(storiesRoot)).toBe(false);
  });

  it("creates one story directory, strict metadata, and deterministic local paths", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const created = library.createStory(storyInput());

    expect(created).toEqual({
      chapterCount: 0,
      createdAt: FIRST_TIME,
      id: "rowan-ashen-crown",
      povCharacterId: "rowan-ashborn",
      status: "active",
      title: "Ashes of the Fallen Crown",
      updatedAt: FIRST_TIME,
    });
    expect(readdirSync(temporaryRoot).sort()).toEqual(["library.json", "rowan-ashen-crown"]);
    expect(readdirSync(join(temporaryRoot, created.id))).toEqual([]);
    expect(library.storyDirectoryPath(created.id)).toBe(join(temporaryRoot, created.id));
    expect(library.storyDatabasePath(created.id)).toBe(join(temporaryRoot, created.id, "story.db"));
    expect(library.chapterMarkdownPath(created.id, 1)).toBe(
      join(temporaryRoot, created.id, "chapter-001.md"),
    );
    expect(library.chapterMarkdownPath(created.id, 350)).toBe(
      join(temporaryRoot, created.id, "chapter-350.md"),
    );
    expect(existsSync(library.storyDatabasePath(created.id))).toBe(false);
    expect(library.getStory(created.id)).toEqual(created);
    expect(library.getActiveStory()).toEqual(created);
  });

  it("writes only required metadata fields and no secret or canon payload", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    library.createStory(storyInput());

    const raw = readFileSync(library.libraryPath, "utf8");
    const parsed = JSON.parse(raw) as {
      activeStoryId: string;
      schemaVersion: number;
      stories: Record<string, unknown>[];
    };
    expect(Object.keys(parsed).sort()).toEqual(["activeStoryId", "schemaVersion", "stories"]);
    expect(Object.keys(parsed.stories[0] ?? {}).sort()).toEqual([
      "chapterCount",
      "createdAt",
      "id",
      "povCharacterId",
      "status",
      "title",
      "updatedAt",
    ]);
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("hiddenCanon");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("creates multiple sibling directories and makes the newest story current", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME),
      rootDirectory: temporaryRoot,
    });
    const first = library.createStory(storyInput());
    const second = library.createStory(
      storyInput({
        id: "elara-ashen-crown",
        povCharacterId: "elara-voss",
        title: "The Exile's Oath",
      }),
    );

    expect(library.listStories()).toEqual([first, second]);
    expect(library.listActiveStories()).toEqual([first, second]);
    expect(library.getActiveStory()).toEqual(second);
    expect(readdirSync(temporaryRoot).sort()).toEqual([
      "elara-ashen-crown",
      "library.json",
      "rowan-ashen-crown",
    ]);
  });

  it("rejects duplicate metadata and an orphaned directory without deleting either", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const created = library.createStory(storyInput());
    const originalIndex = readFileSync(library.libraryPath, "utf8");

    expect(() => library.createStory(storyInput())).toThrow(StoryAlreadyExistsError);
    expect(readFileSync(library.libraryPath, "utf8")).toBe(originalIndex);
    expect(existsSync(library.storyDirectoryPath(created.id))).toBe(true);

    const orphanId = "orphan-story";
    const orphanDirectory = library.storyDirectoryPath(orphanId);
    mkdirSync(orphanDirectory);
    writeFileSync(join(orphanDirectory, "story.db"), "preserve", "utf8");
    expect(() =>
      library.createStory(storyInput({ id: orphanId, povCharacterId: "nyra-vale" })),
    ).toThrow(StoryAlreadyExistsError);
    expect(readFileSync(join(orphanDirectory, "story.db"), "utf8")).toBe("preserve");
    expect(readFileSync(library.libraryPath, "utf8")).toBe(originalIndex);
  });

  it.each([0, 351, 1.5, Number.NaN])("rejects invalid chapter path number %s", (chapter) => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });
    expect(() => library.chapterMarkdownPath("safe-story", chapter)).toThrow(
      StoryLibraryValidationError,
    );
  });

  it("uses an absolute injected root", () => {
    const relativeRoot = join(".", "relative-story-library-test");
    const library = new StoryLibrary({ rootDirectory: relativeRoot });
    expect(library.rootDirectory).toBe(resolve(relativeRoot));
  });
});

describe("StoryLibrary lifecycle", () => {
  it("activates another usable story and updates only its timestamp", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME, THIRD_TIME),
      rootDirectory: temporaryRoot,
    });
    const first = library.createStory(storyInput());
    const second = library.createStory(
      storyInput({ id: "elara-story", povCharacterId: "elara-voss" }),
    );

    const activated = library.activateStory(first.id);

    expect(activated).toEqual({ ...first, updatedAt: THIRD_TIME });
    expect(library.getActiveStory()).toEqual(activated);
    expect(library.getStory(second.id)).toEqual(second);
  });

  it("does not rewrite metadata when the requested story is already current", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    const before = readFileSync(library.libraryPath, "utf8");

    expect(library.activateStory(story.id)).toEqual(story);
    expect(readFileSync(library.libraryPath, "utf8")).toBe(before);
  });

  it("rejects a story without deleting its database or chapter files", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    const databasePath = library.storyDatabasePath(story.id);
    const chapterPath = library.chapterMarkdownPath(story.id, 1);
    writeFileSync(databasePath, "sqlite bytes", "utf8");
    writeFileSync(chapterPath, "reader-safe chapter", "utf8");

    const rejected = library.rejectStory(story.id);

    expect(rejected).toEqual({ ...story, status: "rejected", updatedAt: SECOND_TIME });
    expect(library.getActiveStory()).toBeNull();
    expect(library.listActiveStories()).toEqual([]);
    expect(library.listStories()).toEqual([rejected]);
    expect(readFileSync(databasePath, "utf8")).toBe("sqlite bytes");
    expect(readFileSync(chapterPath, "utf8")).toBe("reader-safe chapter");
    expect(existsSync(library.storyDirectoryPath(story.id))).toBe(true);
  });

  it("rejecting a non-current story preserves the active pointer", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME, THIRD_TIME),
      rootDirectory: temporaryRoot,
    });
    const first = library.createStory(storyInput());
    const second = library.createStory(
      storyInput({ id: "elara-story", povCharacterId: "elara-voss" }),
    );

    expect(library.rejectStory(first.id).status).toBe("rejected");
    expect(library.getActiveStory()).toEqual(second);
  });

  it("keeps rejection idempotent and reopens it only through activation", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME, THIRD_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    const rejected = library.rejectStory(story.id);
    const before = readFileSync(library.libraryPath, "utf8");

    expect(library.rejectStory(story.id)).toEqual(rejected);
    expect(readFileSync(library.libraryPath, "utf8")).toBe(before);
    expect(() => library.updateStory(story.id, { title: "Forbidden edit" })).toThrow(
      RejectedStoryError,
    );

    const reopened = library.activateStory(story.id);
    expect(reopened).toEqual({ ...story, status: "active", updatedAt: THIRD_TIME });
    expect(library.getActiveStory()).toEqual(reopened);
    expect(existsSync(library.storyDirectoryPath(story.id))).toBe(true);
  });

  it("updates chapter count and title while preserving creation metadata", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());

    const updated = library.updateStory(story.id, {
      chapterCount: 18,
      title: "Ashes Beyond the Crown",
    });

    expect(updated).toEqual({
      ...story,
      chapterCount: 18,
      title: "Ashes Beyond the Crown",
      updatedAt: SECOND_TIME,
    });
    expect(library.getActiveStory()).toEqual(updated);
    expect(library.getStory(story.id)).toEqual(updated);
  });

  it("does not rewrite a no-op update", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    const before = readFileSync(library.libraryPath, "utf8");

    expect(library.updateStory(story.id, { chapterCount: 0, title: story.title })).toEqual(story);
    expect(readFileSync(library.libraryPath, "utf8")).toBe(before);
  });

  it.each([-1, 351, 1.5, Number.NaN])("rejects invalid chapter count %s", (chapterCount) => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    expect(() => library.updateStory(story.id, { chapterCount })).toThrow(
      StoryLibraryValidationError,
    );
  });

  it("rejects chapter count rollback", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    library.updateStory(story.id, { chapterCount: 10 });

    expect(() => library.updateStory(story.id, { chapterCount: 9 })).toThrow(
      "chapterCount cannot decrease",
    );
    expect(library.getStory(story.id)?.chapterCount).toBe(10);
  });

  it("rejects unknown story lifecycle operations", () => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });

    expect(() => library.activateStory("missing-story")).toThrow(StoryNotFoundError);
    expect(() => library.rejectStory("missing-story")).toThrow(StoryNotFoundError);
    expect(() => library.updateStory("missing-story", { chapterCount: 1 })).toThrow(
      StoryNotFoundError,
    );
  });

  it("returns defensive metadata copies", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const created = library.createStory(storyInput());
    const fetched = library.getStory(created.id) as StoryMetadata;
    (fetched as { title: string }).title = "Mutated caller copy";
    const listed = library.listStories();
    (listed[0] as { chapterCount: number }).chapterCount = 99;

    expect(library.getStory(created.id)).toEqual(created);
  });

  it("rejects a clock that moves backwards without changing metadata", () => {
    const library = new StoryLibrary({
      now: clock(SECOND_TIME, FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    const before = readFileSync(library.libraryPath, "utf8");

    expect(() => library.updateStory(story.id, { title: "New title" })).toThrow(
      "now cannot move backwards",
    );
    expect(readFileSync(library.libraryPath, "utf8")).toBe(before);
  });
});

describe("StoryLibrary validation and recovery", () => {
  it.each([
    "",
    ".",
    "..",
    "../escape",
    "..\\escape",
    "C:\\outside",
    "/outside",
    "story/name",
    "story_name",
    "Story",
    "con",
    "com1",
    "a".repeat(65),
  ])("rejects unsafe story ID %s across mutations and paths", (storyId) => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });

    expect(() => library.createStory(storyInput({ id: storyId }))).toThrow(
      StoryLibraryValidationError,
    );
    expect(() => library.getStory(storyId)).toThrow(StoryLibraryValidationError);
    expect(() => library.activateStory(storyId)).toThrow(StoryLibraryValidationError);
    expect(() => library.rejectStory(storyId)).toThrow(StoryLibraryValidationError);
    expect(() => library.storyDirectoryPath(storyId)).toThrow(StoryLibraryValidationError);
    expect(() => library.storyDatabasePath(storyId)).toThrow(StoryLibraryValidationError);
    expect(() => library.chapterMarkdownPath(storyId, 1)).toThrow(StoryLibraryValidationError);
    expect(readdirSync(temporaryRoot)).toEqual([]);
  });

  it.each(["../pov", "Rowan", "nul", "rowan_ashborn", "unknown-hero"])(
    "rejects unsafe POV character ID %s",
    (povCharacterId) => {
      const library = new StoryLibrary({ rootDirectory: temporaryRoot });
      expect(() => library.createStory(storyInput({ povCharacterId }))).toThrow(
        StoryLibraryValidationError,
      );
      expect(readdirSync(temporaryRoot)).toEqual([]);
    },
  );

  it.each(["", " padded", "padded ", "line\nbreak", "tab\tcharacter", "a".repeat(201)])(
    "rejects malformed title %s",
    (title) => {
      const library = new StoryLibrary({ rootDirectory: temporaryRoot });
      expect(() => library.createStory(storyInput({ title }))).toThrow(StoryLibraryValidationError);
    },
  );

  it("rejects unsupported create and update fields so secrets cannot enter metadata", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME),
      rootDirectory: temporaryRoot,
    });
    const unsafeCreate = {
      ...storyInput(),
      apiKey: "redacted",
      hiddenCanon: { identity: "secret" },
    } as CreateStoryInput;

    expect(() => library.createStory(unsafeCreate)).toThrow(
      "Create story input contains unsupported fields: apiKey, hiddenCanon",
    );
    const story = library.createStory(storyInput());
    expect(() =>
      library.updateStory(story.id, {
        hiddenCanon: "secret",
      } as UpdateStoryInput),
    ).toThrow("Update story input contains unsupported fields: hiddenCanon");
    expect(() => library.updateStory(story.id, {})).toThrow(
      "Update story input must include chapterCount or title",
    );
  });

  it.each(["", " padded", "line\nbreak", "a".repeat(201)])(
    "rejects malformed updated title %s",
    (title) => {
      const library = new StoryLibrary({
        now: clock(FIRST_TIME),
        rootDirectory: temporaryRoot,
      });
      const story = library.createStory(storyInput());
      expect(() => library.updateStory(story.id, { title })).toThrow(StoryLibraryValidationError);
    },
  );

  it("rejects a malformed persisted index without replacing it", () => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });
    const malformed = "{not-json";
    writeFileSync(library.libraryPath, malformed, "utf8");

    expect(() => library.listStories()).toThrow(InvalidStoryLibraryError);
    expect(readFileSync(library.libraryPath, "utf8")).toBe(malformed);
  });

  it.each([
    ["unknown top-level field", { extra: true }],
    ["unsupported schema", { schemaVersion: 2 }],
    ["stories not array", { stories: {} }],
    ["missing active pointer", { activeStoryId: undefined }],
  ])("rejects persisted index with %s", (_case, patch) => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });
    const index = { activeStoryId: null, schemaVersion: 1, stories: [], ...patch };
    writeFileSync(library.libraryPath, JSON.stringify(index), "utf8");

    expect(() => library.listStories()).toThrow(InvalidStoryLibraryError);
  });

  it.each([
    ["duplicate IDs", [metadata(), metadata()]],
    ["traversal ID", [metadata({ id: "../escape" })]],
    ["unsafe POV", [metadata({ povCharacterId: "..\\escape" })]],
    ["bad status", [metadata({ status: "deleted" })]],
    ["bad chapter count", [metadata({ chapterCount: 351 })]],
    ["bad timestamp", [metadata({ updatedAt: "yesterday" })]],
    ["backwards timestamp", [metadata({ createdAt: SECOND_TIME, updatedAt: FIRST_TIME })]],
    ["secret field", [{ ...metadata(), hiddenCanon: "secret" }]],
  ])("rejects persisted story metadata with %s", (_case, stories) => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });
    writeIndex(library, { activeStoryId: null, stories });

    expect(() => library.listStories()).toThrow(InvalidStoryLibraryError);
  });

  it("rejects an active pointer to a missing or rejected story", () => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });
    writeIndex(library, { activeStoryId: "missing-story", stories: [metadata()] });
    expect(() => library.getActiveStory()).toThrow(InvalidStoryLibraryError);

    writeIndex(library, {
      activeStoryId: "rowan-ashen-crown",
      stories: [metadata({ status: "rejected" })],
    });
    expect(() => library.getActiveStory()).toThrow(InvalidStoryLibraryError);

    writeIndex(library, { activeStoryId: "../escape", stories: [metadata()] });
    expect(() => library.getActiveStory()).toThrow(InvalidStoryLibraryError);
  });

  it("recovers cleanly from a removed index while preserving orphaned story data", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME),
      rootDirectory: temporaryRoot,
    });
    const oldStory = library.createStory(storyInput());
    const oldDatabase = library.storyDatabasePath(oldStory.id);
    writeFileSync(oldDatabase, "preserve old story", "utf8");
    unlinkSync(library.libraryPath);

    expect(library.listStories()).toEqual([]);
    expect(library.getActiveStory()).toBeNull();
    expect(readFileSync(oldDatabase, "utf8")).toBe("preserve old story");

    const newStory = library.createStory(
      storyInput({ id: "new-story", povCharacterId: "nyra-vale" }),
    );
    expect(library.listStories()).toEqual([newStory]);
    expect(readFileSync(oldDatabase, "utf8")).toBe("preserve old story");
    expect(() => library.createStory(storyInput())).toThrow(StoryAlreadyExistsError);
  });

  it("atomically replaces library metadata without leaving temporary files", () => {
    const library = new StoryLibrary({
      now: clock(FIRST_TIME, SECOND_TIME, THIRD_TIME),
      rootDirectory: temporaryRoot,
    });
    const story = library.createStory(storyInput());
    library.updateStory(story.id, { chapterCount: 1 });
    library.rejectStory(story.id);

    expect(readdirSync(temporaryRoot).sort()).toEqual(["library.json", story.id]);
    expect(() => JSON.parse(readFileSync(library.libraryPath, "utf8"))).not.toThrow();
    expect(library.getStory(story.id)).toMatchObject({ chapterCount: 1, status: "rejected" });
  });

  it("rejects invalid constructor seams", () => {
    expect(() => new StoryLibrary({ rootDirectory: "" })).toThrow(StoryLibraryValidationError);
    expect(() => new StoryLibrary({ now: "not-a-clock" as unknown as () => Date })).toThrow(
      StoryLibraryValidationError,
    );
    const invalidClock = new StoryLibrary({
      now: () => new Date(Number.NaN),
      rootDirectory: temporaryRoot,
    });
    expect(() => invalidClock.createStory(storyInput())).toThrow("now must return a valid Date");
  });
});

function storyInput(overrides: Partial<CreateStoryInput> = {}): CreateStoryInput {
  return {
    id: "rowan-ashen-crown",
    povCharacterId: "rowan-ashborn",
    title: "Ashes of the Fallen Crown",
    ...overrides,
  };
}

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chapterCount: 0,
    createdAt: FIRST_TIME,
    id: "rowan-ashen-crown",
    povCharacterId: "rowan-ashborn",
    status: "active",
    title: "Ashes of the Fallen Crown",
    updatedAt: FIRST_TIME,
    ...overrides,
  };
}

function writeIndex(
  library: StoryLibrary,
  input: { activeStoryId: string | null; stories: unknown[] },
): void {
  writeFileSync(library.libraryPath, JSON.stringify({ ...input, schemaVersion: 1 }), "utf8");
}

function clock(...timestamps: string[]): () => Date {
  let index = 0;
  return () => {
    const timestamp = timestamps[index];
    if (timestamp === undefined) throw new Error("Test clock exhausted");
    index += 1;
    return new Date(timestamp);
  };
}
