import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  CHARACTER_IDS,
  PROMPT_VERSION,
  PUBLIC_CHARACTERS,
  WorldStateSchema,
  type CharacterId,
  type WorldState,
} from "@infinite-litrpg/shared";
import Database from "better-sqlite3";
import { config } from "dotenv";
import OpenAI from "openai";

import {
  REVIEW_STORY_MODELS,
  type StoryServiceOptions,
} from "../app/src/server/story/story-service";
import {
  StoryWorkspace,
  type StoryWorkspaceOptions,
  type StoryWorkspaceWarning,
} from "../app/src/server/story/story-workspace";
import { parseStoryChapterMarkdown } from "../app/src/server/storage/story-files";
import { StoryLibrary, type StoryMetadata } from "../app/src/server/storage/story-library";
import { StoryStore } from "../app/src/server/storage/story-store";
import {
  LiveSpendLedger,
  readLiveSpendSnapshot,
  type LiveSpendSnapshot,
} from "./live-spend-ledger";
import {
  STORY_REVIEW_CHAPTERS_PER_STORY,
  STORY_REVIEW_CHAPTER_CAP_USD,
  STORY_REVIEW_BRANCH_POLICY,
  STORY_REVIEW_SCHEMA_VERSION,
  STORY_REVIEW_TOTAL_CAP_USD,
  STORY_REVIEW_TOTAL_CHAPTERS,
  STORY_REVIEW_VARIANT_CONFIG_SHA256,
  StoryReviewSourceEvidenceSchema,
  assertStoryReviewDatabaseQuality,
  buildStoryReviewChapter,
  buildStoryReviewEvidence,
  buildStoryReviewMarkdown,
  buildStoryReviewPreflight,
  mergeStoryReviewHumanSections,
  parseStoryReviewArgs,
  validateStoryReviewPrefix,
  selectStoryReviewChoice,
  type StoryReviewSourceEvidence,
} from "./story-review";
import {
  assertStoryReviewVariantLedger,
  readStoryReviewVariantMarker,
  storyReviewLedgerSourceId,
  storyReviewVariantArchiveReference,
  type StoryReviewVariantMarker,
} from "./story-review-variant";

const ROOT = process.cwd();
const WORLD_ID = "ashen-crown-v1";
const REPORT_DIRECTORY = resolve(ROOT, "evals", "reports");
export const STORY_REVIEW_STORIES_DIRECTORY = resolve(ROOT, "stories");
const STORY_ARCHIVE_DIRECTORY = resolve(REPORT_DIRECTORY, "story-review-archives");
const LEDGER_PATH = resolve(REPORT_DIRECTORY, "story-review-spend.db");
const VARIANT_MARKER_PATH = resolve(REPORT_DIRECTORY, "story-review-variant.json");
const EVIDENCE_PATH = resolve(ROOT, "docs", "story-review-evidence.json");
const MARKDOWN_PATH = resolve(ROOT, "docs", "SAMPLE_STORIES.md");
const STORY_REVIEW_RUN_ID = "00000000-0000-4000-8000-000000000610";

export interface StoryReviewProgress {
  readonly byCharacter: Readonly<Record<CharacterId, number>>;
  readonly completedChapters: number;
}

