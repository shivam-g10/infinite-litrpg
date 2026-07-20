import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { CHARACTER_IDS, RuntimeServiceTierSchema } from "@infinite-litrpg/shared";
import { z } from "zod";

import { pricingVersionForServiceTier } from "../app/src/server/openai/usage";
import {
  LiveSpendLedger,
  type InterruptedKnownReservation,
  type LiveSpendSnapshot,
} from "./live-spend-ledger";
import { assertPrompt1411FullMatrixFits } from "./live-cost-projection";
import {
  LiveReportSchema,
  assertRegisteredResumeCheckpoint,
  assertResumeHarnessPaths,
  buildLiveReport,
  isAppendOnlyEvidence,
  parseLiveReport,
  prepareResume,
  projectedCumulativeCostUsd,
  readNarrativeEvidenceSidecar,
  writeAtomicJson,
  type LiveReport,
  type ResumeSource,
  type ResumeVerification,
  type RerunFrom,
} from "./run-live";

const ROOT = process.cwd();
const TOTAL_CAP_USD = 3;
const CHECKPOINTS_PATH = resolve(ROOT, "evals", "settled-run-checkpoints.json");
const RESUME_CHECKPOINTS_PATH = resolve(ROOT, "evals", "resume-checkpoints.json");
const LEDGER_PATH = resolve(ROOT, "evals", "reports", "live-spend-ledger.db");
const MONEY_EPSILON_USD = 0.000_000_1;
const NON_RUNTIME_BRIDGE_PATHS = new Set([
  "decisions/ADR-017-settled-live-run-reconciliation.md",
  "docs/PLAN.md",
  "docs/STATUS.md",
  "evals/README.md",
  "evals/live-spend-ledger.test.ts",
  "evals/reconcile-settled-live-run.test.ts",
  "evals/resume-checkpoints.json",
  "evals/run-live.test.ts",
  "evals/settled-run-checkpoints.json",
  "package.json",
  "shared/src/engine/narrative.test.ts",
]);

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const PovIdSchema = z.enum(CHARACTER_IDS);
const RuntimeModelSchema = z.enum(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
const PhaseSchema = z.enum(["intent", "narration", "audit", "genesis", "recovery", "finale"]);
const BridgeFileSchema = z
  .object({ path: z.string().min(1).max(1_000), sha256: Sha256Schema })
  .strict();
const RerunFromSchema = z
  .object({ chapter: z.union([z.literal(1), z.literal(2)]), povId: PovIdSchema })
  .strict();
const SettledReservationSchema = z
  .object({
    actualCostUsd: z.number().positive().max(TOTAL_CAP_USD),
    agentId: z.string().min(1).max(240).nullable(),
    attempt: z.number().int().min(0).max(2),
    id: z.string().uuid(),
    maximumCostUsd: z.number().positive().max(TOTAL_CAP_USD),
    model: RuntimeModelSchema,
    phase: PhaseSchema,
    serviceTier: RuntimeServiceTierSchema,
  })
  .strict();

export const SettledRunCheckpointSchema = z
  .object({
    baselineAttemptCostUsd: z.number().min(0).max(TOTAL_CAP_USD),
    bridgeFiles: z.array(BridgeFileSchema).min(1).max(20),
    expectedSidecar: z
      .object({
        attemptCount: z.number().int().min(1).max(1_000),
        candidateCount: z.number().int().min(1).max(100),
        narrativeResponseCount: z.number().int().min(1).max(500),
        runtimeAttemptEvidenceCount: z.number().int().min(1).max(1_000),
        runtimeEvidenceStartAttemptIndex: z.number().int().min(0).max(1_000),
      })
      .strict(),
    expectedSourceReport: z
      .object({
        attemptCount: z.number().int().min(1).max(1_000),
        candidateCount: z.number().int().min(1).max(100),
        narrativeResponseCount: z.number().int().min(1).max(500),
        resultCount: z
          .number()
          .int()
          .min(1)
          .max(CHARACTER_IDS.length * 2),
        runtimeAttemptEvidenceCount: z.number().int().min(1).max(1_000),
      })
      .strict(),
    failureMessage: z.string().min(1).max(1_000),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    knownReservations: z.array(SettledReservationSchema).min(1).max(100),
    outputReportPath: z.string().min(1).max(1_000),
    pricingVersion: z.string().min(1).max(240),
    priorSpendUsd: z.number().min(0).max(TOTAL_CAP_USD),
    promptVersion: z.string().min(1).max(240),
    rerunFrom: z.array(RerunFromSchema).min(1).max(CHARACTER_IDS.length),
    runId: z.string().uuid(),
    runtimeSchemaVersion: z.string().min(1).max(240),
    serviceTier: RuntimeServiceTierSchema,
    sidecarPath: z.string().min(1).max(1_000),
    sidecarSha256: Sha256Schema,
    sourceGitSha: GitShaSchema,
    sourceReportPath: z.string().min(1).max(1_000),
    sourceReportSha256: Sha256Schema,
    startedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const paths = [
      checkpoint.sidecarPath,
      checkpoint.sourceReportPath,
      checkpoint.outputReportPath,
    ];
    if (paths.some((path) => !isNormalizedRelativePath(path))) {
      context.addIssue({ code: "custom", message: "Settled evidence paths must be normalized" });
    }
    if (
      checkpoint.pricingVersion !== pricingVersionForServiceTier(checkpoint.serviceTier) ||
      checkpoint.knownReservations.some(({ serviceTier }) => serviceTier !== checkpoint.serviceTier)
    ) {
      context.addIssue({ code: "custom", message: "Settled service-tier evidence disagrees" });
    }
    if (
      new Set(checkpoint.knownReservations.map(({ id }) => id)).size !==
      checkpoint.knownReservations.length
    ) {
      context.addIssue({ code: "custom", message: "Settled reservation IDs repeat" });
    }
    if (
      new Set(checkpoint.rerunFrom.map(({ povId }) => povId)).size !== checkpoint.rerunFrom.length
    ) {
      context.addIssue({ code: "custom", message: "Settled rerun POVs repeat" });
    }
    const bridgePaths = checkpoint.bridgeFiles.map(({ path }) => path);
    if (
      new Set(bridgePaths).size !== bridgePaths.length ||
      bridgePaths.some((path) => !isNormalizedRelativePath(path))
    ) {
      context.addIssue({ code: "custom", message: "Settled bridge paths are invalid" });
    }
  });

export const SettledRunCheckpointRegistrySchema = z
  .object({
    checkpoints: z.array(SettledRunCheckpointSchema).min(1).max(20),
    version: z.literal(1),
  })
  .strict()
  .superRefine(({ checkpoints }, context) => {
    const ids = new Set<string>();
    const runIds = new Set<string>();
    const outputPaths = new Set<string>();
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (
        ids.has(checkpoint.id) ||
        runIds.has(checkpoint.runId) ||
        outputPaths.has(checkpoint.outputReportPath)
      ) {
        context.addIssue({
          code: "custom",
          message: "Settled checkpoint IDs, run IDs, and output paths must be unique",
          path: ["checkpoints", index],
        });
      }
      ids.add(checkpoint.id);
      runIds.add(checkpoint.runId);
      outputPaths.add(checkpoint.outputReportPath);
    }
  });

