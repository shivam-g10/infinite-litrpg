import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CHARACTER_IDS, RuntimeAttemptTraceSchema } from "@infinite-litrpg/shared";
import { z } from "zod";

import { ZERO_USAGE } from "../app/src/server/openai";
import {
  LiveSpendLedger,
  type InterruptedRunExpectation,
  type LiveSpendSnapshot,
} from "./live-spend-ledger";

const ROOT = process.cwd();
const TOTAL_CAP_USD = 3;
const CHECKPOINTS_PATH = resolve(ROOT, "evals", "interruption-checkpoints.json");
const LEDGER_PATH = resolve(ROOT, "evals", "reports", "live-spend-ledger.db");
const MONEY_EPSILON_USD = 0.000_000_1;
const NON_RUNTIME_BRIDGE_PATHS = new Set([
  "evals/interruption-checkpoints.json",
  "evals/live-spend-ledger.test.ts",
  "evals/reconcile-live-interruption.test.ts",
  "package.json",
]);

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const RuntimeModelSchema = z.enum(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
const TurnIdentitySchema = z
  .object({
    chapter: z.number().int().min(1).max(2),
    povId: z.enum(CHARACTER_IDS),
    requestId: z.string().uuid(),
    turnId: z.string().uuid(),
    worldVersionAfter: z.number().int().min(2),
    worldVersionBefore: z.number().int().min(1),
  })
  .strict()
  .superRefine((turn, context) => {
    if (turn.worldVersionAfter !== turn.worldVersionBefore + 1) {
      context.addIssue({ code: "custom", message: "Turn versions are not contiguous" });
    }
  });
const BridgeFileSchema = z
  .object({ path: z.string().min(1).max(1_000), sha256: Sha256Schema })
  .strict();
const KnownReservationSchema = z
  .object({
    actualCostUsd: z.number().positive().max(TOTAL_CAP_USD),
    agentId: z.string().min(1).max(240).nullable(),
    attempt: z.number().int().min(0).max(2),
    id: z.string().min(1).max(240),
    maximumCostUsd: z.number().positive().max(TOTAL_CAP_USD),
    model: RuntimeModelSchema,
  })
  .strict();
const UnknownReservationSchema = z
  .object({
    agentId: z.string().min(1).max(240).nullable(),
    attempt: z.number().int().min(0).max(2),
    id: z.string().min(1).max(240),
    maximumCostUsd: z.number().positive().max(TOTAL_CAP_USD),
    model: RuntimeModelSchema,
    phase: z.enum(["intent", "narration", "audit", "genesis", "recovery", "finale"]),
    turn: TurnIdentitySchema,
  })
  .strict();

export const InterruptionCheckpointSchema = z
  .object({
    baselineAttemptCostUsd: z.number().min(0).max(TOTAL_CAP_USD),
    bridgeFiles: z.array(BridgeFileSchema).max(20),
    expectedSidecar: z
      .object({
        attemptCount: z.number().int().min(0).max(1_000),
        candidateCount: z.number().int().min(0).max(500),
        narrativeResponseCount: z.number().int().min(0).max(500),
        promptVersion: z.string().min(1).max(240),
        reportVersion: z.number().int().min(1).max(100),
        runtimeAttemptEvidenceCount: z.number().int().min(0).max(1_000),
      })
      .strict(),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    knownReservations: z.array(KnownReservationSchema).max(1_000),
    priorSpendUsd: z.number().min(0).max(TOTAL_CAP_USD),
    receiptPath: z.string().min(1).max(1_000),
    runId: z.string().uuid(),
    sidecarPath: z.string().min(1).max(1_000),
    sidecarSha256: Sha256Schema,
    sourceGitSha: GitShaSchema,
    sourceReportSha256: z.string().regex(/^(?:[a-f0-9]{64}|fresh:[a-f0-9]{40})$/u),
    unknownReservations: z.array(UnknownReservationSchema).length(1),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const paths = [checkpoint.sidecarPath, checkpoint.receiptPath];
    for (const [index, path] of paths.entries()) {
      if (!isNormalizedRelativePath(path)) {
        context.addIssue({
          code: "custom",
          message: "Interruption evidence paths must be normalized repository-relative paths",
          path: [index === 0 ? "sidecarPath" : "receiptPath"],
        });
      }
    }
    const ids = [
      ...checkpoint.knownReservations.map(({ id }) => id),
      ...checkpoint.unknownReservations.map(({ id }) => id),
    ];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Reservation IDs must be unique" });
    }
    const bridgePaths = checkpoint.bridgeFiles.map(({ path }) => path);
    if (
      new Set(bridgePaths).size !== bridgePaths.length ||
      bridgePaths.some((path) => !isNormalizedRelativePath(path))
    ) {
      context.addIssue({ code: "custom", message: "Bridge paths must be unique and normalized" });
    }
  });

