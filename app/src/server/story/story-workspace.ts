import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import type { StorySetup, WorldState } from "@infinite-litrpg/shared";
import type OpenAI from "openai";

import {
  InvalidStoryFileError,
  StoryFileStore,
  isSafeStoryId,
  type StoredStoryChapter,
  type StoryChapterFile,
  type WriteStoryChapterOptions,
} from "../storage/story-files";
import {
  RejectedStoryError,
  StoryAlreadyExistsError,
  StoryLibrary,
  StoryNotFoundError,
  type StoryMetadata,
} from "../storage/story-library";
import { StoryStore } from "../storage/story-store";
import {
  StoryService,
  type ReaderChapterView,
  type RerollLatestCommand,
  type StoryServiceOptions,
  type StoryGenerationPhase,
  type StoryView,
  type TurnCommand,
} from "./story-service";
import { sanitizeReaderProse } from "./reader-safety";

const CANONICAL_WORLD_ID = "ashen-crown-v1";
const MAX_ID_ATTEMPTS = 8;

export interface CreateWorkspaceStoryInput {
  /** Optional deterministic ID for trusted local tooling such as review-pack generation. */
  readonly id?: string;
  readonly povCharacterId: string;
  readonly setup?: StorySetup;
  readonly title: string;
}

export interface RestartWorkspaceStoryInput {
  readonly povCharacterId?: string;
  readonly title?: string;
}

type StoryWorkspaceWarningCode =
  | "canonical-projection-incomplete"
  | "chapter-projection-failed"
  | "library-sync-failed"
  | "reconciliation-failed";

/** Reader-safe, recoverable filesystem warning. Canonical SQLite data remains available. */
export interface StoryWorkspaceWarning {
  readonly chapter: number | null;
  readonly code: StoryWorkspaceWarningCode;
  readonly committed: boolean;
  readonly message: string;
  readonly retryable: true;
  readonly storyId: string;
}

export interface StoryReconciliationResult {
  readonly canonicalChapterCount: number;
  readonly projectedChapterCount: number;
  readonly warnings: readonly StoryWorkspaceWarning[];
}

export interface WorkspaceStoryResult {
  /** Present on responsive reads so story and generation state come from one event-loop snapshot. */
  readonly generation?: StoryGenerationStatus | null;
  readonly metadata: StoryMetadata;
  readonly story: StoryView;
  readonly warnings: readonly StoryWorkspaceWarning[];
}

export interface StoryGenerationStatus {
  readonly mode: "generate" | "rewrite";
  readonly phase: StoryGenerationPhase;
  readonly storyId: string;
  readonly targetChapter: number;
}

export interface RestartWorkspaceStoryResult {
  readonly rejected: StoryMetadata;
  readonly replacement: WorkspaceStoryResult;
}

export interface StoryWorkspaceService {
  exportJson(): string;
  exportMarkdown(): string;
  getReaderChapter(chapterNumber: number): ReaderChapterView;
  getStory(): StoryView | null;
  rerollLatest(
    command: RerollLatestCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
    onProgress?: (phase: StoryGenerationPhase) => void,
  ): Promise<StoryView>;
  selectPov(povCharacterId: string, setup?: StorySetup): StoryView;
  takeTurn(
    command: TurnCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
    onProgress?: (phase: StoryGenerationPhase) => void,
  ): Promise<StoryView>;
}

export interface StoryWorkspaceServiceFactoryInput {
  readonly client: OpenAI;
  readonly options: StoryServiceOptions;
  readonly seedLoader: (() => WorldState) | undefined;
  readonly store: StoryStore;
}

export interface StoryWorkspaceProjectionStore {
  readChapter(storyId: string, chapter: number): Promise<StoredStoryChapter | null>;
  writeChapter(
    input: StoryChapterFile,
    options?: WriteStoryChapterOptions,
  ): Promise<StoredStoryChapter>;
}