type SettledRunCheckpoint = z.infer<typeof SettledRunCheckpointSchema>;

export function verifySettledAttemptExtension(
  sourceAttempts: readonly LiveReport["attempts"][number][],
  extendedAttempts: readonly LiveReport["attempts"][number][],
  expectedReservations: readonly z.infer<typeof SettledReservationSchema>[],
): number {
  if (!isAppendOnlyEvidence(sourceAttempts, extendedAttempts)) {
    throw new Error("Settled attempts are not an append-only source extension");
  }
  const addedAttempts = extendedAttempts.slice(sourceAttempts.length);
  if (addedAttempts.length !== expectedReservations.length) {
    throw new Error("Settled attempt count does not match registered reservations");
  }
  const actualSignatures = addedAttempts.map(attemptSignature).sort();
  const expectedSignatures = expectedReservations.map(reservationSignature).sort();
  if (!isDeepStrictEqual(actualSignatures, expectedSignatures)) {
    throw new Error("Settled attempts do not match registered reservation evidence");
  }
  return sum(addedAttempts.map(({ costUsd }) => costUsd));
}

export function verifySettledArtifacts(
  checkpoint: SettledRunCheckpoint,
  source: ResumeSource,
  sidecar: ReturnType<typeof readNarrativeEvidenceSidecar>,
): void {
  if (
    source.report.version !== 9 ||
    source.sha256 !== checkpoint.sourceReportSha256 ||
    !costsMatch(source.report.totalCostUsd, checkpoint.baselineAttemptCostUsd)
  ) {
    throw new Error("Settled source report does not match registered baseline");
  }
  const expectedSource = checkpoint.expectedSourceReport;
  if (
    source.report.attempts.length !== expectedSource.attemptCount ||
    source.report.narrativeCandidates.length !== expectedSource.candidateCount ||
    source.report.narrativeResponses.length !== expectedSource.narrativeResponseCount ||
    source.report.results.length !== expectedSource.resultCount ||
    source.report.runtimeAttemptEvidence.length !== expectedSource.runtimeAttemptEvidenceCount
  ) {
    throw new Error("Settled source report evidence counts do not match checkpoint");
  }
  const expectedSidecar = checkpoint.expectedSidecar;
  if (
    sidecar.attempts.length !== expectedSidecar.attemptCount ||
    sidecar.candidates.length !== expectedSidecar.candidateCount ||
    sidecar.narrativeResponses.length !== expectedSidecar.narrativeResponseCount ||
    sidecar.runtimeAttemptEvidence.length !== expectedSidecar.runtimeAttemptEvidenceCount ||
    sidecar.runtimeEvidenceStartAttemptIndex !== expectedSidecar.runtimeEvidenceStartAttemptIndex ||
    sidecar.promptVersion !== checkpoint.promptVersion ||
    sidecar.runtimeSchemaVersion !== checkpoint.runtimeSchemaVersion ||
    sidecar.liveRunId !== checkpoint.runId ||
    sidecar.sourceGitSha !== checkpoint.sourceGitSha
  ) {
    throw new Error("Settled sidecar identity or evidence counts do not match checkpoint");
  }
  if (
    !isAppendOnlyEvidence(source.report.narrativeCandidates, sidecar.candidates) ||
    !isAppendOnlyEvidence(source.report.narrativeResponses, sidecar.narrativeResponses) ||
    !isAppendOnlyEvidence(source.report.runtimeAttemptEvidence, sidecar.runtimeAttemptEvidence) ||
    source.report.runtimeEvidenceStartAttemptIndex !== sidecar.runtimeEvidenceStartAttemptIndex
  ) {
    throw new Error("Settled sidecar is not an append-only source evidence extension");
  }
  const newAttemptCostUsd = verifySettledAttemptExtension(
    source.report.attempts,
    sidecar.attempts,
    checkpoint.knownReservations,
  );
  const expectedNewCostUsd = sum(
    checkpoint.knownReservations.map(({ actualCostUsd }) => actualCostUsd),
  );
  if (
    !costsMatch(newAttemptCostUsd, expectedNewCostUsd) ||
    !costsMatch(
      sum(sidecar.attempts.map(({ costUsd }) => costUsd)),
      checkpoint.baselineAttemptCostUsd + expectedNewCostUsd,
    )
  ) {
    throw new Error("Settled sidecar cost does not match durable reservations");
  }
}

