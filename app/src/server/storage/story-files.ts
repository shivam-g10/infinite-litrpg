import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const MAX_CHAPTER = 350;
const STALE_LOCK_AGE_MS = 5 * 60 * 1000;
const SAFE_STORY_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const STORY_CHAPTER_FILENAME = /^chapter-([0-9]{3})\.md$/u;
const WINDOWS_RESERVED_NAMES = new Set([
  "aux",
  "clock$",
  "con",
  "nul",
  "prn",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);
const STORY_FILE_KEYS = new Set(["chapter", "pov", "prose", "storyId", "title", "worldVersion"]);
const STORY_FILE_PATTERN =
  /^---\nstoryId: ([^\n]+)\nchapter: ([^\n]+)\ntitle: ([^\n]+)\npov: ([^\n]+)\nworldVersion: ([^\n]+)\n---\n\n# Chapter ([0-9]+): ([^\n]+)\n\n([\s\S]+)\n$/u;

export interface StoryChapterFile {
  readonly chapter: number;
  readonly pov: string;
  readonly prose: string;
  readonly storyId: string;
  readonly title: string;
  readonly worldVersion: number;
}

export interface StoredStoryChapter extends StoryChapterFile {
  readonly absolutePath: string;
  readonly filename: string;
}

export interface StoryFileStoreOptions {
  /** Test seam and deployment override. Defaults to the repository-level `stories` directory. */
  readonly rootDirectory?: string;
}

export interface WriteStoryChapterOptions {
  /** Must be exactly true to replace an existing chapter file. */
  readonly revision?: boolean;
}

export class StoryFileValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "StoryFileValidationError";
  }
}

export class StoryChapterExistsError extends Error {
  readonly absolutePath: string;

  constructor(absolutePath: string) {
    super(`Story chapter already exists: ${absolutePath}`);
    this.name = "StoryChapterExistsError";
    this.absolutePath = absolutePath;
  }
}

export class StoryChapterWriteConflictError extends Error {
  readonly absolutePath: string;

  constructor(absolutePath: string) {
    super(`Another writer is updating story chapter: ${absolutePath}`);
    this.name = "StoryChapterWriteConflictError";
    this.absolutePath = absolutePath;
  }
}

export class InvalidStoryFileError extends Error {
  readonly absolutePath: string | null;

  constructor(message: string, absolutePath: string | null = null) {
    super(absolutePath === null ? message : `${message}: ${absolutePath}`);
    this.name = "InvalidStoryFileError";
    this.absolutePath = absolutePath;
  }
}

/** Returns the only supported chapter filename for a canonical chapter number. */
export function storyChapterFilename(chapter: number): string {
  assertChapter(chapter);
  return `chapter-${String(chapter).padStart(3, "0")}.md`;
}

/** Strict ASCII slug check. Narrow IDs avoid traversal, case collisions, and Windows device names. */
export function isSafeStoryId(storyId: unknown): storyId is string {
  return (
    typeof storyId === "string" &&
    SAFE_STORY_ID.test(storyId) &&
    !WINDOWS_RESERVED_NAMES.has(storyId)
  );
}

/** Produces deterministic LF-only Markdown containing reader-safe chapter fields only. */
export function renderStoryChapterMarkdown(input: StoryChapterFile): string {
  const chapter = validateStoryChapter(input);

  return [
    "---",
    `storyId: ${JSON.stringify(chapter.storyId)}`,
    `chapter: ${chapter.chapter}`,
    `title: ${JSON.stringify(chapter.title)}`,
    `pov: ${JSON.stringify(chapter.pov)}`,
    `worldVersion: ${chapter.worldVersion}`,
    "---",
    "",
    `# Chapter ${chapter.chapter}: ${chapter.title}`,
    "",
    chapter.prose,
    "",
  ].join("\n");
}

/** Parses only the canonical format emitted by `renderStoryChapterMarkdown`. */
export function parseStoryChapterMarkdown(markdown: string): StoryChapterFile {
  if (typeof markdown !== "string") {
    throw new InvalidStoryFileError("Story chapter Markdown must be a string");
  }

  const normalizedMarkdown = normalizeLineEndings(markdown);
  const match = STORY_FILE_PATTERN.exec(normalizedMarkdown);
  if (!match) {
    throw new InvalidStoryFileError("Story chapter Markdown does not match the canonical format");
  }

  const storyId = parseJsonString(match[1], "storyId");
  const chapter = parseInteger(match[2], "chapter");
  const title = parseJsonString(match[3], "title");
  const pov = parseJsonString(match[4], "pov");
  const worldVersion = parseInteger(match[5], "worldVersion");
  const headingChapter = parseInteger(match[6], "heading chapter");
  const headingTitle = match[7];
  const prose = match[8];
  if (headingChapter !== chapter || headingTitle !== title) {
    throw new InvalidStoryFileError("Story chapter heading does not match its metadata");
  }

  let parsed: StoryChapterFile;
  try {
    parsed = validateStoryChapter({ chapter, pov, prose, storyId, title, worldVersion });
  } catch (error) {
    throw new InvalidStoryFileError(
      error instanceof Error ? error.message : "Story chapter metadata is invalid",
    );
  }

  if (renderStoryChapterMarkdown(parsed) !== normalizedMarkdown) {
    throw new InvalidStoryFileError("Story chapter Markdown is not canonical");
  }
  return parsed;
}

