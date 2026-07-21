import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { CONTRACT_VERSION, PERSISTED_PROMPT_VERSIONS } from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import { z } from "zod";

import { StoryService } from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";
import { LiveResultSchema, restoreRetainedChapter, type LiveResult } from "../evals/run-live";

const ROOT = process.cwd();
const DATA_DIRECTORY = resolve(ROOT, "data");
const FINAL_DATABASE = resolve(DATA_DIRECTORY, "ashen-crown.db");
const TEMPORARY_DATABASE = resolve(DATA_DIRECTORY, `ashen-crown.seed.${process.pid}.db`);
export const DEMO_EVIDENCE_VERSION = "1.0.0-demo-evidence" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);

const DemoEvidenceSourceSchema = z
  .object({
    reportSha256: Sha256Schema,
    reportVersion: z.literal(9),
    sourceGitSha: GitShaSchema,
  })
  .strict();

export const DemoEvidenceSchema = z
  .object({
    result: LiveResultSchema,
    resultSha256: Sha256Schema,
    schemaVersion: z.literal(DEMO_EVIDENCE_VERSION),
    source: DemoEvidenceSourceSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (hashJson(evidence.result) !== evidence.resultSha256) {
      context.addIssue({ code: "custom", message: "Demo result hash does not match evidence" });
    }
    if (
      evidence.result.povId !== "rowan-ashborn" ||
      evidence.result.chapter !== 1 ||
      evidence.result.canonicalNarrativeInput === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Demo evidence must contain canonical Rowan chapter 1",
      });
    }
    if (
      !PERSISTED_PROMPT_VERSIONS.some(
        (promptVersion) => promptVersion === evidence.result.trace.promptVersion,
      ) ||
      evidence.result.trace.contractVersion !== CONTRACT_VERSION
    ) {
      context.addIssue({
        code: "custom",
        message: "Demo evidence does not match a persisted prompt and current contract version",
      });
    }
  });

export type DemoEvidence = z.infer<typeof DemoEvidenceSchema>;

export function defaultDemoEvidencePath(root = ROOT): string {
  return resolve(root, "docs", "evidence", "rowan-chapter-1-demo.json");
}

export function buildDemoEvidence(
  resultCandidate: unknown,
  sourceCandidate: z.input<typeof DemoEvidenceSourceSchema>,
): DemoEvidence {
  const result = LiveResultSchema.parse(resultCandidate);
  return DemoEvidenceSchema.parse({
    result,
    resultSha256: hashJson(result),
    schemaVersion: DEMO_EVIDENCE_VERSION,
    source: DemoEvidenceSourceSchema.parse(sourceCandidate),
  });
}

export function parseDemoEvidence(candidate: unknown): DemoEvidence {
  return DemoEvidenceSchema.parse(candidate);
}

export function readDemoEvidence(path: string): DemoEvidence {
  let candidate: unknown;
  try {
    candidate = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot read demo evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseDemoEvidence(candidate);
}

function main(): void {
  const evidencePath = process.argv[2] ? resolve(process.argv[2]) : defaultDemoEvidencePath();
  const finalFiles = [FINAL_DATABASE, `${FINAL_DATABASE}-shm`, `${FINAL_DATABASE}-wal`];
  if (finalFiles.some((path) => existsSync(path))) {
    throw new Error("Existing app database found. Preserve it; demo seed refuses to overwrite");
  }
  if (!existsSync(evidencePath)) {
    throw new Error(`Tracked demo evidence not found: ${evidencePath}`);
  }

  mkdirSync(DATA_DIRECTORY, { recursive: true });
  const evidence = readDemoEvidence(evidencePath);
  const result: LiveResult = evidence.result;
  const canonical = result.canonicalNarrativeInput;
  if (!canonical) throw new Error("Tracked Rowan chapter lacks exact canonical evidence");

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
    console.log(
      `seeded authenticated Rowan chapter 1 from ${evidence.source.reportSha256}; no model request made`,
    );
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

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
