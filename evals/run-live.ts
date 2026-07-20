import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { config } from "dotenv";

import {
  CHARACTER_IDS,
  NarrativeAuditSchema,
  PROMPT_VERSION,
  RuntimeAttemptTraceSchema,
  TraceEnvelopeSchema,
  UsageSchema,
  VALIDATION_CODES,
  validateWorldState,
  type CharacterId,
} from "@infinite-litrpg/shared";
import OpenAI from "openai";
import { z } from "zod";

import { OpenAIRuntimeError } from "../app/src/server/openai/errors";
import { StoryService } from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";

const ROOT = process.cwd();
const REPORT_DIRECTORY = resolve(ROOT, "evals", "reports");
const REVIEW_DIRECTORY = resolve(ROOT, "docs", "review-packets");
const RESUME_CHECKPOINTS_PATH = resolve(ROOT, "evals", "resume-checkpoints.json");
const DEFAULT_PER_CHAPTER_CAP_USD = 0.1;
const TOTAL_CAP_USD = 3;
const REPORT_VERSION = 6;
const LEGACY_REPORT_VERSION = 5;
const MONEY_EPSILON_USD = 0.000_000_1;
const RESUME_NON_RUNTIME_PATHS = new Set([
  "app/src/server/story/story-service.test.ts",
  "docs/PLAN.md",
  "docs/STATUS.md",
  "evals/README.md",
  "evals/resume-checkpoints.json",
  "evals/run-live.test.ts",
]);

