import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { config } from "dotenv";

import {
  CHARACTER_IDS,
  ChapterRecordSchema,
  ChapterFrameSchema,
  IdSchema,
  ModelCallTraceSchema,
  NarrativeAuditCandidateSchema,
  NarrativeAuditSchema,
  PlayerActionSchema,
  PersistedTraceEnvelopeSchema,
  PROMPT_VERSION,
  RUNTIME_SCHEMA_VERSION,
  RuntimeAttemptTraceSchema,
  RuntimeServiceTierSchema,
  TraceEnvelopeSchema,
  UsageSchema,
  VALIDATION_CODES,
  validateWorldState,
  validateSuggestedChoices,
  WorldDeltaSchema,
  WorldIntentSchema,
  WorldStateSchema,
  buildChapterChoiceOptions,
  buildPovContext,
  canonicalizeChapterFrameCandidate,
  stageWorldDelta,
  type ChapterRecord,
  type CharacterId,
  type Choice,
  type RuntimeServiceTier,
  type WorldState,
} from "@infinite-litrpg/shared";
import OpenAI from "openai";
import { z } from "zod";

import { OpenAIRuntimeError } from "../app/src/server/openai/errors";
import { pricingVersionForServiceTier } from "../app/src/server/openai/usage";
import {
  StoryService,
  canonicalizeNarrativeAuditOutput,
  type CanonicalRenarrationResult,
} from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";
import { LiveSpendLedger, type LiveSpendSnapshot } from "./live-spend-ledger";
import {
  assertPrompt1411FullMatrixFits,
  projectPrompt1411FullMatrixCostUsd,
} from "./live-cost-projection";

const ROOT = process.cwd();
const REPORT_DIRECTORY = resolve(ROOT, "evals", "reports");
const RESUME_CHECKPOINTS_PATH = resolve(ROOT, "evals", "resume-checkpoints.json");
const LIVE_SPEND_LEDGER_PATH = resolve(REPORT_DIRECTORY, "live-spend-ledger.db");
const DEFAULT_PER_CHAPTER_CAP_USD = 0.1;
const TOTAL_CAP_USD = 3;
const LEGACY_REPORT_VERSION = 5;
const VERSION_6_REPORT_VERSION = 6;
const VERSION_7_REPORT_VERSION = 7;
const VERSION_8_REPORT_VERSION = 8;
const REPORT_VERSION = 9;
const MONEY_EPSILON_USD = 0.000_000_1;
const MAX_RESUME_BRIDGE_FILES = 50;
const MAX_RESUME_CHANGED_PATHS = 50;
export const RENARRATION_AUDIT_REASONING_EFFORT = "none" as const;
export const RENARRATION_AUDIT_MAX_OUTPUT_TOKENS = 64 as const;
export const RENARRATION_NARRATION_DIRECTIVE =
  "Movement lock: beforeValues.locationId is departed; currentEffects set_location ends at afterCanon.povCharacter.locationId. Never put the departed location ahead or make it the destination. Write a complete 900 to 925 words now; do not stop short or rely on a continuation." as const;
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
const RerunFromSchema = z
  .object({
    chapter: z.union([z.literal(1), z.literal(2)]),
    povId: PovIdSchema,
  })
  .strict();
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
            bridgeFiles: z.array(BridgeFileSchema).max(MAX_RESUME_BRIDGE_FILES),
            chapterCostCapUsd: z.number().positive().max(DEFAULT_PER_CHAPTER_CAP_USD),
            id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
            priorSpendUsd: z.number().min(0).max(TOTAL_CAP_USD),
            promptVersion: z.string().min(1).max(240),
            reportSha256: Sha256Schema,
            reportVersion: z.union([
              z.literal(LEGACY_REPORT_VERSION),
              z.literal(VERSION_6_REPORT_VERSION),
              z.literal(VERSION_7_REPORT_VERSION),
              z.literal(VERSION_8_REPORT_VERSION),
              z.literal(REPORT_VERSION),
            ]),
            serviceTier: RuntimeServiceTierSchema.default("standard"),
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
    }
  });
const ValidationIssueSchema = z
  .object({
    code: z.enum(VALIDATION_CODES),
    message: z.string().min(1).max(4_000),
    path: z.string().max(1_000),
  })
  .strict();

const ForbiddenFactEvidenceSchema = z
  .object({ claim: z.string().min(1).max(4_000), id: IdSchema })
  .strict();
const CanonicalNarrativeInputEvidenceSchema = z
  .object({
    allowedFactIds: z.array(IdSchema).max(200),
    chapterRecord: ChapterRecordSchema,
    forbiddenFacts: z.array(ForbiddenFactEvidenceSchema).max(200),
    frame: ChapterFrameSchema,
    playerAction: PlayerActionSchema,
    stateAfter: WorldStateSchema,
    stateBefore: WorldStateSchema,
    worldVersionAfter: z.number().int().min(1),
    worldVersionBefore: z.number().int().min(1),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.worldVersionAfter !== evidence.worldVersionBefore + 1) {
      context.addIssue({ code: "custom", message: "Canonical world versions are not contiguous" });
    }
    if (evidence.playerAction.stateVersion !== evidence.worldVersionBefore) {
      context.addIssue({
        code: "custom",
        message: "Canonical player action version does not match the world",
      });
    }
    if (new Set(evidence.allowedFactIds).size !== evidence.allowedFactIds.length) {
      context.addIssue({ code: "custom", message: "Canonical allowed fact IDs repeat" });
    }
    const forbiddenIds = evidence.forbiddenFacts.map(({ id }) => id);
    if (new Set(forbiddenIds).size !== forbiddenIds.length) {
      context.addIssue({ code: "custom", message: "Canonical forbidden fact IDs repeat" });
    }
    if (forbiddenIds.some((id) => evidence.allowedFactIds.includes(id))) {
      context.addIssue({ code: "custom", message: "Canonical fact partitions overlap" });
    }
  });

export const LiveResultSchema = z
  .object({
    adapterMode: AdapterModeSchema,
    audit: NarrativeAuditSchema,
    canonicalNarrativeInput: CanonicalNarrativeInputEvidenceSchema.optional(),
    chapter: z.number().int().min(1).max(2),
    costUsd: z.number().min(0).max(TOTAL_CAP_USD),
    latencyMs: z.number().int().min(0),
    povId: PovIdSchema,
    prose: z.string().min(1).max(20_000),
    streamChunkCount: z.number().int().min(1),
    streamChunks: z.array(z.string().min(1).max(4_096)).min(1).max(100).optional(),
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
    if (result.streamChunks !== undefined) {
      if (
        result.streamChunks.length !== result.streamChunkCount ||
        result.streamChunks.join("") !== result.prose ||
        !result.streamReconstructed
      ) {
        context.addIssue({
          code: "custom",
          message: "Recorded stream chunks do not reconstruct the committed prose",
        });
      }
    }
    const canonical = result.canonicalNarrativeInput;
    if (canonical !== undefined) {
      if (
        canonical.worldVersionBefore !== result.chapter ||
        canonical.worldVersionAfter !== result.chapter + 1
      ) {
        context.addIssue({
          code: "custom",
          message: "Canonical world versions do not match the live chapter",
        });
      }
      if (
        canonical.playerAction.actorId !== result.povId ||
        canonical.frame.terminal ||
        result.trace.acceptedDelta.expectedWorldVersion !== canonical.worldVersionBefore
      ) {
        context.addIssue({
          code: "custom",
          message: "Canonical narrative inputs disagree with the committed result",
        });
      }
      const playerIntents = result.trace.intents.filter(
        ({ actorId, id }) => actorId === result.povId && id.startsWith("intent-player-"),
      );
      if (
        playerIntents.length !== 1 ||
        playerIntents[0]?.goal !== canonical.playerAction.description ||
        !isDeepStrictEqual(playerIntents[0]?.action, canonical.playerAction.action)
      ) {
        context.addIssue({
          code: "custom",
          message: "Canonical player action does not match the committed player intent",
        });
      }
    }
  });

const CurrentRuntimeAttemptTraceSchema = RuntimeAttemptTraceSchema.and(
  z
    .object({
      requestedServiceTier: RuntimeServiceTierSchema,
      serviceTier: RuntimeServiceTierSchema.nullable(),
    })
    .passthrough(),
);
const CurrentModelCallTraceSchema = ModelCallTraceSchema.and(
  z
    .object({
      requestedServiceTier: RuntimeServiceTierSchema,
      serviceTier: RuntimeServiceTierSchema,
    })
    .passthrough(),
);
const CurrentPersistedTraceEnvelopeSchema = PersistedTraceEnvelopeSchema.and(
  z
    .object({
      attempts: z.array(CurrentRuntimeAttemptTraceSchema).max(1_000),
      calls: z.array(CurrentModelCallTraceSchema).min(1).max(12),
    })
    .passthrough(),
);
const CurrentLiveResultSchema = LiveResultSchema.and(
  z.object({ trace: CurrentPersistedTraceEnvelopeSchema }).passthrough(),
);

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

const Version8GateSchema = GateSchema.extend({
  narrativeEvidenceComplete: z.boolean(),
}).strict();

const Version9GateSchema = Version8GateSchema.extend({
  serviceTierEvidenceComplete: z.boolean(),
}).strict();

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

const HistoricalResumeSchema = z
  .object({
    changedPaths: z.array(z.string().min(1).max(1_000)).max(MAX_RESUME_CHANGED_PATHS),
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
      z.literal(VERSION_6_REPORT_VERSION),
      z.literal(VERSION_7_REPORT_VERSION),
    ]),
  })
  .strict();

export const LegacyLiveReportSchema = BaseLiveReportSchema.extend({
  resume: LegacyResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(LEGACY_REPORT_VERSION),
}).superRefine((report, context) => {
  refineReportCommon(report, context);
  refineLegacyCostGates(report, context);
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
  resume: HistoricalResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(VERSION_6_REPORT_VERSION),
}).superRefine((report, context) => {
  refineReportCommon(report, context);
  refineLegacyCostGates(report, context);
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

const Version7ResumeSchema = HistoricalResumeSchema.omit({ retainedResultGitShas: true })
  .extend({
    bridgeFiles: z.array(BridgeFileSchema).max(MAX_RESUME_BRIDGE_FILES),
    retainedResults: z.array(RetainedResultProvenanceSchema).max(12),
  })
  .strict();

const Version8ResumeSchema = Version7ResumeSchema.omit({ sourceReportVersion: true })
  .extend({
    sourceReportVersion: z.union([
      z.literal(LEGACY_REPORT_VERSION),
      z.literal(VERSION_6_REPORT_VERSION),
      z.literal(VERSION_7_REPORT_VERSION),
      z.literal(VERSION_8_REPORT_VERSION),
    ]),
  })
  .strict();

const ResponseIdSchema = z.string().regex(/^resp?_[A-Za-z0-9_-]+$/u);
const CandidateProseSchema = z.string().min(1).max(50_000);
const TurnIdentitySchema = z
  .object({
    chapter: z.number().int().min(1).max(2),
    povId: PovIdSchema,
    requestId: z.string().uuid(),
    turnId: z.string().uuid(),
    worldVersionAfter: z.number().int().min(2),
    worldVersionBefore: z.number().int().min(1),
  })
  .strict()
  .superRefine((turn, context) => {
    if (turn.worldVersionAfter !== turn.worldVersionBefore + 1) {
      context.addIssue({ code: "custom", message: "Turn world versions are not contiguous" });
    }
  });
const RuntimeAttemptEvidenceSchema = z
  .object({
    attempt: RuntimeAttemptTraceSchema,
    turn: TurnIdentitySchema,
  })
  .strict();
const CurrentRuntimeAttemptEvidenceSchema = RuntimeAttemptEvidenceSchema.and(
  z.object({ attempt: CurrentRuntimeAttemptTraceSchema }).passthrough(),
);
const NarrativeRecoveryEvidenceSchema = z
  .object({
    accepted: z.boolean(),
    attempt: z.number().int().min(0).max(2),
    maximumAdditionalWords: z.number().int().min(1).max(500),
    minimumAdditionalWords: z.number().int().min(1).max(500),
    prose: CandidateProseSchema,
    rejectionReason: z.string().min(1).max(1_000).nullable(),
    responseId: ResponseIdSchema,
    wordCount: z.number().int().min(1).max(2_000),
  })
  .strict();
export const NarrativeResponseEvidenceSchema = z
  .object({
    attempt: z.number().int().min(0).max(2),
    bufferedOutputText: z.string().max(50_000),
    chapter: z.number().int().min(1).max(2),
    phase: z.enum(["audit", "narration", "recovery"]),
    povId: PovIdSchema,
    rawOutputText: z.string().max(50_000),
    responseId: ResponseIdSchema,
    sourceGitSha: GitShaSchema,
    status: z.enum(["completed", "incomplete", "failed", "in_progress"]),
    turn: TurnIdentitySchema,
    worldVersionAfter: z.number().int().min(1),
    worldVersionBefore: z.number().int().min(1),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.worldVersionAfter !== response.worldVersionBefore + 1) {
      context.addIssue({
        code: "custom",
        message: "Narrative response versions are not contiguous",
      });
    }
    if (
      response.chapter !== response.turn.chapter ||
      response.povId !== response.turn.povId ||
      response.worldVersionBefore !== response.turn.worldVersionBefore ||
      response.worldVersionAfter !== response.turn.worldVersionAfter
    ) {
      context.addIssue({ code: "custom", message: "Narrative response turn identity disagrees" });
    }
    if (response.phase === "audit" && response.bufferedOutputText !== response.rawOutputText) {
      context.addIssue({ code: "custom", message: "Audit raw response text is inconsistent" });
    }
  });
const NarrativeAuditAttemptEvidenceSchema = z
  .object({
    attempt: z.number().int().min(0).max(2),
    candidate: NarrativeAuditCandidateSchema.nullable(),
    rawOutputText: z.string().max(50_000),
    responseId: ResponseIdSchema,
    status: z.enum(["completed", "incomplete", "failed", "in_progress"]),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.status !== "completed") {
      if (attempt.candidate !== null) {
        context.addIssue({
          code: "custom",
          message: "Incomplete audit response has a parsed candidate",
        });
      }
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(attempt.rawOutputText) as unknown;
    } catch {
      if (attempt.candidate !== null) {
        context.addIssue({ code: "custom", message: "Malformed raw audit has a parsed candidate" });
      }
      return;
    }
    const parsed = NarrativeAuditCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      if (attempt.candidate !== null) {
        context.addIssue({ code: "custom", message: "Invalid raw audit has a parsed candidate" });
      }
      return;
    }
    if (attempt.candidate === null || !isDeepStrictEqual(attempt.candidate, parsed.data)) {
      context.addIssue({ code: "custom", message: "Raw and parsed audit candidates disagree" });
    }
  });
