import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { config } from "dotenv";

import {
  CHARACTER_IDS,
  NarrativeAuditSchema,
  PersistedTraceEnvelopeSchema,
  PROMPT_VERSION,
  RuntimeAttemptTraceSchema,
  TraceEnvelopeSchema,
  UsageSchema,
  VALIDATION_CODES,
  validateWorldState,
  buildChapterChoiceOptions,
  buildPovContext,
  canonicalizeChapterFrameCandidate,
  stageWorldDelta,
  type ChapterRecord,
  type CharacterId,
  type Choice,
} from "@infinite-litrpg/shared";
import OpenAI from "openai";
import { z } from "zod";

import { OpenAIRuntimeError } from "../app/src/server/openai/errors";
import { StoryService } from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";
import { LiveSpendLedger, type LiveSpendSnapshot } from "./live-spend-ledger";

const ROOT = process.cwd();
const REPORT_DIRECTORY = resolve(ROOT, "evals", "reports");
const REVIEW_DIRECTORY = resolve(ROOT, "docs", "review-packets");
const RESUME_CHECKPOINTS_PATH = resolve(ROOT, "evals", "resume-checkpoints.json");
const LIVE_SPEND_LEDGER_PATH = resolve(REPORT_DIRECTORY, "live-spend-ledger.db");
const DEFAULT_PER_CHAPTER_CAP_USD = 0.1;
const TOTAL_CAP_USD = 3;
const REPORT_VERSION = 7;
const PREVIOUS_REPORT_VERSION = 6;
const LEGACY_REPORT_VERSION = 5;
const MONEY_EPSILON_USD = 0.000_000_1;
const RESUME_NON_RUNTIME_PATHS = new Set([
  "app/src/server/openai/stable.test.ts",
  "app/src/server/story/story-service.test.ts",
  "app/src/server/openai/policy.test.ts",
  "decisions/ADR-011-durable-live-eval-budget.md",
  "docs/ARCHITECTURE.md",
  "docs/PLAN.md",
  "docs/STATUS.md",
  "evals/README.md",
  "evals/live-spend-ledger.test.ts",
  "evals/resume-checkpoints.json",
  "evals/run-live-restore.test.ts",
  "evals/run-live.test.ts",
]);

const PovIdSchema = z.enum(CHARACTER_IDS);
const AdapterModeSchema = z.enum(["native-multi-agent", "sequential"]);
const GitShaSchema = z.string().regex(/^[a-f0-9]{7,40}$/u);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const BridgeFileSchema = z
  .object({
    path: z.string().min(1).max(1_000),
    sha256: Sha256Schema,
  })
  .strict();
const ResumeCheckpointRegistrySchema = z
  .object({
    checkpoints: z
      .array(
        z
          .object({
            adapterMode: AdapterModeSchema,
            bridgeFiles: z.array(BridgeFileSchema).max(20),
            chapterCostCapUsd: z.number().positive().max(DEFAULT_PER_CHAPTER_CAP_USD),
            id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
            priorSpendUsd: z.number().min(0).max(TOTAL_CAP_USD),
            promptVersion: z.string().min(1).max(240),
            reportSha256: Sha256Schema,
            reportVersion: z.union([
              z.literal(LEGACY_REPORT_VERSION),
              z.literal(PREVIOUS_REPORT_VERSION),
              z.literal(REPORT_VERSION),
            ]),
            sourceGitSha: GitShaSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    version: z.literal(2),
  })
  .strict()
  .superRefine(({ checkpoints }, context) => {
    const ids = new Set<string>();
    const hashes = new Set<string>();
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (ids.has(checkpoint.id) || hashes.has(checkpoint.reportSha256)) {
        context.addIssue({
          code: "custom",
          message: "Resume checkpoint IDs and report hashes must be unique",
          path: ["checkpoints", index],
        });
      }
      ids.add(checkpoint.id);
      hashes.add(checkpoint.reportSha256);
      const bridgePaths = new Set(checkpoint.bridgeFiles.map(({ path }) => path));
      if (bridgePaths.size !== checkpoint.bridgeFiles.length) {
        context.addIssue({
          code: "custom",
          message: "Bridge file paths must be unique",
          path: ["checkpoints", index, "bridgeFiles"],
        });
      }
      for (const [bridgeIndex, bridgeFile] of checkpoint.bridgeFiles.entries()) {
        const normalized = bridgeFile.path.replaceAll("\\", "/");
        if (
          normalized !== bridgeFile.path ||
          normalized.startsWith("/") ||
          normalized.split("/").includes("..") ||
          /^[a-zA-Z]:/u.test(normalized)
        ) {
          context.addIssue({
            code: "custom",
            message: "Bridge file path must be a normalized repository-relative path",
            path: ["checkpoints", index, "bridgeFiles", bridgeIndex, "path"],
          });
        }
      }
      if (checkpoint.reportVersion < REPORT_VERSION !== checkpoint.bridgeFiles.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Only older report checkpoints require bridge file hashes",
          path: ["checkpoints", index, "bridgeFiles"],
        });
      }
    }
  });
const ValidationIssueSchema = z
  .object({
    code: z.enum(VALIDATION_CODES),
    message: z.string().min(1).max(4_000),
    path: z.string().max(1_000),
  })
  .strict();

export const LiveResultSchema = z
  .object({
    adapterMode: AdapterModeSchema,
    audit: NarrativeAuditSchema,
    chapter: z.number().int().min(1).max(2),
    costUsd: z.number().min(0).max(TOTAL_CAP_USD),
    latencyMs: z.number().int().min(0),
    povId: PovIdSchema,
    prose: z.string().min(1).max(20_000),
    streamChunkCount: z.number().int().min(1),
    streamingLatencyMs: z.number().int().min(0),
    streamReconstructed: z.boolean(),
    trace: PersistedTraceEnvelopeSchema,
    usage: UsageSchema,
    wordCount: z.number().int().min(900).max(1_300),
  })
  .strict()
  .superRefine((result, context) => {
    if (wordCount(result.prose) !== result.wordCount) {
      context.addIssue({ code: "custom", message: "Result word count does not match prose" });
    }
    if (hashText(result.prose) !== result.audit.proseHash) {
      context.addIssue({ code: "custom", message: "Result prose hash does not match audit" });
    }
    if (!isDeepStrictEqual(result.usage, result.trace.totalUsage)) {
      context.addIssue({ code: "custom", message: "Result usage does not match trace" });
    }
    if (!costsMatch(result.costUsd, result.trace.totalEstimatedCostUsd)) {
      context.addIssue({ code: "custom", message: "Result cost does not match trace total" });
    }
    if (!resultTraceCostMatches(result)) {
      context.addIssue({ code: "custom", message: "Result cost does not match trace attempts" });
    }
    if (result.trace.gateResult !== "passed") {
      context.addIssue({ code: "custom", message: "Result trace gate did not pass" });
    }
  });

const GateSchema = z
  .object({
    allAuditsApproved: z.boolean(),
    allCommitsCompleted: z.boolean(),
    allCostsWithinChapterCap: z.boolean(),
    allPovLeakListsEmpty: z.boolean(),
    allProseWithinWordLimit: z.boolean(),
    allStreamsReconstructed: z.boolean(),
    p95WithinSixtySeconds: z.boolean(),
    traceCostMatchesAttempts: z.boolean(),
    totalCostWithinCap: z.boolean(),
  })
  .strict();

