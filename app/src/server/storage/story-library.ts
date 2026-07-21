import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { CHARACTER_IDS } from "@infinite-litrpg/shared";

import { isSafeStoryId, storyChapterFilename } from "./story-files";

const LIBRARY_SCHEMA_VERSION = 1 as const;
const MAX_CHAPTER_COUNT = 350;
const CHARACTER_ID_SET = new Set<string>(CHARACTER_IDS);
const CREATE_STORY_KEYS = new Set(["id", "povCharacterId", "title"]);
const UPDATE_STORY_KEYS = new Set(["chapterCount", "title"]);
const STORY_METADATA_KEYS = new Set([
  "chapterCount",
  "createdAt",
  "id",
  "povCharacterId",
  "status",
  "title",
  "updatedAt",
]);
const LIBRARY_INDEX_KEYS = new Set(["activeStoryId", "schemaVersion", "stories"]);

type StoryStatus = "active" | "rejected";

export interface StoryMetadata {
  readonly chapterCount: number;
  readonly createdAt: string;
  readonly id: string;
  readonly povCharacterId: string;
  readonly status: StoryStatus;
  readonly title: string;
  readonly updatedAt: string;
}

export interface CreateStoryInput {
  readonly id: string;
  readonly povCharacterId: string;
  readonly title: string;
}

export interface UpdateStoryInput {
  readonly chapterCount?: number;
  readonly title?: string;
}

export interface StoryLibraryOptions {
  /** Test seam and deployment override. Defaults to repository-level `stories`. */
  readonly rootDirectory?: string;
  /** Test seam for deterministic timestamps. */
  readonly now?: () => Date;
}

interface StoryLibraryIndex {
  readonly activeStoryId: string | null;
  readonly schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  readonly stories: StoryMetadata[];
}

export class StoryLibraryValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "StoryLibraryValidationError";
  }
}

export class InvalidStoryLibraryError extends Error {
  readonly libraryPath: string;

  constructor(message: string, libraryPath: string) {
    super(`${message}: ${libraryPath}`);
    this.name = "InvalidStoryLibraryError";
    this.libraryPath = libraryPath;
  }
}

export class StoryAlreadyExistsError extends Error {
  readonly storyId: string;

  constructor(storyId: string) {
    super(`Story already exists: ${storyId}`);
    this.name = "StoryAlreadyExistsError";
    this.storyId = storyId;
  }
}

export class StoryNotFoundError extends Error {
  readonly storyId: string;

  constructor(storyId: string) {
    super(`Story not found: ${storyId}`);
    this.name = "StoryNotFoundError";
    this.storyId = storyId;
  }
}

export class RejectedStoryError extends Error {
  readonly storyId: string;

  constructor(storyId: string) {
    super(`Rejected story must be activated before changes: ${storyId}`);
    this.name = "RejectedStoryError";
    this.storyId = storyId;
  }
}

/**
 * Local metadata index for story directories. `active` means usable; `activeStoryId`
 * selects the current story. Rejection never removes story data and activation reopens it.
 */
export class StoryLibrary {
  readonly libraryPath: string;
  readonly rootDirectory: string;

  private readonly now: () => Date;

  constructor(options: StoryLibraryOptions = {}) {
    const rootDirectory = options.rootDirectory ?? defaultStoriesRoot();
    if (
      typeof rootDirectory !== "string" ||
      rootDirectory.trim().length === 0 ||
      rootDirectory.includes("\0")
    ) {
      throw new StoryLibraryValidationError("rootDirectory must be a non-empty filesystem path");
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new StoryLibraryValidationError("now must be a function");
    }

    this.rootDirectory = resolve(/* turbopackIgnore: true */ rootDirectory);
    this.libraryPath = join(this.rootDirectory, "library.json");
    this.now = options.now ?? (() => new Date());
  }

  listStories(): StoryMetadata[] {
    return this.readIndex().stories.map(cloneStory);
  }

  listActiveStories(): StoryMetadata[] {
    return this.readIndex()
      .stories.filter(({ status }) => status === "active")
      .map(cloneStory);
  }