async function main(): Promise<void> {
  const args = parseStoryReviewArgs(process.argv.slice(2));
  const sourceGitSha = currentGitSha();
  const variantMarker = currentVariantMarker(sourceGitSha);
  const expectedLedgerSourceId = storyReviewLedgerSourceId(sourceGitSha, variantMarker);
  const progress = readStoryReviewProgress(sourceGitSha);
  const ledgerState = readReviewLedgerState();
  const ledgerSnapshot = requireStoryReviewLedgerState(ledgerState, variantMarker);
  if (ledgerSnapshot.sourceReportSha256 !== expectedLedgerSourceId) {
    throw new Error("Existing story-review evidence belongs to a different source variant");
  }
  const durableExposureUsd = ledgerSnapshot.totalExposureUsd;
  const preflight = buildStoryReviewPreflight(progress.byCharacter, durableExposureUsd);
  const worktreeClean = isCleanWorktree();
  const paidCommand = `npm run review:stories:live -- --confirm-cost --chapter-cap-usd ${STORY_REVIEW_CHAPTER_CAP_USD} --total-cap-usd ${STORY_REVIEW_TOTAL_CAP_USD}`;

  if (args.preflightOnly) {
    console.log(
      JSON.stringify(
        {
          ...preflight,
          branchPolicy: STORY_REVIEW_BRANCH_POLICY,
          chapterCapUsd: args.chapterCapUsd,
          chaptersPerStory: STORY_REVIEW_CHAPTERS_PER_STORY,
          paidCommand,
          priorVariantExposureUsd: ledgerSnapshot.priorSpendUsd,
          providerRequests: 0,
          qualityVariantArchive: storyReviewVariantArchiveReference(variantMarker),
          sourceGitSha,
          stories: CHARACTER_IDS.length,
          totalCapUsd: args.totalCapUsd,
          uncertainExposureUsd: ledgerSnapshot.uncertainReservationCostUsd,
          worktreeClean,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.finalizeOnly) {
    if (progress.completedChapters !== STORY_REVIEW_TOTAL_CHAPTERS) {
      throw new Error("Provider-free finalization requires all sixty committed chapters");
    }
    if (!hasOnlyStoryReviewOutputChanges()) {
      throw new Error("Provider-free finalization allows changes only to story-review outputs");
    }
    const evidence = writeReviewArtifacts(
      collectSourceEvidence(sourceGitSha, ledgerSnapshot, variantMarker),
    );
    console.log(
      `finalized six ten-chapter stories without provider requests: ${MARKDOWN_PATH}; durable exposure $${evidence.durableExposureUsd.toFixed(6)}`,
    );
    return;
  }

  if (progress.completedChapters === STORY_REVIEW_TOTAL_CHAPTERS) {
    throw new Error("All sixty chapters are committed; run npm run review:stories:finalize");
  }
  if (preflight.effectiveChapterCapUsd <= 0 || !preflight.fullPlanFitsAuthorizedCap) {
    throw new Error("Authorized story-review headroom cannot fund the remaining fair-share plan");
  }

  if (!worktreeClean) {
    throw new Error("Paid story-review generation requires a clean committed worktree");
  }

  config({ path: resolve(ROOT, ".env"), quiet: true });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const runId = STORY_REVIEW_RUN_ID;
  const ledger = new LiveSpendLedger(LEDGER_PATH, STORY_REVIEW_TOTAL_CAP_USD);
  let workspace: StoryWorkspace | null = null;
  let ownsRun = false;
  try {
    ledger.acquireRun(runId);
    ownsRun = true;
    const costHooks = ledger.createCostHooks(runId);
    const client = createStoryReviewClient(apiKey);
    workspace = createStoryReviewWorkspace(client, costHooks, preflight.effectiveChapterCapUsd);
    process.env.GIT_SHA = sourceGitSha;

    for (const characterId of CHARACTER_IDS) {
      await generateStory(characterId, workspace);
    }
    await workspace.close();
    workspace = null;

    const snapshot = ledger.snapshot();
    if (snapshot.activeReservationCount !== 0) {
      throw new Error("Completed story review still has an active provider reservation");
    }
    const evidence = writeReviewArtifacts(
      collectSourceEvidence(sourceGitSha, snapshot, variantMarker),
    );
    ledger.releaseRun(runId);
    ownsRun = false;
    console.log(
      `wrote six ten-chapter stories: ${MARKDOWN_PATH}; durable exposure $${evidence.durableExposureUsd.toFixed(6)}`,
    );
  } catch (error) {
    if (ownsRun && ledger.snapshot().activeReservationCount === 0) {
      ledger.releaseRun(runId);
      ownsRun = false;
    }
    throw error;
  } finally {
    await workspace?.close();
    ledger.close();
  }
}

async function generateStory(characterId: CharacterId, workspace: StoryWorkspace): Promise<void> {
  const storyId = storyReviewStoryId(characterId);
  let result = await workspace.getStory(storyId);
  if (result === null) {
    result = await workspace.createStory({
      id: storyId,
      povCharacterId: characterId,
      title: storyReviewTitle(characterId),
    });
  }
  assertReviewStoryIdentity(characterId, result.metadata);
  assertProjectionSucceeded(characterId, result.warnings);

  let view = result.story;
  let snapshot = readReviewStorySnapshot(characterId, workspace.rootDirectory);
  if (snapshot.state.lockedPovId !== characterId) {
    throw new Error(`Story database does not lock ${characterId}`);
  }
  if (snapshot.state.chapter > STORY_REVIEW_CHAPTERS_PER_STORY) {
    throw new Error(`${characterId} already exceeds the ten-chapter review horizon`);
  }
  while (snapshot.state.chapter < STORY_REVIEW_CHAPTERS_PER_STORY) {
    const choice = selectStoryReviewChoice(snapshot.priorActions, view.chapter.choices);
    if (!choice) {
      throw new Error(`${characterId} chapter ${snapshot.state.chapter} lacks a choice`);
    }
    const beforeChapter = snapshot.state.chapter;
    result = await workspace.takeTurn(storyId, {
      choiceId: choice.id,
      expectedWorldVersion: snapshot.state.version,
      requestId: randomUUID(),
      type: "take_action",
    });
    assertReviewStoryIdentity(characterId, result.metadata);
    assertProjectionSucceeded(characterId, result.warnings);
    view = result.story;
    snapshot = readReviewStorySnapshot(characterId, workspace.rootDirectory);
    if (snapshot.state.chapter !== beforeChapter + 1) {
      throw new Error(`${characterId} did not commit exactly one chapter`);
    }
    console.log(
      `${characterId} chapter ${snapshot.state.chapter}/${STORY_REVIEW_CHAPTERS_PER_STORY} committed; $${view.estimatedCostUsd.toFixed(6)}`,
    );
  }
}

function collectSourceEvidence(
  sourceGitSha: string,
  snapshot: LiveSpendSnapshot,
  variantMarker: StoryReviewVariantMarker,
): StoryReviewSourceEvidence {
  const stories = CHARACTER_IDS.map((characterId) => {
    const databasePath = storyReviewDatabasePath(characterId);
    assertStoryReviewDatabaseQuality(characterId, databasePath);
    const store = new StoryStore(databasePath);
    try {
      const state = store.loadWorldState(WORLD_ID);
      if (
        !state ||
        state.lockedPovId !== characterId ||
        state.chapter !== STORY_REVIEW_CHAPTERS_PER_STORY
      ) {
        throw new Error(`${characterId} is not a complete ten-chapter story`);
      }
      const canonicalChapters = store.loadChapters(WORLD_ID);
      const chapters = canonicalChapters.map((chapterRecord) => {
        const worldDelta = store.loadDelta(WORLD_ID, chapterRecord.stateAfterVersion);
        if (!worldDelta) throw new Error(`Missing delta for ${chapterRecord.id}`);
        const trace = store.loadTrace(chapterRecord.traceId);
        if (!trace) throw new Error(`Missing trace ${chapterRecord.traceId}`);
        if (trace.gitSha !== sourceGitSha || trace.adapterMode !== "sequential") {
          throw new Error(`${characterId} mixes source versions or adapter modes`);
        }
        buildStoryReviewChapter(characterId, chapterRecord, trace);
        return { chapterRecord, trace, worldDelta };
      });
      assertCanonicalReviewProjection(characterId, state, canonicalChapters);
      return { chapters, characterId, finalState: state };
    } finally {
      store.close();
    }
  });
  return StoryReviewSourceEvidenceSchema.parse({
    branchPolicy: STORY_REVIEW_BRANCH_POLICY,
    chapterCapUsd: STORY_REVIEW_CHAPTER_CAP_USD,
    chaptersPerStory: STORY_REVIEW_CHAPTERS_PER_STORY,
    durableExposureUsd: snapshot.totalExposureUsd,
    generatedAt: new Date().toISOString(),
    priorVariantExposureUsd: snapshot.priorSpendUsd,
    promptVersion: PROMPT_VERSION,
    qualityVariantArchive: storyReviewVariantArchiveReference(variantMarker),
    schemaVersion: STORY_REVIEW_SCHEMA_VERSION,
    serviceTier: "flex",
    sourceGitSha,
    stories,
    totalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
    variantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
  });
}

function writeReviewArtifacts(source: StoryReviewSourceEvidence) {
  const evidence = buildStoryReviewEvidence(source);
  writeAtomic(EVIDENCE_PATH, `${JSON.stringify(source, null, 2)}\n`);
  const generatedMarkdown = buildStoryReviewMarkdown(evidence);
  const existingMarkdown = existsSync(MARKDOWN_PATH) ? readFileSync(MARKDOWN_PATH, "utf8") : "";
  writeAtomic(MARKDOWN_PATH, mergeStoryReviewHumanSections(generatedMarkdown, existingMarkdown));
  return evidence;
}

export function readStoryReviewProgress(
  sourceGitSha: string,
  rootDirectory = STORY_REVIEW_STORIES_DIRECTORY,
): StoryReviewProgress {
  const byCharacter = Object.fromEntries(
    CHARACTER_IDS.map((characterId) => [
      characterId,
      readStoryChapterCount(characterId, sourceGitSha, rootDirectory),
    ]),
  ) as Record<CharacterId, number>;
  return {
    byCharacter,
    completedChapters: Object.values(byCharacter).reduce((sum, chapter) => sum + chapter, 0),
  };
}

export function createStoryReviewClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 0 });
}

