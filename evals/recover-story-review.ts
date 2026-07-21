import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  LiveSpendLedger,
  inspectLiveSpendRecovery,
  type LiveSpendSnapshot,
} from "./live-spend-ledger";
import { STORY_REVIEW_TOTAL_CAP_USD } from "./story-review";

const LEDGER_PATH = resolve(process.cwd(), "evals", "reports", "story-review-spend.db");

function main(): void {
  const runId = parseRunId(process.argv.slice(2));
  if (!existsSync(LEDGER_PATH)) throw new Error("Story-review spend ledger does not exist");
  const inspection = inspectLiveSpendRecovery(LEDGER_PATH, runId);
  const ledger = new LiveSpendLedger(LEDGER_PATH, STORY_REVIEW_TOTAL_CAP_USD);
  let snapshot: LiveSpendSnapshot;
  try {
    if (inspection.unknownReservations.length > 0) {
      ledger.claimInterruptedRunAtMaximum(runId, inspection);
    } else {
      const recoveredAttemptCostUsd = roundMoney(
        inspection.baseline.attemptCostUsd +
          inspection.knownReservations.reduce(
            (sum, reservation) => sum + reservation.actualCostUsd,
            0,
          ),
      );
      ledger.recoverStaleRun(runId, inspection.baseline, recoveredAttemptCostUsd);
    }
    ledger.releaseRun(runId);
    snapshot = ledger.snapshot();
  } finally {
    ledger.close();
  }
  console.log(
    JSON.stringify(
      {
        activeReservationCount: snapshot.activeReservationCount,
        providerRequests: 0,
        recoveredRunId: runId,
        totalExposureUsd: snapshot.totalExposureUsd,
        uncertainReservationCostUsd: snapshot.uncertainReservationCostUsd,
      },
      null,
      2,
    ),
  );
}

function parseRunId(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--run-id" || args[1] === undefined) {
    throw new Error("Usage: npm run review:stories:recover -- --run-id <uuid>");
  }
  if (!/^[a-f0-9-]{36}$/u.test(args[1])) throw new Error("Story-review run ID must be a UUID");
  return args[1];
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