export class StoryFileStore {
  readonly rootDirectory: string;

  constructor(options: StoryFileStoreOptions = {}) {
    const rootDirectory = options.rootDirectory ?? defaultStoriesRoot();
    if (
      typeof rootDirectory !== "string" ||
      rootDirectory.trim().length === 0 ||
      rootDirectory.includes("\0")
    ) {
      throw new StoryFileValidationError("rootDirectory must be a non-empty filesystem path");
    }
    this.rootDirectory = resolve(/* turbopackIgnore: true */ rootDirectory);
  }

  async writeChapter(
    input: StoryChapterFile,
    options: WriteStoryChapterOptions = {},
  ): Promise<StoredStoryChapter> {
    const chapter = validateStoryChapter(input);
    const revision = validateWriteOptions(options);
    const filename = storyChapterFilename(chapter.chapter);
    const storyDirectory = this.storyDirectory(chapter.storyId);
    const absolutePath = join(storyDirectory, filename);
    const lockPath = join(storyDirectory, `.${filename}.lock`);
    const temporaryPath = join(storyDirectory, `.${filename}.${randomUUID()}.tmp`);

    await mkdir(storyDirectory, { recursive: true });

    const lockHandle = await acquireChapterLock(lockPath, absolutePath);

    let temporaryFileCreated = false;
    try {
      if (!revision && (await pathExists(absolutePath))) {
        throw new StoryChapterExistsError(absolutePath);
      }

      const temporaryHandle = await open(temporaryPath, "wx", 0o600);
      temporaryFileCreated = true;
      try {
        await temporaryHandle.writeFile(renderStoryChapterMarkdown(chapter), "utf8");
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle.close();
      }

      await rename(temporaryPath, absolutePath);
      temporaryFileCreated = false;
    } finally {
      try {
        if (temporaryFileCreated) {
          await rm(temporaryPath, { force: true });
        }
      } finally {
        try {
          await lockHandle.close();
        } finally {
          await rm(lockPath, { force: true });
        }
      }
    }

    return { ...chapter, absolutePath, filename };
  }

