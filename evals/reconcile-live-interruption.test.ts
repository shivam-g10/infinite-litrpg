import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  InterruptionCheckpointSchema,
  InterruptionReceiptSchema,
  buildInterruptionReceipt,
  verifyInterruptedSidecar,
} from "./reconcile-live-interruption";

const SOURCE_GIT_SHA = "7afba1db77e37b19a714963257e067f335caf0c9";
const RUN_ID = "b6da387e-11b3-4159-ba87-af73cfbb1d7d";
const TURN = {
  chapter: 1,
  povId: "rowan-ashborn",
  requestId: "47de63e1-3c2c-4690-9619-ea8e6d13eae4",
  turnId: "3b0650b5-5fda-407e-b2fe-672e1af5c392",
  worldVersionAfter: 2,
  worldVersionBefore: 1,
} as const;

describe("live interruption reconciliation", () => {
  it("authenticates an exact sidecar and creates a null-response maximum-cost attempt", () => {
    const raw = sidecarText();
    const checkpoint = checkpointFor(raw);
    const evidence = verifyInterruptedSidecar(raw, checkpoint);

    expect(evidence.syntheticAttempts).toEqual([
      {
        attempt: {
          agentId: null,
          attempt: 1,
          costUsd: 0.014623,
          errorCode: "INTERRUPTED_UNKNOWN",
          latencyMs: 0,
          model: "gpt-5.6-luna",
          phase: "narration",
          responseId: null,
          usage: {
            cacheWriteTokens: 0,
            cachedInputTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
          },
        },
        reservationId: "unknown-reservation",
        turn: TURN,
      },
    ]);
    expect(evidence.knownAttemptCostUsd).toBe(0.010074);
  });

  it("rejects changed sidecars, run IDs, evidence counts, and retry shape", () => {
    const raw = sidecarText();
    const checkpoint = checkpointFor(raw);
    expect(() => verifyInterruptedSidecar(`${raw} `, checkpoint)).toThrow("hash");
    const wrongRunRaw = JSON.stringify({ ...JSON.parse(raw), liveRunId: randomUUID() });
    expect(() => verifyInterruptedSidecar(wrongRunRaw, checkpointFor(wrongRunRaw))).toThrow(
      "run ID",
    );
    expect(() =>
      verifyInterruptedSidecar(raw, {
        ...checkpoint,
        expectedSidecar: { ...checkpoint.expectedSidecar, attemptCount: 4 },
      }),
    ).toThrow("counts");
    expect(() =>
      verifyInterruptedSidecar(raw, {
        ...checkpoint,
        unknownReservations: [{ ...checkpoint.unknownReservations[0]!, attempt: 2 }],
      }),
    ).toThrow("retry shape");
  });

  it("builds a strict receipt that includes full conservative exposure", () => {
    const raw = sidecarText();
    const checkpoint = checkpointFor(raw);
    const evidence = verifyInterruptedSidecar(raw, checkpoint);
    const receipt = buildInterruptionReceipt(checkpoint, evidence, SOURCE_GIT_SHA, {
      activeReservationCount: 0,
      baselineAttemptCostUsd: 0,
      headroomUsd: 0.188917825,
      knownReservationCostUsd: 0.010074,
      priorSpendUsd: 2.786385175,
      sourceReportSha256: `fresh:${SOURCE_GIT_SHA}`,
      totalCapUsd: 3,
      totalExposureUsd: 2.811082175,
      uncertainReservationCostUsd: 0.014623,
    });

    expect(InterruptionReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt.totalExposureUsd).toBe(2.811082175);
    expect(InterruptionReceiptSchema.safeParse({ ...receipt, unexpected: true }).success).toBe(
      false,
    );
  });
});

function checkpointFor(raw: string) {
  return InterruptionCheckpointSchema.parse({
    baselineAttemptCostUsd: 0,
    bridgeFiles: [],
    expectedSidecar: {
      attemptCount: 3,
      candidateCount: 1,
      narrativeResponseCount: 1,
      promptVersion: "1.4.11",
      reportVersion: 8,
      runtimeAttemptEvidenceCount: 3,
    },
    id: "prompt-1-4-11-interrupted-1",
    knownReservations: [
      {
        actualCostUsd: 0.010074,
        agentId: null,
        attempt: 0,
        id: "known-reservation",
        maximumCostUsd: 0.02,
        model: "gpt-5.6-luna",
      },
    ],
    priorSpendUsd: 2.786385175,
    receiptPath: "evals/reports/live-interruption-prompt-1.4.11-1.json",
    runId: RUN_ID,
    sidecarPath: "evals/reports/live-full-sequential.narrative-candidates.json",
    sidecarSha256: createHash("sha256").update(raw).digest("hex"),
    sourceGitSha: SOURCE_GIT_SHA,
    sourceReportSha256: `fresh:${SOURCE_GIT_SHA}`,
    unknownReservations: [
      {
        agentId: null,
        attempt: 1,
        id: "unknown-reservation",
        maximumCostUsd: 0.014623,
        model: "gpt-5.6-luna",
        phase: "narration",
        turn: TURN,
      },
    ],
  });
}

function sidecarText(): string {
  return JSON.stringify({
    attempts: [{ costUsd: 0.001755 }, { costUsd: 0.001365 }, { costUsd: 0.006954 }],
    candidates: [
      {
        narratorAttempt: 0,
        rejectionStage: "deterministic",
        turn: TURN,
      },
    ],
    liveRunId: RUN_ID,
    narrativeResponses: [{}],
    promptVersion: "1.4.11",
    reportVersion: 8,
    runtimeAttemptEvidence: [{}, {}, {}],
    sourceGitSha: SOURCE_GIT_SHA,
  });
}