type SettledSourceNarrativeEvidence = Pick<
  LiveReport,
  "narrativeCandidates" | "narrativeResponses" | "results" | "runtimeAttemptEvidence"
>;

type SettledSidecarNarrativeEvidence = {
  readonly candidates: LiveReport["narrativeCandidates"];
  readonly narrativeResponses: LiveReport["narrativeResponses"];
  readonly runtimeAttemptEvidence: LiveReport["runtimeAttemptEvidence"];
};

export function deriveSettledSupersededTurnIds(
  source: SettledSourceNarrativeEvidence,
  sidecar: SettledSidecarNarrativeEvidence,
  rerunFrom: readonly RerunFrom[],
): string[] {
  if (
    !isAppendOnlyEvidence(source.narrativeCandidates, sidecar.candidates) ||
    !isAppendOnlyEvidence(source.narrativeResponses, sidecar.narrativeResponses) ||
    !isAppendOnlyEvidence(source.runtimeAttemptEvidence, sidecar.runtimeAttemptEvidence)
  ) {
    throw new Error("Settled narrative evidence is not append-only");
  }
  const sourceTurnIds = new Set([
    ...source.narrativeCandidates.map(({ turn }) => turn.turnId),
    ...source.narrativeResponses.map(({ turn }) => turn.turnId),
    ...source.runtimeAttemptEvidence.map(({ turn }) => turn.turnId),
  ]);
  const appendedTurns = [
    ...sidecar.candidates.slice(source.narrativeCandidates.length).map(({ turn }) => turn),
    ...sidecar.narrativeResponses.slice(source.narrativeResponses.length).map(({ turn }) => turn),
    ...sidecar.runtimeAttemptEvidence
      .slice(source.runtimeAttemptEvidence.length)
      .map(({ turn }) => turn),
  ];
  const sidecarOnlyTurns = new Map<string, (typeof appendedTurns)[number]>();
  for (const turn of appendedTurns) {
    if (sourceTurnIds.has(turn.turnId)) {
      throw new Error("Settled appended evidence reuses a committed source turn");
    }
    const existing = sidecarOnlyTurns.get(turn.turnId);
    if (existing !== undefined && !isDeepStrictEqual(existing, turn)) {
      throw new Error("Settled sidecar turn identity is inconsistent");
    }
    sidecarOnlyTurns.set(turn.turnId, turn);
  }
  if (sidecarOnlyTurns.size !== 1) {
    throw new Error("Settled sidecar must contain exactly one uncommitted turn");
  }
  const [uncommittedTurn] = sidecarOnlyTurns.values();
  if (
    uncommittedTurn === undefined ||
    !rerunFrom.some(
      ({ chapter, povId }) =>
        chapter === uncommittedTurn.chapter && povId === uncommittedTurn.povId,
    )
  ) {
    throw new Error("Settled sidecar turn does not match a registered rerun target");
  }
  if (source.results.some(({ trace }) => trace.runId === uncommittedTurn.turnId)) {
    throw new Error("Settled sidecar turn was already committed by the source report");
  }
  return [uncommittedTurn.turnId];
}