  async readChapter(storyId: string, chapter: number): Promise<StoredStoryChapter | null> {
    assertStoryId(storyId);
    const filename = storyChapterFilename(chapter);
    const absolutePath = join(this.storyDirectory(storyId), filename);
    let markdown: string;
    try {
      markdown = await readFile(absolutePath, "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }

    let parsed: StoryChapterFile;
    try {
      parsed = parseStoryChapterMarkdown(markdown);
    } catch (error) {
      if (error instanceof InvalidStoryFileError) {
        throw new InvalidStoryFileError(error.message, absolutePath);
      }
      throw error;
    }
    if (parsed.storyId !== storyId || parsed.chapter !== chapter) {
      throw new InvalidStoryFileError(
        "Story chapter metadata does not match its path",
        absolutePath,
      );
    }
    return { ...parsed, absolutePath, filename };
  }

  async listChapters(storyId: string): Promise<StoredStoryChapter[]> {
    assertStoryId(storyId);
    const storyDirectory = this.storyDirectory(storyId);
    let entries;
    try {
      entries = await readdir(storyDirectory, { withFileTypes: true });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return [];
      throw error;
    }

    const chapterNumbers = entries
      .filter((entry) => entry.isFile())
      .map((entry) => STORY_CHAPTER_FILENAME.exec(entry.name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => {
        const chapter = Number(match[1]);
        if (chapter < 1 || chapter > MAX_CHAPTER) {
          throw new InvalidStoryFileError(
            "Story chapter filename is outside the supported range",
            join(storyDirectory, match[0]),
          );
        }
        return chapter;
      })
      .sort((left, right) => left - right);

    const chapters: StoredStoryChapter[] = [];
    for (const chapter of chapterNumbers) {
      const stored = await this.readChapter(storyId, chapter);
      if (stored !== null) chapters.push(stored);
    }
    return chapters;
  }

  private storyDirectory(storyId: string): string {
    assertStoryId(storyId);
    return join(this.rootDirectory, storyId);
  }
}

async function acquireChapterLock(lockPath: string, absolutePath: string) {
  try {
    return await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }

  let lockStats;
  try {
    lockStats = await stat(lockPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
  if (
    lockStats !== undefined &&
    (!lockStats.isFile() || Date.now() - lockStats.mtimeMs <= STALE_LOCK_AGE_MS)
  ) {
    throw new StoryChapterWriteConflictError(absolutePath);
  }

  const stalePath = `${lockPath}.stale.${randomUUID()}`;
  if (lockStats !== undefined) {
    try {
      await rename(lockPath, stalePath);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw new StoryChapterWriteConflictError(absolutePath);
      }
    }
  }

  try {
    return await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new StoryChapterWriteConflictError(absolutePath);
    }
    throw error;
  } finally {
    await rm(stalePath, { force: true });
  }
}

function validateStoryChapter(input: unknown): StoryChapterFile {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new StoryFileValidationError("Story chapter must be an object");
  }

  const record = input as Record<string, unknown>;
  const unexpectedKeys = Object.keys(record).filter((key) => !STORY_FILE_KEYS.has(key));
  if (unexpectedKeys.length > 0) {
    throw new StoryFileValidationError(
      `Story chapter contains unsupported fields: ${unexpectedKeys.sort().join(", ")}`,
    );
  }
  for (const key of STORY_FILE_KEYS) {
    if (!Object.hasOwn(record, key)) {
      throw new StoryFileValidationError(`Story chapter is missing ${key}`);
    }
  }

  const storyId = assertStoryId(record.storyId);
  const chapter = assertChapter(record.chapter);
  const title = validateSingleLineText(record.title, "title", 200);
  const pov = validateSingleLineText(record.pov, "pov", 100);
  const worldVersion = validateWorldVersion(record.worldVersion);
  if (typeof record.prose !== "string") {
    throw new StoryFileValidationError("prose must be a string");
  }
  if (record.prose.includes("\0")) {
    throw new StoryFileValidationError("prose cannot contain a null byte");
  }
  const prose = normalizeLineEndings(record.prose).trim();
  if (prose.length === 0) {
    throw new StoryFileValidationError("prose cannot be empty");
  }

  return { chapter, pov, prose, storyId, title, worldVersion };
}

function validateWriteOptions(options: unknown): boolean {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new StoryFileValidationError("Write options must be an object");
  }
  const record = options as Record<string, unknown>;
  const unexpectedKeys = Object.keys(record).filter((key) => key !== "revision");
  if (unexpectedKeys.length > 0) {
    throw new StoryFileValidationError(
      `Write options contain unsupported fields: ${unexpectedKeys.sort().join(", ")}`,
    );
  }
  if (record.revision !== undefined && typeof record.revision !== "boolean") {
    throw new StoryFileValidationError("revision must be a boolean");
  }
  return record.revision === true;
}

function assertStoryId(value: unknown): string {
  if (typeof value !== "string" || !isSafeStoryId(value)) {
    throw new StoryFileValidationError(
      "storyId must be a lowercase ASCII slug of 1 to 64 characters and not a Windows device name",
    );
  }
  return value;
}

function assertChapter(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_CHAPTER) {
    throw new StoryFileValidationError("chapter must be a safe integer from 1 through 350");
  }
  return value as number;
}

function validateWorldVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new StoryFileValidationError("worldVersion must be a positive safe integer");
  }
  return value as number;
}

function validateSingleLineText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string") {
    throw new StoryFileValidationError(`${field} must be a string`);
  }
  if (
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new StoryFileValidationError(
      `${field} must be trimmed, single-line text no longer than ${maximumLength} characters`,
    );
  }
  return value;
}

function parseJsonString(value: string | undefined, field: string): string {
  if (value === undefined) {
    throw new InvalidStoryFileError(`Story chapter is missing ${field}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new InvalidStoryFileError(`Story chapter ${field} is not a JSON string`);
  }
  if (typeof parsed !== "string") {
    throw new InvalidStoryFileError(`Story chapter ${field} must be a string`);
  }
  return parsed;
}

function parseInteger(value: string | undefined, field: string): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new InvalidStoryFileError(`Story chapter ${field} must be a canonical integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidStoryFileError(`Story chapter ${field} exceeds the safe integer range`);
  }
  return parsed;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function defaultStoriesRoot(): string {
  const currentDirectory = resolve(/* turbopackIgnore: true */ process.cwd());
  const projectDirectory =
    basename(currentDirectory).toLowerCase() === "app"
      ? dirname(currentDirectory)
      : currentDirectory;
  return join(projectDirectory, "stories");
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
