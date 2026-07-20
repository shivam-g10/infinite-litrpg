import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import type OpenAI from "openai";

import { StoryService } from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";
import {
  assertRegisteredResumeCheckpoint,
  parseLiveReport,
  restoreRetainedChapter,
} from "../evals/run-live";

const ROOT = process.cwd();
const DATA_DIRECTORY = resolve(ROOT, "data");
const FINAL_DATABASE = resolve(DATA_DIRECTORY, "ashen-crown.db");
const TEMPORARY_DATABASE = resolve(DATA_DIRECTORY, `ashen-crown.seed.${process.pid}.db`);

export function defaultDemoReportPath(root = ROOT): string {
  return resolve(root, "evals", "reports", "live-full-sequential-settled-1.json");
}

function main(): void {
  const reportPath = process.argv[2] ? resolve(process.argv[2]) : defaultDemoReportPath();
  const finalFiles = [FINAL_DATABASE, `${FINAL_DATABASE}-shm`, `${FINAL_DATABASE}-wal`];
  if (finalFiles.some((path) => existsSync(path))) {
    throw new Error("Existing app database found. Preserve it; demo seed refuses to overwrite");
  }
  if (!existsSync(reportPath)) {
    throw new Error(`Authenticated live report not found: ${reportPath}`);
  }

  mkdirSync(DATA_DIRECTORY, { recursive: true });
  const raw = readFileSync(reportPath, "utf8");
  const report = parseLiveReport(JSON.parse(raw) as unknown);
  const reportSha256 = createHash("sha256").update(raw).digest("hex");
  assertRegisteredResumeCheckpoint(report, reportSha256);
  const result = report.results.find(
    (candidate) => candidate.povId === "rowan-ashborn" && candidate.chapter === 1,
  );
  if (!result) throw new Error("Authenticated Rowan chapter 1 is missing");
  const canonical = result.canonicalNarrativeInput;
  if (!canonical) throw new Error("Authenticated Rowan chapter lacks exact canonical evidence");

  try {
    const store = new StoryStore(TEMPORARY_DATABASE);
    try {
      const service = new StoryService(store, {} as OpenAI, {
        maxBackgroundAgents: 3,
        maxCostUsdPerChapter: 0.1,
        nativeMultiAgent: false,
      });
      const initial = service.selectPov("rowan-ashborn");
      restoreRetainedChapter(store, result, initial.chapter.choices[0]);
      const story = service.getStory();
      const storedChapter = store.loadChapter("ashen-crown-v1", 1);
      if (
        story?.world.chapter !== 1 ||
        story.world.version !== 2 ||
        story.pov.id !== "rowan-ashborn" ||
        story.godMode.gateResult !== "passed" ||
        story.chapter.prose !== result.prose ||
        story.chapter.title !== canonical.chapterRecord.title ||
        !isDeepStrictEqual(story.chapter.choices, canonical.chapterRecord.choices) ||
        !isDeepStrictEqual(storedChapter, canonical.chapterRecord)
      ) {
        throw new Error("Restored demo state failed verification");
      }
    } finally {
      store.close();
    }
    if (existsSync(`${TEMPORARY_DATABASE}-shm`) || existsSync(`${TEMPORARY_DATABASE}-wal`)) {
      throw new Error("SQLite sidecars remain after demo seed close");
    }
    renameSync(TEMPORARY_DATABASE, FINAL_DATABASE);
    console.log(`seeded authenticated Rowan chapter 1 from ${reportSha256}; no model request made`);
  } catch (error) {
    for (const path of [
      TEMPORARY_DATABASE,
      `${TEMPORARY_DATABASE}-shm`,
      `${TEMPORARY_DATABASE}-wal`,
    ]) {
      if (existsSync(path)) rmSync(path, { force: true });
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