export const NarrativeCandidateEvidenceSchema = z
  .object({
    accepted: z.boolean(),
    adapterMode: AdapterModeSchema,
    allowedFactIds: z.array(IdSchema).max(200),
    audit: NarrativeAuditSchema.nullable(),
    auditAttempts: z.array(NarrativeAuditAttemptEvidenceSchema).max(3),
    auditResponseId: ResponseIdSchema.nullable(),
    backgroundIntents: z.array(WorldIntentSchema).max(4),
    chapter: z.number().int().min(1).max(2),
    delta: WorldDeltaSchema,
    deterministicIssues: z.array(ValidationIssueSchema).max(100),
    forbiddenFacts: z.array(ForbiddenFactEvidenceSchema).max(200),
    frame: ChapterFrameSchema,
    mergedProse: CandidateProseSchema,
    mergedWordCount: z.number().int().min(1).max(20_000),
    multiAgentOutputItems: z.array(z.record(z.string(), z.unknown())).max(100),
    narratorAttempt: z.number().int().min(0).max(2),
    narratorResponseId: ResponseIdSchema,
    playerAction: PlayerActionSchema,
    povId: PovIdSchema,
    promptVersion: z.literal(PROMPT_VERSION),
    rawProse: CandidateProseSchema,
    rawWordCount: z.number().int().min(1).max(20_000),
    recovery: NarrativeRecoveryEvidenceSchema.nullable(),
    rejectionStage: z.enum(["accepted", "audit", "audit-invalid", "deterministic", "recovery"]),
    schemaVersion: z.literal(RUNTIME_SCHEMA_VERSION),
    sourceGitSha: GitShaSchema,
    stateAfter: WorldStateSchema,
    stateBefore: WorldStateSchema,
    turn: TurnIdentitySchema,
    worldVersionAfter: z.number().int().min(1),
    worldVersionBefore: z.number().int().min(1),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (wordCount(candidate.rawProse) !== candidate.rawWordCount) {
      context.addIssue({ code: "custom", message: "Raw candidate word count is inconsistent" });
    }
    if (wordCount(candidate.mergedProse) !== candidate.mergedWordCount) {
      context.addIssue({ code: "custom", message: "Merged candidate word count is inconsistent" });
    }
    if (candidate.accepted !== (candidate.rejectionStage === "accepted")) {
      context.addIssue({ code: "custom", message: "Candidate acceptance and stage disagree" });
    }
    if (candidate.worldVersionAfter !== candidate.worldVersionBefore + 1) {
      context.addIssue({ code: "custom", message: "Candidate world versions are not contiguous" });
    }
    if (
      candidate.chapter !== candidate.turn.chapter ||
      candidate.povId !== candidate.turn.povId ||
      candidate.worldVersionBefore !== candidate.turn.worldVersionBefore ||
      candidate.worldVersionAfter !== candidate.turn.worldVersionAfter
    ) {
      context.addIssue({ code: "custom", message: "Narrative candidate turn identity disagrees" });
    }
    const staged = stageWorldDelta(
      candidate.stateBefore,
      candidate.backgroundIntents,
      candidate.delta,
    );
    const expectedContext = buildPovContext(candidate.stateAfter, candidate.povId);
    const expectedAllowedFactIds = [...expectedContext.factIds].sort();
    const expectedAllowedFactIdSet = new Set(expectedAllowedFactIds);
    const expectedForbiddenFacts = candidate.stateAfter.facts
      .filter(({ id }) => !expectedAllowedFactIdSet.has(id))
      .map(({ claim, id }) => ({ claim, id }));
    const playerIntents = candidate.backgroundIntents.filter(
      ({ actorId, id }) => actorId === candidate.povId && id.startsWith("intent-player-"),
    );
    if (
      candidate.stateBefore.lockedPovId !== candidate.povId ||
      candidate.stateBefore.version !== candidate.worldVersionBefore ||
      candidate.stateAfter.version !== candidate.worldVersionAfter ||
      candidate.stateAfter.chapter !== candidate.chapter ||
      candidate.delta.expectedWorldVersion !== candidate.worldVersionBefore ||
      candidate.playerAction.actorId !== candidate.povId ||
      candidate.playerAction.stateVersion !== candidate.worldVersionBefore ||
      !staged.ok ||
      (staged.ok && !isDeepStrictEqual(staged.data.state, candidate.stateAfter)) ||
      !isDeepStrictEqual(candidate.allowedFactIds, expectedAllowedFactIds) ||
      !isDeepStrictEqual(candidate.forbiddenFacts, expectedForbiddenFacts) ||
      candidate.frame.terminal !== candidate.stateAfter.terminal ||
      !validateSuggestedChoices(candidate.stateAfter, candidate.frame.choices).ok ||
      playerIntents.length !== 1 ||
      playerIntents[0]?.goal !== candidate.playerAction.description ||
      !isDeepStrictEqual(playerIntents[0]?.action, candidate.playerAction.action)
    ) {
      context.addIssue({ code: "custom", message: "Narrative candidate canon is inconsistent" });
    }
    const lastAuditResponseId = candidate.auditAttempts.at(-1)?.responseId;
    if (lastAuditResponseId !== undefined && candidate.auditResponseId !== lastAuditResponseId) {
      context.addIssue({ code: "custom", message: "Candidate audit response ID is inconsistent" });
    }
    if (
      (candidate.rejectionStage === "accepted" || candidate.rejectionStage === "audit") &&
      (candidate.auditResponseId === null ||
        candidate.auditAttempts.length === 0 ||
        candidate.auditAttempts.at(-1)?.candidate === null)
    ) {
      context.addIssue({ code: "custom", message: "Completed audit lacks raw candidate evidence" });
    }
    if (candidate.rejectionStage === "accepted" || candidate.rejectionStage === "audit") {
      const parsedAudit = candidate.auditAttempts.at(-1)?.candidate;
      if (parsedAudit !== undefined && parsedAudit !== null) {
        try {
          const expectedAudit = canonicalizeNarrativeAuditOutput(
            parsedAudit,
            candidate.mergedProse,
            new Map(candidate.forbiddenFacts.map(({ claim, id }) => [id, claim] as const)),
          );
          if (!isDeepStrictEqual(candidate.audit, expectedAudit)) {
            context.addIssue({
              code: "custom",
              message: "Final audit does not match the raw parsed candidate",
            });
          }
        } catch {
          context.addIssue({
            code: "custom",
            message: "Raw parsed audit cannot produce the recorded final audit",
          });
        }
      }
    }
    if (candidate.audit !== null && hashText(candidate.mergedProse) !== candidate.audit.proseHash) {
      context.addIssue({ code: "custom", message: "Candidate audit prose hash is inconsistent" });
    }
    if (
      (candidate.rejectionStage === "accepted" && candidate.audit?.approved !== true) ||
      (candidate.rejectionStage === "audit" && candidate.audit?.approved !== false) ||
      ((["audit-invalid", "deterministic", "recovery"] as const).includes(
        candidate.rejectionStage as "audit-invalid" | "deterministic" | "recovery",
      ) &&
        candidate.audit !== null)
    ) {
      context.addIssue({ code: "custom", message: "Candidate audit and stage disagree" });
    }
    const recovery = candidate.recovery;
    if (recovery === null) {
      if (candidate.mergedProse !== candidate.rawProse) {
        context.addIssue({ code: "custom", message: "Candidate changed prose without recovery" });
      }
    } else {
      if (wordCount(recovery.prose) !== recovery.wordCount) {
        context.addIssue({ code: "custom", message: "Recovery word count is inconsistent" });
      }
      const recoveryAccepted =
        recovery.wordCount >= recovery.minimumAdditionalWords &&
        recovery.wordCount <= recovery.maximumAdditionalWords;
      if (
        recovery.accepted !== recoveryAccepted ||
        recovery.accepted === (recovery.rejectionReason !== null)
      ) {
        context.addIssue({ code: "custom", message: "Recovery verdict is inconsistent" });
      }
      const expectedMerged = recovery.accepted
        ? `${candidate.rawProse.trim()} ${recovery.prose.trim()}`
        : candidate.rawProse;
      if (candidate.mergedProse !== expectedMerged) {
        context.addIssue({ code: "custom", message: "Recovery merge evidence is inconsistent" });
      }
      if (!recovery.accepted && candidate.rejectionStage !== "recovery") {
        context.addIssue({ code: "custom", message: "Rejected recovery has the wrong stage" });
      }
    }
    if (new Set(candidate.allowedFactIds).size !== candidate.allowedFactIds.length) {
      context.addIssue({ code: "custom", message: "Allowed fact IDs repeat" });
    }
    if (
      new Set(candidate.forbiddenFacts.map(({ id }) => id)).size !== candidate.forbiddenFacts.length
    ) {
      context.addIssue({ code: "custom", message: "Forbidden fact IDs repeat" });
    }
  });