export interface StoryWorkspaceOptions {
  readonly client: OpenAI;
  /** Defaults to the repository-level ignored `stories` directory. */
  readonly rootDirectory?: string;
  readonly serviceOptions: StoryServiceOptions | ((story: StoryMetadata) => StoryServiceOptions);
  /** Test seam for deterministic IDs. The returned value becomes the ID suffix. */
  readonly idGenerator?: () => string;
  /** Test seam shared with StoryLibrary timestamps. */
  readonly now?: () => Date;
  /** Test seam. Production uses StoryFileStore rooted beside the library. */
  readonly projectionStore?: StoryWorkspaceProjectionStore;
  /** Test seam. Production constructs StoryService directly. */
  readonly serviceFactory?: (input: StoryWorkspaceServiceFactoryInput) => StoryWorkspaceService;
  /** Test seam for alternate seed fixtures. */
  readonly seedLoader?: () => WorldState;
  /** Test seam. Production opens one StoryStore for each story database. */
  readonly storeFactory?: (databasePath: string) => StoryStore;
}

export class StoryWorkspaceValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "StoryWorkspaceValidationError";
  }
}

export class StoryWorkspaceDataError extends Error {
  readonly storyId: string;

  constructor(storyId: string, message: string) {
    super(`${message}: ${storyId}`);
    this.name = "StoryWorkspaceDataError";
    this.storyId = storyId;
  }
}

export class StoryWorkspaceClosedError extends Error {
  constructor() {
    super("Story workspace is closed");
    this.name = "StoryWorkspaceClosedError";
  }
}

export class StoryTurnInProgressError extends Error {
  readonly generation: StoryGenerationStatus;

  constructor(generation: StoryGenerationStatus) {
    super(`Chapter ${generation.targetChapter} is already generating`);
    this.name = "StoryTurnInProgressError";
    this.generation = generation;
  }
}

interface StoryRuntime {
  readonly service: StoryWorkspaceService;
  readonly store: StoryStore;
}

/**
 * Coordinates the user-facing story library. SQLite is canonical; Markdown is a
 * recoverable reader-safe projection. Every mutating operation is serialized per story.
 */
export class StoryWorkspace {
  readonly library: StoryLibrary;
  readonly rootDirectory: string;

  private readonly client: OpenAI;
  private readonly idGenerator: () => string;
  private readonly projectionStore: StoryWorkspaceProjectionStore;
  private readonly runtimes = new Map<string, StoryRuntime>();
  private readonly seedLoader: (() => WorldState) | undefined;
  private readonly serviceFactory: (
    input: StoryWorkspaceServiceFactoryInput,
  ) => StoryWorkspaceService;
  private readonly serviceOptions: StoryWorkspaceOptions["serviceOptions"];
  private readonly storeFactory: (databasePath: string) => StoryStore;
  private readonly storyQueues = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, StoryGenerationStatus>();
  private closed = false;