const BaseLiveReportSchema = z
  .object({
    adapterMode: AdapterModeSchema,
    attempts: z.array(RuntimeAttemptTraceSchema).max(1_000),
    auditRejections: z
      .array(z.object({ audit: NarrativeAuditSchema, povId: PovIdSchema }).strict())
      .max(100),
    chapterCostCapUsd: z.number().positive().max(DEFAULT_PER_CHAPTER_CAP_USD),
    completedChapters: z.number().int().min(0).max(12),
    cumulativeCostUsd: z.number().min(0),
    error: z
      .object({ code: z.string().min(1).max(240), message: z.string().min(1).max(4_000) })
      .strict()
      .nullable(),
    draftRejections: z
      .array(
        z.object({ issues: z.array(ValidationIssueSchema).max(100), povId: PovIdSchema }).strict(),
      )
      .max(100),
    finishedAt: z.string().datetime(),
    gates: GateSchema,
    nativeRequested: z.boolean(),
    povFilter: PovIdSchema.nullable(),
    priorSpendUsd: z.number().min(0).max(TOTAL_CAP_USD),
    projectedMaximumCumulativeCostUsd: z.number().min(0),
    promptVersion: z.string().min(1).max(240),
    results: z.array(LiveResultSchema).max(12),
    startedAt: z.string().datetime(),
    suite: z.enum(["full", "smoke"]),
    totalCostCapUsd: z.literal(TOTAL_CAP_USD),
    totalCostUsd: z.number().min(0),
  })
  .strict();

const LegacyResumeSchema = z
  .object({
    discardedResultCount: z.number().int().min(0).max(12),
    existingAttemptCostUsd: z.number().min(0).max(TOTAL_CAP_USD),
    retainedPovIds: z.array(PovIdSchema).max(6),
    sourceReportPath: z.string().min(1).max(4_000),
  })
  .strict();

const RetainedResultGitShaSchema = z
  .object({
    chapter: z.number().int().min(1).max(2),
    povId: PovIdSchema,
    sourceGitSha: GitShaSchema,
  })
  .strict();

const ResumeSchema = z
  .object({
    changedPaths: z.array(z.string().min(1).max(1_000)).max(20),
    discardedResultCount: z.number().int().min(0).max(12),
    existingAttemptCostUsd: z.number().min(0).max(TOTAL_CAP_USD),
    retainedPovIds: z.array(PovIdSchema).max(6),
    retainedResultGitShas: z.array(RetainedResultGitShaSchema).max(12),
    sourceChapterCostCapUsd: z.number().positive().max(DEFAULT_PER_CHAPTER_CAP_USD),
    sourceGitSha: GitShaSchema,
    sourceReportPath: z.string().min(1).max(4_000),
    sourceReportSha256: Sha256Schema,
    sourceReportVersion: z.union([
      z.literal(LEGACY_REPORT_VERSION),
      z.literal(PREVIOUS_REPORT_VERSION),
      z.literal(REPORT_VERSION),
    ]),
  })
  .strict();

export const LegacyLiveReportSchema = BaseLiveReportSchema.extend({
  resume: LegacyResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(LEGACY_REPORT_VERSION),
}).superRefine((report, context) => {
  refineReportCommon(report, context);
  for (const [index, result] of report.results.entries()) {
    if (result.trace.gitSha !== report.sourceGitSha) {
      context.addIssue({
        code: "custom",
        message: `Result ${index} Git SHA does not match report`,
        path: ["results", index, "trace", "gitSha"],
      });
    }
  }
});

export const Version6LiveReportSchema = BaseLiveReportSchema.extend({
  resume: ResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(PREVIOUS_REPORT_VERSION),
}).superRefine((report, context) => {
  refineReportCommon(report, context);
  if (report.resume !== null) {
    if (report.chapterCostCapUsd > report.resume.sourceChapterCostCapUsd) {
      context.addIssue({ code: "custom", message: "Resumed chapter cap increased" });
    }
    if (report.resume.existingAttemptCostUsd > report.totalCostUsd + MONEY_EPSILON_USD) {
      context.addIssue({ code: "custom", message: "Resume attempt cost exceeds report total" });
    }
    try {
      assertResumeHarnessPaths(
        report.resume.changedPaths,
        report.resume.sourceReportVersion === LEGACY_REPORT_VERSION ? ["evals/run-live.ts"] : [],
      );
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Resume provenance path is invalid",
        path: ["resume", "changedPaths"],
      });
    }
    if (new Set(report.resume.retainedPovIds).size !== report.resume.retainedPovIds.length) {
      context.addIssue({ code: "custom", message: "Resume repeats a retained POV" });
    }
  }
  const retainedByResult = new Map<string, string>();
  for (const [index, retained] of (report.resume?.retainedResultGitShas ?? []).entries()) {
    const key = resultKey(retained.povId, retained.chapter);
    if (retainedByResult.has(key)) {
      context.addIssue({
        code: "custom",
        message: `Retained result ${key} has duplicate Git provenance`,
        path: ["resume", "retainedResultGitShas", index],
      });
    }
    retainedByResult.set(key, retained.sourceGitSha);
    if (!report.resume?.retainedPovIds.includes(retained.povId)) {
      context.addIssue({
        code: "custom",
        message: `Retained result ${key} has no retained POV`,
        path: ["resume", "retainedResultGitShas", index],
      });
    }
  }
  for (const [index, result] of report.results.entries()) {
    const key = resultKey(result.povId, result.chapter);
    const expectedGitSha = retainedByResult.get(key) ?? report.sourceGitSha;
    if (result.trace.gitSha !== expectedGitSha) {
      context.addIssue({
        code: "custom",
        message: `Result ${index} Git SHA has no matching provenance`,
        path: ["results", index, "trace", "gitSha"],
      });
    }
    retainedByResult.delete(key);
  }
  for (const key of retainedByResult.keys()) {
    context.addIssue({
      code: "custom",
      message: `Retained Git provenance ${key} has no result`,
      path: ["resume", "retainedResultGitShas"],
    });
  }
  for (const povId of report.resume?.retainedPovIds ?? []) {
    const chapters = report.resume?.retainedResultGitShas
      .filter((entry) => entry.povId === povId)
      .map(({ chapter }) => chapter)
      .sort((left, right) => left - right);
    if (chapters?.length !== 2 || chapters[0] !== 1 || chapters[1] !== 2) {
      context.addIssue({
        code: "custom",
        message: `Retained POV ${povId} lacks an exact chapter pair`,
        path: ["resume", "retainedPovIds"],
      });
    }
  }
  const pendingChapterCount =
    report.suite === "smoke"
      ? 1
      : CHARACTER_IDS.length * 2 - (report.resume?.retainedResultGitShas.length ?? 0);
  const projected = projectedCumulativeCostUsd(
    report.priorSpendUsd,
    report.resume?.existingAttemptCostUsd ?? 0,
    pendingChapterCount,
    report.chapterCostCapUsd,
  );
  if (!costsMatch(projected, report.projectedMaximumCumulativeCostUsd)) {
    context.addIssue({ code: "custom", message: "Report projected maximum is inconsistent" });
  }
});

