import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InvalidStoryFileError,
  StoryChapterExistsError,
  StoryChapterWriteConflictError,
  StoryFileStore,
  StoryFileValidationError,
  isSafeStoryId,
  parseStoryChapterMarkdown,
  renderStoryChapterMarkdown,
  storyChapterFilename,
  type StoryChapterFile,
  type WriteStoryChapterOptions,
} from "./story-files";

let temporaryRoot = "";

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), "infinite-litrpg-story-files-"));
});

afterEach(() => {
  rmSync(temporaryRoot, { force: true, recursive: true });
});

describe("story chapter paths", () => {
  it.each([
    [1, "chapter-001.md"],
    [9, "chapter-009.md"],
    [10, "chapter-010.md"],
    [350, "chapter-350.md"],
  ])("formats chapter %i as %s", (chapter, filename) => {
    expect(storyChapterFilename(chapter)).toBe(filename);
  });

  it.each([0, 351, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid chapter number %s",
    (chapter) => {
      expect(() => storyChapterFilename(chapter)).toThrow(StoryFileValidationError);
    },
  );

  it.each(["ashen-crown", "story-01", "a", "123e4567-e89b-12d3-a456-426614174000"])(
    "accepts safe story ID %s",
    (storyId) => {
      expect(isSafeStoryId(storyId)).toBe(true);
    },
  );

  it("returns false for non-string runtime input", () => {
    expect(isSafeStoryId(123)).toBe(false);
    expect(isSafeStoryId(null)).toBe(false);
  });

  it.each([
    "",
    ".",
    "..",
    "../escape",
    "..\\escape",
    "C:\\stories",
    "/absolute",
    "story/name",
    "story_name",
    "Story",
    "-story",
    "story-",
    "con",
    "nul",
    "com1",
    "lpt9",
    "a".repeat(65),
  ])("rejects unsafe or Windows-reserved story ID %s", async (storyId) => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });

    expect(isSafeStoryId(storyId)).toBe(false);
    await expect(store.writeChapter(chapterInput({ storyId }))).rejects.toBeInstanceOf(
      StoryFileValidationError,
    );
    expect(readdirSync(temporaryRoot)).toEqual([]);
  });
});

describe("story chapter Markdown", () => {
  it("renders and parses deterministic reader-safe Markdown", () => {
    const input = chapterInput({
      pov: "Rowan Ashborn",
      prose: "First line.\r\n\r\nSecond line.",
      title: 'Ash, Steel, and "Old Roads"',
    });

    const markdown = renderStoryChapterMarkdown(input);

    expect(markdown).toBe(
      [
        "---",
        'storyId: "ashen-crown-rowan"',
        "chapter: 1",
        'title: "Ash, Steel, and \\"Old Roads\\""',
        'pov: "Rowan Ashborn"',
        "worldVersion: 2",
        "---",
        "",
        '# Chapter 1: Ash, Steel, and "Old Roads"',
        "",
        "First line.",
        "",
        "Second line.",
        "",
      ].join("\n"),
    );
    expect(markdown).not.toContain("\r");
    expect(parseStoryChapterMarkdown(markdown)).toEqual({
      ...input,
      prose: "First line.\n\nSecond line.",
    });
  });

  it("accepts Windows CRLF files and returns normalized prose", () => {
    const input = chapterInput({ prose: "Line one.\n\nLine two." });
    const windowsMarkdown = renderStoryChapterMarkdown(input).replace(/\n/gu, "\r\n");

    expect(parseStoryChapterMarkdown(windowsMarkdown)).toEqual(input);
  });

  it.each([
    ["title", "Bad\ntitle"],
    ["pov", ""],
    ["worldVersion", 0],
    ["prose", "   \r\n"],
    ["prose", "Text\0secret"],
  ] as const)("rejects invalid %s", (field, value) => {
    expect(() => renderStoryChapterMarkdown(chapterInput({ [field]: value }))).toThrow(
      StoryFileValidationError,
    );
  });

  it("rejects unsupported fields so keys and hidden canon cannot be serialized", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const unsafe = {
      ...chapterInput(),
      apiKey: "not-a-real-key",
      hiddenCanon: { demonKingIdentity: "secret" },
    } as StoryChapterFile;

    await expect(store.writeChapter(unsafe)).rejects.toThrow(
      "Story chapter contains unsupported fields: apiKey, hiddenCanon",
    );
    expect(readdirSync(temporaryRoot)).toEqual([]);
  });

  it.each([
    ["missing metadata", "# Chapter 1: Ash Road Vigil\n\nProse.\n"],
    [
      "heading mismatch",
      renderStoryChapterMarkdown(chapterInput()).replace(
        "# Chapter 1: Ash Road Vigil",
        "# Chapter 2: Forged Title",
      ),
    ],
    [
      "noncanonical padding",
      renderStoryChapterMarkdown(chapterInput()).replace("chapter: 1", "chapter: 01"),
    ],
  ])("rejects %s", (_case, markdown) => {
    expect(() => parseStoryChapterMarkdown(markdown)).toThrow(InvalidStoryFileError);
  });
});