const NarrativeEvidenceSidecarSchema = z
  .object({
    attempts: z.array(CurrentRuntimeAttemptTraceSchema).max(1_000),
    candidates: z.array(NarrativeCandidateEvidenceSchema).max(100),
    liveRunId: z.string().uuid(),
    narrativeResponses: z.array(NarrativeResponseEvidenceSchema).max(500),
    pricingVersion: z.string().min(1).max(240),
    promptVersion: z.literal(PROMPT_VERSION),
    renarrationResults: z.array(CurrentLiveResultSchema).max(CHARACTER_IDS.length).default([]),
    reportVersion: z.literal(REPORT_VERSION),
    runtimeEvidenceStartAttemptIndex: z.number().int().min(0).max(1_000),
    runtimeSchemaVersion: z.literal(RUNTIME_SCHEMA_VERSION),
    runtimeAttemptEvidence: z.array(CurrentRuntimeAttemptEvidenceSchema).max(1_000),
    serviceTier: RuntimeServiceTierSchema,
    sourceGitSha: GitShaSchema,
    supersededTurnIds: z.array(z.string().uuid()).max(100).default([]),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const Version7LiveReportSchema = BaseLiveReportSchema.extend({
  budgetLedger: LiveSpendSnapshotSchema,
  budgetMode: z.literal("durable-request-reservations"),
  resultChapterCaps: z.array(ResultChapterCapSchema).max(12),
  resume: Version7ResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(VERSION_7_REPORT_VERSION),
}).superRefine(refineDurableReport);

export const Version8LiveReportSchema = BaseLiveReportSchema.extend({
  budgetLedger: LiveSpendSnapshotSchema,
  budgetMode: z.literal("durable-request-reservations"),
  gates: Version8GateSchema,
  narrativeCandidates: z.array(NarrativeCandidateEvidenceSchema).max(100),
  narrativeResponses: z.array(NarrativeResponseEvidenceSchema).max(500),
  runtimeEvidenceStartAttemptIndex: z.number().int().min(0).max(1_000),
  runtimeAttemptEvidence: z.array(RuntimeAttemptEvidenceSchema).max(1_000),
  resultChapterCaps: z.array(ResultChapterCapSchema).max(12),
  resume: Version8ResumeSchema.nullable(),
  sourceGitSha: GitShaSchema,
  version: z.literal(VERSION_8_REPORT_VERSION),
}).superRefine(refineDurableReport);

const SourceEvidenceBoundarySchema = z
  .object({
    attemptCount: z.number().int().min(0).max(1_000),
    narrativeCandidateCount: z.number().int().min(0).max(100),
    narrativeResponseCount: z.number().int().min(0).max(500),
    runtimeAttemptEvidenceCount: z.number().int().min(0).max(1_000),
  })
  .strict();

const SettledFailureSchema = z
  .object({
    checkpointId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    rerunFrom: z.array(RerunFromSchema).min(1).max(CHARACTER_IDS.length),
    runId: z.string().uuid(),
    sidecarSha256: Sha256Schema,
    turnIds: z
      .array(z.string().uuid())
      .min(1)
      .max(CHARACTER_IDS.length * 2),
  })
  .strict()
  .superRefine(({ rerunFrom }, context) => {
    if (new Set(rerunFrom.map(({ povId }) => povId)).size !== rerunFrom.length) {
      context.addIssue({ code: "custom", message: "Settled failure rerun POVs repeat" });
    }
  });

const RenarrationProvenanceSchema = z
  .object({
    chapter: z.union([z.literal(1), z.literal(2)]),
    povId: PovIdSchema,
    replacementProseHash: Sha256Schema.nullable(),
    replacementRequestId: z.string().uuid().nullable(),
    replacementTurnId: z.string().uuid().nullable(),
    sourceCanonicalHash: Sha256Schema,
    sourceProseHash: Sha256Schema,
    sourceRequestId: z.string().uuid(),
    sourceTurnId: z.string().uuid(),
  })
  .strict()
  .superRefine((entry, context) => {
    const replacementValues = [
      entry.replacementProseHash,
      entry.replacementRequestId,
      entry.replacementTurnId,
    ];
    const complete = replacementValues.every((value) => value !== null);
    const pending = replacementValues.every((value) => value === null);
    if (!complete && !pending) {
      context.addIssue({ code: "custom", message: "Re-narration replacement is only partial" });
    }
    if (
      complete &&
      (entry.replacementTurnId === entry.sourceTurnId ||
        entry.replacementRequestId === entry.sourceRequestId ||
        entry.replacementProseHash === entry.sourceProseHash)
    ) {
      context.addIssue({ code: "custom", message: "Re-narration did not replace source prose" });
    }
  });

const Version9ResumeSchema = Version8ResumeSchema.omit({ sourceReportVersion: true })
  .extend({
    renarrate: z.array(RerunFromSchema).max(CHARACTER_IDS.length).default([]),
    renarrations: z.array(RenarrationProvenanceSchema).max(CHARACTER_IDS.length).default([]),
    rerunFrom: z.array(RerunFromSchema).max(CHARACTER_IDS.length).default([]),
    sourceEvidenceBoundary: SourceEvidenceBoundarySchema.nullable().default(null),
    sourceEvidenceGitShas: z.array(GitShaSchema).max(20).default([]),
    sourceReportVersion: z.union([
      z.literal(LEGACY_REPORT_VERSION),
      z.literal(VERSION_6_REPORT_VERSION),
      z.literal(VERSION_7_REPORT_VERSION),
      z.literal(VERSION_8_REPORT_VERSION),
      z.literal(REPORT_VERSION),
    ]),
  })
  .strict()
  .superRefine(({ renarrate, renarrations, rerunFrom, sourceEvidenceGitShas }, context) => {
    if (rerunFrom.length > 0 && renarrate.length > 0) {
      context.addIssue({ code: "custom", message: "Resume modes are mutually exclusive" });
    }
    const targetKeys = renarrate.map(({ chapter, povId }) => resultKey(povId, chapter));
    const provenanceKeys = renarrations.map(({ chapter, povId }) => resultKey(povId, chapter));
    if (
      new Set(targetKeys).size !== targetKeys.length ||
      new Set(provenanceKeys).size !== provenanceKeys.length ||
      !isDeepStrictEqual([...targetKeys].sort(), [...provenanceKeys].sort())
    ) {
      context.addIssue({ code: "custom", message: "Re-narration provenance targets disagree" });
    }
    if (new Set(sourceEvidenceGitShas).size !== sourceEvidenceGitShas.length) {
      context.addIssue({ code: "custom", message: "Source evidence Git SHAs repeat" });
    }
  });

export const LiveReportSchema = BaseLiveReportSchema.extend({
  attempts: z.array(CurrentRuntimeAttemptTraceSchema).max(1_000),
  budgetLedger: LiveSpendSnapshotSchema,
  budgetMode: z.literal("durable-request-reservations"),
  cleanPathProjectedCostUsd: z.number().min(0).nullable(),
  gates: Version9GateSchema,
  narrativeCandidates: z.array(NarrativeCandidateEvidenceSchema).max(100),
  narrativeResponses: z.array(NarrativeResponseEvidenceSchema).max(500),
  pricingVersion: z.string().min(1).max(240),
  projectedFinalExposureUsd: z.number().min(0).nullable(),
  runtimeEvidenceStartAttemptIndex: z.number().int().min(0).max(1_000),
  runtimeAttemptEvidence: z.array(CurrentRuntimeAttemptEvidenceSchema).max(1_000),
  resultChapterCaps: z.array(ResultChapterCapSchema).max(12),
  results: z.array(CurrentLiveResultSchema).max(12),
  resume: Version9ResumeSchema.nullable(),
  serviceTier: RuntimeServiceTierSchema,
  settledFailure: SettledFailureSchema.nullable().default(null),
  sourceGitSha: GitShaSchema,
  supersededTurnIds: z.array(z.string().uuid()).max(100).default([]),
  version: z.literal(REPORT_VERSION),
}).superRefine(refineDurableReport);

type DurableReportForRefinement = z.infer<typeof BaseLiveReportSchema> & {
  readonly budgetLedger: z.infer<typeof LiveSpendSnapshotSchema>;
  readonly cleanPathProjectedCostUsd?: number | null;
  readonly gates:
    | z.infer<typeof GateSchema>
    | z.infer<typeof Version8GateSchema>
    | z.infer<typeof Version9GateSchema>;
  readonly narrativeCandidates?: z.infer<typeof NarrativeCandidateEvidenceSchema>[];
  readonly narrativeResponses?: z.infer<typeof NarrativeResponseEvidenceSchema>[];
  readonly runtimeEvidenceStartAttemptIndex?: number;
  readonly runtimeAttemptEvidence?: z.infer<typeof RuntimeAttemptEvidenceSchema>[];
  readonly resultChapterCaps: z.infer<typeof ResultChapterCapSchema>[];
  readonly pricingVersion?: string;
  readonly projectedFinalExposureUsd?: number | null;
  readonly resume:
    | z.infer<typeof Version7ResumeSchema>
    | z.infer<typeof Version8ResumeSchema>
    | z.infer<typeof Version9ResumeSchema>
    | null;
  readonly serviceTier?: RuntimeServiceTier;
  readonly settledFailure?: z.infer<typeof SettledFailureSchema> | null;
  readonly sourceGitSha: string;
  readonly supersededTurnIds?: string[];
  readonly version:
    typeof VERSION_7_REPORT_VERSION | typeof VERSION_8_REPORT_VERSION | typeof REPORT_VERSION;
};

function refineDurableReport(report: DurableReportForRefinement, context: z.RefinementCtx): void {
  refineReportCommon(report, context);
  const supersededTurnIds = new Set(report.supersededTurnIds ?? []);
  if (supersededTurnIds.size !== (report.supersededTurnIds?.length ?? 0)) {
    context.addIssue({
      code: "custom",
      message: "Superseded narrative turn IDs repeat",
      path: ["supersededTurnIds"],
    });
  }
  if (report.version === REPORT_VERSION) {
    const candidates = report.narrativeCandidates ?? [];
    const responses = report.narrativeResponses ?? [];
    const runtimeEvidence = report.runtimeAttemptEvidence ?? [];
    const boundary =
      report.resume !== null && "sourceEvidenceBoundary" in report.resume
        ? report.resume.sourceEvidenceBoundary
        : null;
    const boundaryFits =
      boundary !== null &&
      boundary.attemptCount <= report.attempts.length &&
      boundary.narrativeCandidateCount <= candidates.length &&
      boundary.narrativeResponseCount <= responses.length &&
      boundary.runtimeAttemptEvidenceCount <= runtimeEvidence.length;
    if (boundary !== null && !boundaryFits) {
      context.addIssue({
        code: "custom",
        message: "Resume source evidence boundary exceeds report evidence",
        path: ["resume", "sourceEvidenceBoundary"],
      });
    }
    const sourceTurnIds = boundaryFits
      ? new Set([
          ...candidates.slice(0, boundary.narrativeCandidateCount).map(({ turn }) => turn.turnId),
          ...responses.slice(0, boundary.narrativeResponseCount).map(({ turn }) => turn.turnId),
          ...runtimeEvidence
            .slice(0, boundary.runtimeAttemptEvidenceCount)
            .map(({ turn }) => turn.turnId),
        ])
      : new Set<string>();
    if (
      boundaryFits &&
      report.resume !== null &&
      !costsMatch(
        sum(report.attempts.slice(0, boundary.attemptCount).map(({ costUsd }) => costUsd)),
        report.resume.existingAttemptCostUsd,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Resume source attempt boundary does not match existing cost",
        path: ["resume", "sourceEvidenceBoundary"],
      });
    }
    for (const turnId of supersededTurnIds) {
      if (!sourceTurnIds.has(turnId)) {
        context.addIssue({
          code: "custom",
          message: "Superseded narrative turn is outside authenticated source evidence",
          path: ["supersededTurnIds"],
        });
      }
      if (report.results.some(({ trace }) => trace.runId === turnId)) {
        context.addIssue({
          code: "custom",
          message: "Committed result cannot use a superseded narrative turn",
          path: ["supersededTurnIds"],
        });
      }
    }
    const settledTurnIds = new Set(report.settledFailure?.turnIds ?? []);
    if (settledTurnIds.size !== (report.settledFailure?.turnIds.length ?? 0)) {
      context.addIssue({
        code: "custom",
        message: "Settled failure turn IDs repeat",
        path: ["settledFailure", "turnIds"],
      });
    }
    if (report.settledFailure !== null && report.settledFailure !== undefined) {
      if (
        !boundaryFits ||
        report.resume === null ||
        report.error === null ||
        report.gates.allCommitsCompleted
      ) {
        context.addIssue({
          code: "custom",
          message: "Settled failure lacks failed resumed-run provenance",
          path: ["settledFailure"],
        });
      } else {
        const suffixTurns = [
          ...candidates.slice(boundary.narrativeCandidateCount).map(({ turn }) => turn),
          ...responses.slice(boundary.narrativeResponseCount).map(({ turn }) => turn),
          ...runtimeEvidence.slice(boundary.runtimeAttemptEvidenceCount).map(({ turn }) => turn),
        ];
        const suffixTurnIds = new Set(suffixTurns.map(({ turnId }) => turnId));
        const targetKeys = new Set(
          report.settledFailure.rerunFrom.map(({ chapter, povId }) => resultKey(povId, chapter)),
        );
        if (
          suffixTurns.length === 0 ||
          !isDeepStrictEqual([...suffixTurnIds].sort(), [...settledTurnIds].sort()) ||
          report.attempts.length - boundary.attemptCount !==
            runtimeEvidence.length - boundary.runtimeAttemptEvidenceCount ||
          suffixTurns.some(
            ({ chapter, povId, turnId }) =>
              sourceTurnIds.has(turnId) || !targetKeys.has(resultKey(povId, chapter)),
          ) ||
          [...settledTurnIds].some((turnId) =>
            report.results.some(({ trace }) => trace.runId === turnId),
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Settled failure evidence suffix is inconsistent",
            path: ["settledFailure"],
          });
        }
      }
    }
    const renarrations =
      report.resume !== null && "renarrations" in report.resume ? report.resume.renarrations : [];
    for (const [index, renarration] of renarrations.entries()) {
      const key = resultKey(renarration.povId, renarration.chapter);
      const result = report.results.find(
        (entry) => entry.povId === renarration.povId && entry.chapter === renarration.chapter,
      );
      const sourceCandidates = boundaryFits
        ? candidates
            .slice(0, boundary.narrativeCandidateCount)
            .filter(
              (candidate) =>
                candidate.accepted &&
                candidate.turn.turnId === renarration.sourceTurnId &&
                candidate.povId === renarration.povId &&
                candidate.chapter === renarration.chapter,
            )
        : [];
      const sourceCandidate = sourceCandidates[0];
      const replacementComplete = renarration.replacementTurnId !== null;
      const replacementCandidate = replacementComplete
        ? candidates
            .slice(boundary?.narrativeCandidateCount ?? candidates.length)
            .filter(
              (candidate) =>
                candidate.accepted &&
                candidate.turn.turnId === renarration.replacementTurnId &&
                candidate.povId === renarration.povId &&
                candidate.chapter === renarration.chapter,
            )
        : [];
      if (
        result === undefined ||
        sourceCandidates.length !== 1 ||
        sourceCandidate?.turn.requestId !== renarration.sourceRequestId ||
        hashText(sourceCandidate.mergedProse) !== renarration.sourceProseHash ||
        !sourceTurnIds.has(renarration.sourceTurnId) ||
        canonicalNarrationSourceHash(result) !== renarration.sourceCanonicalHash ||
        (replacementComplete
          ? result.trace.runId !== renarration.replacementTurnId ||
            result.canonicalNarrativeInput?.chapterRecord.requestId !==
              renarration.replacementRequestId ||
            result.audit.proseHash !== renarration.replacementProseHash ||
            !supersededTurnIds.has(renarration.sourceTurnId) ||
            sourceTurnIds.has(renarration.replacementTurnId!) ||
            replacementCandidate.length !== 1
          : result.trace.runId !== renarration.sourceTurnId ||
            result.audit.proseHash !== renarration.sourceProseHash ||
            supersededTurnIds.has(renarration.sourceTurnId))
      ) {
        context.addIssue({
          code: "custom",
          message: `Re-narration ${key} lacks exact source and replacement provenance`,
          path: ["resume", "renarrations", index],
        });
      }
    }
    for (const turnId of settledTurnIds) supersededTurnIds.add(turnId);
  }
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
    if (report.version === REPORT_VERSION && "rerunFrom" in report.resume) {
      const rerunFrom = report.resume.rerunFrom;
      const renarrate = report.resume.renarrate;
      if (new Set(rerunFrom.map(({ povId }) => povId)).size !== rerunFrom.length) {
        context.addIssue({ code: "custom", message: "Resume repeats a rerun POV" });
      }
      const minimumDiscardedResultCount =
        sum(rerunFrom.map(({ chapter }) => (chapter === 1 ? 2 : 1))) + renarrate.length;
      if (report.resume.discardedResultCount < minimumDiscardedResultCount) {
        context.addIssue({
          code: "custom",
          message: "Resume rerun suffix exceeds discarded results",
        });
      }
      for (const [index, rerun] of rerunFrom.entries()) {
        const retainedChapters = report.resume.retainedResults
          .filter(({ povId }) => povId === rerun.povId)
          .map(({ chapter }) => chapter)
          .sort((left, right) => left - right);
        const expectedRetainedChapters = rerun.chapter === 2 ? [1] : [];
        if (!isDeepStrictEqual(retainedChapters, expectedRetainedChapters)) {
          context.addIssue({
            code: "custom",
            message: `Resume rerun ${resultKey(rerun.povId, rerun.chapter)} has the wrong retained prefix`,
            path: ["resume", "rerunFrom", index],
          });
        }
      }
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
  const renarrationByResult = new Map<string, RenarrationProvenance>(
    report.version === REPORT_VERSION && report.resume !== null && "renarrations" in report.resume
      ? report.resume.renarrations.map((entry) => [resultKey(entry.povId, entry.chapter), entry])
      : [],
  );
  const unmatchedRetainedKeys = new Set(retainedByResult.keys());
  for (const [index, result] of report.results.entries()) {
    const key = resultKey(result.povId, result.chapter);
    const renarration = renarrationByResult.get(key);
    const replaced =
      renarration?.replacementTurnId !== null &&
      renarration?.replacementTurnId === result.trace.runId;
    const expectedGitSha = replaced
      ? report.sourceGitSha
      : (retainedByResult.get(key)?.sourceGitSha ?? report.sourceGitSha);
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
    const renarration = renarrationByResult.get(key);
    const replaced =
      renarration?.replacementTurnId !== null &&
      renarration?.replacementTurnId === result.trace.runId;
    const expectedCap = replaced
      ? report.chapterCostCapUsd
      : (retainedByResult.get(key)?.sourceChapterCapUsd ?? report.chapterCostCapUsd);
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

  const renarrateCount =
    report.version === REPORT_VERSION && report.resume !== null && "renarrate" in report.resume
      ? report.resume.renarrate.length
      : 0;
  const pendingChapterCount =
    report.suite === "smoke"
      ? 1
      : renarrateCount > 0
        ? renarrateCount
        : CHARACTER_IDS.length * 2 - (report.resume?.retainedResults.length ?? 0);
  const projected = Math.max(
    projectedCumulativeCostUsd(
      report.priorSpendUsd,
      report.resume?.existingAttemptCostUsd ?? 0,
      pendingChapterCount,
      report.chapterCostCapUsd,
    ),
    report.cumulativeCostUsd,
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
  const expectedResultCount = report.suite === "smoke" ? 1 : CHARACTER_IDS.length * 2;
  refineGateValue(
    report,
    "allCostsWithinChapterCap",
    report.results.length === expectedResultCount &&
      report.results.every((result) => {
        const cap = report.resultChapterCaps.find(
          (entry) => entry.povId === result.povId && entry.chapter === result.chapter,
        )?.capUsd;
        return cap !== undefined && result.costUsd <= cap + MONEY_EPSILON_USD;
      }),
    context,
  );
  refineGateValue(
    report,
    "totalCostWithinCap",
    ledger.totalExposureUsd <= TOTAL_CAP_USD + MONEY_EPSILON_USD,
    context,
  );

  if (report.version === VERSION_8_REPORT_VERSION || report.version === REPORT_VERSION) {
    const candidates = report.narrativeCandidates ?? [];
    const responses = report.narrativeResponses ?? [];
    const runtimeEvidenceStartAttemptIndex = report.runtimeEvidenceStartAttemptIndex ?? 0;
    const runtimeAttemptEvidence = report.runtimeAttemptEvidence ?? [];
    refineNarrativeEvidence(
      report,
      candidates,
      responses,
      runtimeEvidenceStartAttemptIndex,
      runtimeAttemptEvidence,
      supersededTurnIds,
      context,
    );
    const expectedComplete = narrativeEvidenceIsComplete(
      report.results,
      report.attempts,
      candidates,
      responses,
      runtimeEvidenceStartAttemptIndex,
      runtimeAttemptEvidence,
      report.suite,
      supersededTurnIds,
    );
    if (
      !("narrativeEvidenceComplete" in report.gates) ||
      report.gates.narrativeEvidenceComplete !== expectedComplete
    ) {
      context.addIssue({
        code: "custom",
        message: "Narrative evidence gate is inconsistent",
        path: ["gates", "narrativeEvidenceComplete"],
      });
    }
  }
  if (report.version === REPORT_VERSION) refineServiceTierEvidence(report, context);
}

function refineServiceTierEvidence(
  report: DurableReportForRefinement,
  context: z.RefinementCtx,
): void {
  const serviceTier = report.serviceTier;
  if (serviceTier === undefined || report.pricingVersion === undefined) {
    context.addIssue({ code: "custom", message: "Version 9 report lacks service-tier provenance" });
    return;
  }
  if (report.suite === "full" && serviceTier !== "flex") {
    context.addIssue({ code: "custom", message: "Full version 9 reports require Flex processing" });
  }
  const expectedPricingVersion = pricingVersionForServiceTier(serviceTier);
  if (report.pricingVersion !== expectedPricingVersion) {
    context.addIssue({
      code: "custom",
      message: "Report pricing version disagrees with service tier",
    });
  }
  const renarrationTargetCount =
    report.resume !== null && "renarrate" in report.resume ? report.resume.renarrate.length : 0;
  const expectedProjection =
    report.suite !== "full"
      ? null
      : renarrationTargetCount > 0
        ? roundNanoUsd(renarrationTargetCount * report.chapterCostCapUsd)
        : projectPrompt1411FullMatrixCostUsd(serviceTier);
  const expectedFinalExposure =
    expectedProjection === null
      ? null
      : roundNanoUsd(
          report.priorSpendUsd +
            (renarrationTargetCount > 0 ? (report.resume?.existingAttemptCostUsd ?? 0) : 0) +
            expectedProjection,
        );
  if (
    report.cleanPathProjectedCostUsd !== expectedProjection ||
    report.projectedFinalExposureUsd !== expectedFinalExposure
  ) {
    context.addIssue({ code: "custom", message: "Report clean-path projection is inconsistent" });
  }
  const expectedEvidence = serviceTierEvidenceIsComplete(
    report,
    serviceTier,
    expectedPricingVersion,
  );
  if (
    !("serviceTierEvidenceComplete" in report.gates) ||
    report.gates.serviceTierEvidenceComplete !== expectedEvidence
  ) {
    context.addIssue({
      code: "custom",
      message: "Service-tier evidence gate is inconsistent",
      path: ["gates", "serviceTierEvidenceComplete"],
    });
  }
}

function serviceTierEvidenceIsComplete(
  report: DurableReportForRefinement,
  serviceTier: RuntimeServiceTier,
  pricingVersion: string,
): boolean {
  return recordedServiceTierEvidenceIsComplete(
    report.attempts,
    report.results,
    report.runtimeEvidenceStartAttemptIndex ?? 0,
    serviceTier,
    pricingVersion,
  );
}

function recordedServiceTierEvidenceIsComplete(
  attempts: readonly z.infer<typeof RuntimeAttemptTraceSchema>[],
  results: readonly LiveResult[],
  runtimeEvidenceStartAttemptIndex: number,
  serviceTier: RuntimeServiceTier,
  pricingVersion: string,
): boolean {
  const currentAttempts = attempts.slice(runtimeEvidenceStartAttemptIndex);
  return (
    currentAttempts.length > 0 &&
    currentAttempts.every(
      (attempt) =>
        attempt.requestedServiceTier === serviceTier && attempt.serviceTier === serviceTier,
    ) &&
    results.every(
      ({ trace }) =>
        trace.pricingVersion === pricingVersion &&
        trace.attempts.every(
          (attempt) =>
            attempt.requestedServiceTier === serviceTier && attempt.serviceTier === serviceTier,
        ) &&
        trace.calls.every(
          (call) => call.requestedServiceTier === serviceTier && call.serviceTier === serviceTier,
        ),
    )
  );
}

function refineNarrativeEvidence(
  report: DurableReportForRefinement,
  candidates: readonly z.infer<typeof NarrativeCandidateEvidenceSchema>[],
  responses: readonly z.infer<typeof NarrativeResponseEvidenceSchema>[],
  runtimeEvidenceStartAttemptIndex: number,
  runtimeAttemptEvidence: readonly z.infer<typeof RuntimeAttemptEvidenceSchema>[],
  supersededTurnIds: ReadonlySet<string>,
  context: z.RefinementCtx,
): void {
  const legacyEvidenceGap = runtimeEvidenceStartAttemptIndex > 0;
  if (legacyEvidenceGap && report.resume === null) {
    context.addIssue({
      code: "custom",
      message: "Runtime evidence gap has no authenticated resume provenance",
      path: ["runtimeEvidenceStartAttemptIndex"],
    });
  }
  const allowedSourceGitShas = new Set([
    report.sourceGitSha,
    ...(report.resume === null ? [] : [report.resume.sourceGitSha]),
    ...(report.resume?.retainedResults.map(({ sourceGitSha }) => sourceGitSha) ?? []),
    ...(report.resume !== null && "sourceEvidenceGitShas" in report.resume
      ? report.resume.sourceEvidenceGitShas
      : []),
  ]);
  const inheritedSourceEvidenceGitShas =
    report.resume !== null && "sourceEvidenceGitShas" in report.resume
      ? report.resume.sourceEvidenceGitShas
      : [];
  const sourceEvidenceBoundary =
    report.resume !== null && "sourceEvidenceBoundary" in report.resume
      ? report.resume.sourceEvidenceBoundary
      : null;
  if (inheritedSourceEvidenceGitShas.length > 0) {
    const authenticatedSourceGitShas = new Set(
      sourceEvidenceBoundary === null
        ? []
        : [
            ...candidates
              .slice(0, sourceEvidenceBoundary.narrativeCandidateCount)
              .map(({ sourceGitSha }) => sourceGitSha),
            ...responses
              .slice(0, sourceEvidenceBoundary.narrativeResponseCount)
              .map(({ sourceGitSha }) => sourceGitSha),
          ],
    );
    for (const [index, sourceGitSha] of inheritedSourceEvidenceGitShas.entries()) {
      if (!authenticatedSourceGitShas.has(sourceGitSha)) {
        context.addIssue({
          code: "custom",
          message: "Inherited source Git SHA is outside the authenticated evidence boundary",
          path: ["resume", "sourceEvidenceGitShas", index],
        });
      }
    }
  }
  const expectedStateBeforeByResult = refineCommittedResultEvidence(report.results, context);
  const matchingAttempts = (
    phase: string,
    responseId: string,
    attempt: number,
    turn: z.infer<typeof TurnIdentitySchema>,
  ) =>
    runtimeAttemptEvidence.filter(
      (entry) =>
        entry.attempt.phase === phase &&
        entry.attempt.responseId === responseId &&
        entry.attempt.attempt === attempt &&
        entry.attempt.model === "gpt-5.6-luna" &&
        isDeepStrictEqual(entry.turn, turn),
    );
  const runtimeAttempts = runtimeAttemptEvidence.map(({ attempt }) => attempt);
  const runtimeAttemptsMatchReport =
    runtimeEvidenceStartAttemptIndex <= report.attempts.length &&
    isDeepStrictEqual(report.attempts.slice(runtimeEvidenceStartAttemptIndex), runtimeAttempts);
  if (!runtimeAttemptsMatchReport) {
    context.addIssue({
      code: "custom",
      message: "Turn-bound runtime attempts do not match the report attempts",
      path: ["runtimeAttemptEvidence"],
    });
  }
  const providerResponseIds = new Set<string>();
  for (const [index, attempt] of report.attempts.entries()) {
    if (attempt.responseId === null) continue;
    if (providerResponseIds.has(attempt.responseId)) {
      context.addIssue({
        code: "custom",
        message: "Provider response ID is reused across attempts",
        path: ["attempts", index, "responseId"],
      });
    }
    providerResponseIds.add(attempt.responseId);
  }
  const responseKeys = new Set<string>();

  for (const [index, response] of responses.entries()) {
    if (!allowedSourceGitShas.has(response.sourceGitSha)) {
      context.addIssue({
        code: "custom",
        message: "Narrative response Git SHA has no report provenance",
        path: ["narrativeResponses", index, "sourceGitSha"],
      });
    }
    const key = response.responseId;
    if (responseKeys.has(key)) {
      context.addIssue({
        code: "custom",
        message: "Narrative response evidence is duplicated",
        path: ["narrativeResponses", index],
      });
    }
    responseKeys.add(key);
    if (
      matchingAttempts(response.phase, response.responseId, response.attempt, response.turn)
        .length !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "Narrative response has no unique matching attempt",
        path: ["narrativeResponses", index, "responseId"],
      });
    }
  }

  const narratorKeys = new Set<string>();
  const recoveryKeys = new Set<string>();
  const turnIdentityById = new Map<string, z.infer<typeof TurnIdentitySchema>>();
  const turnIdByRequestId = new Map<string, string>();
  for (const [index, candidate] of candidates.entries()) {
    if (!allowedSourceGitShas.has(candidate.sourceGitSha)) {
      context.addIssue({
        code: "custom",
        message: "Narrative candidate Git SHA has no report provenance",
        path: ["narrativeCandidates", index, "sourceGitSha"],
      });
    }
    const key = resultKey(candidate.povId, candidate.chapter);
    const expectedStateBefore = expectedStateBeforeByResult.get(key);
    const isSuperseded = supersededTurnIds.has(candidate.turn.turnId);
    const existingTurn = turnIdentityById.get(candidate.turn.turnId);
    const existingTurnId = turnIdByRequestId.get(candidate.turn.requestId);
    if (
      (!isSuperseded &&
        (expectedStateBefore === undefined ||
          !isDeepStrictEqual(candidate.stateBefore, expectedStateBefore))) ||
      (existingTurn !== undefined && !isDeepStrictEqual(existingTurn, candidate.turn)) ||
      (existingTurnId !== undefined && existingTurnId !== candidate.turn.turnId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Narrative candidate is not rooted in the canonical turn chain",
        path: ["narrativeCandidates", index, "stateBefore"],
      });
    }
    turnIdentityById.set(candidate.turn.turnId, candidate.turn);
    turnIdByRequestId.set(candidate.turn.requestId, candidate.turn.turnId);
    const committedResult = report.results.find(
      (result) => result.povId === candidate.povId && result.chapter === candidate.chapter,
    );
    if (
      !isSuperseded &&
      candidate.accepted &&
      committedResult?.canonicalNarrativeInput !== undefined &&
      !candidateMatchesCanonicalInput(candidate, committedResult.canonicalNarrativeInput)
    ) {
      context.addIssue({
        code: "custom",
        message: "Narrative candidate canon inputs do not match the committed result",
        path: ["narrativeCandidates", index],
      });
    }
    const narratorKey = candidate.narratorResponseId;
    if (narratorKeys.has(narratorKey)) {
      context.addIssue({
        code: "custom",
        message: "Narration attempt is linked to multiple candidates",
        path: ["narrativeCandidates", index, "narratorResponseId"],
      });
    }
    narratorKeys.add(narratorKey);
    const narratorAttempts = matchingAttempts(
      "narration",
      candidate.narratorResponseId,
      candidate.narratorAttempt,
      candidate.turn,
    );
    if (narratorAttempts.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Narrative candidate has no unique matching narration attempt",
        path: ["narrativeCandidates", index, "narratorResponseId"],
      });
    } else if ((narratorAttempts[0]?.attempt.errorCode === null) !== candidate.accepted) {
      context.addIssue({
        code: "custom",
        message: "Narrative candidate acceptance disagrees with its attempt",
        path: ["narrativeCandidates", index, "accepted"],
      });
    }
    const narratorResponse = responses.filter(
      (response) =>
        response.phase === "narration" &&
        response.responseId === candidate.narratorResponseId &&
        response.attempt === candidate.narratorAttempt &&
        isDeepStrictEqual(response.turn, candidate.turn),
    );
    if (
      narratorResponse.length !== 1 ||
      narratorResponse[0]?.status !== "completed" ||
      narratorResponse[0]?.rawOutputText !== candidate.rawProse ||
      narratorResponse[0]?.povId !== candidate.povId ||
      narratorResponse[0]?.chapter !== candidate.chapter ||
      narratorResponse[0]?.sourceGitSha !== candidate.sourceGitSha ||
      narratorResponse[0]?.worldVersionBefore !== candidate.worldVersionBefore ||
      narratorResponse[0]?.worldVersionAfter !== candidate.worldVersionAfter ||
      (narratorResponse[0].bufferedOutputText.length > 0 &&
        narratorResponse[0].bufferedOutputText !== candidate.rawProse)
    ) {
      context.addIssue({
        code: "custom",
        message: "Narrative candidate does not match one raw narration response",
        path: ["narrativeCandidates", index, "rawProse"],
      });
    }
    if (candidate.recovery !== null) {
      const recoveryAttempts = matchingAttempts(
        "recovery",
        candidate.recovery.responseId,
        candidate.recovery.attempt,
        candidate.turn,
      );
      if (recoveryAttempts.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "Narrative candidate has no matching recovery attempt",
          path: ["narrativeCandidates", index, "recovery", "responseId"],
        });
      } else if (
        (recoveryAttempts[0]?.attempt.errorCode === null) !==
        candidate.recovery.accepted
      ) {
        context.addIssue({
          code: "custom",
          message: "Recovery verdict disagrees with its attempt",
          path: ["narrativeCandidates", index, "recovery", "accepted"],
        });
      }
      const recoveryKey = candidate.recovery.responseId;
      if (recoveryKeys.has(recoveryKey)) {
        context.addIssue({
          code: "custom",
          message: "Recovery attempt is linked to multiple candidates",
          path: ["narrativeCandidates", index, "recovery", "responseId"],
        });
      }
      recoveryKeys.add(recoveryKey);
      const recoveryResponse = responses.filter(
        (response) =>
          response.phase === "recovery" &&
          response.responseId === candidate.recovery?.responseId &&
          response.attempt === candidate.recovery.attempt &&
          isDeepStrictEqual(response.turn, candidate.turn),
      );
      if (
        recoveryResponse.length !== 1 ||
        recoveryResponse[0]?.status !== "completed" ||
        recoveryResponse[0]?.rawOutputText !== candidate.recovery.prose ||
        recoveryResponse[0]?.povId !== candidate.povId ||
        recoveryResponse[0]?.chapter !== candidate.chapter ||
        recoveryResponse[0]?.sourceGitSha !== candidate.sourceGitSha ||
        recoveryResponse[0]?.worldVersionBefore !== candidate.worldVersionBefore ||
        recoveryResponse[0]?.worldVersionAfter !== candidate.worldVersionAfter ||
        (recoveryResponse[0].bufferedOutputText.length > 0 &&
          recoveryResponse[0].bufferedOutputText !== candidate.recovery.prose)
      ) {
        context.addIssue({
          code: "custom",
          message: "Recovery candidate does not match one raw recovery response",
          path: ["narrativeCandidates", index, "recovery"],
        });
      }
    }
    for (const [auditIndex, auditAttempt] of candidate.auditAttempts.entries()) {
      const rawAuditResponses = responses.filter(
        (response) =>
          response.phase === "audit" &&
          response.responseId === auditAttempt.responseId &&
          response.attempt === auditAttempt.attempt &&
          isDeepStrictEqual(response.turn, candidate.turn),
      );
      if (
        matchingAttempts("audit", auditAttempt.responseId, auditAttempt.attempt, candidate.turn)
          .length !== 1
      ) {
        context.addIssue({
          code: "custom",
          message: "Narrative candidate has no matching audit attempt",
          path: ["narrativeCandidates", index, "auditAttempts", auditIndex, "responseId"],
        });
      }
      if (
        rawAuditResponses.length !== 1 ||
        rawAuditResponses[0]?.rawOutputText !== auditAttempt.rawOutputText ||
        rawAuditResponses[0]?.status !== auditAttempt.status
      ) {
        context.addIssue({
          code: "custom",
          message: "Narrative candidate audit does not match one raw audit response",
          path: ["narrativeCandidates", index, "auditAttempts", auditIndex],
        });
      }
    }
  }

  if (!legacyEvidenceGap) {
    for (const [index, evidence] of runtimeAttemptEvidence.entries()) {
      const { attempt, turn } = evidence;
      if (
        (attempt.phase === "narration" || attempt.phase === "recovery") &&
        attempt.responseId !== null &&
        responses.filter(
          (response) =>
            response.phase === attempt.phase &&
            response.responseId === attempt.responseId &&
            response.attempt === attempt.attempt &&
            isDeepStrictEqual(response.turn, turn),
        ).length !== 1
      ) {
        context.addIssue({
          code: "custom",
          message: "Narrative attempt lacks unique raw response evidence",
          path: ["runtimeAttemptEvidence", index],
        });
      }
      if (
        attempt.phase === "audit" &&
        attempt.responseId !== null &&
        responses.filter(
          (response) =>
            response.phase === "audit" &&
            response.responseId === attempt.responseId &&
            response.attempt === attempt.attempt &&
            isDeepStrictEqual(response.turn, turn),
        ).length !== 1
      ) {
        context.addIssue({
          code: "custom",
          message: "Audit attempt lacks unique raw response evidence",
          path: ["runtimeAttemptEvidence", index],
        });
      }
    }
  }

  for (const [index, result] of report.results.entries()) {
    const isLegacyRetainedResult =
      legacyEvidenceGap &&
      report.resume?.retainedResults.some(
        (retained) => retained.povId === result.povId && retained.chapter === result.chapter,
      );
    if (result.canonicalNarrativeInput === undefined && !isLegacyRetainedResult) {
      context.addIssue({
        code: "custom",
        message: `Result ${resultKey(result.povId, result.chapter)} lacks canonical narrative inputs`,
        path: ["results", index, "canonicalNarrativeInput"],
      });
    }
    if (result.streamChunks === undefined && !isLegacyRetainedResult) {
      context.addIssue({
        code: "custom",
        message: `Result ${resultKey(result.povId, result.chapter)} lacks stream transcript evidence`,
        path: ["results", index, "streamChunks"],
      });
    }
    const matches = candidates.filter(
      (candidate) =>
        !supersededTurnIds.has(candidate.turn.turnId) &&
        candidate.accepted &&
        candidate.povId === result.povId &&
        candidate.chapter === result.chapter &&
        candidate.adapterMode === result.adapterMode &&
        candidate.sourceGitSha === result.trace.gitSha &&
        candidate.promptVersion === result.trace.promptVersion &&
        candidate.schemaVersion === result.trace.schemaVersion &&
        candidate.mergedProse === result.prose &&
        isDeepStrictEqual(candidate.audit, result.audit) &&
        isDeepStrictEqual(candidate.delta, result.trace.acceptedDelta) &&
        isDeepStrictEqual(candidate.backgroundIntents, result.trace.intents) &&
        isDeepStrictEqual(candidate.multiAgentOutputItems, result.trace.multiAgentOutputItems) &&
        result.canonicalNarrativeInput !== undefined &&
        candidateMatchesCanonicalInput(candidate, result.canonicalNarrativeInput),
    );
    const acceptedCandidate = matches[0];
    if (matches.length !== 1 && !isLegacyRetainedResult) {
      context.addIssue({
        code: "custom",
        message: `Result ${resultKey(result.povId, result.chapter)} needs one exact accepted narrative candidate`,
        path: ["results", index],
      });
    } else if (acceptedCandidate !== undefined) {
      const committedRequestId = result.canonicalNarrativeInput?.chapterRecord.requestId;
      const attemptReferences = [
        { phase: "narration" as const, responseId: acceptedCandidate.narratorResponseId },
        ...(acceptedCandidate.recovery === null
          ? []
          : [{ phase: "recovery" as const, responseId: acceptedCandidate.recovery.responseId }]),
        ...acceptedCandidate.auditAttempts.map(({ responseId }) => ({
          phase: "audit" as const,
          responseId,
        })),
      ];
      if (
        attemptReferences.some(
          ({ phase, responseId }) =>
            runtimeAttemptEvidence.filter(
              ({ attempt, turn }) =>
                attempt.phase === phase &&
                attempt.responseId === responseId &&
                isDeepStrictEqual(turn, acceptedCandidate.turn) &&
                result.trace.attempts.some((traceAttempt) =>
                  isDeepStrictEqual(traceAttempt, attempt),
                ),
            ).length !== 1,
        ) ||
        acceptedCandidate.turn.turnId !== result.trace.runId ||
        committedRequestId === undefined ||
        acceptedCandidate.turn.requestId !== committedRequestId ||
        result.trace.calls.filter(
          (call) =>
            call.phase === "narration" && call.responseId === acceptedCandidate.narratorResponseId,
        ).length !== 1 ||
        result.trace.calls.filter(
          (call) => call.phase === "audit" && call.responseId === acceptedCandidate.auditResponseId,
        ).length !== 1 ||
        (acceptedCandidate.recovery !== null &&
          result.trace.calls.filter(
            (call) =>
              call.phase === "recovery" &&
              call.responseId === acceptedCandidate.recovery?.responseId,
          ).length !== 1) ||
        !traceCallsMatchTurn(result, acceptedCandidate.turn, runtimeAttemptEvidence)
      ) {
        context.addIssue({
          code: "custom",
          message: `Result ${resultKey(result.povId, result.chapter)} candidate lacks exact trace linkage`,
          path: ["results", index, "trace"],
        });
      }
    }
  }
}