const ResultChapterCapSchema = z
  .object({
    chapter: z.number().int().min(1).max(2),
    capUsd: z.number().positive().max(DEFAULT_PER_CHAPTER_CAP_USD),
    povId: PovIdSchema,
  })
  .strict();

const LiveSpendSnapshotSchema = z
  .object({
    activeReservationCount: z.literal(0),
    baselineAttemptCostUsd: z.number().min(0),
    headroomUsd: z.number().min(0).max(TOTAL_CAP_USD),
    knownReservationCostUsd: z.number().min(0),
    priorSpendUsd: z.number().min(0).max(TOTAL_CAP_USD),
    sourceReportSha256: z.string().min(1).max(80),
    totalCapUsd: z.literal(TOTAL_CAP_USD),
    totalExposureUsd: z.number().min(0),
    uncertainReservationCostUsd: z.number().min(0),
  })
  .strict();

const RetainedResultProvenanceSchema = RetainedResultGitShaSchema.extend({
  sourceChapterCapUsd: z.number().positive().max(DEFAULT_PER_CHAPTER_CAP_USD),
}).strict();

const Version7ResumeSchema = ResumeSchema.omit({ retainedResultGitShas: true })
  .extend({
    bridgeFiles: z.array(BridgeFileSchema).max(20),
    retainedResults: z.array(RetainedResultProvenanceSchema).max(12),
  })
  .strict();

export const LiveReportSchema = BaseLiveReportSchema.extend({
  budgetLedger: LiveSpendSnapshotSchema,
  budgetMode: z.literal("durable-request-reservations"),
  resultChapterCaps: z.array(ResultChapterCapSchema).max(12),
  resume: Version7ResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(REPORT_VERSION),
}).superRefine((report, context) => {
  refineReportCommon(report, context);
  if (report.resume !== null) {
    if (report.resume.existingAttemptCostUsd > report.totalCostUsd + MONEY_EPSILON_USD) {
      context.addIssue({ code: "custom", message: "Resume attempt cost exceeds report total" });
    }
    try {
      assertResumeHarnessPaths(
        report.resume.changedPaths,
        report.resume.bridgeFiles.map(({ path }) => path),
      );
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Resume provenance path is invalid",
        path: ["resume", "changedPaths"],
      });
    }
    if (new Set(report.resume.retainedPovIds).size !== report.resume.retainedPovIds.length) {
      context.addIssue({ code: "custom", message: "Resume repeats a retained POV" });
    }
  }

  const retainedByResult = new Map<string, z.infer<typeof RetainedResultProvenanceSchema>>();
  for (const [index, retained] of (report.resume?.retainedResults ?? []).entries()) {
    const key = resultKey(retained.povId, retained.chapter);
    if (retainedByResult.has(key)) {
      context.addIssue({
        code: "custom",
        message: `Retained result ${key} has duplicate provenance`,
        path: ["resume", "retainedResults", index],
      });
    }
    retainedByResult.set(key, retained);
    if (!report.resume?.retainedPovIds.includes(retained.povId)) {
      context.addIssue({
        code: "custom",
        message: `Retained result ${key} has no retained POV`,
        path: ["resume", "retainedResults", index],
      });
    }
  }
  const unmatchedRetainedKeys = new Set(retainedByResult.keys());
  for (const [index, result] of report.results.entries()) {
    const key = resultKey(result.povId, result.chapter);
    const expectedGitSha = retainedByResult.get(key)?.sourceGitSha ?? report.sourceGitSha;
    if (result.trace.gitSha !== expectedGitSha) {
      context.addIssue({
        code: "custom",
        message: `Result ${index} Git SHA has no matching provenance`,
        path: ["results", index, "trace", "gitSha"],
      });
    }
    unmatchedRetainedKeys.delete(key);
  }
  for (const key of unmatchedRetainedKeys) {
    context.addIssue({
      code: "custom",
      message: `Retained provenance ${key} has no result`,
      path: ["resume", "retainedResults"],
    });
  }
  for (const povId of report.resume?.retainedPovIds ?? []) {
    const chapters = report.resume?.retainedResults
      .filter((entry) => entry.povId === povId)
      .map(({ chapter }) => chapter)
      .sort((left, right) => left - right);
    if (
      chapters?.length !== 1 &&
      (chapters?.length !== 2 || chapters[0] !== 1 || chapters[1] !== 2)
    ) {
      context.addIssue({
        code: "custom",
        message: `Retained POV ${povId} lacks a contiguous chapter prefix`,
        path: ["resume", "retainedPovIds"],
      });
    } else if (chapters[0] !== 1) {
      context.addIssue({
        code: "custom",
        message: `Retained POV ${povId} does not start at chapter 1`,
        path: ["resume", "retainedPovIds"],
      });
    }
  }

  const caps = new Map<string, number>();
  for (const [index, entry] of report.resultChapterCaps.entries()) {
    const key = resultKey(entry.povId, entry.chapter);
    if (caps.has(key)) {
      context.addIssue({
        code: "custom",
        message: `Result cap ${key} is duplicated`,
        path: ["resultChapterCaps", index],
      });
    }
    caps.set(key, entry.capUsd);
  }
  for (const [index, result] of report.results.entries()) {
    const key = resultKey(result.povId, result.chapter);
    const cap = caps.get(key);
    const expectedCap = retainedByResult.get(key)?.sourceChapterCapUsd ?? report.chapterCostCapUsd;
    if (
      cap === undefined ||
      !costsMatch(cap, expectedCap) ||
      result.costUsd > cap + MONEY_EPSILON_USD
    ) {
      context.addIssue({
        code: "custom",
        message: `Result ${key} has no valid chapter cap provenance`,
        path: ["results", index, "costUsd"],
      });
    }
    caps.delete(key);
  }
  if (caps.size > 0) {
    context.addIssue({ code: "custom", message: "Result cap has no matching result" });
  }

  const pendingChapterCount =
    report.suite === "smoke"
      ? 1
      : CHARACTER_IDS.length * 2 - (report.resume?.retainedResults.length ?? 0);
  const projected = projectedCumulativeCostUsd(
    report.priorSpendUsd,
    report.resume?.existingAttemptCostUsd ?? 0,
    pendingChapterCount,
    report.chapterCostCapUsd,
  );
  if (!costsMatch(projected, report.projectedMaximumCumulativeCostUsd)) {
    context.addIssue({ code: "custom", message: "Report projected maximum is inconsistent" });
  }

  const ledger = report.budgetLedger;
  const expectedBaseline = report.resume?.existingAttemptCostUsd ?? 0;
  const expectedNewExposure = report.totalCostUsd - expectedBaseline;
  const expectedLedgerSource = report.resume?.sourceReportSha256 ?? `fresh:${report.sourceGitSha}`;
  if (
    !costsMatch(ledger.priorSpendUsd, report.priorSpendUsd) ||
    !costsMatch(ledger.baselineAttemptCostUsd, expectedBaseline) ||
    ledger.sourceReportSha256 !== expectedLedgerSource ||
    !costsMatch(
      ledger.knownReservationCostUsd + ledger.uncertainReservationCostUsd,
      expectedNewExposure,
    ) ||
    !costsMatch(ledger.totalExposureUsd, report.cumulativeCostUsd) ||
    !costsMatch(ledger.headroomUsd, Math.max(0, TOTAL_CAP_USD - report.cumulativeCostUsd))
  ) {
    context.addIssue({ code: "custom", message: "Durable spend ledger does not match report" });
  }
});