describe("StoryFileStore", () => {
  it("writes through the injected root and reads all required fields", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const input = chapterInput();
    const expectedPath = join(temporaryRoot, input.storyId, "chapter-001.md");

    const stored = await store.writeChapter(input);

    expect(stored).toEqual({
      ...input,
      absolutePath: expectedPath,
      filename: "chapter-001.md",
    });
    expect(await store.readChapter(input.storyId, input.chapter)).toEqual(stored);
    expect(readFileSync(expectedPath, "utf8")).toBe(renderStoryChapterMarkdown(input));
    expect(readdirSync(join(temporaryRoot, input.storyId))).toEqual(["chapter-001.md"]);
  });

  it("returns null and an empty list without creating a missing story directory", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });

    await expect(store.readChapter("missing-story", 1)).resolves.toBeNull();
    await expect(store.listChapters("missing-story")).resolves.toEqual([]);
    expect(readdirSync(temporaryRoot)).toEqual([]);
  });

  it("lists canonical chapter files in numeric order and ignores unrelated files", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    for (const chapter of [10, 2, 1]) {
      await store.writeChapter(
        chapterInput({ chapter, title: `Chapter ${chapter}`, worldVersion: chapter + 1 }),
      );
    }
    const storyDirectory = join(temporaryRoot, "ashen-crown-rowan");
    writeFileSync(join(storyDirectory, "notes.md"), "ignored", "utf8");
    writeFileSync(join(storyDirectory, ".chapter-003.md.crash.tmp"), "ignored", "utf8");
    await mkdir(join(storyDirectory, "chapter-004.md"));

    const chapters = await store.listChapters("ashen-crown-rowan");

    expect(chapters.map(({ chapter }) => chapter)).toEqual([1, 2, 10]);
    expect(chapters.map(({ filename }) => filename)).toEqual([
      "chapter-001.md",
      "chapter-002.md",
      "chapter-010.md",
    ]);
  });

  it("preserves an existing file unless revision is exactly true", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const original = chapterInput();
    const revision = chapterInput({ prose: "Revised reader-safe prose.", title: "Revised Title" });
    const stored = await store.writeChapter(original);

    await expect(store.writeChapter(revision)).rejects.toBeInstanceOf(StoryChapterExistsError);
    expect(await readFile(stored.absolutePath, "utf8")).toBe(renderStoryChapterMarkdown(original));

    await store.writeChapter(revision, { revision: true });

    await expect(store.readChapter(original.storyId, original.chapter)).resolves.toEqual({
      ...revision,
      absolutePath: stored.absolutePath,
      filename: stored.filename,
    });
    expect(readdirSync(join(temporaryRoot, original.storyId))).toEqual([stored.filename]);
  });

  it("rejects non-boolean and unknown revision options", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });

    await expect(
      store.writeChapter(chapterInput(), {
        revision: "yes",
      } as unknown as WriteStoryChapterOptions),
    ).rejects.toThrow("revision must be a boolean");
    await expect(
      store.writeChapter(chapterInput(), {
        replace: true,
      } as unknown as WriteStoryChapterOptions),
    ).rejects.toThrow("Write options contain unsupported fields: replace");
  });

  it("allows only one concurrent first write and never overwrites the winner", async () => {
    const firstStore = new StoryFileStore({ rootDirectory: temporaryRoot });
    const secondStore = new StoryFileStore({ rootDirectory: temporaryRoot });
    const first = chapterInput({ prose: "First candidate." });
    const second = chapterInput({ prose: "Second candidate." });

    const results = await Promise.allSettled([
      firstStore.writeChapter(first),
      secondStore.writeChapter(second),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const stored = await firstStore.readChapter(first.storyId, first.chapter);
    expect([first.prose, second.prose]).toContain(stored?.prose);
  });

  it("does not remove another writer's lock", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const input = chapterInput();
    const storyDirectory = join(temporaryRoot, input.storyId);
    const lockPath = join(storyDirectory, ".chapter-001.md.lock");
    await mkdir(storyDirectory, { recursive: true });
    await writeFile(lockPath, "other writer", "utf8");

    await expect(store.writeChapter(input)).rejects.toBeInstanceOf(StoryChapterWriteConflictError);
    await expect(readFile(lockPath, "utf8")).resolves.toBe("other writer");
    expect(readdirSync(storyDirectory)).toEqual([".chapter-001.md.lock"]);
  });

  it("recovers a crash-stale lock before projecting the canonical chapter", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const input = chapterInput();
    const storyDirectory = join(temporaryRoot, input.storyId);
    const lockPath = join(storyDirectory, ".chapter-001.md.lock");
    await mkdir(storyDirectory, { recursive: true });
    await writeFile(lockPath, "crashed writer", "utf8");
    const staleTime = new Date(Date.now() - 6 * 60 * 1000);
    await utimes(lockPath, staleTime, staleTime);

    await expect(store.writeChapter(input)).resolves.toMatchObject({ chapter: 1 });
    await expect(store.readChapter(input.storyId, 1)).resolves.toMatchObject(input);
    expect(readdirSync(storyDirectory)).toEqual(["chapter-001.md"]);
  });

  it("cleans its temporary file and lock when atomic rename fails", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const input = chapterInput();
    const storyDirectory = join(temporaryRoot, input.storyId);
    const targetDirectory = join(storyDirectory, "chapter-001.md");
    await mkdir(targetDirectory, { recursive: true });

    await expect(store.writeChapter(input, { revision: true })).rejects.toBeInstanceOf(Error);
    expect(readdirSync(storyDirectory)).toEqual(["chapter-001.md"]);
  });

  it("rejects matching filenames whose metadata is malformed or belongs to another story", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const storyDirectory = join(temporaryRoot, "ashen-crown-rowan");
    await mkdir(storyDirectory, { recursive: true });
    await writeFile(
      join(storyDirectory, "chapter-001.md"),
      renderStoryChapterMarkdown(chapterInput({ storyId: "another-story" })),
      "utf8",
    );

    await expect(store.readChapter("ashen-crown-rowan", 1)).rejects.toThrow(
      "Story chapter metadata does not match its path",
    );
    await expect(store.listChapters("ashen-crown-rowan")).rejects.toBeInstanceOf(
      InvalidStoryFileError,
    );
  });

  it("fails closed on a chapter-shaped filename outside the canonical range", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const storyDirectory = join(temporaryRoot, "ashen-crown-rowan");
    await mkdir(storyDirectory, { recursive: true });
    await writeFile(join(storyDirectory, "chapter-000.md"), "invalid", "utf8");

    await expect(store.listChapters("ashen-crown-rowan")).rejects.toThrow(
      "Story chapter filename is outside the supported range",
    );
  });

  it("reads a canonical file after a Windows CRLF conversion", async () => {
    const store = new StoryFileStore({ rootDirectory: temporaryRoot });
    const input = chapterInput({ prose: "Line one.\n\nLine two." });
    const stored = await store.writeChapter(input);
    const markdown = await readFile(stored.absolutePath, "utf8");
    await writeFile(stored.absolutePath, markdown.replace(/\n/gu, "\r\n"), "utf8");

    await expect(store.readChapter(input.storyId, input.chapter)).resolves.toEqual(stored);
  });
});

function chapterInput(overrides: Partial<StoryChapterFile> = {}): StoryChapterFile {
  return {
    chapter: 1,
    pov: "Rowan Ashborn",
    prose: "Ash drifted across the road while Rowan watched the ruined village.",
    storyId: "ashen-crown-rowan",
    title: "Ash Road Vigil",
    worldVersion: 2,
    ...overrides,
  };
}