  getStory(storyId: string): StoryMetadata | null {
    const id = validateIdentifier(storyId, "storyId");
    const story = this.readIndex().stories.find((candidate) => candidate.id === id);
    return story === undefined ? null : cloneStory(story);
  }

  getActiveStory(): StoryMetadata | null {
    const index = this.readIndex();
    if (index.activeStoryId === null) return null;
    const story = index.stories.find(({ id }) => id === index.activeStoryId);
    if (story === undefined) {
      throw new InvalidStoryLibraryError(
        "Active story is missing from library metadata",
        this.libraryPath,
      );
    }
    return cloneStory(story);
  }

  createStory(input: CreateStoryInput): StoryMetadata {
    const validated = validateCreateStoryInput(input);
    const index = this.readIndex();
    if (index.stories.some(({ id }) => id === validated.id)) {
      throw new StoryAlreadyExistsError(validated.id);
    }

    const storyDirectory = this.storyDirectoryPath(validated.id);
    if (pathExists(storyDirectory)) {
      throw new StoryAlreadyExistsError(validated.id);
    }

    const timestamp = this.currentTimestamp();
    const story: StoryMetadata = {
      chapterCount: 0,
      createdAt: timestamp,
      id: validated.id,
      povCharacterId: validated.povCharacterId,
      status: "active",
      title: validated.title,
      updatedAt: timestamp,
    };
    const nextIndex: StoryLibraryIndex = {
      activeStoryId: story.id,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      stories: [...index.stories, story],
    };

    mkdirSync(this.rootDirectory, { recursive: true });
    try {
      mkdirSync(storyDirectory);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) throw new StoryAlreadyExistsError(validated.id);
      throw error;
    }
    try {
      this.writeIndex(nextIndex);
    } catch (error) {
      try {
        rmdirSync(storyDirectory);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Failed to write library metadata and roll back the new story directory",
        );
      }
      throw error;
    }
    return cloneStory(story);
  }

  activateStory(storyId: string): StoryMetadata {
    const id = validateIdentifier(storyId, "storyId");
    const index = this.readIndex();
    const storyIndex = findStoryIndex(index, id);
    const story = index.stories[storyIndex];
    if (story === undefined) throw new StoryNotFoundError(id);
    if (index.activeStoryId === id && story.status === "active") return cloneStory(story);

    const updated: StoryMetadata = {
      ...story,
      status: "active",
      updatedAt: this.currentTimestamp(story.updatedAt),
    };
    this.writeIndex({
      ...index,
      activeStoryId: id,
      stories: replaceStory(index.stories, storyIndex, updated),
    });
    return cloneStory(updated);
  }

  rejectStory(storyId: string): StoryMetadata {
    const id = validateIdentifier(storyId, "storyId");
    const index = this.readIndex();
    const storyIndex = findStoryIndex(index, id);
    const story = index.stories[storyIndex];
    if (story === undefined) throw new StoryNotFoundError(id);
    if (story.status === "rejected") return cloneStory(story);

    const rejected: StoryMetadata = {
      ...story,
      status: "rejected",
      updatedAt: this.currentTimestamp(story.updatedAt),
    };
    this.writeIndex({
      ...index,
      activeStoryId: index.activeStoryId === id ? null : index.activeStoryId,
      stories: replaceStory(index.stories, storyIndex, rejected),
    });
    return cloneStory(rejected);
  }

  updateStory(storyId: string, input: UpdateStoryInput): StoryMetadata {
    const id = validateIdentifier(storyId, "storyId");
    const patch = validateUpdateStoryInput(input);
    const index = this.readIndex();
    const storyIndex = findStoryIndex(index, id);
    const story = index.stories[storyIndex];
    if (story === undefined) throw new StoryNotFoundError(id);
    if (story.status === "rejected") throw new RejectedStoryError(id);
    if (patch.chapterCount !== undefined && patch.chapterCount < story.chapterCount) {
      throw new StoryLibraryValidationError("chapterCount cannot decrease");
    }

    const chapterCount = patch.chapterCount ?? story.chapterCount;
    const title = patch.title ?? story.title;
    if (chapterCount === story.chapterCount && title === story.title) return cloneStory(story);

    const updated: StoryMetadata = {
      ...story,
      chapterCount,
      title,
      updatedAt: this.currentTimestamp(story.updatedAt),
    };
    this.writeIndex({
      ...index,
      stories: replaceStory(index.stories, storyIndex, updated),
    });
    return cloneStory(updated);
  }

  storyDirectoryPath(storyId: string): string {
    const id = validateIdentifier(storyId, "storyId");
    return join(this.rootDirectory, id);
  }

  storyDatabasePath(storyId: string): string {
    return join(this.storyDirectoryPath(storyId), "story.db");
  }

  chapterMarkdownPath(storyId: string, chapter: number): string {
    return join(
      this.storyDirectoryPath(storyId),
      storyChapterFilename(validateChapterNumber(chapter)),
    );
  }

  private currentTimestamp(previous?: string): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new StoryLibraryValidationError("now must return a valid Date");
    }
    const timestamp = value.toISOString();
    if (previous !== undefined && timestamp < previous) {
      throw new StoryLibraryValidationError("now cannot move backwards");
    }
    return timestamp;
  }

  private readIndex(): StoryLibraryIndex {
    let json: string;
    try {
      json = readFileSync(this.libraryPath, "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return emptyIndex();
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json) as unknown;
    } catch {
      throw new InvalidStoryLibraryError("Library metadata is not valid JSON", this.libraryPath);
    }
    try {
      return validateLibraryIndex(parsed);
    } catch (error) {
      throw new InvalidStoryLibraryError(
        error instanceof Error ? error.message : "Library metadata is invalid",
        this.libraryPath,
      );
    }
  }

  private writeIndex(index: StoryLibraryIndex): void {
    const validated = validateLibraryIndex(index);
    mkdirSync(this.rootDirectory, { recursive: true });
    const temporaryPath = join(this.rootDirectory, `.library.json.${randomUUID()}.tmp`);
    let descriptor: number | null = null;
    let temporaryFileCreated = false;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      temporaryFileCreated = true;
      writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      renameSync(temporaryPath, this.libraryPath);
      temporaryFileCreated = false;
    } finally {
      try {
        if (descriptor !== null) closeSync(descriptor);
      } finally {
        if (temporaryFileCreated) rmSync(temporaryPath, { force: true });
      }
    }
  }
}