export type LiveResult = z.infer<typeof LiveResultSchema>;
export type LegacyLiveReport = z.infer<typeof LegacyLiveReportSchema>;
export type Version6LiveReport = z.infer<typeof Version6LiveReportSchema>;
export type LiveReport = z.infer<typeof LiveReportSchema>;
export type ResumableLiveReport = LegacyLiveReport | Version6LiveReport | LiveReport;
export type ResultChapterCap = z.infer<typeof ResultChapterCapSchema>;

function refineReportCommon(
  report: z.infer<typeof BaseLiveReportSchema>,
  context: z.RefinementCtx,
): void {
  const attemptCostUsd = sum(report.attempts.map(({ costUsd }) => costUsd));
  if (!costsMatch(attemptCostUsd, report.totalCostUsd)) {
    context.addIssue({ code: "custom", message: "Report total cost does not match attempts" });
  }
  if (!costsMatch(report.priorSpendUsd + attemptCostUsd, report.cumulativeCostUsd)) {
    context.addIssue({ code: "custom", message: "Report cumulative cost is inconsistent" });
  }
  if (report.completedChapters !== report.results.length) {
    context.addIssue({
      code: "custom",
      message: "Report completed chapter count is inconsistent",
    });
  }
  const wantedAdapter = report.nativeRequested ? "native-multi-agent" : "sequential";
  if (report.adapterMode !== wantedAdapter) {
    context.addIssue({ code: "custom", message: "Report adapter fields disagree" });
  }
  const resultKeys = new Set<string>();
  for (const [index, result] of report.results.entries()) {
    const key = resultKey(result.povId, result.chapter);
    if (resultKeys.has(key)) {
      context.addIssue({
        code: "custom",
        message: `Report repeats result ${key}`,
        path: ["results", index],
      });
    }
    resultKeys.add(key);
    if (
      result.adapterMode !== report.adapterMode ||
      result.trace.adapterMode !== report.adapterMode
    ) {
      context.addIssue({
        code: "custom",
        message: `Result ${index} adapter does not match report`,
        path: ["results", index, "adapterMode"],
      });
    }
    if (result.trace.promptVersion !== report.promptVersion) {
      context.addIssue({
        code: "custom",
        message: `Result ${index} prompt version does not match report`,
        path: ["results", index, "trace", "promptVersion"],
      });
    }
  }
}

function resultKey(povId: CharacterId, chapter: number): string {
  return `${povId}:${chapter}`;
}

export interface ResumeRequirements {
  readonly adapterMode: z.infer<typeof AdapterModeSchema>;
  readonly chapterCostCapUsd: number;
  readonly priorSpendUsd: number;
  readonly promptVersion: string;
  readonly sourceGitSha: string;
}