export function buildStoryReviewServiceOptions(
  characterId: CharacterId,
  costHooks: NonNullable<StoryServiceOptions["costHooks"]>,
  chapterCapUsd: number,
): StoryServiceOptions {
  return {
    costHooks,
    enforceNarrativeQuality: true,
    maxBackgroundAgents: 3,
    maxCostUsdPerChapter: chapterCapUsd,
    modelConfig: REVIEW_STORY_MODELS,
    nativeMultiAgent: false,
    promptCacheKey: storyReviewPromptCacheKey(characterId),
    serviceTier: "flex",
  };
}

export function buildStoryReviewWorkspaceOptions(
  client: OpenAI,
  costHooks: NonNullable<StoryServiceOptions["costHooks"]>,
  chapterCapUsd: number,
  rootDirectory = STORY_REVIEW_STORIES_DIRECTORY,
): StoryWorkspaceOptions {
  return {
    client,
    rootDirectory: resolve(rootDirectory),
    serviceOptions: ({ povCharacterId }) =>
      buildStoryReviewServiceOptions(
        requireReviewCharacterId(povCharacterId),
        costHooks,
        chapterCapUsd,
      ),
  };
}

export function createStoryReviewWorkspace(
  client: OpenAI,
  costHooks: NonNullable<StoryServiceOptions["costHooks"]>,
  chapterCapUsd: number,
  rootDirectory = STORY_REVIEW_STORIES_DIRECTORY,
): StoryWorkspace {
  return new StoryWorkspace(
    buildStoryReviewWorkspaceOptions(client, costHooks, chapterCapUsd, rootDirectory),
  );
}