  constructor(options: StoryWorkspaceOptions) {
    if (typeof options !== "object" || options === null) {
      throw new StoryWorkspaceValidationError("StoryWorkspace options must be an object");
    }
    if (options.client === undefined || options.client === null) {
      throw new StoryWorkspaceValidationError("client is required");
    }
    if (
      typeof options.serviceOptions !== "object" &&
      typeof options.serviceOptions !== "function"
    ) {
      throw new StoryWorkspaceValidationError("serviceOptions must be an object or function");
    }

    this.library = new StoryLibrary({
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.rootDirectory === undefined ? {} : { rootDirectory: options.rootDirectory }),
    });
    this.rootDirectory = this.library.rootDirectory;
    this.client = options.client;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.projectionStore =
      options.projectionStore ?? new StoryFileStore({ rootDirectory: this.rootDirectory });
    this.seedLoader = options.seedLoader;
    this.serviceOptions = options.serviceOptions;
    this.storeFactory = options.storeFactory ?? ((databasePath) => new StoryStore(databasePath));
    this.serviceFactory =
      options.serviceFactory ??
      ((input) => new StoryService(input.store, input.client, input.options, input.seedLoader));
  }

  listStories(): StoryMetadata[] {
    this.assertOpen();
    return this.library.listStories();
  }

  getStoryMetadata(storyId: string): StoryMetadata | null {
    this.assertOpen();
    return this.library.getStory(validateStoryId(storyId));
  }

  getActiveStoryMetadata(): StoryMetadata | null {
    this.assertOpen();
    return this.library.getActiveStory();
  }

  getGenerationStatus(storyId: string): StoryGenerationStatus | null {
    this.assertOpen();
    return this.generations.get(validateStoryId(storyId)) ?? null;
  }

  getActiveGenerationStatus(): StoryGenerationStatus | null {
    const active = this.getActiveStoryMetadata();
    return active === null ? null : (this.generations.get(active.id) ?? null);
  }

  listGenerationStatuses(): StoryGenerationStatus[] {
    this.assertOpen();
    return [...this.generations.values()];
  }

  async getActiveStory(): Promise<WorkspaceStoryResult | null> {
    const active = this.getActiveStoryMetadata();
    return active === null ? null : this.getStory(active.id);
  }

  async createStory(input: CreateWorkspaceStoryInput): Promise<WorkspaceStoryResult> {
    this.assertOpen();
    const priorActiveStoryId = this.library.getActiveStory()?.id ?? null;
    const metadata = this.createMetadata(input);

    return this.enqueue(metadata.id, async () => {
      try {
        const runtime = this.openRuntime(metadata, true, input.setup);
        const story = requireStoryView(metadata.id, runtime.service.getStory());
        return { metadata, story, warnings: [] };
      } catch (error) {
        this.closeRuntime(metadata.id);
        try {
          this.library.rejectStory(metadata.id);
          if (priorActiveStoryId !== null) this.library.activateStory(priorActiveStoryId);
        } catch {
          // Preserve the initialization failure. Library data remains on disk for recovery.
        }
        throw error;
      }
    });
  }

  async getStory(storyId: string): Promise<WorkspaceStoryResult | null> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    if (this.library.getStory(id) === null) return null;

    const metadata = requireMetadata(this.library, id);
    const runtime = this.openRuntime(metadata, false);
    const initialStory = requireStoryView(id, runtime.service.getStory());
    const reconciliation = await this.reconcileWithoutHidingStory(runtime, id, initialStory);
    const story = requireStoryView(id, runtime.service.getStory());
    const generation = this.generations.get(id) ?? null;
    return {
      generation,
      metadata: requireMetadata(this.library, id),
      story,
      warnings: reconciliation.warnings,
    };
  }

  async activateStory(storyId: string): Promise<WorkspaceStoryResult> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    return this.enqueue(id, async () => {
      const existing = requireMetadata(this.library, id);
      const runtime = this.openRuntime(existing, false);
      const story = requireStoryView(id, runtime.service.getStory());
      this.library.activateStory(id);
      const reconciliation = await this.reconcileWithoutHidingStory(runtime, id, story);
      return {
        metadata: requireMetadata(this.library, id),
        story,
        warnings: reconciliation.warnings,
      };
    });
  }

  reopenStory(storyId: string): Promise<WorkspaceStoryResult> {
    return this.activateStory(storyId);
  }

  async rejectStory(storyId: string): Promise<StoryMetadata> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    return this.enqueue(id, async () => {
      const rejected = this.library.rejectStory(id);
      this.closeRuntime(id);
      return rejected;
    });
  }

  async restartStory(
    storyId: string,
    input: RestartWorkspaceStoryInput = {},
  ): Promise<RestartWorkspaceStoryResult> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    return this.enqueue(id, async () => {
      const current = requireMetadata(this.library, id);
      const setup = this.openRuntime(current, false).store.loadStorySetup(CANONICAL_WORLD_ID);
      const replacement = await this.createStory({
        povCharacterId: input.povCharacterId ?? current.povCharacterId,
        ...(setup === null ? {} : { setup }),
        title: input.title ?? restartTitle(current.title),
      });
      const rejected = this.library.rejectStory(id);
      this.closeRuntime(id);
      return { rejected, replacement };
    });
  }

  async getReaderChapter(storyId: string, chapter: number): Promise<ReaderChapterView> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    const metadata = requireMetadata(this.library, id);
    return this.openRuntime(metadata, false).service.getReaderChapter(chapter);
  }

  async takeTurn(
    storyId: string,
    command: TurnCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
    onProgress?: (status: StoryGenerationStatus) => void,
  ): Promise<WorkspaceStoryResult> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    const generation = this.beginGeneration(id, "generate");
    return this.enqueue(id, async () => {
      const metadataBefore = requireMetadata(this.library, id);
      if (metadataBefore.status === "rejected") throw new RejectedStoryError(id);
      const runtime = this.openRuntime(metadataBefore, false);
      const story = await runtime.service.takeTurn(command, onNarrationChunk, (phase) =>
        onProgress?.(this.updateGeneration(generation, phase)),
      );
      const reconciliation = await this.reconcileWithoutHidingStory(runtime, id, story);
      return {
        metadata: requireMetadata(this.library, id),
        story,
        warnings: reconciliation.warnings,
      };
    }).finally(() => this.endGeneration(generation));
  }

  async rerollLatest(
    storyId: string,
    command: RerollLatestCommand,
    onNarrationChunk?: (chunk: string) => void | Promise<void>,
    onProgress?: (status: StoryGenerationStatus) => void,
  ): Promise<WorkspaceStoryResult> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    const generation = this.beginGeneration(id, "rewrite");
    return this.enqueue(id, async () => {
      const metadataBefore = requireMetadata(this.library, id);
      if (metadataBefore.status === "rejected") throw new RejectedStoryError(id);
      const runtime = this.openRuntime(metadataBefore, false);
      const story = await runtime.service.rerollLatest(command, onNarrationChunk, (phase) =>
        onProgress?.(this.updateGeneration(generation, phase)),
      );
      const reconciliation = await this.reconcileWithoutHidingStory(runtime, id, story);
      return {
        metadata: requireMetadata(this.library, id),
        story,
        warnings: reconciliation.warnings,
      };
    }).finally(() => this.endGeneration(generation));
  }

  async exportJson(storyId: string): Promise<string> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    return this.enqueue(id, async () => {
      const metadata = requireMetadata(this.library, id);
      return this.openRuntime(metadata, false).service.exportJson();
    });
  }

  async exportMarkdown(storyId: string): Promise<string> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    return this.enqueue(id, async () => {
      const metadata = requireMetadata(this.library, id);
      const markdown = this.openRuntime(metadata, false).service.exportMarkdown();
      return markdown.replace(/^# .+$/mu, `# ${metadata.title}`);
    });
  }

  async reconcileStory(storyId: string): Promise<StoryReconciliationResult> {
    this.assertOpen();
    const id = validateStoryId(storyId);
    return this.enqueue(id, async () => {
      const metadata = requireMetadata(this.library, id);
      const runtime = this.openRuntime(metadata, false);
      return this.reconcileRuntime(runtime, id);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.storyQueues.values()]);
    for (const runtime of this.runtimes.values()) runtime.store.close();
    this.runtimes.clear();
    this.storyQueues.clear();
    this.generations.clear();
  }

  private createMetadata(input: CreateWorkspaceStoryInput): StoryMetadata {
    if (input.id !== undefined) {
      return this.library.createStory({
        id: validateStoryId(input.id),
        povCharacterId: input.povCharacterId,
        title: input.title,
      });
    }
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const id = generateStoryId(input.title, this.idGenerator());
      try {
        return this.library.createStory({
          id,
          povCharacterId: input.povCharacterId,
          title: input.title,
        });
      } catch (error) {
        if (error instanceof StoryAlreadyExistsError) continue;
        throw error;
      }
    }
    throw new StoryWorkspaceDataError(
      "story-id-collision",
      `Could not allocate a unique story ID after ${MAX_ID_ATTEMPTS} attempts`,
    );
  }

  private openRuntime(
    metadata: StoryMetadata,
    initialize: boolean,
    setup?: StorySetup,
  ): StoryRuntime {
    const cached = this.runtimes.get(metadata.id);
    if (cached !== undefined) return cached;

    const databasePath = this.library.storyDatabasePath(metadata.id);
    if (!initialize && !existsSync(databasePath)) {
      throw new StoryWorkspaceDataError(metadata.id, "Canonical story database is missing");
    }

    const store = this.storeFactory(databasePath);
    try {
      const options =
        typeof this.serviceOptions === "function"
          ? this.serviceOptions(metadata)
          : this.serviceOptions;
      const service = this.serviceFactory({
        client: this.client,
        options,
        seedLoader: this.seedLoader,
        store,
      });
      if (initialize) service.selectPov(metadata.povCharacterId, setup);
      const story = service.getStory();
      if (story === null) {
        throw new StoryWorkspaceDataError(metadata.id, "Canonical story world is missing");
      }
      const runtime = { service, store };
      this.runtimes.set(metadata.id, runtime);
      return runtime;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  private async reconcileWithoutHidingStory(
    runtime: StoryRuntime,
    storyId: string,
    story: StoryView,
  ): Promise<StoryReconciliationResult> {
    try {
      return await this.reconcileRuntime(runtime, storyId);
    } catch (error) {
      return {
        canonicalChapterCount: readStoryChapter(story),
        projectedChapterCount: 0,
        warnings: [
          warning(
            "reconciliation-failed",
            storyId,
            readStoryChapter(story) || null,
            `Canonical chapter committed; projection can be retried: ${errorMessage(error)}`,
          ),
        ],
      };
    }
  }

  private async reconcileRuntime(
    runtime: StoryRuntime,
    storyId: string,
  ): Promise<StoryReconciliationResult> {
    const state = runtime.store.loadWorldState(CANONICAL_WORLD_ID);
    if (state === null) {
      throw new StoryWorkspaceDataError(storyId, "Canonical story world is missing");
    }
    const chapters = runtime.store.loadChapters(state.id);
    const warnings: StoryWorkspaceWarning[] = [];
    let projectedChapterCount = 0;

    for (const chapter of chapters) {
      const expected: StoryChapterFile = {
        chapter: chapter.chapter,
        pov:
          state.characters.find(({ id }) => id === chapter.povCharacterId)?.name ??
          chapter.povCharacterId,
        prose: sanitizeReaderProse(chapter.prose),
        storyId,
        title: chapter.title,
        worldVersion: chapter.stateAfterVersion,
      };
      const projected = await this.projectChapter(expected, warnings);
      if (projected) projectedChapterCount += 1;
    }

    if (chapters.length !== state.chapter) {
      warnings.push(
        warning(
          "canonical-projection-incomplete",
          storyId,
          state.chapter || null,
          `Canonical world is at chapter ${state.chapter}, but SQLite contains ${chapters.length} chapter records`,
        ),
      );
    }

    const latestState = runtime.store.loadWorldState(CANONICAL_WORLD_ID);
    if (latestState === null) {
      throw new StoryWorkspaceDataError(storyId, "Canonical story world disappeared");
    }
    const metadata = requireMetadata(this.library, storyId);
    if (metadata.chapterCount !== latestState.chapter) {
      if (metadata.status === "active") {
        try {
          this.library.updateStory(storyId, { chapterCount: latestState.chapter });
        } catch (error) {
          warnings.push(
            warning(
              "library-sync-failed",
              storyId,
              latestState.chapter || null,
              `Canonical chapter count is ${latestState.chapter}; library sync can be retried: ${errorMessage(error)}`,
            ),
          );
        }
      } else {
        warnings.push(
          warning(
            "library-sync-failed",
            storyId,
            latestState.chapter || null,
            "Rejected story metadata is stale; reopen it to synchronize the chapter count",
          ),
        );
      }
    }

    return {
      canonicalChapterCount: latestState.chapter,
      projectedChapterCount,
      warnings,
    };
  }

  private async projectChapter(
    expected: StoryChapterFile,
    warnings: StoryWorkspaceWarning[],
  ): Promise<boolean> {
    let existing: StoredStoryChapter | null = null;
    let revision = false;
    try {
      existing = await this.projectionStore.readChapter(expected.storyId, expected.chapter);
      if (existing !== null && sameProjection(existing, expected)) return true;
      revision = existing !== null;
    } catch (error) {
      if (error instanceof InvalidStoryFileError) {
        revision = true;
      } else {
        warnings.push(
          warning(
            "chapter-projection-failed",
            expected.storyId,
            expected.chapter,
            `Chapter ${expected.chapter} remains canonical in SQLite; projection read can be retried: ${errorMessage(error)}`,
          ),
        );
        return false;
      }
    }

    try {
      await this.projectionStore.writeChapter(expected, revision ? { revision: true } : {});
      return true;
    } catch (error) {
      warnings.push(
        warning(
          "chapter-projection-failed",
          expected.storyId,
          expected.chapter,
          `Chapter ${expected.chapter} remains canonical in SQLite; Markdown projection can be retried: ${errorMessage(error)}`,
        ),
      );
      return false;
    }
  }

  private enqueue<T>(storyId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.storyQueues.get(storyId) ?? Promise.resolve();
    const current = prior.then(operation);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.storyQueues.set(storyId, settled);
    void settled.then(() => {
      if (this.storyQueues.get(storyId) === settled) this.storyQueues.delete(storyId);
    });
    return current;
  }

  private beginGeneration(
    storyId: string,
    mode: StoryGenerationStatus["mode"],
  ): StoryGenerationStatus {
    const existing = this.generations.get(storyId);
    if (existing !== undefined) throw new StoryTurnInProgressError(existing);
    const metadata = requireMetadata(this.library, storyId);
    if (metadata.status === "rejected") throw new RejectedStoryError(storyId);
    const story = requireStoryView(storyId, this.openRuntime(metadata, false).service.getStory());
    const currentChapter = readStoryChapter(story);
    const generation = {
      mode,
      phase: "preparing",
      storyId,
      targetChapter: mode === "rewrite" ? Math.max(1, currentChapter) : currentChapter + 1,
    } as const;
    this.generations.set(storyId, generation);
    return generation;
  }

  private updateGeneration(
    generation: StoryGenerationStatus,
    phase: StoryGenerationPhase,
  ): StoryGenerationStatus {
    const updated = { ...generation, phase };
    this.generations.set(generation.storyId, updated);
    return updated;
  }

  private endGeneration(generation: StoryGenerationStatus): void {
    if (this.generations.has(generation.storyId)) {
      this.generations.delete(generation.storyId);
    }
  }

  private closeRuntime(storyId: string): void {
    const runtime = this.runtimes.get(storyId);
    if (runtime === undefined) return;
    runtime.store.close();
    this.runtimes.delete(storyId);
  }

  private assertOpen(): void {
    if (this.closed) throw new StoryWorkspaceClosedError();
  }
}

function generateStoryId(title: unknown, suffixCandidate: unknown): string {
  if (typeof suffixCandidate !== "string") {
    throw new StoryWorkspaceValidationError("idGenerator must return a string");
  }
  const suffix = suffixCandidate
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .slice(0, 12);
  if (suffix.length === 0) {
    throw new StoryWorkspaceValidationError(
      "idGenerator must return at least one ASCII letter or digit",
    );
  }
  const base =
    typeof title === "string"
      ? title
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/gu, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 48)
          .replace(/-+$/gu, "")
      : "";
  const id = `${base || "story"}-${suffix}`;
  if (!isSafeStoryId(id)) {
    throw new StoryWorkspaceValidationError("Could not generate a safe story ID");
  }
  return id;
}