export interface ResumePreparation {
  readonly attempts: LiveReport["attempts"];
  readonly auditRejections: LiveReport["auditRejections"];
  readonly discardedResultCount: number;
  readonly draftRejections: LiveReport["draftRejections"];
  readonly existingAttemptCostUsd: number;
  readonly pendingPovIds: CharacterId[];
  readonly retainedPovIds: CharacterId[];
  readonly retainedResultCaps: ResultChapterCap[];
  readonly retainedResults: LiveResult[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suite = parseSuite(args);
  const nativeRequested = args.includes("--native");
  const adapterMode = nativeRequested ? "native-multi-agent" : "sequential";
  const povFilter = parsePov(args);
  const resumeReportArgument = parseOptionalFlag(args, "--resume-report");
  const recoverStaleRunId = parseOptionalFlag(args, "--recover-stale-run");
  if (resumeReportArgument !== null && suite !== "full") {
    throw new Error("--resume-report is only valid for the full live suite");
  }
  const perChapterCapUsd = parseUsdFlag(
    args,
    "--chapter-cap-usd",
    DEFAULT_PER_CHAPTER_CAP_USD,
    false,
    DEFAULT_PER_CHAPTER_CAP_USD,
  );
  const priorSpendUsd = parseUsdFlag(args, "--prior-spend-usd", 0, true, TOTAL_CAP_USD);
  if (suite === "full" && !args.includes("--confirm-cost")) {
    throw new Error("Full live eval requires --confirm-cost");
  }
  if (suite === "full") assertCleanGitCheckpoint();
  config({ path: resolve(ROOT, ".env"), quiet: true });
  const sourceGitSha = currentGitSha();
  process.env.GIT_SHA = sourceGitSha;
  const resumeReportPath =
    resumeReportArgument === null ? null : resolve(ROOT, resumeReportArgument);
  const resumeSource = resumeReportPath === null ? null : readLiveReport(resumeReportPath);
  const resumeReport = resumeSource?.report ?? null;
  const resumeVerification =
    resumeSource === null
      ? { bridgeFiles: [], changedPaths: [] }
      : verifyResumeCheckpoint(resumeSource.report, resumeSource.sha256, sourceGitSha);
  const resumePreparation =
    resumeReport === null
      ? null
      : prepareResume(resumeReport, {
          adapterMode,
          chapterCostCapUsd: perChapterCapUsd,
          priorSpendUsd,
          promptVersion: PROMPT_VERSION,
          sourceGitSha: resumeReport.sourceGitSha,
        });
  const plannedPovIds =
    suite === "smoke"
      ? [povFilter ?? "rowan-ashborn"]
      : (resumePreparation?.pendingPovIds ?? [...CHARACTER_IDS]);
  const turnsPerPov = suite === "smoke" ? 1 : 2;
  const pendingChapterCount =
    suite === "smoke"
      ? 1
      : CHARACTER_IDS.length * 2 - (resumePreparation?.retainedResults.length ?? 0);
  const existingAttemptCostUsd = resumePreparation?.existingAttemptCostUsd ?? 0;
  const projectedMaximumCumulativeCostUsd = projectedCumulativeCostUsd(
    priorSpendUsd,
    existingAttemptCostUsd,
    pendingChapterCount,
    perChapterCapUsd,
  );
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey });
  mkdirSync(REPORT_DIRECTORY, { recursive: true });

  const reportPath = resolve(
    REPORT_DIRECTORY,
    `live-${suite}-${nativeRequested ? "native" : "sequential"}${povFilter ? `-${povFilter}` : ""}.json`,
  );
  const startedAt = new Date().toISOString();
  const results: LiveResult[] = [...(resumePreparation?.retainedResults ?? [])];
  const resultChapterCaps: ResultChapterCap[] = [...(resumePreparation?.retainedResultCaps ?? [])];
  const attempts: LiveReport["attempts"] = [...(resumePreparation?.attempts ?? [])];
  const auditRejections: LiveReport["auditRejections"] = [
    ...(resumePreparation?.auditRejections ?? []),
  ];
  const draftRejections: LiveReport["draftRejections"] = [
    ...(resumePreparation?.draftRejections ?? []),
  ];
  const ledger = new LiveSpendLedger(LIVE_SPEND_LEDGER_PATH, TOTAL_CAP_USD);
  const liveRunId = randomUUID();
  let ledgerLocked = false;
  let failure: unknown = null;
  try {
    if (recoverStaleRunId === null) ledger.acquireRun(liveRunId);
    else ledger.recoverStaleRun(recoverStaleRunId, liveRunId);
    ledgerLocked = true;
    ledger.synchronizeBaseline(liveRunId, {
      attemptCostUsd: existingAttemptCostUsd,
      priorSpendUsd,
      sourceReportSha256: resumeSource?.sha256 ?? `fresh:${sourceGitSha}`,
    });
    const costHooks = ledger.createCostHooks(liveRunId);

    try {
      for (const povId of plannedPovIds) {
        const store = new StoryStore();
        try {
          const service = new StoryService(store, client, {
            costHooks,
            maxBackgroundAgents: 3,
            maxCostUsdPerChapter: perChapterCapUsd,
            nativeMultiAgent: nativeRequested,
            onNarrativeAudit: (audit) => {
              if (!audit.approved) {
                auditRejections.push({ audit, povId });
                console.log(
                  `audit rejected: ${JSON.stringify(audit.scores)}; leaks=${audit.leakedFactIds.join(",") || "none"}; ${audit.evidence.map(({ detail }) => detail).join(" ")}`,
                );
              }
            },
            onNarrativeDraftRejected: (issues) => {
              draftRejections.push({ issues: [...issues], povId });
              console.log(
                `draft rejected: ${issues.map(({ code, message }) => `${code}: ${message}`).join("; ")}`,
              );
            },
            onRuntimeAttempt: (attempt) => {
              attempts.push(attempt);
              if (attempt.errorCode !== null) {
                console.log(
                  `${attempt.model} attempt ${attempt.attempt + 1}: ${attempt.errorCode}, $${attempt.costUsd.toFixed(5)}`,
                );
              }
            },
          });
          let view = service.selectPov(povId);
          const retainedPrefix = results
            .filter((result) => result.povId === povId)
            .sort((left, right) => left.chapter - right.chapter);
          if (retainedPrefix.length === 1) {
            const retainedChapter = retainedPrefix[0];
            if (!retainedChapter) throw new Error("Retained chapter prefix disappeared");
            restoreRetainedChapter(store, retainedChapter, view.chapter.choices[0]);
          }
          for (let turn = retainedPrefix.length; turn < turnsPerPov; turn += 1) {
            const beforeTurn = store.loadWorldState("ashen-crown-v1");
            if (!beforeTurn) throw new Error("World disappeared before live turn");
            const streamedChunks: string[] = [];
            const streamingStartedAt = performance.now();
            view = await service.takeTurn(
              turn === 0
                ? {
                    choiceId: view.chapter.choices[0]?.id ?? "missing-choice",
                    expectedWorldVersion: beforeTurn.version,
                    requestId: randomUUID(),
                    type: "take_action",
                  }
                : {
                    description: "Investigate the immediate area for fresh tracks.",
                    expectedWorldVersion: beforeTurn.version,
                    requestId: randomUUID(),
                    type: "custom_action",
                  },
              (chunk) => {
                streamedChunks.push(chunk);
              },
            );
            const streamingLatencyMs = Math.max(
              0,
              Math.round(performance.now() - streamingStartedAt),
            );
            const state = store.loadWorldState("ashen-crown-v1");
            if (!state || !validateWorldState(state).ok) {
              throw new Error("World is invalid after live chapter");
            }
            const chapter = store.loadChapter("ashen-crown-v1", state.chapter);
            if (!chapter) throw new Error(`Committed chapter ${state.chapter} is missing`);
            const trace = store.loadTrace(chapter.traceId);
            if (!trace) throw new Error(`Trace ${chapter.traceId} is missing`);
            const result: LiveResult = {
              adapterMode: trace.adapterMode,
              audit: chapter.narrativeAudit,
              chapter: chapter.chapter,
              costUsd: chapter.estimatedCostUsd,
              latencyMs: chapter.latencyMs,
              povId,
              prose: chapter.prose,
              streamChunkCount: streamedChunks.length,
              streamingLatencyMs,
              streamReconstructed: streamedChunks.join("") === chapter.prose,
              trace,
              usage: chapter.usage,
              wordCount: wordCount(chapter.prose),
            };
            assertChapterResult(result, nativeRequested, perChapterCapUsd);
            results.push(result);
            resultChapterCaps.push({
              capUsd: perChapterCapUsd,
              chapter: result.chapter,
              povId,
            });
            writeAtomicJson(
              reportPath,
              buildLiveReport(null, ledger.snapshot(), {
                adapterMode,
                apiKey,
                attempts,
                auditRejections,
                chapterCostCapUsd: perChapterCapUsd,
                draftRejections,
                existingAttemptCostUsd,
                nativeRequested,
                povFilter,
                priorSpendUsd,
                projectedMaximumCumulativeCostUsd,
                resultChapterCaps,
                results,
                resumePreparation,
                resumeReport,
                resumeReportPath,
                resumeSource,
                resumeVerification,
                sourceGitSha,
                startedAt,
                suite,
              }),
            );
            console.log(
              `${povId} chapter ${chapter.chapter}: ${result.wordCount} words, $${result.costUsd.toFixed(5)}, ${result.latencyMs}ms, ${result.adapterMode}`,
            );
          }
        } finally {
          store.close();
        }
      }
    } catch (error) {
      failure = error;
    }

    const ledgerSnapshot = ledger.snapshot();
    const report = buildLiveReport(failure, ledgerSnapshot, {
      adapterMode,
      apiKey,
      attempts,
      auditRejections,
      chapterCostCapUsd: perChapterCapUsd,
      draftRejections,
      existingAttemptCostUsd,
      nativeRequested,
      povFilter,
      priorSpendUsd,
      projectedMaximumCumulativeCostUsd,
      resultChapterCaps,
      results,
      resumePreparation,
      resumeReport,
      resumeReportPath,
      resumeSource,
      resumeVerification,
      sourceGitSha,
      startedAt,
      suite,
    });
    writeAtomicJson(reportPath, report);
    if (suite === "full" && failure === null && Object.values(report.gates).every(Boolean)) {
      writeReviewPackets(results);
    }

    const p95LatencyMs = percentile(
      results.map(({ streamingLatencyMs }) => streamingLatencyMs),
      0.95,
    );
    console.log(
      `report ${reportPath}; ${results.length}/${suite === "smoke" ? 1 : 12} chapters; $${report.totalCostUsd.toFixed(5)}; p95 ${p95LatencyMs}ms`,
    );
    if (failure !== null) {
      const safe = safeError(failure, apiKey);
      console.error(`${safe.code}: ${safe.message}`);
      process.exitCode = 1;
    } else {
      const failedGates = Object.entries(report.gates)
        .filter(([, passed]) => !passed)
        .map(([name]) => name);
      if (failedGates.length > 0) {
        console.error(`failed gates: ${failedGates.join(", ")}`);
        process.exitCode = 1;
      }
    }
  } finally {
    if (ledgerLocked) ledger.releaseRun(liveRunId);
    ledger.close();
  }
}

interface ResumeVerification {
  readonly bridgeFiles: z.infer<typeof BridgeFileSchema>[];
  readonly changedPaths: string[];
}