async function main(): Promise<void> {
  const checkpointId = parseRequiredFlag(process.argv.slice(2), "--checkpoint");
  assertCleanGitCheckpoint();
  const currentGitSha = gitOutput(["rev-parse", "HEAD"]);
  const registry = SettledRunCheckpointRegistrySchema.parse(
    JSON.parse(readFileSync(CHECKPOINTS_PATH, "utf8")) as unknown,
  );
  const checkpoint = registry.checkpoints.find(({ id }) => id === checkpointId);
  if (!checkpoint) throw new Error(`Unknown settled run checkpoint ${checkpointId}`);
  verifyRecoveryBridge(checkpoint, currentGitSha);
  const outputReportPath = resolve(ROOT, checkpoint.outputReportPath);

  const sourceReportPath = resolve(ROOT, checkpoint.sourceReportPath);
  const sourceRaw = readFileSync(sourceReportPath, "utf8");
  const source: ResumeSource = {
    report: parseLiveReport(JSON.parse(sourceRaw) as unknown),
    sha256: hashText(sourceRaw),
  };
  const sidecarPath = resolve(ROOT, checkpoint.sidecarPath);
  const sidecarRaw = readFileSync(sidecarPath, "utf8");
  if (hashText(sidecarRaw) !== checkpoint.sidecarSha256) {
    throw new Error("Settled sidecar hash does not match checkpoint");
  }
  const sidecar = readNarrativeEvidenceSidecar(
    sidecarPath,
    checkpoint.runId,
    checkpoint.sourceGitSha,
    checkpoint.serviceTier,
    checkpoint.pricingVersion,
  );
  verifySettledArtifacts(checkpoint, source, sidecar);
  const resumeVerification = authenticateOriginalResume(source, checkpoint.sourceGitSha);
  const resumeRequirements = {
    adapterMode: "sequential" as const,
    chapterCostCapUsd: source.report.chapterCostCapUsd,
    priorSpendUsd: checkpoint.priorSpendUsd,
    promptVersion: checkpoint.promptVersion,
    serviceTier: checkpoint.serviceTier,
    sourceGitSha: source.report.sourceGitSha,
  };
  const attemptedResumePreparation = prepareResume(
    source.report,
    resumeRequirements,
    checkpoint.rerunFrom as RerunFrom[],
  );
  if (
    !isAppendOnlyEvidence(attemptedResumePreparation.attempts, sidecar.attempts) ||
    !isAppendOnlyEvidence(attemptedResumePreparation.narrativeCandidates, sidecar.candidates) ||
    !isAppendOnlyEvidence(
      attemptedResumePreparation.narrativeResponses,
      sidecar.narrativeResponses,
    ) ||
    !isAppendOnlyEvidence(
      attemptedResumePreparation.runtimeAttemptEvidence,
      sidecar.runtimeAttemptEvidence,
    )
  ) {
    throw new Error("Settled sidecar diverges from prepared selective resume evidence");
  }
  const canonicalResumePreparation = prepareResume(source.report, resumeRequirements, []);
  const supersededTurnIds = deriveSettledSupersededTurnIds(
    source.report as LiveReport,
    sidecar,
    checkpoint.rerunFrom as RerunFrom[],
  );
  const resumePreparation = canonicalResumePreparation;

  const ledger = new LiveSpendLedger(LEDGER_PATH, TOTAL_CAP_USD);
  const ledgerExpectation = {
    baseline: {
      attemptCostUsd: checkpoint.baselineAttemptCostUsd,
      priorSpendUsd: checkpoint.priorSpendUsd,
      sourceReportSha256: checkpoint.sourceReportSha256,
    },
    knownReservations: checkpoint.knownReservations.map(toLedgerReservation),
  };
  let claimed = false;
  let reportCommitted = false;
  try {
    if (existsSync(outputReportPath)) {
      const writtenRaw = readFileSync(outputReportPath, "utf8");
      const writtenReport = LiveReportSchema.parse(JSON.parse(writtenRaw) as unknown);
      const expectedReport = materializeFailureReport(
        checkpoint,
        source,
        sidecar,
        resumePreparation,
        resumeVerification,
        ledger.snapshot(),
        supersededTurnIds,
      );
      assertEquivalentSettledReport(writtenReport, expectedReport);
      ledger.completeSettledRunAfterReport(checkpoint.runId, ledgerExpectation);
      reportCommitted = true;
      printSettledReport(checkpoint.outputReportPath, writtenRaw, writtenReport);
      return;
    }
    const ledgerSnapshot = ledger.claimSettledRunForReport(checkpoint.runId, ledgerExpectation);
    claimed = true;
    const report = materializeFailureReport(
      checkpoint,
      source,
      sidecar,
      resumePreparation,
      resumeVerification,
      ledgerSnapshot,
      supersededTurnIds,
    );
    writeAtomicJson(outputReportPath, report);
    const writtenRaw = readFileSync(outputReportPath, "utf8");
    const writtenReport = LiveReportSchema.parse(JSON.parse(writtenRaw) as unknown);
    reportCommitted = true;
    ledger.completeSettledRunAfterReport(checkpoint.runId, ledgerExpectation);
    claimed = false;
    printSettledReport(checkpoint.outputReportPath, writtenRaw, writtenReport);
  } finally {
    if (claimed) {
      console.error(
        `settled reconciliation lock retained by run ${checkpoint.runId}; reportCommitted=${reportCommitted}`,
      );
    }
    ledger.close();
  }
}