function refineCommittedResultEvidence(
  results: readonly LiveResult[],
  context: z.RefinementCtx,
): Map<string, WorldState> {
  const expectedStateBeforeByResult = new Map<string, WorldState>();
  for (const povId of CHARACTER_IDS) {
    const seed = loadLockedSeedWorld(povId);
    expectedStateBeforeByResult.set(resultKey(povId, 1), seed);
    const chapterOne = results.find((result) => result.povId === povId && result.chapter === 1);
    if (chapterOne?.canonicalNarrativeInput !== undefined) {
      expectedStateBeforeByResult.set(
        resultKey(povId, 2),
        chapterOne.canonicalNarrativeInput.stateAfter,
      );
    } else if (chapterOne !== undefined) {
      const staged = stageWorldDelta(
        seed,
        chapterOne.trace.intents as z.infer<typeof WorldIntentSchema>[],
        chapterOne.trace.acceptedDelta,
      );
      if (
        staged.ok &&
        hashJson(seed) === chapterOne.trace.stateBeforeHash &&
        hashJson(staged.data.state) === chapterOne.trace.stateAfterHash
      ) {
        expectedStateBeforeByResult.set(resultKey(povId, 2), staged.data.state);
      }
    }
  }

  for (const [index, result] of results.entries()) {
    const canonical = result.canonicalNarrativeInput;
    if (canonical === undefined) continue;
    const expectedStateBefore = expectedStateBeforeByResult.get(
      resultKey(result.povId, result.chapter),
    );
    const staged = stageWorldDelta(
      canonical.stateBefore,
      result.trace.intents as z.infer<typeof WorldIntentSchema>[],
      result.trace.acceptedDelta,
    );
    const povContext = buildPovContext(canonical.stateAfter, result.povId);
    const expectedAllowedFactIds = [...povContext.factIds].sort();
    const allowedFactIdSet = new Set(expectedAllowedFactIds);
    const expectedForbiddenFacts = canonical.stateAfter.facts
      .filter(({ id }) => !allowedFactIdSet.has(id))
      .map(({ claim, id }) => ({ claim, id }));
    const chapter = canonical.chapterRecord;
    const expectedFrame = {
      choices: chapter.choices,
      terminal: chapter.terminal,
      title: chapter.title,
    };
    if (
      expectedStateBefore === undefined ||
      !isDeepStrictEqual(canonical.stateBefore, expectedStateBefore) ||
      !staged.ok ||
      (staged.ok && !isDeepStrictEqual(staged.data.state, canonical.stateAfter)) ||
      hashJson(canonical.stateBefore) !== result.trace.stateBeforeHash ||
      hashJson(canonical.stateAfter) !== result.trace.stateAfterHash ||
      canonical.stateBefore.lockedPovId !== result.povId ||
      canonical.stateAfter.lockedPovId !== result.povId ||
      canonical.stateAfter.chapter !== result.chapter ||
      !isDeepStrictEqual(canonical.allowedFactIds, expectedAllowedFactIds) ||
      !isDeepStrictEqual(canonical.forbiddenFacts, expectedForbiddenFacts) ||
      !isDeepStrictEqual(canonical.frame, expectedFrame) ||
      !isDeepStrictEqual(canonical.playerAction, chapter.playerAction) ||
      chapter.chapter !== result.chapter ||
      chapter.povCharacterId !== result.povId ||
      chapter.prose !== result.prose ||
      chapter.proseHash !== result.audit.proseHash ||
      !isDeepStrictEqual(chapter.narrativeAudit, result.audit) ||
      !costsMatch(chapter.estimatedCostUsd, result.costUsd) ||
      chapter.latencyMs !== result.latencyMs ||
      !isDeepStrictEqual(chapter.usage, result.usage) ||
      chapter.traceId !== result.trace.runId ||
      chapter.requestId === undefined ||
      chapter.safeContextHash !== hashJson(povContext) ||
      chapter.stateBeforeVersion !== canonical.stateBefore.version ||
      chapter.stateAfterVersion !== canonical.stateAfter.version ||
      chapter.terminal !== canonical.stateAfter.terminal ||
      result.trace.fixtureId !== canonical.stateBefore.id ||
      result.trace.fixtureVersion !== canonical.stateBefore.fixtureVersion ||
      !validateSuggestedChoices(canonical.stateAfter, chapter.choices).ok
    ) {
      context.addIssue({
        code: "custom",
        message: "Committed chapter evidence does not reproduce canonical state",
        path: ["results", index, "canonicalNarrativeInput"],
      });
    }
  }
  return expectedStateBeforeByResult;
}