interface BuildLiveReportInput {
  readonly adapterMode: z.infer<typeof AdapterModeSchema>;
  readonly apiKey: string;
  readonly attempts: LiveReport["attempts"];
  readonly auditRejections: LiveReport["auditRejections"];
  readonly chapterCostCapUsd: number;
  readonly draftRejections: LiveReport["draftRejections"];
  readonly existingAttemptCostUsd: number;
  readonly nativeRequested: boolean;
  readonly povFilter: CharacterId | null;
  readonly priorSpendUsd: number;
  readonly projectedMaximumCumulativeCostUsd: number;
  readonly resultChapterCaps: ResultChapterCap[];
  readonly results: LiveResult[];
  readonly resumePreparation: ResumePreparation | null;
  readonly resumeReport: ResumableLiveReport | null;
  readonly resumeReportPath: string | null;
  readonly resumeSource: ResumeSource | null;
  readonly resumeVerification: ResumeVerification;
  readonly sourceGitSha: string;
  readonly startedAt: string;
  readonly suite: "full" | "smoke";
}

function buildLiveReport(
  failure: unknown,
  ledgerSnapshot: LiveSpendSnapshot,
  input: BuildLiveReportInput,
): LiveReport {
  if (ledgerSnapshot.sourceReportSha256 === null) {
    throw new Error("Durable live spend ledger has no synchronized report baseline");
  }
  const expected = input.suite === "smoke" ? 1 : 12;
  const totalCostUsd = sum(input.attempts.map(({ costUsd }) => costUsd));
  const completeMatrix =
    input.suite === "full" ? hasExactFullMatrix(input.results) : input.results.length === 1;
  const caps = new Map(
    input.resultChapterCaps.map(({ capUsd, chapter, povId }) => [
      resultKey(povId, chapter),
      capUsd,
    ]),
  );
  const gates = {
    allAuditsApproved:
      input.results.length === expected && input.results.every(({ audit }) => audit.approved),
    allCommitsCompleted: completeMatrix,
    allCostsWithinChapterCap:
      input.results.length === expected &&
      input.results.every(
        (result) =>
          result.costUsd <=
          (caps.get(resultKey(result.povId, result.chapter)) ?? Number.NEGATIVE_INFINITY),
      ),
    allPovLeakListsEmpty:
      input.results.length === expected &&
      input.results.every(({ audit }) => audit.leakedFactIds.length === 0),
    allProseWithinWordLimit:
      input.results.length === expected &&
      input.results.every(({ wordCount: count }) => count >= 900 && count <= 1_300),
    allStreamsReconstructed:
      input.results.length === expected &&
      input.results.every(({ streamChunkCount, streamReconstructed }) =>
        Boolean(streamChunkCount > 0 && streamReconstructed),
      ),
    p95WithinSixtySeconds:
      input.results.length > 0 &&
      percentile(
        input.results.map(({ streamingLatencyMs }) => streamingLatencyMs),
        0.95,
      ) <= 60_000,
    traceCostMatchesAttempts:
      input.results.length === expected &&
      input.results.every((result) => resultTraceCostMatches(result)),
    totalCostWithinCap: ledgerSnapshot.totalExposureUsd <= TOTAL_CAP_USD,
  };

  return LiveReportSchema.parse({
    adapterMode: input.adapterMode,
    attempts: input.attempts,
    auditRejections: input.auditRejections,
    budgetLedger: ledgerSnapshot,
    budgetMode: "durable-request-reservations",
    chapterCostCapUsd: input.chapterCostCapUsd,
    completedChapters: input.results.length,
    cumulativeCostUsd: input.priorSpendUsd + totalCostUsd,
    draftRejections: input.draftRejections,
    error: failure === null ? null : safeError(failure, input.apiKey),
    finishedAt: new Date().toISOString(),
    gates,
    nativeRequested: input.nativeRequested,
    povFilter: input.povFilter,
    priorSpendUsd: input.priorSpendUsd,
    projectedMaximumCumulativeCostUsd: input.projectedMaximumCumulativeCostUsd,
    promptVersion: PROMPT_VERSION,
    resultChapterCaps: input.resultChapterCaps,
    results: input.results,
    resume:
      input.resumeReportPath === null ||
      input.resumeSource === null ||
      input.resumeReport === null ||
      input.resumePreparation === null
        ? null
        : {
            bridgeFiles: input.resumeVerification.bridgeFiles,
            changedPaths: input.resumeVerification.changedPaths,
            discardedResultCount: input.resumePreparation.discardedResultCount,
            existingAttemptCostUsd: input.existingAttemptCostUsd,
            retainedPovIds: input.resumePreparation.retainedPovIds,
            retainedResults: input.resumePreparation.retainedResults.map((result) => {
              const sourceChapterCapUsd = input.resumePreparation?.retainedResultCaps.find(
                (entry) => entry.povId === result.povId && entry.chapter === result.chapter,
              )?.capUsd;
              if (sourceChapterCapUsd === undefined) {
                throw new Error(
                  `Retained result ${resultKey(result.povId, result.chapter)} lost cap provenance`,
                );
              }
              return {
                chapter: result.chapter,
                povId: result.povId,
                sourceChapterCapUsd,
                sourceGitSha: result.trace.gitSha,
              };
            }),
            sourceChapterCostCapUsd: input.resumeReport.chapterCostCapUsd,
            sourceGitSha: input.resumeReport.sourceGitSha,
            sourceReportPath: input.resumeReportPath,
            sourceReportSha256: input.resumeSource.sha256,
            sourceReportVersion: input.resumeReport.version,
          },
    sourceGitSha: input.sourceGitSha,
    startedAt: input.startedAt,
    suite: input.suite,
    totalCostCapUsd: TOTAL_CAP_USD,
    totalCostUsd,
    version: REPORT_VERSION,
  });
}

export function restoreRetainedChapter(
  store: StoryStore,
  result: LiveResult,
  initialChoice: Choice | undefined,
): void {
  if (result.chapter !== 1 || initialChoice === undefined) {
    throw new Error("Only a complete retained chapter 1 prefix can restore live state");
  }
  const before = store.loadWorldState("ashen-crown-v1");
  if (!before || before.lockedPovId !== result.povId || before.chapter !== 0) {
    throw new Error("Retained chapter restore requires its locked initial world");
  }
  if (hashJson(before) !== result.trace.stateBeforeHash) {
    throw new Error("Retained chapter state-before hash does not match the seed fixture");
  }
  const trace = TraceEnvelopeSchema.parse(result.trace);
  const playerIntent = trace.intents.find(
    ({ actorId, id }) => actorId === result.povId && id.startsWith("intent-player-"),
  );
  if (
    !playerIntent ||
    playerIntent.goal !== initialChoice.description ||
    !isDeepStrictEqual(playerIntent.action, initialChoice.action)
  ) {
    throw new Error("Retained chapter player intent does not match the live protocol choice");
  }
  const staged = stageWorldDelta(before, trace.intents, trace.acceptedDelta);
  if (!staged.ok) throw new Error("Retained chapter delta cannot restage from the seed fixture");
  const prospective = staged.data.state;
  if (hashJson(prospective) !== result.trace.stateAfterHash) {
    throw new Error("Retained chapter state-after hash does not match its accepted delta");
  }
  const options = buildChapterChoiceOptions(prospective);
  const frame = canonicalizeChapterFrameCandidate(prospective, {
    optionIds: options.slice(0, 2).map(({ id }) => id),
    title: "Restored live checkpoint",
  });
  if (!frame.ok) throw new Error("Retained chapter cannot build legal continuation choices");
  const chapter: ChapterRecord = {
    chapter: prospective.chapter,
    choices: frame.data.choices,
    estimatedCostUsd: result.costUsd,
    id: `chapter-${String(prospective.chapter).padStart(3, "0")}`,
    latencyMs: result.latencyMs,
    narrativeAudit: result.audit,
    playerAction: {
      action: initialChoice.action,
      actorId: result.povId,
      description: initialChoice.description,
      milestoneId: initialChoice.milestoneId,
      source: "suggested",
      stateVersion: before.version,
    },
    povCharacterId: result.povId,
    prose: result.prose,
    proseHash: result.audit.proseHash,
    safeContextHash: hashJson(buildPovContext(prospective, result.povId)),
    stateAfterVersion: prospective.version,
    stateBeforeVersion: before.version,
    terminal: prospective.terminal,
    title: frame.data.title,
    traceId: trace.runId,
    usage: result.usage,
  };
  store.commitTurn({
    chapter,
    delta: trace.acceptedDelta,
    state: prospective,
    trace,
  });
  const restored = store.loadWorldState("ashen-crown-v1");
  if (!restored || hashJson(restored) !== result.trace.stateAfterHash) {
    throw new Error("Retained chapter restore did not commit the authenticated state");
  }
}

