import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { LiveSpendLedger } from "./live-spend-ledger";

const SOURCE_A = "a".repeat(64);
const SOURCE_B = "b".repeat(64);

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("durable live spend ledger", () => {
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
    const newRun = randomUUID();
    recovered.recoverStaleRun(staleRun, newRun);
    recovered.synchronizeBaseline(newRun, {
      attemptCostUsd: 0.24,
      priorSpendUsd: 2.5,
      sourceReportSha256: SOURCE_B,
    });
    expect(recovered.snapshot()).toMatchObject({
      baselineAttemptCostUsd: 0.24,
      totalExposureUsd: 2.74,
    });
    recovered.releaseRun(newRun);
    recovered.close();
  });

  it("blocks stale takeover for a live owner, wrong ID, or active provider request", () => {
    const liveFilename = temporaryLedgerPath();
    const liveRun = randomUUID();
    const live = new LiveSpendLedger(liveFilename, 3);
    live.acquireRun(liveRun);
    expect(() => live.recoverStaleRun(liveRun, randomUUID())).toThrow("running owner");
    expect(() => live.recoverStaleRun(randomUUID(), randomUUID())).toThrow("does not match");
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
    expect(() => blocked.recoverStaleRun(activeRun, randomUUID())).toThrow(
      "external reconciliation",
    );
    blocked.close();
  });

  it("blocks a recovered run when the source report omitted settled exposure", () => {
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
    const newRun = randomUUID();
    recovered.recoverStaleRun(staleRun, newRun);
    expect(() =>
      recovered.synchronizeBaseline(newRun, {
        attemptCostUsd: 0.2,
        priorSpendUsd: 2.5,
        sourceReportSha256: SOURCE_A,
      }),
    ).toThrow("do not reconcile");
    recovered.releaseRun(newRun);
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