function loadLockedSeedWorld(povId: CharacterId): WorldState {
  const raw = JSON.parse(
    readFileSync(resolve(ROOT, "evals", "fixtures", "demon-king-world.json"), "utf8"),
  ) as unknown;
  const validated = validateWorldState(raw);
  if (!validated.ok) throw new Error("Live eval seed fixture is invalid");
  const seed = structuredClone(validated.data);
  seed.lockedPovId = povId;
  const locked = validateWorldState(seed);
  if (!locked.ok) throw new Error(`Cannot lock live eval seed to ${povId}`);
  return locked.data;
}

function candidateMatchesCanonicalInput(
  candidate: z.infer<typeof NarrativeCandidateEvidenceSchema>,
  canonical: z.infer<typeof CanonicalNarrativeInputEvidenceSchema>,
): boolean {
  return (
    candidate.worldVersionBefore === canonical.worldVersionBefore &&
    candidate.worldVersionAfter === canonical.worldVersionAfter &&
    isDeepStrictEqual(candidate.allowedFactIds, canonical.allowedFactIds) &&
    isDeepStrictEqual(candidate.forbiddenFacts, canonical.forbiddenFacts) &&
    isDeepStrictEqual(candidate.frame, canonical.frame) &&
    isDeepStrictEqual(candidate.playerAction, canonical.playerAction) &&
    isDeepStrictEqual(candidate.stateBefore, canonical.stateBefore) &&
    isDeepStrictEqual(candidate.stateAfter, canonical.stateAfter)
  );
}

function traceCallsMatchTurn(
  result: LiveResult,
  turn: z.infer<typeof TurnIdentitySchema>,
  runtimeAttemptEvidence: readonly z.infer<typeof RuntimeAttemptEvidenceSchema>[],
): boolean {
  const usedAttemptIndexes = new Set<number>();
  for (const call of result.trace.calls) {
    const finalIndexes = result.trace.attempts.flatMap((attempt, index) =>
      attempt.responseId === call.responseId &&
      attempt.phase === call.phase &&
      attempt.model === call.model &&
      attempt.agentId === call.agentId
        ? [index]
        : [],
    );
    if (finalIndexes.length !== 1) return false;
    const finalIndex = finalIndexes[0];
    if (finalIndex === undefined) return false;
    const callAttemptIndexes = [finalIndex];
    let cursor = finalIndex - 1;
    for (let expectedAttempt = call.retries - 1; expectedAttempt >= 0; expectedAttempt -= 1) {
      let matchedIndex = -1;
      for (let index = cursor; index >= 0; index -= 1) {
        const attempt = result.trace.attempts[index];
        if (
          attempt?.attempt === expectedAttempt &&
          attempt.phase === call.phase &&
          attempt.model === call.model &&
          attempt.agentId === call.agentId
        ) {
          matchedIndex = index;
          break;
        }
      }
      if (matchedIndex < 0) return false;
      callAttemptIndexes.unshift(matchedIndex);
      cursor = matchedIndex - 1;
    }
    if (callAttemptIndexes.some((index) => usedAttemptIndexes.has(index))) return false;
    callAttemptIndexes.forEach((index) => usedAttemptIndexes.add(index));
    const callAttempts = callAttemptIndexes.flatMap((index) => {
      const attempt = result.trace.attempts[index];
      return attempt === undefined ? [] : [attempt];
    });
    if (
      callAttempts.length !== call.retries + 1 ||
      callAttempts.some(
        (attempt, index) =>
          attempt.attempt !== index ||
          attempt.phase !== call.phase ||
          attempt.model !== call.model ||
          attempt.agentId !== call.agentId,
      ) ||
      callAttempts.at(-1)?.responseId !== call.responseId ||
      callAttempts.at(-1)?.errorCode !== null ||
      !costsMatch(sum(callAttempts.map(({ costUsd }) => costUsd)), call.estimatedCostUsd) ||
      !isDeepStrictEqual(sumAttemptUsage(callAttempts), call.usage)
    ) {
      return false;
    }
    if (
      callAttempts.some(
        (attempt) =>
          runtimeAttemptEvidence.filter(
            (evidence) =>
              isDeepStrictEqual(evidence.turn, turn) &&
              isDeepStrictEqual(evidence.attempt, attempt),
          ).length !== 1,
      )
    ) {
      return false;
    }
  }
  return true;
}

function sumAttemptUsage(
  attempts: readonly z.infer<typeof RuntimeAttemptTraceSchema>[],
): z.infer<typeof UsageSchema> {
  return attempts.reduce<z.infer<typeof UsageSchema>>(
    (total, { usage }) => ({
      cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
    }),
    {
      cacheWriteTokens: 0,
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    },
  );
}

function narrativeEvidenceIsComplete(
  results: readonly LiveResult[],
  attempts: readonly z.infer<typeof RuntimeAttemptTraceSchema>[],
  candidates: readonly z.infer<typeof NarrativeCandidateEvidenceSchema>[],
  responses: readonly z.infer<typeof NarrativeResponseEvidenceSchema>[],
  runtimeEvidenceStartAttemptIndex: number,
  runtimeAttemptEvidence: readonly z.infer<typeof RuntimeAttemptEvidenceSchema>[],
  suite: "full" | "smoke",
  supersededTurnIds: ReadonlySet<string> = new Set(),
): boolean {
  const expected = suite === "smoke" ? 1 : CHARACTER_IDS.length * 2;
  if (
    results.length !== expected ||
    runtimeEvidenceStartAttemptIndex > attempts.length ||
    !isDeepStrictEqual(
      runtimeAttemptEvidence.map(({ attempt }) => attempt),
      attempts.slice(runtimeEvidenceStartAttemptIndex),
    )
  ) {
    return false;
  }
  const narrativeAttemptsCovered = runtimeAttemptEvidence.every(({ attempt, turn }) => {
    if (supersededTurnIds.has(turn.turnId)) return true;
    if (
      (attempt.phase !== "narration" && attempt.phase !== "recovery") ||
      attempt.responseId === null
    ) {
      return true;
    }
    return (
      responses.filter(
        (response) =>
          response.phase === attempt.phase &&
          response.responseId === attempt.responseId &&
          response.attempt === attempt.attempt &&
          isDeepStrictEqual(response.turn, turn),
      ).length === 1
    );
  });
  const auditAttemptsCovered = runtimeAttemptEvidence.every(({ attempt, turn }) => {
    if (supersededTurnIds.has(turn.turnId)) return true;
    if (attempt.phase !== "audit" || attempt.responseId === null) return true;
    return (
      candidates
        .flatMap(({ auditAttempts }) => auditAttempts)
        .filter(
          (evidence) =>
            evidence.responseId === attempt.responseId &&
            evidence.attempt === attempt.attempt &&
            candidates.some(
              (candidate) =>
                candidate.auditAttempts.includes(evidence) &&
                isDeepStrictEqual(candidate.turn, turn),
            ),
        ).length === 1
    );
  });
  return (
    narrativeAttemptsCovered &&
    auditAttemptsCovered &&
    results.every((result) => {
      const canonical = result.canonicalNarrativeInput;
      return (
        canonical !== undefined &&
        candidates.filter(
          (candidate) =>
            !supersededTurnIds.has(candidate.turn.turnId) &&
            candidate.accepted &&
            candidate.povId === result.povId &&
            candidate.chapter === result.chapter &&
            candidate.adapterMode === result.adapterMode &&
            candidate.sourceGitSha === result.trace.gitSha &&
            candidate.promptVersion === result.trace.promptVersion &&
            candidate.schemaVersion === result.trace.schemaVersion &&
            candidate.turn.turnId === result.trace.runId &&
            candidate.turn.requestId === canonical.chapterRecord.requestId &&
            candidate.mergedProse === result.prose &&
            isDeepStrictEqual(candidate.audit, result.audit) &&
            isDeepStrictEqual(candidate.delta, result.trace.acceptedDelta) &&
            isDeepStrictEqual(candidate.backgroundIntents, result.trace.intents) &&
            isDeepStrictEqual(
              candidate.multiAgentOutputItems,
              result.trace.multiAgentOutputItems,
            ) &&
            candidateMatchesCanonicalInput(candidate, canonical),
        ).length === 1 &&
        candidates.some(
          (candidate) =>
            !supersededTurnIds.has(candidate.turn.turnId) &&
            candidate.accepted &&
            candidate.povId === result.povId &&
            candidate.chapter === result.chapter &&
            traceCallsMatchTurn(result, candidate.turn, runtimeAttemptEvidence),
        )
      );
    })
  );
}