export function writeAtomicJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function assertChapterResult(
  result: LiveResult,
  nativeRequested: boolean,
  perChapterCapUsd: number,
): void {
  if (!result.audit.approved || result.audit.leakedFactIds.length > 0) {
    throw new Error(`Narrative audit failed for ${result.povId} chapter ${result.chapter}`);
  }
  if (result.wordCount < 900 || result.wordCount > 1_300) {
    throw new Error(`Chapter word count is invalid: ${result.wordCount}`);
  }
  if (result.costUsd > perChapterCapUsd) {
    throw new Error(`Chapter cost $${result.costUsd.toFixed(6)} exceeded cap`);
  }
  if (result.streamChunkCount < 1 || !result.streamReconstructed) {
    throw new Error("Validated replay did not reconstruct committed prose");
  }
  if (!result.trace.calls.some(({ phase }) => phase === "narration")) {
    throw new Error("Trace omitted narration call");
  }
  if (!result.trace.calls.some(({ phase }) => phase === "audit")) {
    throw new Error("Trace omitted audit call");
  }
  const wantedMode = nativeRequested ? "native-multi-agent" : "sequential";
  if (result.adapterMode !== wantedMode) {
    throw new Error(`Adapter mode ${result.adapterMode} did not match ${wantedMode}`);
  }
  if (!resultTraceCostMatches(result)) {
    throw new Error("Chapter cost does not match its trace attempts");
  }
}

function writeReviewPackets(results: readonly LiveResult[]): void {
  if (!hasExactFullMatrix(results)) {
    throw new Error("Review packets require exact chapter 1 and 2 pairs for all six POVs");
  }
  mkdirSync(REVIEW_DIRECTORY, { recursive: true });
  for (const povId of CHARACTER_IDS) {
    const chapters = results
      .filter((result) => result.povId === povId)
      .sort((left, right) => left.chapter - right.chapter);
    const body = [
      `# POV Review Packet: ${povId}`,
      "",
      "Review status: pending human review.",
      "",
      "Dimensions: choice fulfillment, causality, POV voice, progression clarity, continuity, off-screen consequence, repetition.",
      "",
      ...chapters.flatMap((result) => [
        `## Chapter ${result.chapter}`,
        "",
        `- Adapter: ${result.adapterMode}`,
        `- Words: ${result.wordCount}`,
        `- Cost: $${result.costUsd.toFixed(6)}`,
        `- Latency: ${result.latencyMs} ms`,
        `- Audit: ${JSON.stringify(result.audit.scores)}`,
        "",
        result.prose,
        "",
      ]),
    ].join("\n");
    writeFileSync(resolve(REVIEW_DIRECTORY, `${povId}.md`), `${body}\n`, "utf8");
  }
}

export function prepareResume(
  report: ResumableLiveReport,
  requirements: ResumeRequirements,
): ResumePreparation {
  if (report.suite !== "full") {
    throw new Error("Resume report must be a version 5, 6, or 7 full-suite report");
  }
  if (report.priorSpendUsd !== requirements.priorSpendUsd) {
    throw new Error("Resume report prior spend does not match this run");
  }
  if (report.adapterMode !== requirements.adapterMode) {
    throw new Error("Resume report adapter does not match this run");
  }
  if (report.promptVersion !== requirements.promptVersion) {
    throw new Error("Resume report prompt version does not match current prompts");
  }
  if (report.sourceGitSha !== requirements.sourceGitSha) {
    throw new Error("Resume report Git SHA does not match current HEAD");
  }

  const retainedResults: LiveResult[] = [];
  const retainedResultCaps: ResultChapterCap[] = [];
  const retainedPovIds: CharacterId[] = [];
  const pendingPovIds: CharacterId[] = [];
  let discardedResultCount = 0;
  for (const povId of CHARACTER_IDS) {
    const povResults = report.results.filter((result) => result.povId === povId);
    const chapters = [...povResults].sort((left, right) => left.chapter - right.chapter);
    const contiguousPrefix =
      (chapters.length === 1 && chapters[0]?.chapter === 1) ||
      (chapters.length === 2 && chapters[0]?.chapter === 1 && chapters[1]?.chapter === 2);
    if (contiguousPrefix) {
      for (const result of chapters) {
        const sourceCap = sourceResultChapterCap(report, result.povId, result.chapter);
        assertChapterResult(result, requirements.adapterMode === "native-multi-agent", sourceCap);
        assertResultPayloadConsistency(result);
        retainedResultCaps.push({
          capUsd: sourceCap,
          chapter: result.chapter,
          povId: result.povId,
        });
      }
      retainedResults.push(...chapters);
      retainedPovIds.push(povId);
      if (chapters.length < 2) pendingPovIds.push(povId);
    } else {
      discardedResultCount += chapters.length;
      pendingPovIds.push(povId);
    }
  }
  const attempts = [...report.attempts];
  return {
    attempts,
    auditRejections: [...report.auditRejections],
    discardedResultCount,
    draftRejections: [...report.draftRejections],
    existingAttemptCostUsd: sum(attempts.map(({ costUsd }) => costUsd)),
    pendingPovIds,
    retainedPovIds,
    retainedResultCaps,
    retainedResults,
  };
}

function sourceResultChapterCap(
  report: ResumableLiveReport,
  povId: CharacterId,
  chapter: number,
): number {
  if (report.version !== REPORT_VERSION) return report.chapterCostCapUsd;
  const cap = report.resultChapterCaps.find(
    (entry) => entry.povId === povId && entry.chapter === chapter,
  )?.capUsd;
  if (cap === undefined) throw new Error(`Resume result ${resultKey(povId, chapter)} has no cap`);
  return cap;
}

export function projectedCumulativeCostUsd(
  priorSpendUsd: number,
  existingAttemptCostUsd: number,
  pendingChapterCount: number,
  chapterCostCapUsd: number,
): number {
  return priorSpendUsd + existingAttemptCostUsd + pendingChapterCount * chapterCostCapUsd;
}