function validateCreateStoryInput(input: unknown): CreateStoryInput {
  const record = validateExactObject(input, CREATE_STORY_KEYS, "Create story input");
  return {
    id: validateIdentifier(record.id, "id"),
    povCharacterId: validatePovCharacterId(record.povCharacterId),
    title: validateTitle(record.title),
  };
}

function validateUpdateStoryInput(input: unknown): UpdateStoryInput {
  const record = validateExactObject(input, UPDATE_STORY_KEYS, "Update story input", false);
  const hasChapterCount = Object.hasOwn(record, "chapterCount");
  const hasTitle = Object.hasOwn(record, "title");
  if (!hasChapterCount && !hasTitle) {
    throw new StoryLibraryValidationError("Update story input must include chapterCount or title");
  }

  const result: { chapterCount?: number; title?: string } = {};
  if (hasChapterCount) result.chapterCount = validateChapterCount(record.chapterCount);
  if (hasTitle) result.title = validateTitle(record.title);
  return result;
}

function validateLibraryIndex(input: unknown): StoryLibraryIndex {
  const record = validateExactObject(input, LIBRARY_INDEX_KEYS, "Library metadata");
  if (record.schemaVersion !== LIBRARY_SCHEMA_VERSION) {
    throw new StoryLibraryValidationError("Library metadata has an unsupported schemaVersion");
  }
  if (!Array.isArray(record.stories)) {
    throw new StoryLibraryValidationError("Library metadata stories must be an array");
  }
  const stories = record.stories.map((story, index) => validateStoryMetadata(story, index));
  const ids = new Set<string>();
  for (const story of stories) {
    if (ids.has(story.id)) {
      throw new StoryLibraryValidationError("Library metadata contains duplicate story IDs");
    }
    ids.add(story.id);
  }

  let activeStoryId: string | null;
  if (record.activeStoryId === null) {
    activeStoryId = null;
  } else {
    activeStoryId = validateIdentifier(record.activeStoryId, "activeStoryId");
    const active = stories.find(({ id }) => id === activeStoryId);
    if (active === undefined || active.status !== "active") {
      throw new StoryLibraryValidationError(
        "Library metadata activeStoryId must reference an active story",
      );
    }
  }

  return { activeStoryId, schemaVersion: LIBRARY_SCHEMA_VERSION, stories };
}