const InterruptionCheckpointRegistrySchema = z
  .object({
    checkpoints: z.array(InterruptionCheckpointSchema).min(1).max(100),
    version: z.literal(1),
  })
  .strict();

const SyntheticAttemptSchema = z
  .object({
    attempt: RuntimeAttemptTraceSchema,
    reservationId: z.string().min(1).max(240),
    turn: TurnIdentitySchema,
  })
  .strict();

const LiveSpendSnapshotSchema = z
  .object({
    activeReservationCount: z.number().int().min(0),
    baselineAttemptCostUsd: z.number().min(0),
    headroomUsd: z.number().min(0),
    knownReservationCostUsd: z.number().min(0),
    priorSpendUsd: z.number().min(0),
    sourceReportSha256: z.string().nullable(),
    totalCapUsd: z.number().positive(),
    totalExposureUsd: z.number().min(0),
    uncertainReservationCostUsd: z.number().min(0),
  })
  .strict();

export const InterruptionReceiptSchema = z
  .object({
    budgetLedger: LiveSpendSnapshotSchema,
    checkpointId: z.string().min(1).max(240),
    finishedAt: z.string().datetime(),
    knownAttemptCostUsd: z.number().min(0).max(TOTAL_CAP_USD),
    promptVersion: z.string().min(1).max(240),
    reconciliationGitSha: GitShaSchema,
    runId: z.string().uuid(),
    sidecarPath: z.string().min(1).max(1_000),
    sidecarSha256: Sha256Schema,
    sourceGitSha: GitShaSchema,
    syntheticAttempts: z.array(SyntheticAttemptSchema).length(1),
    totalExposureUsd: z.number().min(0).max(TOTAL_CAP_USD),
    unknownReservationCostUsd: z.number().positive().max(TOTAL_CAP_USD),
    version: z.literal(1),
  })
  .strict();

const MinimalSidecarSchema = z
  .object({
    attempts: z.array(z.object({ costUsd: z.number().min(0) }).passthrough()),
    candidates: z.array(
      z
        .object({
          narratorAttempt: z.number().int().min(0).max(2),
          rejectionStage: z.string().min(1),
          turn: TurnIdentitySchema,
        })
        .passthrough(),
    ),
    liveRunId: z.string().uuid(),
    narrativeResponses: z.array(z.unknown()),
    promptVersion: z.string().min(1).max(240),
    reportVersion: z.number().int().min(1).max(100),
    runtimeAttemptEvidence: z.array(z.unknown()),
    sourceGitSha: GitShaSchema,
  })
  .passthrough();

export interface VerifiedInterruptionEvidence {
  readonly knownAttemptCostUsd: number;
  readonly sidecarSha256: string;
  readonly syntheticAttempts: readonly z.infer<typeof SyntheticAttemptSchema>[];
}