export function storyReviewPromptCacheKey(characterId: CharacterId): string {
  const digest = createHash("sha256").update(characterId).digest("hex").slice(0, 24);
  return `story-review:${digest}`;
}

function readStoryChapterCount(
  characterId: CharacterId,
  sourceGitSha: string,
  rootDirectory = STORY_REVIEW_STORIES_DIRECTORY,
): number {
  const library = new StoryLibrary({ rootDirectory });
  const metadata = library.getStory(storyReviewStoryId(characterId));
  const path = storyReviewDatabasePath(characterId, rootDirectory);
  if (!existsSync(path)) {
    if (metadata !== null) {
      throw new Error(`${characterId} review library entry lacks its canonical database`);
    }
    return 0;
  }
  if (metadata === null) {
    throw new Error(`${characterId} canonical review database lacks library metadata`);
  }
  assertReviewStoryIdentity(characterId, metadata);
  const database = new Database(path, { fileMustExist: true, readonly: true });
  try {
    const row = database
      .prepare("SELECT state_json AS json FROM worlds WHERE id = ?")
      .get(WORLD_ID) as { readonly json: string } | undefined;
    if (!row) return 0;
    const state = WorldStateSchema.parse(JSON.parse(row.json) as unknown);
    const chapters = database
      .prepare(
        `SELECT c.chapter, c.record_json AS chapter_json, d.delta_json, t.trace_json
           FROM chapters c
           JOIN world_deltas d ON d.world_id = c.world_id AND d.chapter = c.chapter
           JOIN traces t ON t.world_id = c.world_id AND t.chapter = c.chapter
          WHERE c.world_id = ?
          ORDER BY c.chapter`,
      )
      .all(WORLD_ID) as {
      readonly chapter: number;
      readonly chapter_json: string;
      readonly delta_json: string;
      readonly trace_json: string;
    }[];
    if (
      state.lockedPovId !== characterId ||
      state.chapter !== chapters.length ||
      state.version !== state.chapter + 1 ||
      state.chapter > STORY_REVIEW_CHAPTERS_PER_STORY ||
      chapters.some(({ chapter }, index) => chapter !== index + 1)
    ) {
      throw new Error(`${characterId} review database is not a contiguous prefix`);
    }
    validateStoryReviewPrefix(
      characterId,
      sourceGitSha,
      chapters.map((chapter) => ({
        chapter: JSON.parse(chapter.chapter_json) as unknown,
        delta: JSON.parse(chapter.delta_json) as unknown,
        trace: JSON.parse(chapter.trace_json) as unknown,
      })),
      state,
    );
    return state.chapter;
  } finally {
    database.close();
  }
}