export type LiveResult = z.infer<typeof LiveResultSchema>;
export type LegacyLiveReport = z.infer<typeof LegacyLiveReportSchema>;
export type Version6LiveReport = z.infer<typeof Version6LiveReportSchema>;
export type Version7LiveReport = z.infer<typeof Version7LiveReportSchema>;
export type Version8LiveReport = z.infer<typeof Version8LiveReportSchema>;
export type LiveReport = z.infer<typeof LiveReportSchema>;
export type ResumableLiveReport =
  LegacyLiveReport | Version6LiveReport | Version7LiveReport | Version8LiveReport | LiveReport;
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
    if (!multiAgentEvidenceMatchesAdapter(result.trace)) {
      context.addIssue({
        code: "custom",
        message: `Result ${index} lacks evidence for ${report.adapterMode}`,
        path: ["results", index, "trace", "multiAgentOutputItems"],
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
  const expectedResultCount = report.suite === "smoke" ? 1 : CHARACTER_IDS.length * 2;
  const requiresCurrentEvidence = "runtimeAttemptEvidence" in report;
  const committedEvidencePresent =
    !requiresCurrentEvidence ||
    report.results.every(
      ({ canonicalNarrativeInput, streamChunks }) =>
        canonicalNarrativeInput !== undefined && streamChunks !== undefined,
    );
  const reportResume = (
    report as typeof report & {
      readonly resume?: { readonly renarrations?: readonly RenarrationProvenance[] } | null;
    }
  ).resume;
  const renarrationsComplete =
    reportResume?.renarrations?.every(({ replacementTurnId }) => replacementTurnId !== null) ??
    true;
  const expectedCommonGates: readonly [keyof z.infer<typeof GateSchema>, boolean][] = [
    [
      "allAuditsApproved",
      report.results.length === expectedResultCount &&
        report.results.every(({ audit }) => audit.approved),
    ],
    [
      "allCommitsCompleted",
      report.error === null &&
        committedEvidencePresent &&
        renarrationsComplete &&
        (report.suite === "smoke"
          ? report.results.length === 1
          : hasExactFullMatrix(report.results)),
    ],
    [
      "allPovLeakListsEmpty",
      report.results.length === expectedResultCount &&
        report.results.every(({ audit }) => audit.leakedFactIds.length === 0),
    ],
    [
      "allProseWithinWordLimit",
      report.results.length === expectedResultCount &&
        report.results.every(({ wordCount: count }) => count >= 900 && count <= 1_300),
    ],
    [
      "allStreamsReconstructed",
      report.results.length === expectedResultCount &&
        report.results.every(({ prose, streamChunkCount, streamChunks, streamReconstructed }) =>
          streamChunks === undefined
            ? streamChunkCount > 0 && streamReconstructed
            : streamChunks.length > 0 && streamChunks.join("") === prose,
        ),
    ],
    [
      "p95WithinSixtySeconds",
      report.results.length > 0 &&
        percentile(
          report.results.map(({ streamingLatencyMs }) => streamingLatencyMs),
          0.95,
        ) <= 60_000,
    ],
    [
      "traceCostMatchesAttempts",
      report.results.length === expectedResultCount &&
        report.results.every((result) => resultTraceCostMatches(result)),
    ],
  ];
  for (const [gate, expected] of expectedCommonGates) {
    refineGateValue(report, gate, expected, context);
  }
}

function refineLegacyCostGates(
  report: z.infer<typeof BaseLiveReportSchema>,
  context: z.RefinementCtx,
): void {
  const expectedResultCount = report.suite === "smoke" ? 1 : CHARACTER_IDS.length * 2;
  refineGateValue(
    report,
    "allCostsWithinChapterCap",
    report.results.length === expectedResultCount &&
      report.results.every(
        ({ costUsd }) => costUsd <= report.chapterCostCapUsd + MONEY_EPSILON_USD,
      ),
    context,
  );
  refineGateValue(
    report,
    "totalCostWithinCap",
    report.cumulativeCostUsd <= TOTAL_CAP_USD + MONEY_EPSILON_USD,
    context,
  );
}

function refineGateValue(
  report: z.infer<typeof BaseLiveReportSchema>,
  gate: keyof z.infer<typeof GateSchema>,
  expected: boolean,
  context: z.RefinementCtx,
): void {
  if (report.gates[gate] !== expected) {
    context.addIssue({
      code: "custom",
      message: `Gate ${gate} is inconsistent`,
      path: ["gates", gate],
    });
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
  readonly serviceTier: RuntimeServiceTier;
  readonly sourceGitSha: string;
}

export type RerunFrom = z.infer<typeof RerunFromSchema>;
export type RenarrationProvenance = z.infer<typeof RenarrationProvenanceSchema>;

export interface RenarrationSource {
  readonly result: LiveResult;
  readonly sourceCanonicalHash: string;
  readonly sourceChapterCapUsd: number;
}

export interface ResumePreparation {
  readonly attempts: LiveReport["attempts"];
  readonly auditRejections: LiveReport["auditRejections"];
  readonly discardedResultCount: number;
  readonly draftRejections: LiveReport["draftRejections"];
  readonly existingAttemptCostUsd: number;
  readonly narrativeCandidates: LiveReport["narrativeCandidates"];
  readonly narrativeResponses: LiveReport["narrativeResponses"];
  readonly runtimeEvidenceStartAttemptIndex: number;
  readonly runtimeAttemptEvidence: LiveReport["runtimeAttemptEvidence"];
  readonly pendingPovIds: CharacterId[];
  readonly renarrate: RerunFrom[];
  readonly renarrationSources: RenarrationSource[];
  readonly rerunFrom: RerunFrom[];
  readonly retainedPovIds: CharacterId[];
  readonly retainedResultCaps: ResultChapterCap[];
  readonly retainedResults: LiveResult[];
  readonly supersededTurnIds: string[];
}

export interface LiveRunFinalizationState {
  reportCommitted: boolean;
}

export function createLiveRunFinalizationState(): LiveRunFinalizationState {
  return { reportCommitted: false };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suite = parseSuite(args);
  const nativeRequested = args.includes("--native");
  const adapterMode = nativeRequested ? "native-multi-agent" : "sequential";
  const povFilter = parsePov(args);
  const resumeReportArgument = parseOptionalFlag(args, "--resume-report");
  const renarrate = parseRenarrate(args);
  const rerunFrom = parseRerunFrom(args);
  const recoverStaleRunId = parseOptionalFlag(args, "--recover-stale-run");
  if (resumeReportArgument !== null && suite !== "full") {
    throw new Error("--resume-report is only valid for the full live suite");
  }
  if (rerunFrom.length > 0 && resumeReportArgument === null) {
    throw new Error("--rerun-from requires --resume-report");
  }
  if (renarrate.length > 0 && resumeReportArgument === null) {
    throw new Error("--renarrate requires --resume-report");
  }
  if (renarrate.length > 0 && rerunFrom.length > 0) {
    throw new Error("--renarrate and --rerun-from are mutually exclusive");
  }
  if (renarrate.length > 0 && povFilter !== null) {
    throw new Error("--renarrate cannot be combined with --pov");
  }
  const perChapterCapUsd = parseUsdFlag(
    args,
    "--chapter-cap-usd",
    DEFAULT_PER_CHAPTER_CAP_USD,
    false,
    DEFAULT_PER_CHAPTER_CAP_USD,
  );
  const priorSpendUsd = parseUsdFlag(args, "--prior-spend-usd", 0, true, TOTAL_CAP_USD);
  const serviceTier = RuntimeServiceTierSchema.parse(
    parseOptionalFlag(args, "--service-tier") ?? "standard",
  );
  if (suite === "full" && serviceTier !== "flex") {
    throw new Error("Full live eval requires --service-tier flex");
  }
  const pricingVersion = pricingVersionForServiceTier(serviceTier);
  const reportPath = resolve(
    REPORT_DIRECTORY,
    `live-${suite}-${nativeRequested ? "native" : "sequential"}${povFilter ? `-${povFilter}` : ""}${renarrate.length > 0 ? "-renarrated" : ""}.json`,
  );
  const narrativeEvidencePath = reportPath.replace(/\.json$/u, ".narrative-candidates.json");
  let cleanPathProjection: ReturnType<typeof assertPrompt1411FullMatrixFits> | null =
    suite === "full" && renarrate.length === 0
      ? assertPrompt1411FullMatrixFits(priorSpendUsd, serviceTier, TOTAL_CAP_USD)
      : null;
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
  if (recoverStaleRunId !== null && existsSync(reportPath) && existsSync(narrativeEvidencePath)) {
    const committedSource = readLiveReport(reportPath);
    const committedReport =
      committedSource.report.version === REPORT_VERSION ? committedSource.report : null;
    let currentReservationCounts: CommittedReportReservationCounts | null = null;
    try {
      if (committedReport === null) throw new Error("Committed report is not current version");
      const committedEvidence = readNarrativeEvidenceSidecar(
        narrativeEvidencePath,
        recoverStaleRunId,
        committedReport.sourceGitSha,
        committedReport.serviceTier,
        committedReport.pricingVersion,
        true,
      );
      currentReservationCounts = assertCommittedReportMatchesSidecar(
        committedReport,
        committedEvidence,
        recoverStaleRunId,
      );
    } catch {
      currentReservationCounts = null;
    }
    if (currentReservationCounts !== null && committedReport !== null) {
      if (
        committedReport.suite !== suite ||
        committedReport.nativeRequested !== nativeRequested ||
        committedReport.adapterMode !== adapterMode ||
        committedReport.povFilter !== povFilter ||
        !costsMatch(committedReport.priorSpendUsd, priorSpendUsd) ||
        !costsMatch(committedReport.chapterCostCapUsd, perChapterCapUsd) ||
        committedReport.serviceTier !== serviceTier ||
        committedReport.pricingVersion !== pricingVersion
      ) {
        throw new Error("Committed report recovery arguments do not match the original run");
      }
      const recoveryLedger = new LiveSpendLedger(LIVE_SPEND_LEDGER_PATH, TOTAL_CAP_USD);
      try {
        recoveryLedger.completeRunAfterCommittedReport(
          recoverStaleRunId,
          committedReport.budgetLedger,
          currentReservationCounts.knownReservationCount,
          currentReservationCounts.uncertainReservationCount,
        );
      } finally {
        recoveryLedger.close();
      }
      console.log(`recovered committed report ${reportPath}; no provider request made`);
      if (
        committedReport.error !== null ||
        Object.values(committedReport.gates).some((passed) => !passed)
      ) {
        process.exitCode = 1;
      }
      return;
    }
  }
  const resumeVerification =
    resumeSource === null
      ? { bridgeFiles: [], changedPaths: [] }
      : verifyResumeCheckpoint(resumeSource.report, resumeSource.sha256, sourceGitSha);
  const resumePreparation =
    resumeReport === null
      ? null
      : prepareResume(
          resumeReport,
          {
            adapterMode,
            chapterCostCapUsd: perChapterCapUsd,
            priorSpendUsd,
            promptVersion: PROMPT_VERSION,
            serviceTier,
            sourceGitSha: resumeReport.sourceGitSha,
          },
          rerunFrom,
          renarrate,
        );
  const plannedPovIds =
    suite === "smoke"
      ? [povFilter ?? "rowan-ashborn"]
      : (resumePreparation?.pendingPovIds ?? [...CHARACTER_IDS]);
  const turnsPerPov = suite === "smoke" ? 1 : 2;
  const pendingChapterCount =
    suite === "smoke"
      ? 1
      : renarrate.length > 0
        ? renarrate.length
        : CHARACTER_IDS.length * 2 - (resumePreparation?.retainedResults.length ?? 0);
  const existingAttemptCostUsd = resumePreparation?.existingAttemptCostUsd ?? 0;
  let projectedMaximumCumulativeCostUsd = projectedCumulativeCostUsd(
    priorSpendUsd,
    existingAttemptCostUsd,
    pendingChapterCount,
    perChapterCapUsd,
  );
  if (renarrate.length > 0) {
    cleanPathProjection = assertRenarrationPlanFits(
      priorSpendUsd,
      existingAttemptCostUsd,
      pendingChapterCount,
      perChapterCapUsd,
      TOTAL_CAP_USD,
    );
    projectedMaximumCumulativeCostUsd = cleanPathProjection.projectedFinalExposureUsd;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey });
  mkdirSync(REPORT_DIRECTORY, { recursive: true });
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
  const narrativeCandidates: LiveReport["narrativeCandidates"] = [
    ...(resumePreparation?.narrativeCandidates ?? []),
  ];
  const narrativeResponses: LiveReport["narrativeResponses"] = [
    ...(resumePreparation?.narrativeResponses ?? []),
  ];
  const runtimeEvidenceStartAttemptIndex = resumePreparation?.runtimeEvidenceStartAttemptIndex ?? 0;
  const runtimeAttemptEvidence: LiveReport["runtimeAttemptEvidence"] = [
    ...(resumePreparation?.runtimeAttemptEvidence ?? []),
  ];
  const supersededTurnIds = [...(resumePreparation?.supersededTurnIds ?? [])];
  const renarrations: RenarrationProvenance[] = (resumePreparation?.renarrationSources ?? []).map(
    ({ result, sourceCanonicalHash }) => {
      const sourceRequestId = result.canonicalNarrativeInput?.chapterRecord.requestId;
      if (sourceRequestId === undefined) {
        throw new Error(
          `Re-narration source ${resultKey(result.povId, result.chapter)} lacks request`,
        );
      }
      return {
        chapter: result.chapter as 1 | 2,
        povId: result.povId,
        replacementProseHash: null,
        replacementRequestId: null,
        replacementTurnId: null,
        sourceCanonicalHash,
        sourceProseHash: result.audit.proseHash,
        sourceRequestId,
        sourceTurnId: result.trace.runId,
      };
    },
  );
  const renarrationResults: LiveResult[] = [];
  const ledger = new LiveSpendLedger(LIVE_SPEND_LEDGER_PATH, TOTAL_CAP_USD);
  const liveRunId = recoverStaleRunId ?? randomUUID();
  const ledgerBaseline = {
    attemptCostUsd: existingAttemptCostUsd,
    priorSpendUsd,
    sourceReportSha256: resumeSource?.sha256 ?? `fresh:${sourceGitSha}`,
  };
  let ledgerLocked = false;
  const finalization = createLiveRunFinalizationState();
  let failure: unknown = null;
  let recoveredEvidenceExtended = false;
  try {
    if (recoverStaleRunId === null) {
      ledger.acquireRun(liveRunId);
      ledgerLocked = true;
      writeNarrativeEvidenceSidecar(
        narrativeEvidencePath,
        attempts,
        narrativeCandidates,
        narrativeResponses,
        runtimeEvidenceStartAttemptIndex,
        runtimeAttemptEvidence,
        serviceTier,
        pricingVersion,
        sourceGitSha,
        liveRunId,
        supersededTurnIds,
        renarrationResults,
      );
    } else {
      const recoveredEvidence = readNarrativeEvidenceSidecar(
        narrativeEvidencePath,
        recoverStaleRunId,
        sourceGitSha,
        serviceTier,
        pricingVersion,
      );
      const recoveredSupersededTurnIds = [...supersededTurnIds];
      for (const replacement of recoveredEvidence.renarrationResults) {
        const source = resumePreparation?.renarrationSources.find(
          ({ result }) =>
            result.povId === replacement.povId && result.chapter === replacement.chapter,
        );
        const provenance = renarrations.find(
          (entry) => entry.povId === replacement.povId && entry.chapter === replacement.chapter,
        );
        const resultIndex = results.findIndex(
          (result) => result.povId === replacement.povId && result.chapter === replacement.chapter,
        );
        const capIndex = resultChapterCaps.findIndex(
          (entry) => entry.povId === replacement.povId && entry.chapter === replacement.chapter,
        );
        if (source === undefined || provenance === undefined || resultIndex < 0 || capIndex < 0) {
          throw new Error("Recovered re-narration WAL changed source canon or identity");
        }
        assertRenarrationReplacement(source.result, replacement);
        if (canonicalNarrationSourceHash(replacement) !== source.sourceCanonicalHash) {
          throw new Error("Recovered re-narration WAL changed authenticated source canon");
        }
        assertChapterResult(replacement, nativeRequested, perChapterCapUsd);
        results[resultIndex] = replacement;
        resultChapterCaps[capIndex] = {
          capUsd: perChapterCapUsd,
          chapter: replacement.chapter,
          povId: replacement.povId,
        };
        provenance.replacementProseHash = replacement.audit.proseHash;
        provenance.replacementRequestId =
          replacement.canonicalNarrativeInput?.chapterRecord.requestId ?? null;
        provenance.replacementTurnId = replacement.trace.runId;
        if (provenance.replacementRequestId === null) {
          throw new Error("Recovered re-narration WAL lacks a request ID");
        }
        if (!recoveredSupersededTurnIds.includes(source.result.trace.runId)) {
          recoveredSupersededTurnIds.push(source.result.trace.runId);
        }
      }
      if (
        !isAppendOnlyEvidence(attempts, recoveredEvidence.attempts) ||
        !isAppendOnlyEvidence(narrativeCandidates, recoveredEvidence.candidates) ||
        !isAppendOnlyEvidence(narrativeResponses, recoveredEvidence.narrativeResponses) ||
        recoveredEvidence.runtimeEvidenceStartAttemptIndex !== runtimeEvidenceStartAttemptIndex ||
        !isAppendOnlyEvidence(runtimeAttemptEvidence, recoveredEvidence.runtimeAttemptEvidence) ||
        !isAppendOnlyEvidence(renarrationResults, recoveredEvidence.renarrationResults) ||
        !isDeepStrictEqual(recoveredSupersededTurnIds, recoveredEvidence.supersededTurnIds)
      ) {
        throw new Error("Stale-run evidence is not an append-only checkpoint extension");
      }
      recoveredEvidenceExtended =
        recoveredEvidence.attempts.length > attempts.length ||
        recoveredEvidence.candidates.length > narrativeCandidates.length ||
        recoveredEvidence.narrativeResponses.length > narrativeResponses.length ||
        recoveredEvidence.runtimeAttemptEvidence.length > runtimeAttemptEvidence.length ||
        recoveredEvidence.renarrationResults.length > renarrationResults.length;
      attempts.splice(0, attempts.length, ...recoveredEvidence.attempts);
      narrativeCandidates.splice(0, narrativeCandidates.length, ...recoveredEvidence.candidates);
      narrativeResponses.splice(
        0,
        narrativeResponses.length,
        ...recoveredEvidence.narrativeResponses,
      );
      runtimeAttemptEvidence.splice(
        0,
        runtimeAttemptEvidence.length,
        ...recoveredEvidence.runtimeAttemptEvidence,
      );
      renarrationResults.splice(
        0,
        renarrationResults.length,
        ...recoveredEvidence.renarrationResults,
      );
      supersededTurnIds.splice(0, supersededTurnIds.length, ...recoveredEvidence.supersededTurnIds);
      ledger.recoverStaleRun(
        recoverStaleRunId,
        ledgerBaseline,
        sum(attempts.map(({ costUsd }) => costUsd)),
      );
      ledgerLocked = true;
      writeNarrativeEvidenceSidecar(
        narrativeEvidencePath,
        attempts,
        narrativeCandidates,
        narrativeResponses,
        runtimeEvidenceStartAttemptIndex,
        runtimeAttemptEvidence,
        serviceTier,
        pricingVersion,
        sourceGitSha,
        liveRunId,
        supersededTurnIds,
        renarrationResults,
      );
    }
    if (recoverStaleRunId === null) {
      ledger.synchronizeBaseline(liveRunId, ledgerBaseline);
    }
    const costHooks = ledger.createCostHooks(liveRunId);

    if (recoveredEvidenceExtended) {
      failure = new Error(
        "Recovered stale-run evidence was checkpointed without replay; register this report and resume normally",
      );
    } else
      try {
        if ((resumePreparation?.renarrationSources.length ?? 0) > 0) {
          for (const source of resumePreparation?.renarrationSources ?? []) {
            const sourceResult = source.result;
            const canonical = sourceResult.canonicalNarrativeInput;
            if (canonical === undefined) {
              throw new Error(
                `Re-narration source ${resultKey(sourceResult.povId, sourceResult.chapter)} lacks canon`,
              );
            }
            const store = new StoryStore();
            try {
              const service = new StoryService(store, client, {
                auditReasoningEffort: RENARRATION_AUDIT_REASONING_EFFORT,
                canonicalAuditMaxOutputTokens: RENARRATION_AUDIT_MAX_OUTPUT_TOKENS,
                canonicalNarrationDirective: RENARRATION_NARRATION_DIRECTIVE,
                costHooks,
                maxBackgroundAgents: 0,
                maxCostUsdPerChapter: perChapterCapUsd,
                nativeMultiAgent: false,
                onNarrativeAudit: (audit) => {
                  if (!audit.approved) {
                    auditRejections.push({ audit, povId: sourceResult.povId });
                  }
                },
                onNarrativeCandidate: (candidate) => {
                  narrativeCandidates.push(NarrativeCandidateEvidenceSchema.parse(candidate));
                  writeNarrativeEvidenceSidecar(
                    narrativeEvidencePath,
                    attempts,
                    narrativeCandidates,
                    narrativeResponses,
                    runtimeEvidenceStartAttemptIndex,
                    runtimeAttemptEvidence,
                    serviceTier,
                    pricingVersion,
                    sourceGitSha,
                    liveRunId,
                    supersededTurnIds,
                    renarrationResults,
                  );
                },
                onNarrativeDraftRejected: (issues) => {
                  draftRejections.push({ issues: [...issues], povId: sourceResult.povId });
                  console.log(
                    `draft rejected: ${issues.map(({ code, message }) => `${code}: ${message}`).join("; ")}`,
                  );
                },
                onNarrativeResponse: (response) => {
                  narrativeResponses.push(NarrativeResponseEvidenceSchema.parse(response));
                  writeNarrativeEvidenceSidecar(
                    narrativeEvidencePath,
                    attempts,
                    narrativeCandidates,
                    narrativeResponses,
                    runtimeEvidenceStartAttemptIndex,
                    runtimeAttemptEvidence,
                    serviceTier,
                    pricingVersion,
                    sourceGitSha,
                    liveRunId,
                    supersededTurnIds,
                    renarrationResults,
                  );
                },
                onRuntimeAttempt: (attempt, turn) => {
                  attempts.push(attempt);
                  runtimeAttemptEvidence.push({ attempt, turn: TurnIdentitySchema.parse(turn) });
                  writeNarrativeEvidenceSidecar(
                    narrativeEvidencePath,
                    attempts,
                    narrativeCandidates,
                    narrativeResponses,
                    runtimeEvidenceStartAttemptIndex,
                    runtimeAttemptEvidence,
                    serviceTier,
                    pricingVersion,
                    sourceGitSha,
                    liveRunId,
                    supersededTurnIds,
                    renarrationResults,
                  );
                },
                serviceTier,
              });
              const streamingStartedAt = performance.now();
              const generated = await service.renarrateCanonicalTurn(
                {
                  adapterMode: sourceResult.adapterMode,
                  delta: WorldDeltaSchema.parse(sourceResult.trace.acceptedDelta),
                  frame: canonical.frame,
                  intents: sourceResult.trace.intents.map((intent) =>
                    WorldIntentSchema.parse(intent),
                  ),
                  multiAgentOutputItems: sourceResult.trace.multiAgentOutputItems,
                  playerAction: canonical.playerAction,
                  stateAfter: canonical.stateAfter,
                  stateBefore: canonical.stateBefore,
                },
                randomUUID(),
              );
              const replacement = buildRenarratedLiveResult(
                sourceResult,
                generated,
                Math.max(0, Math.round(performance.now() - streamingStartedAt)),
              );
              assertRenarrationReplacement(sourceResult, replacement);
              if (canonicalNarrationSourceHash(replacement) !== source.sourceCanonicalHash) {
                throw new Error("Re-narration changed authenticated canon");
              }
              assertChapterResult(replacement, nativeRequested, perChapterCapUsd);
              const resultIndex = results.findIndex(
                (result) =>
                  result.povId === sourceResult.povId && result.chapter === sourceResult.chapter,
              );
              const capIndex = resultChapterCaps.findIndex(
                (entry) =>
                  entry.povId === sourceResult.povId && entry.chapter === sourceResult.chapter,
              );
              const provenance = renarrations.find(
                (entry) =>
                  entry.povId === sourceResult.povId && entry.chapter === sourceResult.chapter,
              );
              if (resultIndex < 0 || capIndex < 0 || provenance === undefined) {
                throw new Error("Re-narration target lost its source result or provenance");
              }
              results[resultIndex] = replacement;
              resultChapterCaps[capIndex] = {
                capUsd: perChapterCapUsd,
                chapter: replacement.chapter,
                povId: replacement.povId,
              };
              provenance.replacementProseHash = replacement.audit.proseHash;
              provenance.replacementRequestId =
                replacement.canonicalNarrativeInput?.chapterRecord.requestId ?? null;
              provenance.replacementTurnId = replacement.trace.runId;
              if (provenance.replacementRequestId === null) {
                throw new Error("Re-narration replacement lost its request ID");
              }
              if (!supersededTurnIds.includes(sourceResult.trace.runId)) {
                supersededTurnIds.push(sourceResult.trace.runId);
              }
              renarrationResults.push(replacement);
              writeNarrativeEvidenceSidecar(
                narrativeEvidencePath,
                attempts,
                narrativeCandidates,
                narrativeResponses,
                runtimeEvidenceStartAttemptIndex,
                runtimeAttemptEvidence,
                serviceTier,
                pricingVersion,
                sourceGitSha,
                liveRunId,
                supersededTurnIds,
                renarrationResults,
              );
              writeAtomicJson(
                reportPath,
                buildLiveReport(null, ledger.snapshot(), {
                  adapterMode,
                  apiKey,
                  attempts,
                  auditRejections,
                  chapterCostCapUsd: perChapterCapUsd,
                  cleanPathProjection,
                  draftRejections,
                  existingAttemptCostUsd,
                  narrativeCandidates,
                  narrativeResponses,
                  nativeRequested,
                  povFilter,
                  pricingVersion,
                  priorSpendUsd,
                  projectedMaximumCumulativeCostUsd,
                  renarrations,
                  resultChapterCaps,
                  results,
                  resumePreparation,
                  resumeReport,
                  resumeReportPath,
                  resumeSource,
                  resumeVerification,
                  runtimeAttemptEvidence,
                  runtimeEvidenceStartAttemptIndex,
                  serviceTier,
                  sourceGitSha,
                  startedAt,
                  suite,
                  supersededTurnIds,
                }),
              );
              console.log(
                `${replacement.povId} chapter ${replacement.chapter} re-narrated: ${replacement.wordCount} words, $${replacement.costUsd.toFixed(5)}`,
              );
            } finally {
              store.close();
            }
          }
        } else {
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
                onNarrativeCandidate: (candidate) => {
                  narrativeCandidates.push(NarrativeCandidateEvidenceSchema.parse(candidate));
                  writeNarrativeEvidenceSidecar(
                    narrativeEvidencePath,
                    attempts,
                    narrativeCandidates,
                    narrativeResponses,
                    runtimeEvidenceStartAttemptIndex,
                    runtimeAttemptEvidence,
                    serviceTier,
                    pricingVersion,
                    sourceGitSha,
                    liveRunId,
                    supersededTurnIds,
                    renarrationResults,
                  );
                },
                onNarrativeDraftRejected: (issues) => {
                  draftRejections.push({ issues: [...issues], povId });
                  console.log(
                    `draft rejected: ${issues.map(({ code, message }) => `${code}: ${message}`).join("; ")}`,
                  );
                },
                onNarrativeResponse: (response) => {
                  narrativeResponses.push(NarrativeResponseEvidenceSchema.parse(response));
                  writeNarrativeEvidenceSidecar(
                    narrativeEvidencePath,
                    attempts,
                    narrativeCandidates,
                    narrativeResponses,
                    runtimeEvidenceStartAttemptIndex,
                    runtimeAttemptEvidence,
                    serviceTier,
                    pricingVersion,
                    sourceGitSha,
                    liveRunId,
                    supersededTurnIds,
                    renarrationResults,
                  );
                },
                onRuntimeAttempt: (attempt, turn) => {
                  attempts.push(attempt);
                  runtimeAttemptEvidence.push({ attempt, turn: TurnIdentitySchema.parse(turn) });
                  writeNarrativeEvidenceSidecar(
                    narrativeEvidencePath,
                    attempts,
                    narrativeCandidates,
                    narrativeResponses,
                    runtimeEvidenceStartAttemptIndex,
                    runtimeAttemptEvidence,
                    serviceTier,
                    pricingVersion,
                    sourceGitSha,
                    liveRunId,
                    supersededTurnIds,
                    renarrationResults,
                  );
                  if (attempt.errorCode !== null) {
                    console.log(
                      `${attempt.model} attempt ${attempt.attempt + 1}: ${attempt.errorCode}, $${attempt.costUsd.toFixed(5)}`,
                    );
                  }
                },
                serviceTier,
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
                const povContext = buildPovContext(state, povId);
                const allowedFactIds = [...povContext.factIds].sort();
                const allowedFactIdSet = new Set(allowedFactIds);
                const result: LiveResult = {
                  adapterMode: trace.adapterMode,
                  audit: chapter.narrativeAudit,
                  canonicalNarrativeInput: {
                    allowedFactIds,
                    chapterRecord: chapter,
                    forbiddenFacts: state.facts
                      .filter(({ id }) => !allowedFactIdSet.has(id))
                      .map(({ claim, id }) => ({ claim, id })),
                    frame: {
                      choices: chapter.choices,
                      terminal: chapter.terminal,
                      title: chapter.title,
                    },
                    playerAction: chapter.playerAction,
                    stateAfter: state,
                    stateBefore: beforeTurn,
                    worldVersionAfter: chapter.stateAfterVersion,
                    worldVersionBefore: chapter.stateBeforeVersion,
                  },
                  chapter: chapter.chapter,
                  costUsd: chapter.estimatedCostUsd,
                  latencyMs: chapter.latencyMs,
                  povId,
                  prose: chapter.prose,
                  streamChunkCount: streamedChunks.length,
                  streamChunks: streamedChunks,
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
                    narrativeCandidates,
                    narrativeResponses,
                    pricingVersion,
                    cleanPathProjection,
                    runtimeEvidenceStartAttemptIndex,
                    runtimeAttemptEvidence,
                    nativeRequested,
                    povFilter,
                    priorSpendUsd,
                    projectedMaximumCumulativeCostUsd,
                    renarrations,
                    resultChapterCaps,
                    results,
                    resumePreparation,
                    resumeReport,
                    resumeReportPath,
                    resumeSource,
                    resumeVerification,
                    sourceGitSha,
                    serviceTier,
                    startedAt,
                    supersededTurnIds,
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
      narrativeCandidates,
      narrativeResponses,
      pricingVersion,
      cleanPathProjection,
      runtimeEvidenceStartAttemptIndex,
      runtimeAttemptEvidence,
      nativeRequested,
      povFilter,
      priorSpendUsd,
      projectedMaximumCumulativeCostUsd,
      renarrations,
      resultChapterCaps,
      results,
      resumePreparation,
      resumeReport,
      resumeReportPath,
      resumeSource,
      resumeVerification,
      sourceGitSha,
      serviceTier,
      startedAt,
      supersededTurnIds,
      suite,
    });
    writeAtomicJson(reportPath, report);
    finalization.reportCommitted = true;

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
    if (ledgerLocked && finalization.reportCommitted) {
      ledger.releaseRun(liveRunId);
    } else if (ledgerLocked) {
      console.error(`stale recovery lock retained by run ${liveRunId}`);
    }
    ledger.close();
  }
}

export interface ResumeVerification {
  readonly bridgeFiles: z.infer<typeof BridgeFileSchema>[];
  readonly changedPaths: string[];
}

export interface BuildLiveReportInput {
  readonly adapterMode: z.infer<typeof AdapterModeSchema>;
  readonly apiKey: string;
  readonly attempts: LiveReport["attempts"];
  readonly auditRejections: LiveReport["auditRejections"];
  readonly chapterCostCapUsd: number;
  readonly cleanPathProjection: ReturnType<typeof assertPrompt1411FullMatrixFits> | null;
  readonly draftRejections: LiveReport["draftRejections"];
  readonly existingAttemptCostUsd: number;
  readonly narrativeCandidates: LiveReport["narrativeCandidates"];
  readonly narrativeResponses: LiveReport["narrativeResponses"];
  readonly runtimeEvidenceStartAttemptIndex: number;
  readonly runtimeAttemptEvidence: LiveReport["runtimeAttemptEvidence"];
  readonly nativeRequested: boolean;
  readonly povFilter: CharacterId | null;
  readonly priorSpendUsd: number;
  readonly pricingVersion: string;
  readonly projectedMaximumCumulativeCostUsd: number;
  readonly renarrations?: RenarrationProvenance[];
  readonly resultChapterCaps: ResultChapterCap[];
  readonly results: LiveResult[];
  readonly resumePreparation: ResumePreparation | null;
  readonly resumeReport: ResumableLiveReport | null;
  readonly resumeReportPath: string | null;
  readonly resumeSource: ResumeSource | null;
  readonly resumeVerification: ResumeVerification;
  readonly settledFailure?: z.infer<typeof SettledFailureSchema> | null;
  readonly sourceGitSha: string;
  readonly serviceTier: RuntimeServiceTier;
  readonly startedAt: string;
  readonly supersededTurnIds: string[];
  readonly suite: "full" | "smoke";
}

function sourceEvidenceBoundary(
  report: ResumableLiveReport,
): z.infer<typeof SourceEvidenceBoundarySchema> {
  return {
    attemptCount: report.attempts.length,
    narrativeCandidateCount:
      "narrativeCandidates" in report ? report.narrativeCandidates.length : 0,
    narrativeResponseCount: "narrativeResponses" in report ? report.narrativeResponses.length : 0,
    runtimeAttemptEvidenceCount:
      "runtimeAttemptEvidence" in report ? report.runtimeAttemptEvidence.length : 0,
  };
}

function sourceEvidenceGitShas(report: ResumableLiveReport): string[] {
  if (!("narrativeCandidates" in report) || !("narrativeResponses" in report)) return [];
  return [
    ...new Set([
      ...report.narrativeCandidates.map(({ sourceGitSha }) => sourceGitSha),
      ...report.narrativeResponses.map(({ sourceGitSha }) => sourceGitSha),
    ]),
  ].sort();
}

export function buildLiveReport(
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
  const renarrations = input.renarrations ?? [];
  const allRenarrationsCompleted = renarrations.every(
    ({ replacementTurnId }) => replacementTurnId !== null,
  );
  const caps = new Map(
    input.resultChapterCaps.map(({ capUsd, chapter, povId }) => [
      resultKey(povId, chapter),
      capUsd,
    ]),
  );
  const gates = {
    allAuditsApproved:
      input.results.length === expected && input.results.every(({ audit }) => audit.approved),
    allCommitsCompleted:
      failure === null &&
      completeMatrix &&
      allRenarrationsCompleted &&
      input.results.every(
        ({ canonicalNarrativeInput, streamChunks }) =>
          canonicalNarrativeInput !== undefined && streamChunks !== undefined,
      ),
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
      input.results.every(
        ({ prose, streamChunks }) =>
          streamChunks !== undefined && streamChunks.length > 0 && streamChunks.join("") === prose,
      ),
    narrativeEvidenceComplete: narrativeEvidenceIsComplete(
      input.results,
      input.attempts,
      input.narrativeCandidates,
      input.narrativeResponses,
      input.runtimeEvidenceStartAttemptIndex,
      input.runtimeAttemptEvidence,
      input.suite,
      new Set(input.supersededTurnIds),
    ),
    p95WithinSixtySeconds:
      input.results.length > 0 &&
      percentile(
        input.results.map(({ streamingLatencyMs }) => streamingLatencyMs),
        0.95,
      ) <= 60_000,
    serviceTierEvidenceComplete: recordedServiceTierEvidenceIsComplete(
      input.attempts,
      input.results,
      input.runtimeEvidenceStartAttemptIndex,
      input.serviceTier,
      input.pricingVersion,
    ),
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
    cleanPathProjectedCostUsd: input.cleanPathProjection?.projectedMatrixCostUsd ?? null,
    completedChapters: input.results.length,
    cumulativeCostUsd: input.priorSpendUsd + totalCostUsd,
    draftRejections: input.draftRejections,
    error: failure === null ? null : safeError(failure, input.apiKey),
    finishedAt: new Date().toISOString(),
    gates,
    nativeRequested: input.nativeRequested,
    narrativeCandidates: input.narrativeCandidates,
    narrativeResponses: input.narrativeResponses,
    runtimeEvidenceStartAttemptIndex: input.runtimeEvidenceStartAttemptIndex,
    povFilter: input.povFilter,
    priorSpendUsd: input.priorSpendUsd,
    pricingVersion: input.pricingVersion,
    projectedFinalExposureUsd: input.cleanPathProjection?.projectedFinalExposureUsd ?? null,
    projectedMaximumCumulativeCostUsd: Math.max(
      input.projectedMaximumCumulativeCostUsd,
      input.priorSpendUsd + totalCostUsd,
    ),
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
            renarrate: input.resumePreparation.renarrate,
            renarrations,
            rerunFrom: input.resumePreparation.rerunFrom,
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
            sourceEvidenceBoundary: sourceEvidenceBoundary(input.resumeReport),
            sourceEvidenceGitShas: sourceEvidenceGitShas(input.resumeReport),
            sourceGitSha: input.resumeReport.sourceGitSha,
            sourceReportPath: input.resumeReportPath,
            sourceReportSha256: input.resumeSource.sha256,
            sourceReportVersion: input.resumeReport.version,
          },
    settledFailure: input.settledFailure ?? null,
    sourceGitSha: input.sourceGitSha,
    supersededTurnIds: input.supersededTurnIds,
    serviceTier: input.serviceTier,
    startedAt: input.startedAt,
    suite: input.suite,
    totalCostCapUsd: TOTAL_CAP_USD,
    totalCostUsd,
    runtimeAttemptEvidence: input.runtimeAttemptEvidence,
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
  let chapter: ChapterRecord;
  if (result.canonicalNarrativeInput !== undefined) {
    const canonical = result.canonicalNarrativeInput;
    if (
      !isDeepStrictEqual(canonical.stateBefore, before) ||
      !isDeepStrictEqual(canonical.stateAfter, prospective)
    ) {
      throw new Error("Retained chapter canonical states do not match authenticated state hashes");
    }
    chapter = ChapterRecordSchema.parse(canonical.chapterRecord);
    if (
      chapter.prose !== result.prose ||
      chapter.proseHash !== result.audit.proseHash ||
      chapter.povCharacterId !== result.povId ||
      chapter.traceId !== trace.runId
    ) {
      throw new Error("Retained canonical chapter does not match authenticated result evidence");
    }
  } else {
    const options = buildChapterChoiceOptions(prospective);
    const frame = canonicalizeChapterFrameCandidate(prospective, {
      optionIds: options.slice(0, 2).map(({ id }) => id),
      title: "Restored live checkpoint",
    });
    if (!frame.ok) throw new Error("Retained chapter cannot build legal continuation choices");
    chapter = {
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
  }
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

export function isAppendOnlyEvidence<T>(
  checkpointed: readonly T[],
  recovered: readonly T[],
): boolean {
  return (
    recovered.length >= checkpointed.length &&
    isDeepStrictEqual(recovered.slice(0, checkpointed.length), checkpointed)
  );
}

export function writeNarrativeEvidenceSidecar(
  path: string,
  attempts: readonly z.infer<typeof RuntimeAttemptTraceSchema>[],
  candidates: readonly z.infer<typeof NarrativeCandidateEvidenceSchema>[],
  narrativeResponses: readonly z.infer<typeof NarrativeResponseEvidenceSchema>[],
  runtimeEvidenceStartAttemptIndex: number,
  runtimeAttemptEvidence: readonly z.infer<typeof RuntimeAttemptEvidenceSchema>[],
  serviceTier: RuntimeServiceTier,
  pricingVersion: string,
  sourceGitSha: string,
  liveRunId: string,
  supersededTurnIds: readonly string[] = [],
  renarrationResults: readonly LiveResult[] = [],
): void {
  writeAtomicJson(
    path,
    NarrativeEvidenceSidecarSchema.parse({
      attempts,
      candidates,
      liveRunId,
      narrativeResponses,
      promptVersion: PROMPT_VERSION,
      reportVersion: REPORT_VERSION,
      pricingVersion,
      renarrationResults,
      runtimeEvidenceStartAttemptIndex,
      runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
      runtimeAttemptEvidence,
      serviceTier,
      sourceGitSha,
      supersededTurnIds,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function readNarrativeEvidenceSidecar(
  path: string,
  expectedLiveRunId: string,
  expectedSourceGitSha: string,
  expectedServiceTier: RuntimeServiceTier,
  expectedPricingVersion: string,
  allowUncertainReturnedTier = false,
): z.infer<typeof NarrativeEvidenceSidecarSchema> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot read stale-run narrative evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const evidence = NarrativeEvidenceSidecarSchema.parse(candidate);
  if (evidence.liveRunId !== expectedLiveRunId) {
    throw new Error("Narrative evidence belongs to a different stale run");
  }
  if (evidence.sourceGitSha !== expectedSourceGitSha) {
    throw new Error("Narrative evidence belongs to a different Git checkpoint");
  }
  if (
    evidence.serviceTier !== expectedServiceTier ||
    evidence.pricingVersion !== expectedPricingVersion
  ) {
    throw new Error("Narrative evidence service tier does not match this run");
  }
  const currentAttempts = evidence.attempts.slice(evidence.runtimeEvidenceStartAttemptIndex);
  if (
    currentAttempts.some(
      (attempt) =>
        attempt.requestedServiceTier !== expectedServiceTier ||
        (attempt.serviceTier !== expectedServiceTier &&
          !(allowUncertainReturnedTier && attempt.serviceTier === null)),
    ) ||
    evidence.runtimeAttemptEvidence.some(
      ({ attempt }) =>
        attempt.requestedServiceTier !== expectedServiceTier ||
        (attempt.serviceTier !== expectedServiceTier &&
          !(allowUncertainReturnedTier && attempt.serviceTier === null)),
    )
  ) {
    throw new Error("Narrative evidence contains mixed service-tier attempts");
  }
  return evidence;
}

export interface CommittedReportReservationCounts {
  readonly knownReservationCount: number;
  readonly uncertainReservationCount: number;
}

export function assertCommittedReportMatchesSidecar(
  report: LiveReport,
  evidence: z.infer<typeof NarrativeEvidenceSidecarSchema>,
  expectedLiveRunId: string,
): CommittedReportReservationCounts {
  if (report.settledFailure != null) {
    throw new Error("Settled-failure receipts need their dedicated reconciliation path");
  }
  if (
    evidence.liveRunId !== expectedLiveRunId ||
    evidence.sourceGitSha !== report.sourceGitSha ||
    evidence.serviceTier !== report.serviceTier ||
    evidence.pricingVersion !== report.pricingVersion ||
    evidence.promptVersion !== report.promptVersion ||
    evidence.reportVersion !== report.version ||
    evidence.runtimeSchemaVersion !== RUNTIME_SCHEMA_VERSION
  ) {
    throw new Error("Committed report metadata does not match its narrative sidecar");
  }
  if (
    evidence.runtimeEvidenceStartAttemptIndex !== report.runtimeEvidenceStartAttemptIndex ||
    !isDeepStrictEqual(evidence.attempts, report.attempts) ||
    !isDeepStrictEqual(evidence.candidates, report.narrativeCandidates) ||
    !isDeepStrictEqual(evidence.narrativeResponses, report.narrativeResponses) ||
    !isDeepStrictEqual(evidence.runtimeAttemptEvidence, report.runtimeAttemptEvidence) ||
    !isDeepStrictEqual(evidence.supersededTurnIds, report.supersededTurnIds ?? [])
  ) {
    throw new Error("Committed report evidence does not exactly match its narrative sidecar");
  }
  const reportRenarrationResults = (report.resume?.renarrations ?? []).flatMap(
    ({ chapter, povId, replacementTurnId }) => {
      if (replacementTurnId === null) return [];
      const result = report.results.find(
        (entry) => entry.povId === povId && entry.chapter === chapter,
      );
      return result === undefined ? [] : [result];
    },
  );
  if (!isDeepStrictEqual(evidence.renarrationResults, reportRenarrationResults)) {
    throw new Error("Committed report re-narration WAL does not match its sidecar");
  }
  const sourceAttemptCount = report.resume?.sourceEvidenceBoundary?.attemptCount ?? 0;
  if (report.resume !== null && report.resume.sourceEvidenceBoundary === null) {
    throw new Error("Committed resumed report lacks an authenticated source evidence boundary");
  }
  const currentAttemptCount = report.attempts.length - sourceAttemptCount;
  if (currentAttemptCount < 0) {
    throw new Error("Committed report source attempt boundary exceeds its evidence");
  }
  const currentAttempts = report.attempts.slice(sourceAttemptCount);
  return {
    knownReservationCount: currentAttempts.filter(({ serviceTier }) => serviceTier !== null).length,
    uncertainReservationCount: currentAttempts.filter(({ serviceTier }) => serviceTier === null)
      .length,
  };
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
  if (!multiAgentEvidenceMatchesAdapter(result.trace)) {
    throw new Error(`Trace lacks evidence for ${wantedMode}`);
  }
  if (!resultTraceCostMatches(result)) {
    throw new Error("Chapter cost does not match its trace attempts");
  }
}

export function multiAgentEvidenceMatchesAdapter(
  trace: Pick<LiveResult["trace"], "adapterMode" | "multiAgentOutputItems">,
): boolean {
  if (trace.adapterMode === "sequential") return trace.multiAgentOutputItems.length === 0;

  const calls = new Map<string, string>();
  const outputs = new Map<string, string>();
  let hasRootFinalMessage = false;
  for (const item of trace.multiAgentOutputItems) {
    if (item.type === "multi_agent_call") {
      if (typeof item.call_id === "string" && typeof item.action === "string") {
        calls.set(item.call_id, item.action);
      }
      continue;
    }
    if (item.type === "multi_agent_call_output") {
      if (typeof item.call_id === "string" && typeof item.action === "string") {
        outputs.set(item.call_id, item.action);
      }
      continue;
    }
    if (item.type !== "message" || item.phase !== "final_answer") continue;
    const agent = item.agent;
    const isRoot =
      agent === null ||
      agent === undefined ||
      (typeof agent === "object" &&
        agent !== null &&
        "agent_name" in agent &&
        (agent.agent_name === "root" || agent.agent_name === "/root"));
    const content = item.content;
    if (
      isRoot &&
      Array.isArray(content) &&
      content.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "output_text" &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text.length > 0,
      )
    ) {
      hasRootFinalMessage = true;
    }
  }

  const hasMatchedSpawn = [...calls].some(
    ([callId, action]) => action === "spawn_agent" && outputs.get(callId) === action,
  );
  return hasMatchedSpawn && hasRootFinalMessage;
}

export function buildRenarratedLiveResult(
  source: LiveResult,
  generated: CanonicalRenarrationResult,
  streamingLatencyMs: number,
): LiveResult {
  const canonical = source.canonicalNarrativeInput;
  if (canonical === undefined) {
    throw new Error(`Re-narration source ${resultKey(source.povId, source.chapter)} lacks canon`);
  }
  const result = LiveResultSchema.parse({
    adapterMode: generated.trace.adapterMode,
    audit: generated.chapter.narrativeAudit,
    canonicalNarrativeInput: {
      ...canonical,
      chapterRecord: generated.chapter,
    },
    chapter: generated.chapter.chapter,
    costUsd: generated.chapter.estimatedCostUsd,
    latencyMs: generated.chapter.latencyMs,
    povId: generated.chapter.povCharacterId,
    prose: generated.chapter.prose,
    streamChunkCount: generated.streamChunks.length,
    streamChunks: [...generated.streamChunks],
    streamingLatencyMs,
    streamReconstructed: generated.streamChunks.join("") === generated.chapter.prose,
    trace: generated.trace,
    usage: generated.chapter.usage,
    wordCount: wordCount(generated.chapter.prose),
  });
  if (canonicalNarrationSourceHash(result) !== canonicalNarrationSourceHash(source)) {
    throw new Error("Re-narration changed canonical narrative inputs");
  }
  return result;
}

export function assertRenarrationReplacement(source: LiveResult, replacement: LiveResult): void {
  const sourceRequestId = source.canonicalNarrativeInput?.chapterRecord.requestId;
  const replacementRequestId = replacement.canonicalNarrativeInput?.chapterRecord.requestId;
  if (
    source.povId !== replacement.povId ||
    source.chapter !== replacement.chapter ||
    sourceRequestId === undefined ||
    replacementRequestId === undefined ||
    source.trace.runId === replacement.trace.runId ||
    sourceRequestId === replacementRequestId ||
    source.audit.proseHash === replacement.audit.proseHash ||
    canonicalNarrationSourceHash(source) !== canonicalNarrationSourceHash(replacement)
  ) {
    throw new Error("Re-narration replacement changed canon or retained source identity");
  }
}

export function prepareResume(
  report: ResumableLiveReport,
  requirements: ResumeRequirements,
  rerunFrom: readonly RerunFrom[] = [],
  renarrate: readonly RerunFrom[] = [],
): ResumePreparation {
  if (report.suite !== "full") {
    throw new Error("Resume report must be a version 5 through 9 full-suite report");
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
  if (reportServiceTier(report) !== requirements.serviceTier) {
    throw new Error("Resume report service tier does not match this run");
  }
  if (
    report.version === REPORT_VERSION &&
    report.attempts.length > report.runtimeEvidenceStartAttemptIndex &&
    !report.gates.serviceTierEvidenceComplete
  ) {
    throw new Error("Resume report contains incomplete service-tier evidence");
  }
  if (report.sourceGitSha !== requirements.sourceGitSha) {
    throw new Error("Resume report Git SHA does not match current HEAD");
  }
  if (new Set(rerunFrom.map(({ povId }) => povId)).size !== rerunFrom.length) {
    throw new Error("Explicit rerun repeats a POV");
  }
  if (new Set(renarrate.map(({ povId }) => povId)).size !== renarrate.length) {
    throw new Error("Explicit re-narration repeats a POV");
  }
  if (rerunFrom.length > 0 && renarrate.length > 0) {
    throw new Error("Rerun and re-narration are mutually exclusive");
  }
  if (
    report.version === REPORT_VERSION &&
    report.settledFailure !== null &&
    report.settledFailure !== undefined
  ) {
    const expectedTargets = report.settledFailure.rerunFrom
      .map(({ chapter, povId }) => resultKey(povId, chapter))
      .sort();
    const activeTargets = rerunFrom.length > 0 ? rerunFrom : renarrate;
    const actualTargets = activeTargets
      .map(({ chapter, povId }) => resultKey(povId, chapter))
      .sort();
    if (!isDeepStrictEqual(actualTargets, expectedTargets)) {
      throw new Error("Settled failure requires its exact recorded rerun targets");
    }
  }
  const rerunStartByPovId = new Map(rerunFrom.map(({ chapter, povId }) => [povId, chapter]));
  const renarrateKeys = new Set(renarrate.map(({ chapter, povId }) => resultKey(povId, chapter)));

  const retainedResults: LiveResult[] = [];
  const retainedResultCaps: ResultChapterCap[] = [];
  const retainedPovIds: CharacterId[] = [];
  const pendingPovIds: CharacterId[] = [];
  const renarrationSources: RenarrationSource[] = [];
  let discardedResultCount = 0;
  for (const povId of CHARACTER_IDS) {
    const povResults = report.results.filter((result) => result.povId === povId);
    const chapters = [...povResults].sort((left, right) => left.chapter - right.chapter);
    const contiguousPrefix =
      (chapters.length === 1 && chapters[0]?.chapter === 1) ||
      (chapters.length === 2 && chapters[0]?.chapter === 1 && chapters[1]?.chapter === 2);
    const rerunStart = rerunStartByPovId.get(povId);
    if (rerunStart !== undefined) {
      if (chapters.length !== 2 || chapters[0]?.chapter !== 1 || chapters[1]?.chapter !== 2) {
        throw new Error(`Explicit rerun POV ${povId} lacks a complete chapter pair`);
      }
      for (const result of chapters) {
        const sourceCap = sourceResultChapterCap(report, result.povId, result.chapter);
        assertChapterResult(result, requirements.adapterMode === "native-multi-agent", sourceCap);
        assertResultPayloadConsistency(result);
      }
      const retainedPrefix = chapters.filter(({ chapter }) => chapter < rerunStart);
      for (const result of retainedPrefix) {
        retainedResults.push(result);
        retainedResultCaps.push({
          capUsd: sourceResultChapterCap(report, result.povId, result.chapter),
          chapter: result.chapter,
          povId: result.povId,
        });
      }
      if (retainedPrefix.length > 0) retainedPovIds.push(povId);
      discardedResultCount += chapters.length - retainedPrefix.length;
      pendingPovIds.push(povId);
      continue;
    }
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
      if (
        chapters.length < 2 ||
        chapters.some(({ chapter }) => renarrateKeys.has(resultKey(povId, chapter)))
      ) {
        pendingPovIds.push(povId);
      }
    } else {
      discardedResultCount += chapters.length;
      pendingPovIds.push(povId);
    }
  }
  if (renarrate.length > 0) {
    if (report.version !== REPORT_VERSION) {
      throw new Error("Canon-only re-narration requires a current version 9 report");
    }
    for (const target of renarrate) {
      const result = retainedResults.find(
        (entry) => entry.povId === target.povId && entry.chapter === target.chapter,
      );
      if (result?.canonicalNarrativeInput === undefined) {
        throw new Error(
          `Re-narration target ${resultKey(target.povId, target.chapter)} lacks canon`,
        );
      }
      if ((report.supersededTurnIds ?? []).includes(result.trace.runId)) {
        throw new Error(
          `Re-narration target ${resultKey(target.povId, target.chapter)} is superseded`,
        );
      }
      renarrationSources.push({
        result,
        sourceCanonicalHash: canonicalNarrationSourceHash(result),
        sourceChapterCapUsd: sourceResultChapterCap(report, result.povId, result.chapter),
      });
    }
    discardedResultCount += renarrate.length;
  }
  const attempts = [...report.attempts];
  const hasRuntimeEvidence =
    report.version === VERSION_8_REPORT_VERSION || report.version === REPORT_VERSION;
  const retainedResultKeys = new Set(
    retainedResults.map(({ chapter, povId }) => resultKey(povId, chapter)),
  );
  const supersededTurnIds = new Set(
    report.version === REPORT_VERSION
      ? [...(report.supersededTurnIds ?? []), ...(report.settledFailure?.turnIds ?? [])]
      : [],
  );
  if (hasRuntimeEvidence) {
    for (const { turn } of report.runtimeAttemptEvidence) {
      if (!retainedResultKeys.has(resultKey(turn.povId, turn.chapter))) {
        supersededTurnIds.add(turn.turnId);
      }
    }
    for (const { chapter, povId, turn } of report.narrativeCandidates) {
      if (!retainedResultKeys.has(resultKey(povId, chapter))) supersededTurnIds.add(turn.turnId);
    }
    for (const { chapter, povId, turn } of report.narrativeResponses) {
      if (!retainedResultKeys.has(resultKey(povId, chapter))) supersededTurnIds.add(turn.turnId);
    }
  }
  return {
    attempts,
    auditRejections: [...report.auditRejections],
    discardedResultCount,
    draftRejections: [...report.draftRejections],
    existingAttemptCostUsd: sum(attempts.map(({ costUsd }) => costUsd)),
    narrativeCandidates: hasRuntimeEvidence ? [...report.narrativeCandidates] : [],
    narrativeResponses: hasRuntimeEvidence ? [...report.narrativeResponses] : [],
    runtimeEvidenceStartAttemptIndex: hasRuntimeEvidence
      ? report.runtimeEvidenceStartAttemptIndex
      : report.attempts.length,
    runtimeAttemptEvidence: hasRuntimeEvidence ? [...report.runtimeAttemptEvidence] : [],
    pendingPovIds,
    renarrate: [...renarrate],
    renarrationSources,
    rerunFrom: [...rerunFrom],
    retainedPovIds,
    retainedResultCaps,
    retainedResults,
    supersededTurnIds: [...supersededTurnIds],
  };
}

function reportServiceTier(report: ResumableLiveReport): RuntimeServiceTier {
  return report.version === REPORT_VERSION ? report.serviceTier : "standard";
}

function sourceResultChapterCap(
  report: ResumableLiveReport,
  povId: CharacterId,
  chapter: number,
): number {
  if (report.version === LEGACY_REPORT_VERSION || report.version === VERSION_6_REPORT_VERSION) {
    return report.chapterCostCapUsd;
  }
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

export function assertRenarrationPlanFits(
  priorSpendUsd: number,
  existingAttemptCostUsd: number,
  targetCount: number,
  chapterCostCapUsd: number,
  totalCapUsd = TOTAL_CAP_USD,
): ReturnType<typeof assertPrompt1411FullMatrixFits> {
  if (!Number.isInteger(targetCount) || targetCount <= 0) {
    throw new Error("Re-narration cost preflight requires at least one exact target");
  }
  const projectedMatrixCostUsd = roundNanoUsd(targetCount * chapterCostCapUsd);
  const projectedFinalExposureUsd = roundNanoUsd(
    projectedCumulativeCostUsd(
      priorSpendUsd,
      existingAttemptCostUsd,
      targetCount,
      chapterCostCapUsd,
    ),
  );
  const headroomAfterProjectionUsd = roundNanoUsd(totalCapUsd - projectedFinalExposureUsd);
  if (headroomAfterProjectionUsd < 0) {
    throw new Error(
      `Re-narration plan exceeds the live cap by $${Math.abs(headroomAfterProjectionUsd).toFixed(9)}`,
    );
  }
  return { headroomAfterProjectionUsd, projectedFinalExposureUsd, projectedMatrixCostUsd };
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

export interface ResumeSource {
  readonly report: ResumableLiveReport;
  readonly sha256: string;
}

export function readLiveReport(path: string): ResumeSource {
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
  return { report: parseLiveReport(candidate), sha256: hashText(raw) };
}

export function parseLiveReport(candidate: unknown): ResumableLiveReport {
  const version9 = LiveReportSchema.safeParse(candidate);
  if (version9.success) return version9.data;
  const version8 = Version8LiveReportSchema.safeParse(candidate);
  if (version8.success) return version8.data;
  const version7 = Version7LiveReportSchema.safeParse(candidate);
  if (version7.success) return version7.data;
  const version6 = Version6LiveReportSchema.safeParse(candidate);
  if (version6.success) return version6.data;
  const version5 = LegacyLiveReportSchema.safeParse(candidate);
  if (version5.success) return version5.data;
  const details = [
    ...version9.error.issues,
    ...version8.error.issues,
    ...version7.error.issues,
    ...version6.error.issues,
    ...version5.error.issues,
  ]
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "report"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Resume report is not valid version 5, 6, 7, 8, or 9 data: ${details}`);
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
      checkpoint.serviceTier === reportServiceTier(report) &&
      checkpoint.sourceGitSha === report.sourceGitSha,
  );
  if (!registered) {
    throw new Error("Resume report is not present in the committed checkpoint registry");
  }
  for (const bridgeFile of registered.bridgeFiles) {
    const actualSha256 =
      currentFileHashes?.[bridgeFile.path] ?? hashFile(resolve(ROOT, bridgeFile.path));
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

export function parseRerunFrom(args: readonly string[]): RerunFrom[] {
  return parseChapterTargets(args, "--rerun-from");
}

export function parseRenarrate(args: readonly string[]): RerunFrom[] {
  return parseChapterTargets(args, "--renarrate");
}

function parseChapterTargets(
  args: readonly string[],
  flag: "--renarrate" | "--rerun-from",
): RerunFrom[] {
  const values: RerunFrom[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    const match = /^(.*):([12])$/u.exec(value);
    if (match === null) {
      throw new Error(`${flag} requires <pov-id>:<chapter 1 or 2>`);
    }
    const povId = match[1];
    const chapter = Number(match[2]) as 1 | 2;
    if (!CHARACTER_IDS.includes(povId as CharacterId)) {
      throw new Error(`Unknown ${flag} POV ${povId}`);
    }
    if (values.some((entry) => entry.povId === povId)) {
      throw new Error(`${flag} repeats ${povId}`);
    }
    values.push({ chapter, povId: povId as CharacterId });
    index += 1;
  }
  return values;
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

function roundNanoUsd(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
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

export function canonicalNarrationSourceHash(result: LiveResult): string {
  const canonical = result.canonicalNarrativeInput;
  if (canonical === undefined) {
    throw new Error(`Result ${resultKey(result.povId, result.chapter)} lacks canonical evidence`);
  }
  return hashJson({
    acceptedDelta: result.trace.acceptedDelta,
    adapterMode: result.adapterMode,
    allowedFactIds: canonical.allowedFactIds,
    chapter: result.chapter,
    chapterId: canonical.chapterRecord.id,
    fixtureId: result.trace.fixtureId,
    fixtureVersion: result.trace.fixtureVersion,
    forbiddenFacts: canonical.forbiddenFacts,
    frame: canonical.frame,
    intents: result.trace.intents,
    multiAgentOutputItems: result.trace.multiAgentOutputItems,
    playerAction: canonical.playerAction,
    povId: result.povId,
    safeContextHash: canonical.chapterRecord.safeContextHash,
    stateAfter: canonical.stateAfter,
    stateAfterHash: result.trace.stateAfterHash,
    stateBefore: canonical.stateBefore,
    stateBeforeHash: result.trace.stateBeforeHash,
    worldVersionAfter: canonical.worldVersionAfter,
    worldVersionBefore: canonical.worldVersionBefore,
  });
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