export function verifyInterruptedSidecar(
  raw: string,
  checkpointInput: z.input<typeof InterruptionCheckpointSchema>,
): VerifiedInterruptionEvidence {
  const checkpoint = InterruptionCheckpointSchema.parse(checkpointInput);
  const sidecarSha256 = hashText(raw);
  if (sidecarSha256 !== checkpoint.sidecarSha256) {
    throw new Error("Interrupted sidecar hash does not match checkpoint");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Interrupted sidecar is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const sidecar = MinimalSidecarSchema.parse(parsedJson);
  if (sidecar.liveRunId !== checkpoint.runId) {
    throw new Error("Interrupted sidecar run ID does not match checkpoint");
  }
  if (sidecar.sourceGitSha !== checkpoint.sourceGitSha) {
    throw new Error("Interrupted sidecar Git SHA does not match checkpoint");
  }
  const expected = checkpoint.expectedSidecar;
  if (
    sidecar.promptVersion !== expected.promptVersion ||
    sidecar.reportVersion !== expected.reportVersion
  ) {
    throw new Error("Interrupted sidecar version does not match checkpoint");
  }
  if (
    sidecar.attempts.length !== expected.attemptCount ||
    sidecar.candidates.length !== expected.candidateCount ||
    sidecar.narrativeResponses.length !== expected.narrativeResponseCount ||
    sidecar.runtimeAttemptEvidence.length !== expected.runtimeAttemptEvidenceCount
  ) {
    throw new Error("Interrupted sidecar evidence counts do not match checkpoint");
  }
  const knownAttemptCostUsd = sum(sidecar.attempts.map(({ costUsd }) => costUsd));
  const expectedKnownCostUsd = sum(
    checkpoint.knownReservations.map(({ actualCostUsd }) => actualCostUsd),
  );
  if (!costsMatch(knownAttemptCostUsd, expectedKnownCostUsd)) {
    throw new Error("Interrupted sidecar attempts do not match known reservation cost");
  }
  const unknown = checkpoint.unknownReservations[0];
  const lastCandidate = sidecar.candidates.at(-1);
  if (
    unknown === undefined ||
    lastCandidate === undefined ||
    unknown.phase !== "narration" ||
    unknown.agentId !== null ||
    unknown.model !== "gpt-5.6-luna" ||
    unknown.attempt !== lastCandidate.narratorAttempt + 1 ||
    lastCandidate.rejectionStage !== "deterministic" ||
    JSON.stringify(unknown.turn) !== JSON.stringify(lastCandidate.turn)
  ) {
    throw new Error("Interrupted reservation retry shape does not match sidecar evidence");
  }
  return {
    knownAttemptCostUsd,
    sidecarSha256,
    syntheticAttempts: [
      SyntheticAttemptSchema.parse({
        attempt: {
          agentId: unknown.agentId,
          attempt: unknown.attempt,
          costUsd: unknown.maximumCostUsd,
          errorCode: "INTERRUPTED_UNKNOWN",
          latencyMs: 0,
          model: unknown.model,
          phase: unknown.phase,
          responseId: null,
          usage: ZERO_USAGE,
        },
        reservationId: unknown.id,
        turn: unknown.turn,
      }),
    ],
  };
}

export function buildInterruptionReceipt(
  checkpointInput: z.input<typeof InterruptionCheckpointSchema>,
  evidence: VerifiedInterruptionEvidence,
  reconciliationGitSha: string,
  ledgerSnapshot: LiveSpendSnapshot,
): z.infer<typeof InterruptionReceiptSchema> {
  const checkpoint = InterruptionCheckpointSchema.parse(checkpointInput);
  const unknownReservationCostUsd = sum(
    checkpoint.unknownReservations.map(({ maximumCostUsd }) => maximumCostUsd),
  );
  const expectedExposure =
    checkpoint.priorSpendUsd +
    checkpoint.baselineAttemptCostUsd +
    evidence.knownAttemptCostUsd +
    unknownReservationCostUsd;
  if (
    ledgerSnapshot.activeReservationCount !== 0 ||
    !costsMatch(ledgerSnapshot.priorSpendUsd, checkpoint.priorSpendUsd) ||
    !costsMatch(ledgerSnapshot.baselineAttemptCostUsd, checkpoint.baselineAttemptCostUsd) ||
    ledgerSnapshot.sourceReportSha256 !== checkpoint.sourceReportSha256 ||
    !costsMatch(ledgerSnapshot.knownReservationCostUsd, evidence.knownAttemptCostUsd) ||
    !costsMatch(ledgerSnapshot.uncertainReservationCostUsd, unknownReservationCostUsd) ||
    !costsMatch(ledgerSnapshot.totalExposureUsd, expectedExposure)
  ) {
    throw new Error("Reconciled ledger does not match interruption evidence");
  }
  return InterruptionReceiptSchema.parse({
    budgetLedger: ledgerSnapshot,
    checkpointId: checkpoint.id,
    finishedAt: new Date().toISOString(),
    knownAttemptCostUsd: evidence.knownAttemptCostUsd,
    promptVersion: checkpoint.expectedSidecar.promptVersion,
    reconciliationGitSha,
    runId: checkpoint.runId,
    sidecarPath: checkpoint.sidecarPath,
    sidecarSha256: evidence.sidecarSha256,
    sourceGitSha: checkpoint.sourceGitSha,
    syntheticAttempts: evidence.syntheticAttempts,
    totalExposureUsd: ledgerSnapshot.totalExposureUsd,
    unknownReservationCostUsd,
    version: 1,
  });
}

async function main(): Promise<void> {
  const checkpointId = parseRequiredFlag(process.argv.slice(2), "--checkpoint");
  assertCleanGitCheckpoint();
  const currentGitSha = gitOutput(["rev-parse", "HEAD"]);
  const registry = InterruptionCheckpointRegistrySchema.parse(
    JSON.parse(readFileSync(CHECKPOINTS_PATH, "utf8")) as unknown,
  );
  const checkpoint = registry.checkpoints.find(({ id }) => id === checkpointId);
  if (!checkpoint) throw new Error(`Unknown interruption checkpoint ${checkpointId}`);
  verifyRecoveryBridge(checkpoint, currentGitSha);
  const sidecarRaw = readFileSync(resolve(ROOT, checkpoint.sidecarPath), "utf8");
  const evidence = verifyInterruptedSidecar(sidecarRaw, checkpoint);
  const expectation: InterruptedRunExpectation = {
    baseline: {
      attemptCostUsd: checkpoint.baselineAttemptCostUsd,
      priorSpendUsd: checkpoint.priorSpendUsd,
      sourceReportSha256: checkpoint.sourceReportSha256,
    },
    knownReservations: checkpoint.knownReservations,
    unknownReservations: checkpoint.unknownReservations,
  };
  const ledger = new LiveSpendLedger(LEDGER_PATH, TOTAL_CAP_USD);
  let claimed = false;
  let released = false;
  try {
    ledger.claimInterruptedRunAtMaximum(checkpoint.runId, expectation);
    claimed = true;
    const receipt = buildInterruptionReceipt(
      checkpoint,
      evidence,
      currentGitSha,
      ledger.snapshot(),
    );
    const receiptPath = resolve(ROOT, checkpoint.receiptPath);
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeAtomicJson(receiptPath, receipt);
    const receiptRaw = readFileSync(receiptPath, "utf8");
    InterruptionReceiptSchema.parse(JSON.parse(receiptRaw) as unknown);
    ledger.releaseRun(checkpoint.runId);
    released = true;
    console.log(
      JSON.stringify(
        {
          headroomUsd: receipt.budgetLedger.headroomUsd,
          receiptPath: checkpoint.receiptPath,
          receiptSha256: hashText(receiptRaw),
          totalExposureUsd: receipt.totalExposureUsd,
          unknownReservationCostUsd: receipt.unknownReservationCostUsd,
        },
        null,
        2,
      ),
    );
  } finally {
    if (claimed && !released) {
      console.error(`interruption reconciliation lock retained by run ${checkpoint.runId}`);
    }
    ledger.close();
  }
}

function verifyRecoveryBridge(
  checkpoint: z.infer<typeof InterruptionCheckpointSchema>,
  currentGitSha: string,
): void {
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", checkpoint.sourceGitSha, currentGitSha],
    { cwd: ROOT, encoding: "utf8", windowsHide: true },
  );
  if (ancestor.status !== 0) {
    throw new Error("Interrupted source Git SHA is not an ancestor of reconciliation HEAD");
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
      throw new Error(`Unregistered interruption bridge path ${path}`);
    }
  }
  for (const [path, expectedHash] of bridgeByPath) {
    if (!changedPaths.includes(path)) {
      throw new Error(`Interruption bridge file ${path} is not changed from source`);
    }
    const actualHash = hashText(readFileSync(resolve(ROOT, path)));
    if (actualHash !== expectedHash) {
      throw new Error(`Interruption bridge file ${path} hash does not match checkpoint`);
    }
  }
}

function assertCleanGitCheckpoint(): void {
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"]);
  if (status.length > 0) throw new Error("Interruption reconciliation requires a clean commit");
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  }).trim();
}

function parseRequiredFlag(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function writeAtomicJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
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