export function assertEquivalentSettledReport(existing: LiveReport, expected: LiveReport): void {
  const { finishedAt: existingFinishedAt, ...existingStable } = existing;
  const { finishedAt: expectedFinishedAt, ...expectedStable } = expected;
  if (
    existingFinishedAt.length === 0 ||
    expectedFinishedAt.length === 0 ||
    !isDeepStrictEqual(existingStable, expectedStable)
  ) {
    throw new Error("Existing settled report does not match authenticated checkpoint evidence");
  }
}

function printSettledReport(path: string, raw: string, report: LiveReport): void {
  console.log(
    JSON.stringify(
      {
        headroomUsd: report.budgetLedger.headroomUsd,
        outputReportPath: path,
        outputReportSha256: hashText(raw),
        retainedResultCount: report.results.length,
        totalCostUsd: report.totalCostUsd,
        totalExposureUsd: report.cumulativeCostUsd,
      },
      null,
      2,
    ),
  );
}

export function materializeFailureReport(
  checkpoint: SettledRunCheckpoint,
  source: ResumeSource,
  sidecar: ReturnType<typeof readNarrativeEvidenceSidecar>,
  resumePreparation: ReturnType<typeof prepareResume>,
  resumeVerification: ResumeVerification,
  ledgerSnapshot: LiveSpendSnapshot,
  settledTurnIds: string[],
): LiveReport {
  if (source.report.version !== 9) {
    throw new Error("Settled materialization requires a version 9 source report");
  }
  const sourceReport = source.report;
  const newCandidates = sidecar.candidates.slice(sourceReport.narrativeCandidates.length);
  const draftRejections = [
    ...resumePreparation.draftRejections,
    ...newCandidates
      .filter(({ deterministicIssues }) => deterministicIssues.length > 0)
      .map(({ deterministicIssues, povId }) => ({ issues: deterministicIssues, povId })),
  ];
  const pendingChapterCount = CHARACTER_IDS.length * 2 - resumePreparation.retainedResults.length;
  return buildLiveReport(new Error(checkpoint.failureMessage), ledgerSnapshot, {
    adapterMode: "sequential",
    apiKey: "never-match-settled-reconciliation",
    attempts: sidecar.attempts,
    auditRejections: resumePreparation.auditRejections,
    chapterCostCapUsd: sourceReport.chapterCostCapUsd,
    cleanPathProjection: assertPrompt1411FullMatrixFits(
      checkpoint.priorSpendUsd,
      checkpoint.serviceTier,
      TOTAL_CAP_USD,
    ),
    draftRejections,
    existingAttemptCostUsd: resumePreparation.existingAttemptCostUsd,
    narrativeCandidates: sidecar.candidates,
    narrativeResponses: sidecar.narrativeResponses,
    nativeRequested: false,
    povFilter: null,
    pricingVersion: checkpoint.pricingVersion,
    priorSpendUsd: checkpoint.priorSpendUsd,
    projectedMaximumCumulativeCostUsd: projectedCumulativeCostUsd(
      checkpoint.priorSpendUsd,
      resumePreparation.existingAttemptCostUsd,
      pendingChapterCount,
      sourceReport.chapterCostCapUsd,
    ),
    resultChapterCaps: resumePreparation.retainedResultCaps,
    results: resumePreparation.retainedResults,
    resumePreparation,
    resumeReport: sourceReport,
    resumeReportPath: resolve(ROOT, checkpoint.sourceReportPath),
    resumeSource: source,
    resumeVerification,
    runtimeAttemptEvidence: sidecar.runtimeAttemptEvidence,
    runtimeEvidenceStartAttemptIndex: sidecar.runtimeEvidenceStartAttemptIndex,
    serviceTier: checkpoint.serviceTier,
    settledFailure: {
      checkpointId: checkpoint.id,
      rerunFrom: checkpoint.rerunFrom,
      runId: checkpoint.runId,
      sidecarSha256: checkpoint.sidecarSha256,
      turnIds: settledTurnIds,
    },
    sourceGitSha: checkpoint.sourceGitSha,
    startedAt: checkpoint.startedAt,
    suite: "full",
    supersededTurnIds: resumePreparation.supersededTurnIds,
  });
}