export function hasExactFullMatrix(results: readonly LiveResult[]): boolean {
  if (results.length !== CHARACTER_IDS.length * 2) return false;
  return CHARACTER_IDS.every((povId) => {
    const chapters = results
      .filter((result) => result.povId === povId)
      .map(({ chapter }) => chapter)
      .sort((left, right) => left - right);
    return chapters.length === 2 && chapters[0] === 1 && chapters[1] === 2;
  });
}

export function resultTraceCostMatches(result: LiveResult): boolean {
  return costsMatch(result.costUsd, sum(result.trace.attempts.map(({ costUsd }) => costUsd)));
}

interface ResumeSource {
  readonly report: ResumableLiveReport;
  readonly sha256: string;
}

function readLiveReport(path: string): ResumeSource {
  let raw: string;
  let candidate: unknown;
  try {
    raw = readFileSync(path, "utf8");
    candidate = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot read resume report: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const current = LiveReportSchema.safeParse(candidate);
  if (current.success) return { report: current.data, sha256: hashText(raw) };
  const previous = Version6LiveReportSchema.safeParse(candidate);
  if (previous.success) return { report: previous.data, sha256: hashText(raw) };
  const legacy = LegacyLiveReportSchema.safeParse(candidate);
  if (legacy.success) return { report: legacy.data, sha256: hashText(raw) };
  const details = [...current.error.issues, ...previous.error.issues, ...legacy.error.issues]
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "report"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Resume report is not valid version 5, 6, or 7 data: ${details}`);
}

function verifyResumeCheckpoint(
  report: ResumableLiveReport,
  reportSha256: string,
  currentSourceGitSha: string,
): ResumeVerification {
  const bridgeFiles = assertRegisteredResumeCheckpoint(report, reportSha256);
  if (report.sourceGitSha === currentSourceGitSha) return { bridgeFiles, changedPaths: [] };
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", report.sourceGitSha, currentSourceGitSha], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
  } catch {
    throw new Error("Resume report Git SHA is not an ancestor of current HEAD");
  }
  const changedPaths = execFileSync(
    "git",
    ["diff", "--name-only", `${report.sourceGitSha}..${currentSourceGitSha}`],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    },
  )
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
  assertResumeHarnessPaths(
    changedPaths,
    bridgeFiles.map(({ path }) => path),
  );
  return { bridgeFiles, changedPaths };
}

export function assertRegisteredResumeCheckpoint(
  report: ResumableLiveReport,
  reportSha256: string,
  registryCandidate?: unknown,
  currentFileHashes?: Readonly<Record<string, string>>,
): z.infer<typeof BridgeFileSchema>[] {
  let candidate = registryCandidate;
  if (candidate === undefined) {
    try {
      candidate = JSON.parse(readFileSync(RESUME_CHECKPOINTS_PATH, "utf8")) as unknown;
    } catch (error) {
      throw new Error(
        `Cannot read resume checkpoint registry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const registry = ResumeCheckpointRegistrySchema.parse(candidate);
  const registered = registry.checkpoints.find(
    (checkpoint) =>
      checkpoint.adapterMode === report.adapterMode &&
      checkpoint.chapterCostCapUsd === report.chapterCostCapUsd &&
      checkpoint.priorSpendUsd === report.priorSpendUsd &&
      checkpoint.promptVersion === report.promptVersion &&
      checkpoint.reportSha256 === reportSha256 &&
      checkpoint.reportVersion === report.version &&
      checkpoint.sourceGitSha === report.sourceGitSha,
  );
  if (!registered) {
    throw new Error("Resume report is not present in the committed checkpoint registry");
  }
  for (const bridgeFile of registered.bridgeFiles) {
    const actualSha256 =
      currentFileHashes?.[bridgeFile.path] ??
      hashText(readFileSync(resolve(ROOT, bridgeFile.path), "utf8"));
    if (actualSha256 !== bridgeFile.sha256) {
      throw new Error(`Resume bridge file ${bridgeFile.path} does not match its audited hash`);
    }
  }
  return registered.bridgeFiles;
}

export function assertResumeHarnessPaths(
  paths: readonly string[],
  bridgePaths: readonly string[] = [],
): void {
  const allowedBridgePaths = new Set(bridgePaths.map((path) => path.replaceAll("\\", "/")));
  const forbidden = paths.find((path) => {
    const normalized = path.replaceAll("\\", "/");
    return !RESUME_NON_RUNTIME_PATHS.has(normalized) && !allowedBridgePaths.has(normalized);
  });
  if (forbidden !== undefined) {
    throw new Error(`Resume checkpoint changed runtime path ${forbidden}`);
  }
}

function parseSuite(args: readonly string[]): "full" | "smoke" {
  const index = args.indexOf("--suite");
  const value = index === -1 ? undefined : args[index + 1];
  if (value !== "smoke" && value !== "full") {
    throw new Error("Use --suite smoke or --suite full");
  }
  return value;
}

function parsePov(args: readonly string[]): CharacterId | null {
  const index = args.indexOf("--pov");
  if (index === -1) return null;
  const value = args[index + 1];
  if (!CHARACTER_IDS.includes(value as CharacterId)) {
    throw new Error(`Unknown --pov value ${value ?? "missing"}`);
  }
  return value as CharacterId;
}

function parseOptionalFlag(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseUsdFlag(
  args: readonly string[],
  name: string,
  fallback: number,
  allowZero: boolean,
  maximum: number,
): number {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value > maximum || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(
      `${name} must be ${allowZero ? "nonnegative" : "positive"} and at most ${maximum}`,
    );
  }
  return value;
}

function safeError(error: unknown, apiKey: string): { code: string; message: string } {
  const code = error instanceof OpenAIRuntimeError ? error.code : "LIVE_EVAL_FAILED";
  const raw = error instanceof Error ? error.message : String(error);
  return { code, message: raw.split(apiKey).join("[REDACTED]") };
}

function wordCount(prose: string): number {
  return prose.trim().split(/\s+/u).filter(Boolean).length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function costsMatch(left: number, right: number): boolean {
  return Math.abs(left - right) < MONEY_EPSILON_USD;
}

function assertResultPayloadConsistency(result: LiveResult): void {
  if (wordCount(result.prose) !== result.wordCount) {
    throw new Error("Resume result word count does not match prose");
  }
  if (hashText(result.prose) !== result.audit.proseHash) {
    throw new Error("Resume result prose hash does not match audit");
  }
  if (!isDeepStrictEqual(result.usage, result.trace.totalUsage)) {
    throw new Error("Resume result usage does not match trace");
  }
  if (!costsMatch(result.costUsd, result.trace.totalEstimatedCostUsd)) {
    throw new Error("Resume result cost does not match trace total");
  }
  if (result.trace.gateResult !== "passed") {
    throw new Error("Resume result trace gate did not pass");
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function currentGitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    }).trim();
  } catch {
    return "0000000";
  }
}

function assertCleanGitCheckpoint(): void {
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    },
  ).trim();
  if (status.length > 0) {
    throw new Error("Full live eval requires a clean committed Git checkpoint");
  }
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? sorted.at(-1) ?? 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    const safe = safeError(error, apiKey || "never-match-empty-key");
    console.error(`${safe.code}: ${safe.message}`);
    process.exitCode = 1;
  });
}
