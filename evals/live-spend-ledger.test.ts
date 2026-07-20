import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { LiveSpendLedger } from "./live-spend-ledger";

const SOURCE_A = "a".repeat(64);
const SOURCE_B = "b".repeat(64);
const RECOVERY_BASELINE = {
  attemptCostUsd: 0.2,
  priorSpendUsd: 2.5,
  sourceReportSha256: SOURCE_A,
} as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("durable live spend ledger", () => {
  it("migrates a version-one ledger in place without changing exposure", () => {
    const filename = temporaryLedgerPath();
    createVersionOneLedger(filename);

    const migrated = new LiveSpendLedger(filename, 3);
    expect(migrated.snapshot()).toMatchObject({
      activeReservationCount: 0,
      knownReservationCostUsd: 0.010074,
      priorSpendUsd: 2.786385175,
      totalExposureUsd: 2.811082175,
      uncertainReservationCostUsd: 0.014623,
    });
    migrated.close();

    const database = new Database(filename, { readonly: true });
    try {
      expect(database.prepare("SELECT version FROM ledger_meta WHERE id = 1").get()).toEqual({
        version: 2,
      });
      expect(database.prepare("SELECT DISTINCT service_tier FROM reservations").all()).toEqual([
        { service_tier: "standard" },
      ]);
    } finally {
      database.close();
    }
  });

  it("keeps an in-flight reservation across process reopen", () => {
    const filename = temporaryLedgerPath();
    const runId = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(runId);
    first.synchronizeBaseline(runId, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    first.createCostHooks(runId).reserve(reservation("reservation-1", 0.1));
    expect(first.snapshot()).toMatchObject({
      activeReservationCount: 1,
      totalExposureUsd: 2.8,
    });
    first.close();

    const reopened = new LiveSpendLedger(filename, 3);
    expect(reopened.snapshot()).toMatchObject({
      activeReservationCount: 1,
      headroomUsd: 0.2,
      totalExposureUsd: 2.8,
    });
    expect(() => reopened.acquireRun(randomUUID())).toThrow("locked by run");
    reopened.close();
  });

  it("settles known usage to actual cost and preserves uncertain exposure", () => {
    const ledger = new LiveSpendLedger(temporaryLedgerPath(), 3);
    const runId = randomUUID();
    ledger.acquireRun(runId);
    ledger.synchronizeBaseline(runId, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = ledger.createCostHooks(runId);
    hooks.reserve(reservation("known-reservation", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-reservation" });
    hooks.reserve(reservation("uncertain-reservation", 0.05));
    hooks.markUncertain("uncertain-reservation");

    expect(ledger.snapshot()).toMatchObject({
      activeReservationCount: 0,
      knownReservationCostUsd: 0.04,
      totalExposureUsd: 2.79,
      uncertainReservationCostUsd: 0.05,
    });
    ledger.releaseRun(runId);
    ledger.close();
  });

  it("stores the requested service tier with every reservation", () => {
    const filename = temporaryLedgerPath();
    const ledger = new LiveSpendLedger(filename, 3);
    const runId = randomUUID();
    ledger.acquireRun(runId);
    ledger.synchronizeBaseline(runId, {
      attemptCostUsd: 0,
      priorSpendUsd: 0,
      sourceReportSha256: SOURCE_A,
    });
    ledger
      .createCostHooks(runId)
      .reserve({ ...reservation("flex-reservation", 0.05), serviceTier: "flex" });

    const database = new Database(filename);
    try {
      expect(
        database
          .prepare("SELECT service_tier FROM reservations WHERE id = ?")
          .get("flex-reservation"),
      ).toEqual({ service_tier: "flex" });
    } finally {
      database.close();
    }
    ledger.createCostHooks(runId).markUncertain("flex-reservation");
    ledger.releaseRun(runId);
    ledger.close();
  });

  it("atomically rejects concurrent exposure beyond the global cap", () => {
    const filename = temporaryLedgerPath();
    const runId = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    const second = new LiveSpendLedger(filename, 3);
    first.acquireRun(runId);
    first.synchronizeBaseline(runId, {
      attemptCostUsd: 0.05,
      priorSpendUsd: 2.9,
      sourceReportSha256: SOURCE_A,
    });
    first.createCostHooks(runId).reserve(reservation("first-reservation", 0.04));

    expect(() =>
      second.createCostHooks(runId).reserve(reservation("second-reservation", 0.02)),
    ).toThrow("Global live exposure");
    expect(first.snapshot().totalExposureUsd).toBe(2.99);
    first.createCostHooks(runId).markUncertain("first-reservation");
    first.releaseRun(runId);
    first.close();
    second.close();
  });

  it("records known usage even when it exceeds the conservative reservation", () => {
    const ledger = new LiveSpendLedger(temporaryLedgerPath(), 3);
    const runId = randomUUID();
    ledger.acquireRun(runId);
    ledger.synchronizeBaseline(runId, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = ledger.createCostHooks(runId);
    hooks.reserve(reservation("under-reserved", 0.01));
    hooks.settle({ actualCostUsd: 0.02, id: "under-reserved" });
    expect(ledger.snapshot()).toMatchObject({
      knownReservationCostUsd: 0.02,
      totalExposureUsd: 2.72,
    });
    ledger.releaseRun(runId);
    ledger.close();
  });

  it("folds a newer report baseline once and accepts an idempotent import", () => {
    const ledger = new LiveSpendLedger(temporaryLedgerPath(), 3);
    const firstRun = randomUUID();
    ledger.acquireRun(firstRun);
    ledger.synchronizeBaseline(firstRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = ledger.createCostHooks(firstRun);
    hooks.reserve(reservation("known-reservation", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-reservation" });
    ledger.releaseRun(firstRun);

    const secondRun = randomUUID();
    ledger.acquireRun(secondRun);
    ledger.synchronizeBaseline(secondRun, {
      attemptCostUsd: 0.24,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_B,
    });
    ledger.synchronizeBaseline(secondRun, {
      attemptCostUsd: 0.24,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_B,
    });
    expect(ledger.snapshot()).toMatchObject({
      baselineAttemptCostUsd: 0.24,
      knownReservationCostUsd: 0,
      sourceReportSha256: SOURCE_B,
      totalExposureUsd: 2.74,
    });
    ledger.releaseRun(secondRun);
    ledger.close();
  });

  it("folds exact global exposure into a fresh suite without reclaiming spend", () => {
    const ledger = new LiveSpendLedger(temporaryLedgerPath(), 3);
    const firstRun = randomUUID();
    ledger.acquireRun(firstRun);
    ledger.synchronizeBaseline(firstRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = ledger.createCostHooks(firstRun);
    hooks.reserve(reservation("known-reservation", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-reservation" });
    ledger.releaseRun(firstRun);

    const secondRun = randomUUID();
    ledger.acquireRun(secondRun);
    ledger.synchronizeBaseline(secondRun, {
      attemptCostUsd: 0,
      priorSpendUsd: 2.74,
      sourceReportSha256: "fresh:abcdef0",
    });
    expect(ledger.snapshot()).toMatchObject({
      baselineAttemptCostUsd: 0,
      priorSpendUsd: 2.74,
      totalExposureUsd: 2.74,
    });
    ledger.releaseRun(secondRun);
    ledger.close();
  });

  it("rejects a fresh suite that understates carried global exposure", () => {
    const ledger = new LiveSpendLedger(temporaryLedgerPath(), 3);
    const firstRun = randomUUID();
    ledger.acquireRun(firstRun);
    ledger.synchronizeBaseline(firstRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    ledger.releaseRun(firstRun);

    const secondRun = randomUUID();
    ledger.acquireRun(secondRun);
    expect(() =>
      ledger.synchronizeBaseline(secondRun, {
        attemptCostUsd: 0,
        priorSpendUsd: 2.69,
        sourceReportSha256: "fresh:abcdef0",
      }),
    ).toThrow("do not reconcile");
    ledger.releaseRun(secondRun);
    ledger.close();
  });

  it("rejects a report that omits settled provider exposure", () => {
    const ledger = new LiveSpendLedger(temporaryLedgerPath(), 3);
    const firstRun = randomUUID();
    ledger.acquireRun(firstRun);
    ledger.synchronizeBaseline(firstRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = ledger.createCostHooks(firstRun);
    hooks.reserve(reservation("known-reservation", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-reservation" });
    ledger.releaseRun(firstRun);

    const secondRun = randomUUID();
    ledger.acquireRun(secondRun);
    expect(() =>
      ledger.synchronizeBaseline(secondRun, {
        attemptCostUsd: 0.2,
        priorSpendUsd: 2.5,
        sourceReportSha256: SOURCE_B,
      }),
    ).toThrow("do not reconcile");
    ledger.releaseRun(secondRun);
    ledger.close();
  });

  it("recovers a dead zero-active lock and reconciles a checkpointed report", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = first.createCostHooks(staleRun);
    hooks.reserve(reservation("known-before-crash", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-before-crash" });
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    recovered.recoverStaleRun(staleRun, RECOVERY_BASELINE, 0.24);
    recovered.synchronizeBaseline(staleRun, {
      attemptCostUsd: 0.24,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_B,
    });
    expect(recovered.snapshot()).toMatchObject({
      baselineAttemptCostUsd: 0.24,
      totalExposureUsd: 2.74,
    });
    recovered.releaseRun(staleRun);
    recovered.close();
  });

  it("verifies recovered sidecar spend without folding or reclaiming it", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = first.createCostHooks(staleRun);
    hooks.reserve(reservation("known-before-sidecar", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-before-sidecar" });
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    recovered.recoverStaleRun(staleRun, RECOVERY_BASELINE, 0.24);
    expect(recovered.snapshot()).toMatchObject({
      baselineAttemptCostUsd: 0.2,
      knownReservationCostUsd: 0.04,
      sourceReportSha256: SOURCE_A,
      totalExposureUsd: 2.74,
    });
    recovered.releaseRun(staleRun);

    const resumedRun = randomUUID();
    recovered.acquireRun(resumedRun);
    recovered.synchronizeBaseline(resumedRun, {
      attemptCostUsd: 0.24,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_B,
    });
    recovered.synchronizeBaseline(resumedRun, {
      attemptCostUsd: 0.24,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_B,
    });
    expect(recovered.snapshot()).toMatchObject({
      baselineAttemptCostUsd: 0.24,
      knownReservationCostUsd: 0,
      sourceReportSha256: SOURCE_B,
      totalExposureUsd: 2.74,
    });
    recovered.releaseRun(resumedRun);
    recovered.close();
  });

  it("reclaims an exact released settled run only while its report commits", () => {
    const filename = temporaryLedgerPath();
    const settledRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(settledRun);
    first.synchronizeBaseline(settledRun, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(settledRun);
    hooks.reserve(reservation("known-before-report-failure", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-before-report-failure" });
    first.releaseRun(settledRun);
    first.close();

    const reconciler = new LiveSpendLedger(filename, 3);
    expect(
      reconciler.claimSettledRunForReport(settledRun, {
        baseline: RECOVERY_BASELINE,
        knownReservations: [expectedKnownReservation("known-before-report-failure", 0.1, 0.04)],
      }),
    ).toMatchObject({
      activeReservationCount: 0,
      baselineAttemptCostUsd: 0.2,
      knownReservationCostUsd: 0.04,
      totalExposureUsd: 2.74,
    });
    expect(() => reconciler.acquireRun(randomUUID())).toThrow("locked by run");
    reconciler.releaseRun(settledRun);
    reconciler.close();
  });

  it("finishes an authenticated settled report after a crash and stays idempotent", () => {
    const filename = temporaryLedgerPath();
    const settledRun = randomUUID();
    const expectation = {
      baseline: RECOVERY_BASELINE,
      knownReservations: [expectedKnownReservation("known-before-crash", 0.1, 0.04)],
    };
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(settledRun);
    first.synchronizeBaseline(settledRun, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(settledRun);
    hooks.reserve(reservation("known-before-crash", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-before-crash" });
    first.releaseRun(settledRun);
    first.claimSettledRunForReport(settledRun, expectation);
    first.close();
    markOwnerProcessDead(filename);

    const retry = new LiveSpendLedger(filename, 3);
    expect(retry.claimSettledRunForReport(settledRun, expectation)).toMatchObject({
      activeReservationCount: 0,
      knownReservationCostUsd: 0.04,
      totalExposureUsd: 2.74,
    });
    expect(retry.completeSettledRunAfterReport(settledRun, expectation)).toMatchObject({
      activeReservationCount: 0,
      knownReservationCostUsd: 0.04,
      totalExposureUsd: 2.74,
    });
    expect(retry.completeSettledRunAfterReport(settledRun, expectation)).toMatchObject({
      totalExposureUsd: 2.74,
    });
    const proofRun = randomUUID();
    retry.acquireRun(proofRun);
    retry.releaseRun(proofRun);
    retry.close();
  });

  it("does not reclaim a live or mismatched settled-report lock", () => {
    const filename = temporaryLedgerPath();
    const settledRun = randomUUID();
    const exact = {
      baseline: RECOVERY_BASELINE,
      knownReservations: [expectedKnownReservation("known-for-report-lock", 0.1, 0.04)],
    } as const;
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(settledRun);
    first.synchronizeBaseline(settledRun, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(settledRun);
    hooks.reserve(reservation("known-for-report-lock", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-for-report-lock" });
    first.releaseRun(settledRun);
    first.claimSettledRunForReport(settledRun, exact);
    expect(() => first.claimSettledRunForReport(settledRun, exact)).toThrow("running owner");
    first.close();
    markOwnerProcessDead(filename);

    const retry = new LiveSpendLedger(filename, 3);
    expect(() =>
      retry.claimSettledRunForReport(settledRun, {
        ...exact,
        knownReservations: [expectedKnownReservation("known-for-report-lock", 0.1, 0.03)],
      }),
    ).toThrow("do not exactly match");
    expect(() => retry.acquireRun(randomUUID())).toThrow(`locked by run ${settledRun}`);
    retry.claimSettledRunForReport(settledRun, exact);
    retry.completeSettledRunAfterReport(settledRun, exact);
    retry.close();
  });

  it("releases a dead run only after its committed report snapshot matches exactly", () => {
    const filename = temporaryLedgerPath();
    const runId = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(runId);
    first.synchronizeBaseline(runId, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(runId);
    hooks.reserve(reservation("known-in-committed-report", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-in-committed-report" });
    hooks.reserve(reservation("uncertain-in-committed-report", 0.05));
    hooks.markUncertain("uncertain-in-committed-report");
    const committedSnapshot = first.snapshot();
    expect(() => first.completeRunAfterCommittedReport(runId, committedSnapshot, 1, 1)).toThrow(
      "running owner",
    );
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    expect(recovered.completeRunAfterCommittedReport(runId, committedSnapshot, 1, 1)).toStrictEqual(
      committedSnapshot,
    );
    expect(recovered.completeRunAfterCommittedReport(runId, committedSnapshot, 1, 1)).toStrictEqual(
      committedSnapshot,
    );
    const proofRun = randomUUID();
    recovered.acquireRun(proofRun);
    recovered.releaseRun(proofRun);
    recovered.close();
  });

  it("keeps a dead committed-report lock on snapshot or reservation-owner mismatch", () => {
    const filename = temporaryLedgerPath();
    const runId = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(runId);
    first.synchronizeBaseline(runId, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(runId);
    hooks.reserve(reservation("known-before-committed-report-check", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-before-committed-report-check" });
    const committedSnapshot = first.snapshot();
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    expect(() =>
      recovered.completeRunAfterCommittedReport(
        runId,
        {
          ...committedSnapshot,
          knownReservationCostUsd: 0.03,
        },
        1,
        0,
      ),
    ).toThrow("snapshot does not exactly match");
    expect(() => recovered.completeRunAfterCommittedReport(runId, committedSnapshot, 0, 0)).toThrow(
      "known reservation count",
    );
    expect(() => recovered.completeRunAfterCommittedReport(runId, committedSnapshot, 1, 1)).toThrow(
      "uncertain reservation count",
    );
    recovered.close();
    setReservationOwner(filename, "known-before-committed-report-check", randomUUID());

    const wrongOwner = new LiveSpendLedger(filename, 3);
    expect(() =>
      wrongOwner.completeRunAfterCommittedReport(runId, committedSnapshot, 1, 0),
    ).toThrow("another run");
    expect(() => wrongOwner.acquireRun(randomUUID())).toThrow(`locked by run ${runId}`);
    wrongOwner.close();
  });

  it("rejects mismatched settled evidence without taking the ledger lock", () => {
    const filename = temporaryLedgerPath();
    const settledRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(settledRun);
    first.synchronizeBaseline(settledRun, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(settledRun);
    hooks.reserve(reservation("known-settled-mismatch", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-settled-mismatch" });
    first.releaseRun(settledRun);
    first.close();

    const reconciler = new LiveSpendLedger(filename, 3);
    expect(() =>
      reconciler.claimSettledRunForReport(settledRun, {
        baseline: RECOVERY_BASELINE,
        knownReservations: [expectedKnownReservation("known-settled-mismatch", 0.1, 0.03)],
      }),
    ).toThrow("do not exactly match");
    const proofRun = randomUUID();
    reconciler.acquireRun(proofRun);
    reconciler.releaseRun(proofRun);
    reconciler.close();
  });

  it("rejects recovered totals that omit or invent settled spend", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = first.createCostHooks(staleRun);
    hooks.reserve(reservation("known-before-invalid-sidecar", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-before-invalid-sidecar" });
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    expect(() => recovered.recoverStaleRun(staleRun, RECOVERY_BASELINE, 0.2)).toThrow(
      "does not reconcile",
    );
    expect(() => recovered.recoverStaleRun(staleRun, RECOVERY_BASELINE, 0.25)).toThrow(
      "does not reconcile",
    );
    expect(recovered.snapshot()).toMatchObject({
      baselineAttemptCostUsd: 0.2,
      knownReservationCostUsd: 0.04,
      totalExposureUsd: 2.74,
    });
    recovered.recoverStaleRun(staleRun, RECOVERY_BASELINE, 0.24);
    recovered.releaseRun(staleRun);
    recovered.close();
  });

  it("blocks stale takeover for a live owner, wrong ID, or active provider request", () => {
    const liveFilename = temporaryLedgerPath();
    const liveRun = randomUUID();
    const live = new LiveSpendLedger(liveFilename, 3);
    live.acquireRun(liveRun);
    expect(() => live.recoverStaleRun(liveRun, RECOVERY_BASELINE, 0.2)).toThrow("running owner");
    expect(() => live.recoverStaleRun(randomUUID(), RECOVERY_BASELINE, 0.2)).toThrow(
      "does not match",
    );
    live.close();

    const activeFilename = temporaryLedgerPath();
    const activeRun = randomUUID();
    const active = new LiveSpendLedger(activeFilename, 3);
    active.acquireRun(activeRun);
    active.synchronizeBaseline(activeRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    active.createCostHooks(activeRun).reserve(reservation("active-before-crash", 0.05));
    active.close();
    markOwnerProcessDead(activeFilename);

    const blocked = new LiveSpendLedger(activeFilename, 3);
    expect(() => blocked.recoverStaleRun(activeRun, RECOVERY_BASELINE, 0.2)).toThrow(
      "external reconciliation",
    );
    blocked.close();
  });

  it("claims an exact dead interruption and charges active requests at full reserve", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(staleRun);
    hooks.reserve(reservation("known-before-interruption", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-before-interruption" });
    hooks.reserve(reservation("unknown-at-interruption", 0.05));
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    recovered.claimInterruptedRunAtMaximum(staleRun, {
      baseline: RECOVERY_BASELINE,
      knownReservations: [expectedKnownReservation("known-before-interruption", 0.1, 0.04)],
      unknownReservations: [expectedUnknownReservation("unknown-at-interruption", 0.05)],
    });
    expect(recovered.snapshot()).toMatchObject({
      activeReservationCount: 0,
      knownReservationCostUsd: 0.04,
      totalExposureUsd: 2.79,
      uncertainReservationCostUsd: 0.05,
    });
    recovered.releaseRun(staleRun);
    recovered.close();
  });

  it("reconciles an interrupted Flex reservation without coercing it to Standard", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, RECOVERY_BASELINE);
    first
      .createCostHooks(staleRun)
      .reserve({ ...reservation("unknown-flex-interruption", 0.05), serviceTier: "flex" });
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    recovered.claimInterruptedRunAtMaximum(staleRun, {
      baseline: RECOVERY_BASELINE,
      knownReservations: [],
      unknownReservations: [
        { ...expectedUnknownReservation("unknown-flex-interruption", 0.05), serviceTier: "flex" },
      ],
    });
    expect(recovered.snapshot()).toMatchObject({
      activeReservationCount: 0,
      totalExposureUsd: 2.75,
      uncertainReservationCostUsd: 0.05,
    });
    recovered.releaseRun(staleRun);
    recovered.close();
  });

  it("reclaims an already charged interruption only after the replacement owner dies", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, RECOVERY_BASELINE);
    first
      .createCostHooks(staleRun)
      .reserve(reservation("unknown-before-reconciliation-crash", 0.05));
    first.close();
    markOwnerProcessDead(filename);
    const expectation = {
      baseline: RECOVERY_BASELINE,
      knownReservations: [],
      unknownReservations: [
        expectedUnknownReservation("unknown-before-reconciliation-crash", 0.05),
      ],
    } as const;

    const interruptedReconciler = new LiveSpendLedger(filename, 3);
    interruptedReconciler.claimInterruptedRunAtMaximum(staleRun, expectation);
    expect(interruptedReconciler.snapshot().uncertainReservationCostUsd).toBe(0.05);
    interruptedReconciler.close();
    markOwnerProcessDead(filename);

    const retry = new LiveSpendLedger(filename, 3);
    retry.claimInterruptedRunAtMaximum(staleRun, expectation);
    expect(retry.snapshot()).toMatchObject({
      activeReservationCount: 0,
      totalExposureUsd: 2.75,
      uncertainReservationCostUsd: 0.05,
    });
    retry.releaseRun(staleRun);
    retry.close();
  });

  it("rejects interruption reservations owned by another run", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, RECOVERY_BASELINE);
    first.createCostHooks(staleRun).reserve(reservation("wrong-owner-before-reconciliation", 0.05));
    first.close();
    markOwnerProcessDead(filename);
    setReservationOwner(filename, "wrong-owner-before-reconciliation", randomUUID());

    const recovered = new LiveSpendLedger(filename, 3);
    expect(() =>
      recovered.claimInterruptedRunAtMaximum(staleRun, {
        baseline: RECOVERY_BASELINE,
        knownReservations: [],
        unknownReservations: [
          expectedUnknownReservation("wrong-owner-before-reconciliation", 0.05),
        ],
      }),
    ).toThrow("do not exactly match");
    expect(recovered.snapshot()).toMatchObject({
      activeReservationCount: 1,
      totalExposureUsd: 2.75,
      uncertainReservationCostUsd: 0,
    });
    recovered.close();
  });

  it("rejects live, incomplete, or mismatched interruption claims without mutation", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, RECOVERY_BASELINE);
    const hooks = first.createCostHooks(staleRun);
    hooks.reserve(reservation("known-for-claim", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "known-for-claim" });
    hooks.reserve(reservation("unknown-for-claim", 0.05));

    const exact = {
      baseline: RECOVERY_BASELINE,
      knownReservations: [expectedKnownReservation("known-for-claim", 0.1, 0.04)],
      unknownReservations: [expectedUnknownReservation("unknown-for-claim", 0.05)],
    } as const;
    expect(() => first.claimInterruptedRunAtMaximum(staleRun, exact)).toThrow("running owner");
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    expect(() => recovered.claimInterruptedRunAtMaximum(randomUUID(), exact)).toThrow(
      "does not match",
    );
    expect(() =>
      recovered.claimInterruptedRunAtMaximum(staleRun, {
        ...exact,
        unknownReservations: [],
      }),
    ).toThrow("requires an unknown reservation");
    expect(() =>
      recovered.claimInterruptedRunAtMaximum(staleRun, {
        ...exact,
        unknownReservations: [expectedUnknownReservation("unknown-for-claim", 0.04)],
      }),
    ).toThrow("do not exactly match");
    expect(recovered.snapshot()).toMatchObject({
      activeReservationCount: 1,
      knownReservationCostUsd: 0.04,
      totalExposureUsd: 2.79,
      uncertainReservationCostUsd: 0,
    });
    recovered.claimInterruptedRunAtMaximum(staleRun, exact);
    recovered.releaseRun(staleRun);
    recovered.close();
  });

  it("keeps the stale lock when the source report omitted settled exposure", () => {
    const filename = temporaryLedgerPath();
    const staleRun = randomUUID();
    const first = new LiveSpendLedger(filename, 3);
    first.acquireRun(staleRun);
    first.synchronizeBaseline(staleRun, {
      attemptCostUsd: 0.2,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_A,
    });
    const hooks = first.createCostHooks(staleRun);
    hooks.reserve(reservation("unreported-before-crash", 0.1));
    hooks.settle({ actualCostUsd: 0.04, id: "unreported-before-crash" });
    first.close();
    markOwnerProcessDead(filename);

    const recovered = new LiveSpendLedger(filename, 3);
    expect(() => recovered.recoverStaleRun(staleRun, RECOVERY_BASELINE, 0.2)).toThrow(
      "does not reconcile",
    );
    recovered.recoverStaleRun(staleRun, RECOVERY_BASELINE, 0.24);
    recovered.releaseRun(staleRun);
    recovered.close();
  });
});

function temporaryLedgerPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "infinite-litrpg-ledger-"));
  temporaryDirectories.push(directory);
  return join(directory, "ledger.db");
}

function reservation(id: string, maximumCostUsd: number) {
  return {
    agentId: null,
    attempt: 0,
    id,
    maximumCostUsd,
    model: "gpt-5.6-terra" as const,
    serviceTier: "standard" as const,
  };
}

function expectedKnownReservation(id: string, maximumCostUsd: number, actualCostUsd: number) {
  return {
    actualCostUsd,
    agentId: null,
    attempt: 0,
    id,
    maximumCostUsd,
    model: "gpt-5.6-terra" as const,
  };
}

function expectedUnknownReservation(id: string, maximumCostUsd: number) {
  return {
    agentId: null,
    attempt: 0,
    id,
    maximumCostUsd,
    model: "gpt-5.6-terra" as const,
  };
}

function markOwnerProcessDead(filename: string): void {
  const database = new Database(filename);
  try {
    database.prepare("UPDATE run_lock SET pid = ? WHERE id = 1").run(2_147_483_646);
  } finally {
    database.close();
  }
}

function setReservationOwner(filename: string, reservationId: string, runId: string): void {
  const database = new Database(filename);
  try {
    database.prepare("UPDATE reservations SET run_id = ? WHERE id = ?").run(runId, reservationId);
  } finally {
    database.close();
  }
}

function createVersionOneLedger(filename: string): void {
  const database = new Database(filename);
  try {
    database.exec(`
      CREATE TABLE ledger_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        total_cap_nano INTEGER NOT NULL,
        prior_spend_nano INTEGER,
        baseline_attempt_nano INTEGER NOT NULL,
        source_report_sha256 TEXT
      );
      CREATE TABLE run_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        run_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        started_at TEXT NOT NULL
      );
      CREATE TABLE reservations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        agent_id TEXT,
        attempt INTEGER NOT NULL,
        model TEXT NOT NULL,
        max_nano INTEGER NOT NULL,
        actual_nano INTEGER,
        status TEXT NOT NULL CHECK (status IN ('active', 'known', 'uncertain')),
        created_at TEXT NOT NULL,
        settled_at TEXT
      );
    `);
    database
      .prepare(
        `INSERT INTO ledger_meta (
           id, version, total_cap_nano, prior_spend_nano, baseline_attempt_nano,
           source_report_sha256
         ) VALUES (1, 1, 3000000000, 2786385175, 0, ?)`,
      )
      .run(`fresh:${"a".repeat(40)}`);
    const insert = database.prepare(
      `INSERT INTO reservations (
         id, run_id, agent_id, attempt, model, max_nano, actual_nano, status,
         created_at, settled_at
       ) VALUES (?, ?, NULL, 0, 'gpt-5.6-luna', ?, ?, ?, ?, ?)`,
    );
    insert.run("known-v1", randomUUID(), 20_000_000, 10_074_000, "known", "now", "now");
    insert.run("uncertain-v1", randomUUID(), 14_623_000, null, "uncertain", "now", "now");
  } finally {
    database.close();
  }
}