function restartTitle(title: string): string {
  const suffix = " — Restart";
  return `${title.slice(0, 100 - suffix.length).trimEnd()}${suffix}`;
}

function validateStoryId(storyId: unknown): string {
  if (!isSafeStoryId(storyId)) {
    throw new StoryWorkspaceValidationError("storyId must be a safe lowercase ASCII identifier");
  }
  return storyId;
}

function requireMetadata(library: StoryLibrary, storyId: string): StoryMetadata {
  const metadata = library.getStory(storyId);
  if (metadata === null) throw new StoryNotFoundError(storyId);
  return metadata;
}

function requireStoryView(storyId: string, story: StoryView | null): StoryView {
  if (story === null)
    throw new StoryWorkspaceDataError(storyId, "Canonical story world is missing");
  return story;
}

function readStoryChapter(story: StoryView): number {
  const chapter = story.world.chapter;
  return Number.isSafeInteger(chapter) && (chapter as number) >= 0 ? (chapter as number) : 0;
}

function sameProjection(existing: StoredStoryChapter, expected: StoryChapterFile): boolean {
  return (
    existing.chapter === expected.chapter &&
    existing.pov === expected.pov &&
    existing.prose === expected.prose &&
    existing.storyId === expected.storyId &&
    existing.title === expected.title &&
    existing.worldVersion === expected.worldVersion
  );
}

function warning(
  code: StoryWorkspaceWarningCode,
  storyId: string,
  chapter: number | null,
  message: string,
): StoryWorkspaceWarning {
  return { chapter, code, committed: true, message, retryable: true, storyId };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