function validateStoryMetadata(input: unknown, index: number): StoryMetadata {
  const record = validateExactObject(
    input,
    STORY_METADATA_KEYS,
    `Library story metadata at index ${index}`,
  );
  const status = record.status;
  if (status !== "active" && status !== "rejected") {
    throw new StoryLibraryValidationError("Story status must be active or rejected");
  }
  const createdAt = validateTimestamp(record.createdAt, "createdAt");
  const updatedAt = validateTimestamp(record.updatedAt, "updatedAt");
  if (updatedAt < createdAt) {
    throw new StoryLibraryValidationError("Story updatedAt cannot precede createdAt");
  }

  return {
    chapterCount: validateChapterCount(record.chapterCount),
    createdAt,
    id: validateIdentifier(record.id, "id"),
    povCharacterId: validatePovCharacterId(record.povCharacterId),
    status,
    title: validateTitle(record.title),
    updatedAt,
  };
}

function validateExactObject(
  input: unknown,
  keys: ReadonlySet<string>,
  label: string,
  requireAll = true,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new StoryLibraryValidationError(`${label} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const unexpectedKeys = Object.keys(record).filter((key) => !keys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new StoryLibraryValidationError(
      `${label} contains unsupported fields: ${unexpectedKeys.sort().join(", ")}`,
    );
  }
  if (requireAll) {
    for (const key of keys) {
      if (!Object.hasOwn(record, key)) {
        throw new StoryLibraryValidationError(`${label} is missing ${key}`);
      }
    }
  }
  return record;
}

function validateIdentifier(value: unknown, field: string): string {
  if (!isSafeStoryId(value)) {
    throw new StoryLibraryValidationError(
      `${field} must be a safe lowercase ASCII identifier of 1 to 64 characters`,
    );
  }
  return value;
}

function validatePovCharacterId(value: unknown): string {
  if (typeof value !== "string" || !CHARACTER_ID_SET.has(value)) {
    throw new StoryLibraryValidationError(
      "povCharacterId must identify one of the six selectable characters",
    );
  }
  return value;
}

function validateTitle(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new StoryLibraryValidationError(
      "title must be trimmed, single-line text no longer than 200 characters",
    );
  }
  return value;
}

function validateChapterCount(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_CHAPTER_COUNT
  ) {
    throw new StoryLibraryValidationError("chapterCount must be a safe integer from 0 through 350");
  }
  return value as number;
}

function validateChapterNumber(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_CHAPTER_COUNT
  ) {
    throw new StoryLibraryValidationError("chapter must be a safe integer from 1 through 350");
  }
  return value as number;
}

function validateTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new StoryLibraryValidationError(`${field} must be a canonical ISO timestamp`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new StoryLibraryValidationError(`${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function findStoryIndex(index: StoryLibraryIndex, storyId: string): number {
  const found = index.stories.findIndex(({ id }) => id === storyId);
  if (found === -1) throw new StoryNotFoundError(storyId);
  return found;
}

function replaceStory(
  stories: readonly StoryMetadata[],
  index: number,
  story: StoryMetadata,
): StoryMetadata[] {
  return stories.map((candidate, candidateIndex) => (candidateIndex === index ? story : candidate));
}

function cloneStory(story: StoryMetadata): StoryMetadata {
  return { ...story };
}

function emptyIndex(): StoryLibraryIndex {
  return { activeStoryId: null, schemaVersion: LIBRARY_SCHEMA_VERSION, stories: [] };
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function defaultStoriesRoot(): string {
  const currentDirectory = resolve(/* turbopackIgnore: true */ process.cwd());
  const projectDirectory =
    basename(currentDirectory).toLowerCase() === "app"
      ? dirname(currentDirectory)
      : currentDirectory;
  return join(projectDirectory, "stories");
}

function hasErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