function readReviewLedgerState(): {
  readonly runId: string | null;
  readonly snapshot: LiveSpendSnapshot | null;
} {
  if (!existsSync(LEDGER_PATH)) return { runId: null, snapshot: null };
  const snapshot = readLiveSpendSnapshot(LEDGER_PATH);
  const database = new Database(LEDGER_PATH, { fileMustExist: true, readonly: true });
  try {
    const lock = database.prepare("SELECT run_id FROM run_lock WHERE id = 1").get() as
      { readonly run_id: string } | undefined;
    return { runId: lock?.run_id ?? null, snapshot };
  } finally {
    database.close();
  }
}

export function requireStoryReviewLedgerState(
  state: {
    readonly runId: string | null;
    readonly snapshot: LiveSpendSnapshot | null;
  },
  marker: StoryReviewVariantMarker,
): LiveSpendSnapshot {
  if (state.snapshot === null) {
    throw new Error(
      "Story-review quality variant must be migrated before preflight or paid generation",
    );
  }
  if (state.runId !== null) {
    throw new Error(
      `Story-review spend ledger is locked by run ${state.runId}. Recover only after its process is dead: npm run review:stories:recover -- --run-id ${state.runId}`,
    );
  }
  assertStoryReviewVariantLedger(state.snapshot, marker);
  if (state.snapshot.activeReservationCount !== 0) {
    throw new Error("Story-review spend needs interruption reconciliation before more work");
  }
  return state.snapshot;
}

export function storyReviewStoryId(characterId: CharacterId): string {
  return `review-${characterId}`;
}

export function storyReviewDatabasePath(
  characterId: CharacterId,
  rootDirectory = STORY_REVIEW_STORIES_DIRECTORY,
): string {
  return resolve(rootDirectory, storyReviewStoryId(characterId), "story.db");
}

export function storyReviewTitle(characterId: CharacterId): string {
  const character = PUBLIC_CHARACTERS.find(({ id }) => id === characterId);
  if (character === undefined) throw new Error(`Unknown review character ${characterId}`);
  return `Ashen Crown — ${character.name}`;
}

function requireReviewCharacterId(value: string): CharacterId {
  const characterId = CHARACTER_IDS.find((candidate) => candidate === value);
  if (characterId === undefined) throw new Error(`Unknown review character ${value}`);
  return characterId;
}

