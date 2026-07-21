import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  CHARACTER_IDS,
  PROMPT_VERSION,
  WorldStateSchema,
  type CharacterId,
} from "@infinite-litrpg/shared";
import Database from "better-sqlite3";
import { config } from "dotenv";
import OpenAI from "openai";

import { StoryService } from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";
import {
  LiveSpendLedger,
  readLiveSpendSnapshot,
  type LiveSpendSnapshot,
} from "./live-spend-ledger";
import {
  STORY_REVIEW_CHAPTERS_PER_STORY,
  STORY_REVIEW_CHAPTER_CAP_USD,
  STORY_REVIEW_SCHEMA_VERSION,
  STORY_REVIEW_TOTAL_CAP_USD,
  STORY_REVIEW_TOTAL_CHAPTERS,
  StoryReviewSourceEvidenceSchema,
  buildStoryReviewChapter,
  buildStoryReviewEvidence,
  buildStoryReviewMarkdown,
  buildStoryReviewPreflight,
  mergeStoryReviewHumanSections,
  parseStoryReviewArgs,
  validateStoryReviewPrefix,
  type StoryReviewSourceEvidence,
} from "./story-review";

const ROOT = process.cwd();
const WORLD_ID = "ashen-crown-v1";
const REPORT_DIRECTORY = resolve(ROOT, "evals", "reports");
const STORY_DATA_DIRECTORY = resolve(REPORT_DIRECTORY, "story-review");
const LEDGER_PATH = resolve(REPORT_DIRECTORY, "story-review-spend.db");
const EVIDENCE_PATH = resolve(ROOT, "docs", "story-review-evidence.json");
const MARKDOWN_PATH = resolve(ROOT, "docs", "SAMPLE_STORIES.md");
const BRANCH_POLICY = "first-offered-choice" as const;
const STORY_REVIEW_RUN_ID = "00000000-0000-4000-8000-000000000610";

export interface StoryReviewProgress {
  readonly byCharacter: Readonly<Record<CharacterId, number>>;
  readonly completedChapters: number;
}