export function authenticateOriginalResume(
  source: ResumeSource,
  runtimeSourceGitSha: string,
): ResumeVerification {
  const registry = JSON.parse(readFileSync(RESUME_CHECKPOINTS_PATH, "utf8")) as {
    checkpoints?: { bridgeFiles?: { path: string }[]; reportSha256?: string }[];
  };
  const entry = registry.checkpoints?.find(({ reportSha256 }) => reportSha256 === source.sha256);
  if (!entry?.bridgeFiles) {
    throw new Error("Settled source report has no registered resume checkpoint");
  }
  const historicalHashes = Object.fromEntries(
    entry.bridgeFiles.map(({ path }) => [path, hashGitFile(runtimeSourceGitSha, path)]),
  );
  const bridgeFiles = assertRegisteredResumeCheckpoint(
    source.report,
    source.sha256,
    registry,
    historicalHashes,
  );
  const changedPaths = gitOutput([
    "diff",
    "--name-only",
    `${source.report.sourceGitSha}..${runtimeSourceGitSha}`,
  ])
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
  assertResumeHarnessPaths(
    changedPaths,
    bridgeFiles.map(({ path }) => path),
  );
  return { bridgeFiles, changedPaths };
}

function verifyRecoveryBridge(checkpoint: SettledRunCheckpoint, currentGitSha: string): void {
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", checkpoint.sourceGitSha, currentGitSha],
    { cwd: ROOT, encoding: "utf8", windowsHide: true },
  );
  if (ancestor.status !== 0) {
    throw new Error("Settled runtime Git SHA is not an ancestor of reconciliation HEAD");
  }
  const bridgeByPath = new Map(checkpoint.bridgeFiles.map((file) => [file.path, file.sha256]));
  const changedPaths = gitOutput([
    "diff",
    "--name-only",
    `${checkpoint.sourceGitSha}..${currentGitSha}`,
  ])
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
  for (const path of changedPaths) {
    if (!NON_RUNTIME_BRIDGE_PATHS.has(path) && !bridgeByPath.has(path)) {
      throw new Error(`Unregistered settled-run bridge path ${path}`);
    }
  }
  for (const [path, expectedHash] of bridgeByPath) {
    if (!changedPaths.includes(path)) {
      throw new Error(`Settled-run bridge file ${path} is not changed from runtime source`);
    }
    if (hashText(readFileSync(resolve(ROOT, path))) !== expectedHash) {
      throw new Error(`Settled-run bridge file ${path} hash does not match checkpoint`);
    }
  }
}