function assertReviewStoryIdentity(characterId: CharacterId, metadata: StoryMetadata): void {
  if (
    metadata.id !== storyReviewStoryId(characterId) ||
    metadata.povCharacterId !== characterId ||
    metadata.status !== "active" ||
    metadata.title !== storyReviewTitle(characterId)
  ) {
    throw new Error(`${characterId} canonical review story metadata does not match its identity`);
  }
}

function assertProjectionSucceeded(
  characterId: CharacterId,
  warnings: readonly StoryWorkspaceWarning[],
): void {
  if (warnings.length === 0) return;
  throw new Error(
    `${characterId} canonical Markdown projection failed: ${warnings
      .map(({ code }) => code)
      .join(", ")}`,
  );
}

function readReviewStorySnapshot(
  characterId: CharacterId,
  rootDirectory = STORY_REVIEW_STORIES_DIRECTORY,
) {
  const store = new StoryStore(storyReviewDatabasePath(characterId, rootDirectory));
  try {
    const state = store.loadWorldState(WORLD_ID);
    if (state === null) throw new Error(`${characterId} canonical review database lacks its world`);
    const priorActions = store.loadChapters(WORLD_ID).map(({ playerAction }) => playerAction);
    return { priorActions, state };
  } finally {
    store.close();
  }
}

function assertCanonicalReviewProjection(
  characterId: CharacterId,
  state: WorldState,
  chapters: ReturnType<StoryStore["loadChapters"]>,
  rootDirectory = STORY_REVIEW_STORIES_DIRECTORY,
): void {
  const library = new StoryLibrary({ rootDirectory });
  const storyId = storyReviewStoryId(characterId);
  const metadata = library.getStory(storyId);
  if (metadata === null) throw new Error(`${characterId} review story lacks library metadata`);
  assertReviewStoryIdentity(characterId, metadata);
  if (metadata.chapterCount !== state.chapter || chapters.length !== state.chapter) {
    throw new Error(`${characterId} review library chapter count does not match canonical SQLite`);
  }
  const povName = state.characters.find(({ id }) => id === characterId)?.name;
  if (povName === undefined) throw new Error(`${characterId} is missing from its canonical world`);

  for (const chapter of chapters) {
    const markdownPath = library.chapterMarkdownPath(storyId, chapter.chapter);
    if (!existsSync(markdownPath)) {
      throw new Error(
        `${characterId} lacks projected chapter-${String(chapter.chapter).padStart(3, "0")}.md`,
      );
    }
    const projected = parseStoryChapterMarkdown(readFileSync(markdownPath, "utf8"));
    if (
      projected.storyId !== storyId ||
      projected.chapter !== chapter.chapter ||
      projected.title !== chapter.title ||
      projected.pov !== povName ||
      projected.prose !== chapter.prose ||
      projected.worldVersion !== chapter.stateAfterVersion
    ) {
      throw new Error(`${characterId} chapter ${chapter.chapter} Markdown differs from SQLite`);
    }
  }
}

function currentVariantMarker(sourceGitSha: string): StoryReviewVariantMarker {
  if (!existsSync(VARIANT_MARKER_PATH)) {
    throw new Error(
      "Story-review quality variant must be migrated before preflight or paid generation",
    );
  }
  return readStoryReviewVariantMarker(VARIANT_MARKER_PATH, STORY_ARCHIVE_DIRECTORY, sourceGitSha);
}

function currentGitSha(): string {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error("Current Git SHA is invalid");
  return sha;
}

function isCleanWorktree(): boolean {
  return (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim().length === 0
  );
}

function hasOnlyStoryReviewOutputChanges(): boolean {
  const allowed = new Set(["docs/SAMPLE_STORIES.md", "docs/story-review-evidence.json"]);
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .filter(Boolean)
    .every((entry) => allowed.has(entry.slice(3).replaceAll("\\", "/")));
}

function writeAtomic(path: string, value: string): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, value, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const apiKey = process.env.OPENAI_API_KEY;
    console.error(apiKey ? message.split(apiKey).join("[REDACTED]") : message);
    process.exitCode = 1;
  });
}