async function main(): Promise<void> {
  const args = parseStoryReviewArgs(process.argv.slice(2));
  const sourceGitSha = currentGitSha();
  const progress = readStoryReviewProgress(sourceGitSha);
  const ledgerState = readReviewLedgerState();
  if (ledgerState.snapshot && ledgerState.snapshot.totalCapUsd !== args.totalCapUsd) {
    throw new Error("Existing story-review ledger uses a different total cap");
  }
  if (ledgerState.runId !== null) {
    throw new Error(
      `Story-review spend ledger is locked by run ${ledgerState.runId}. Recover only after its process is dead: npm run review:stories:recover -- --run-id ${ledgerState.runId}`,
    );
  }
  if (ledgerState.snapshot && ledgerState.snapshot.activeReservationCount !== 0) {
    throw new Error("Story-review spend needs interruption reconciliation before more work");
  }
  const durableExposureUsd = ledgerState.snapshot?.totalExposureUsd ?? 0;
  if (ledgerState.snapshot === null && progress.completedChapters !== 0) {
    throw new Error("Story-review chapters exist without a durable spend ledger");
  }
  const preflight = buildStoryReviewPreflight(progress.byCharacter, durableExposureUsd);
  const worktreeClean = isCleanWorktree();
  const paidCommand =
    "npm run review:stories:live -- --confirm-cost --chapter-cap-usd 0.0424 --total-cap-usd 2.544";

  if (args.preflightOnly) {
    console.log(
      JSON.stringify(
        {
          ...preflight,
          branchPolicy: BRANCH_POLICY,
          chapterCapUsd: args.chapterCapUsd,
          chaptersPerStory: STORY_REVIEW_CHAPTERS_PER_STORY,
          paidCommand,
          providerRequests: 0,
          sourceGitSha,
          stories: CHARACTER_IDS.length,
          totalCapUsd: args.totalCapUsd,
          uncertainExposureUsd: ledgerState.snapshot?.uncertainReservationCostUsd ?? 0,
          worktreeClean,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (
    ledgerState.snapshot?.sourceReportSha256 !== null &&
    ledgerState.snapshot?.sourceReportSha256 !== undefined &&
    ledgerState.snapshot.sourceReportSha256 !== `fresh:${sourceGitSha}`
  ) {
    throw new Error("Existing story-review evidence belongs to a different source Git SHA");
  }

  if (args.finalizeOnly) {
    if (progress.completedChapters !== STORY_REVIEW_TOTAL_CHAPTERS) {
      throw new Error("Provider-free finalization requires all sixty committed chapters");
    }
    if (!hasOnlyStoryReviewOutputChanges()) {
      throw new Error("Provider-free finalization allows changes only to story-review outputs");
    }
    const evidence = writeReviewArtifacts(
      collectSourceEvidence(sourceGitSha, ledgerState.snapshot!),
    );
    console.log(
      `finalized six ten-chapter stories without provider requests: ${MARKDOWN_PATH}; durable exposure $${evidence.durableExposureUsd.toFixed(6)}`,
    );
    return;
  }

  if (progress.completedChapters === STORY_REVIEW_TOTAL_CHAPTERS) {
    throw new Error("All sixty chapters are committed; run npm run review:stories:finalize");
  }

  if (!worktreeClean) {
    throw new Error("Paid story-review generation requires a clean committed worktree");
  }

  config({ path: resolve(ROOT, ".env"), quiet: true });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  mkdirSync(STORY_DATA_DIRECTORY, { recursive: true });
  const runId = STORY_REVIEW_RUN_ID;
  const ledger = new LiveSpendLedger(LEDGER_PATH, STORY_REVIEW_TOTAL_CAP_USD);
  let ownsRun = false;
  try {
    const initialSnapshot = ledger.snapshot();
    if (initialSnapshot.sourceReportSha256 === null) {
      ledger.acquireRunWithBaseline(runId, {
        attemptCostUsd: 0,
        priorSpendUsd: 0,
        sourceReportSha256: `fresh:${sourceGitSha}`,
      });
    } else {
      ledger.acquireRun(runId);
    }
    ownsRun = true;
    const costHooks = ledger.createCostHooks(runId);
    const client = createStoryReviewClient(apiKey);
    process.env.GIT_SHA = sourceGitSha;

    for (const characterId of CHARACTER_IDS) {
      await generateStory(characterId, client, costHooks, args.chapterCapUsd);
    }

    const snapshot = ledger.snapshot();
    if (snapshot.activeReservationCount !== 0) {
      throw new Error("Completed story review still has an active provider reservation");
    }
    const evidence = writeReviewArtifacts(collectSourceEvidence(sourceGitSha, snapshot));
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
    ledger.close();
  }
}

async function generateStory(
  characterId: CharacterId,
  client: OpenAI,
  costHooks: ReturnType<LiveSpendLedger["createCostHooks"]>,
  chapterCapUsd: number,
): Promise<void> {
  const store = new StoryStore(storyDatabasePath(characterId));
  try {
    const service = new StoryService(store, client, {
      costHooks,
      maxBackgroundAgents: 3,
      maxCostUsdPerChapter: chapterCapUsd,
      nativeMultiAgent: false,
      serviceTier: "flex",
    });
    let view = service.selectPov(characterId);
    let state = store.loadWorldState(WORLD_ID);
    if (!state || state.lockedPovId !== characterId) {
      throw new Error(`Story database does not lock ${characterId}`);
    }
    if (state.chapter > STORY_REVIEW_CHAPTERS_PER_STORY) {
      throw new Error(`${characterId} already exceeds the ten-chapter review horizon`);
    }
    while (state.chapter < STORY_REVIEW_CHAPTERS_PER_STORY) {
      const choice = view.chapter.choices.find(({ id }) => id === "choice-1");
      if (!choice) throw new Error(`${characterId} chapter ${state.chapter} lacks choice-1`);
      const beforeChapter = state.chapter;
      view = await service.takeTurn({
        choiceId: choice.id,
        expectedWorldVersion: state.version,
        requestId: randomUUID(),
        type: "take_action",
      });
      state = store.loadWorldState(WORLD_ID);
      if (!state || state.chapter !== beforeChapter + 1) {
        throw new Error(`${characterId} did not commit exactly one chapter`);
      }
      console.log(
        `${characterId} chapter ${state.chapter}/${STORY_REVIEW_CHAPTERS_PER_STORY} committed; $${view.estimatedCostUsd.toFixed(6)}`,
      );
    }
  } finally {
    store.close();
  }
}

function collectSourceEvidence(
  sourceGitSha: string,
  snapshot: LiveSpendSnapshot,
): StoryReviewSourceEvidence {
  const stories = CHARACTER_IDS.map((characterId) => {
    const store = new StoryStore(storyDatabasePath(characterId));
    try {
      const state = store.loadWorldState(WORLD_ID);
      if (
        !state ||
        state.lockedPovId !== characterId ||
        state.chapter !== STORY_REVIEW_CHAPTERS_PER_STORY
      ) {
        throw new Error(`${characterId} is not a complete ten-chapter story`);
      }
      const chapters = store.loadChapters(WORLD_ID).map((chapterRecord) => {
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
      return { chapters, characterId, finalState: state };
    } finally {
      store.close();
    }
  });
  return StoryReviewSourceEvidenceSchema.parse({
    branchPolicy: BRANCH_POLICY,
    chapterCapUsd: STORY_REVIEW_CHAPTER_CAP_USD,
    chaptersPerStory: STORY_REVIEW_CHAPTERS_PER_STORY,
    durableExposureUsd: snapshot.totalExposureUsd,
    generatedAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    schemaVersion: STORY_REVIEW_SCHEMA_VERSION,
    serviceTier: "flex",
    sourceGitSha,
    stories,
    totalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
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

export function readStoryReviewProgress(sourceGitSha: string): StoryReviewProgress {
  const byCharacter = Object.fromEntries(
    CHARACTER_IDS.map((characterId) => [
      characterId,
      readStoryChapterCount(characterId, sourceGitSha),
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

function readStoryChapterCount(characterId: CharacterId, sourceGitSha: string): number {
  const path = storyDatabasePath(characterId);
  if (!existsSync(path)) return 0;
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

function storyDatabasePath(characterId: CharacterId): string {
  return resolve(STORY_DATA_DIRECTORY, `${characterId}.db`);
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