const PovIdSchema = z.enum(CHARACTER_IDS);
const AdapterModeSchema = z.enum(["native-multi-agent", "sequential"]);
const GitShaSchema = z.string().regex(/^[a-f0-9]{7,40}$/u);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ResumeCheckpointRegistrySchema = z
  .object({
    checkpoints: z
      .array(
        z
          .object({
            adapterMode: AdapterModeSchema,
            bridgeRunnerSha256: Sha256Schema.nullable(),
            chapterCostCapUsd: z.number().positive().max(DEFAULT_PER_CHAPTER_CAP_USD),
            id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
            priorSpendUsd: z.number().min(0).max(TOTAL_CAP_USD),
            promptVersion: z.string().min(1).max(240),
            reportSha256: Sha256Schema,
            reportVersion: z.union([z.literal(LEGACY_REPORT_VERSION), z.literal(REPORT_VERSION)]),
            sourceGitSha: GitShaSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    version: z.literal(1),
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
      if (
        (checkpoint.reportVersion === LEGACY_REPORT_VERSION) !==
        (checkpoint.bridgeRunnerSha256 !== null)
      ) {
        context.addIssue({
          code: "custom",
          message: "Only legacy checkpoints require a bridge runner hash",
          path: ["checkpoints", index, "bridgeRunnerSha256"],
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
    trace: TraceEnvelopeSchema,
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
    cumulativeCostUsd: z.number().min(0).max(TOTAL_CAP_USD),
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
    totalCostUsd: z.number().min(0).max(TOTAL_CAP_USD),
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
    sourceReportVersion: z.union([z.literal(LEGACY_REPORT_VERSION), z.literal(REPORT_VERSION)]),
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

export const LiveReportSchema = BaseLiveReportSchema.extend({
  resume: ResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(REPORT_VERSION),
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
        report.resume.sourceReportVersion === LEGACY_REPORT_VERSION,
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

export type LiveResult = z.infer<typeof LiveResultSchema>;
export type LegacyLiveReport = z.infer<typeof LegacyLiveReportSchema>;
export type LiveReport = z.infer<typeof LiveReportSchema>;
export type ResumableLiveReport = LegacyLiveReport | LiveReport;

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
  readonly retainedResults: LiveResult[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suite = parseSuite(args);
  const nativeRequested = args.includes("--native");
  const adapterMode = nativeRequested ? "native-multi-agent" : "sequential";
  const povFilter = parsePov(args);
  const resumeReportArgument = parseOptionalFlag(args, "--resume-report");
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
  const resumeChangedPaths =
    resumeSource === null
      ? []
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
  const pendingChapterCount = plannedPovIds.length * turnsPerPov;
  const existingAttemptCostUsd = resumePreparation?.existingAttemptCostUsd ?? 0;
  const projectedMaximumCumulativeCostUsd = projectedCumulativeCostUsd(
    priorSpendUsd,
    existingAttemptCostUsd,
    pendingChapterCount,
    perChapterCapUsd,
  );
  if (projectedMaximumCumulativeCostUsd > TOTAL_CAP_USD) {
    throw new Error("Prior spend, existing attempts, and pending chapter caps can exceed $3");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey });
  mkdirSync(REPORT_DIRECTORY, { recursive: true });

  const startedAt = new Date().toISOString();
  const results: LiveResult[] = [...(resumePreparation?.retainedResults ?? [])];
  const attempts: LiveReport["attempts"] = [...(resumePreparation?.attempts ?? [])];
  const auditRejections: LiveReport["auditRejections"] = [
    ...(resumePreparation?.auditRejections ?? []),
  ];
  const draftRejections: LiveReport["draftRejections"] = [
    ...(resumePreparation?.draftRejections ?? []),
  ];
  let failure: unknown = null;
  try {
    for (const povId of plannedPovIds) {
      const store = new StoryStore();
      try {
        const service = new StoryService(store, client, {
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
        for (let turn = 0; turn < turnsPerPov; turn += 1) {
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
          const totalCost = sum(attempts.map(({ costUsd }) => costUsd));
          if (priorSpendUsd + totalCost > TOTAL_CAP_USD) {
            throw new Error("Prior spend plus live suite attempts exceeded the $3 total cap");
          }
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

  const expected = suite === "smoke" ? 1 : 12;
  const totalCostUsd = sum(attempts.map(({ costUsd }) => costUsd));
  const p95LatencyMs = percentile(
    results.map(({ streamingLatencyMs }) => streamingLatencyMs),
    0.95,
  );
  const completeMatrix = suite === "full" ? hasExactFullMatrix(results) : results.length === 1;
  const gates = {
    allAuditsApproved: results.length === expected && results.every(({ audit }) => audit.approved),
    allCommitsCompleted: completeMatrix,
    allCostsWithinChapterCap:
      results.length === expected && results.every(({ costUsd }) => costUsd <= perChapterCapUsd),
    allPovLeakListsEmpty:
      results.length === expected && results.every(({ audit }) => audit.leakedFactIds.length === 0),
    allProseWithinWordLimit:
      results.length === expected &&
      results.every(({ wordCount: count }) => count >= 900 && count <= 1_300),
    allStreamsReconstructed:
      results.length === expected &&
      results.every(({ streamChunkCount, streamReconstructed }) =>
        Boolean(streamChunkCount > 0 && streamReconstructed),
      ),
    p95WithinSixtySeconds:
      results.length > 0 &&
      percentile(
        results.map(({ streamingLatencyMs }) => streamingLatencyMs),
        0.95,
      ) <= 60_000,
    traceCostMatchesAttempts:
      results.length === expected && results.every((result) => resultTraceCostMatches(result)),
    totalCostWithinCap: priorSpendUsd + totalCostUsd <= TOTAL_CAP_USD,
  };
  const report = LiveReportSchema.parse({
    adapterMode,
    attempts,
    auditRejections,
    chapterCostCapUsd: perChapterCapUsd,
    completedChapters: results.length,
    cumulativeCostUsd: priorSpendUsd + totalCostUsd,
    draftRejections,
    error: failure === null ? null : safeError(failure, apiKey),
    finishedAt: new Date().toISOString(),
    gates,
    nativeRequested,
    povFilter,
    priorSpendUsd,
    projectedMaximumCumulativeCostUsd,
    promptVersion: PROMPT_VERSION,
    results,
    resume:
      resumeReportPath === null ||
      resumeSource === null ||
      resumeReport === null ||
      resumePreparation === null
        ? null
        : {
            changedPaths: resumeChangedPaths,
            discardedResultCount: resumePreparation.discardedResultCount,
            existingAttemptCostUsd,
            retainedPovIds: resumePreparation.retainedPovIds,
            retainedResultGitShas: resumePreparation.retainedResults.map((result) => ({
              chapter: result.chapter,
              povId: result.povId,
              sourceGitSha: result.trace.gitSha,
            })),
            sourceChapterCostCapUsd: resumeReport.chapterCostCapUsd,
            sourceGitSha: resumeReport.sourceGitSha,
            sourceReportPath: resumeReportPath,
            sourceReportSha256: resumeSource.sha256,
            sourceReportVersion: resumeReport.version,
          },
    sourceGitSha,
    startedAt,
    suite,
    totalCostCapUsd: TOTAL_CAP_USD,
    totalCostUsd,
    version: REPORT_VERSION,
  });
  const reportPath = resolve(
    REPORT_DIRECTORY,
    `live-${suite}-${nativeRequested ? "native" : "sequential"}${povFilter ? `-${povFilter}` : ""}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (suite === "full" && failure === null && Object.values(gates).every(Boolean)) {
    writeReviewPackets(results);
  }

  console.log(
    `report ${reportPath}; ${results.length}/${expected} chapters; $${totalCostUsd.toFixed(5)}; p95 ${p95LatencyMs}ms`,
  );
  if (failure !== null) {
    const safe = safeError(failure, apiKey);
    console.error(`${safe.code}: ${safe.message}`);
    process.exitCode = 1;
    return;
  }
  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedGates.length > 0) {
    console.error(`failed gates: ${failedGates.join(", ")}`);
    process.exitCode = 1;
  }
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
    throw new Error("Resume report must be a version 5 or 6 full-suite report");
  }
  if (report.priorSpendUsd !== requirements.priorSpendUsd) {
    throw new Error("Resume report prior spend does not match this run");
  }
  if (requirements.chapterCostCapUsd > report.chapterCostCapUsd) {
    throw new Error("Resume report chapter cap cannot increase");
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
  const retainedPovIds: CharacterId[] = [];
  const pendingPovIds: CharacterId[] = [];
  let discardedResultCount = 0;
  for (const povId of CHARACTER_IDS) {
    const povResults = report.results.filter((result) => result.povId === povId);
    const chapters = [...povResults].sort((left, right) => left.chapter - right.chapter);
    const completePair =
      chapters.length === 2 && chapters[0]?.chapter === 1 && chapters[1]?.chapter === 2;
    if (completePair) {
      for (const result of chapters) {
        assertChapterResult(
          result,
          requirements.adapterMode === "native-multi-agent",
          requirements.chapterCostCapUsd,
        );
        assertResultPayloadConsistency(result);
      }
      retainedResults.push(...chapters);
      retainedPovIds.push(povId);
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
    retainedResults,
  };
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
  const legacy = LegacyLiveReportSchema.safeParse(candidate);
  if (legacy.success) return { report: legacy.data, sha256: hashText(raw) };
  const details = [...current.error.issues, ...legacy.error.issues]
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "report"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Resume report is not valid version 5 or 6 data: ${details}`);
}

function verifyResumeCheckpoint(
  report: ResumableLiveReport,
  reportSha256: string,
  currentSourceGitSha: string,
): string[] {
  assertRegisteredResumeCheckpoint(report, reportSha256);
  if (report.sourceGitSha === currentSourceGitSha) return [];
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
  assertResumeHarnessPaths(changedPaths, report.version === LEGACY_REPORT_VERSION);
  return changedPaths;
}

export function assertRegisteredResumeCheckpoint(
  report: ResumableLiveReport,
  reportSha256: string,
  registryCandidate?: unknown,
  currentRunnerSha256?: string,
): void {
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
  if (registered.bridgeRunnerSha256 !== null) {
    const runnerSha256 =
      currentRunnerSha256 ?? hashText(readFileSync(resolve(ROOT, "evals", "run-live.ts"), "utf8"));
    if (runnerSha256 !== registered.bridgeRunnerSha256) {
      throw new Error("Legacy resume bridge runner does not match its audited content hash");
    }
  }
}

export function assertResumeHarnessPaths(
  paths: readonly string[],
  allowLegacyRunnerChange = false,
): void {
  const forbidden = paths.find((path) => {
    const normalized = path.replaceAll("\\", "/");
    return (
      !RESUME_NON_RUNTIME_PATHS.has(normalized) &&
      !(allowLegacyRunnerChange && normalized === "evals/run-live.ts")
    );
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
    throw new Error(`${name} requires a path`);
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