function toLedgerReservation(
  reservation: z.infer<typeof SettledReservationSchema>,
): InterruptedKnownReservation {
  return {
    actualCostUsd: reservation.actualCostUsd,
    agentId: reservation.agentId,
    attempt: reservation.attempt,
    id: reservation.id,
    maximumCostUsd: reservation.maximumCostUsd,
    model: reservation.model,
    serviceTier: reservation.serviceTier,
  };
}

function attemptSignature(attempt: LiveReport["attempts"][number]): string {
  return JSON.stringify({
    actualCostUsd: attempt.costUsd,
    agentId: attempt.agentId,
    attempt: attempt.attempt,
    model: attempt.model,
    phase: attempt.phase,
    serviceTier: attempt.requestedServiceTier,
  });
}

function reservationSignature(reservation: z.infer<typeof SettledReservationSchema>): string {
  return JSON.stringify({
    actualCostUsd: reservation.actualCostUsd,
    agentId: reservation.agentId,
    attempt: reservation.attempt,
    model: reservation.model,
    phase: reservation.phase,
    serviceTier: reservation.serviceTier,
  });
}

function hashGitFile(gitSha: string, path: string): string {
  return hashText(
    execFileSync("git", ["show", `${gitSha}:${path}`], {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    }),
  );
}

function assertCleanGitCheckpoint(): void {
  if (gitOutput(["status", "--porcelain", "--untracked-files=all"]).length > 0) {
    throw new Error("Settled reconciliation requires a clean committed checkpoint");
  }
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  }).trim();
}

function parseRequiredFlag(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function isNormalizedRelativePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized === path &&
    !normalized.startsWith("/") &&
    !normalized.split("/").includes("..") &&
    !/^[a-zA-Z]:/u.test(normalized)
  );
}

function hashText(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function costsMatch(left: number, right: number): boolean {
  return Math.abs(left - right) < MONEY_EPSILON_USD;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
