import Database from "better-sqlite3";

import { OpenAIRuntimeError, type RuntimeCostHooks } from "../app/src/server/openai";
import type { RuntimeModel } from "../app/src/server/openai/models";
import type { RuntimeServiceTier } from "@infinite-litrpg/shared";

const LEDGER_VERSION = 2;
const NANO_USD = 1_000_000_000;
export const LIVE_SPEND_ORIGINAL_TOTAL_CAP_USD = 3 as const;
export const LIVE_SPEND_EXTENDED_TOTAL_CAP_USD = 3.021 as const;
const ORIGINAL_TOTAL_CAP_NANO = 3_000_000_000;
const EXTENDED_TOTAL_CAP_NANO = 3_021_000_000;

export interface LiveSpendBaseline {
  readonly attemptCostUsd: number;
  readonly priorSpendUsd: number;
  readonly sourceReportSha256: string;
}

export interface LiveSpendSnapshot {
  readonly activeReservationCount: number;
  readonly baselineAttemptCostUsd: number;
  readonly headroomUsd: number;
  readonly knownReservationCostUsd: number;
  readonly priorSpendUsd: number;
  readonly sourceReportSha256: string | null;
  readonly totalCapUsd: number;
  readonly totalExposureUsd: number;
  readonly uncertainReservationCostUsd: number;
}

export interface LiveSpendCapPreflight {
  readonly baselineAttemptCostUsd: number;
  readonly currentTotalCapUsd: number;
  readonly knownReservationCostUsd: number;
  readonly migrationRequired: boolean;
  readonly priorSpendUsd: number;
  readonly projectedHeadroomUsd: number;
  readonly requestedTotalCapUsd: number;
  readonly sourceReportSha256: string | null;
  readonly totalExposureUsd: number;
  readonly uncertainReservationCostUsd: number;
}

export interface LiveSpendCapPreflightOptions {
  readonly allowedLockedRunId?: string;
}

interface MetaRow {
  readonly baseline_attempt_nano: number;
  readonly prior_spend_nano: number | null;
  readonly source_report_sha256: string | null;
  readonly total_cap_nano: number;
  readonly version: number;
}

interface RunLockRow {
  readonly pid: number;
  readonly run_id: string;
}

interface ReservationRow {
  readonly actual_nano: number | null;
  readonly max_nano: number;
  readonly run_id: string;
  readonly status: "active" | "known" | "uncertain";
}

interface ReservationAuditRow extends ReservationRow {
  readonly agent_id: string | null;
  readonly attempt: number;
  readonly id: string;
  readonly model: RuntimeModel;
  readonly service_tier: RuntimeServiceTier;
}

export interface InterruptedKnownReservation {
  readonly actualCostUsd: number;
  readonly agentId: string | null;
  readonly attempt: number;
  readonly id: string;
  readonly maximumCostUsd: number;
  readonly model: RuntimeModel;
  readonly serviceTier?: RuntimeServiceTier;
}

export interface InterruptedUnknownReservation {
  readonly agentId: string | null;
  readonly attempt: number;
  readonly id: string;
  readonly maximumCostUsd: number;
  readonly model: RuntimeModel;
  readonly serviceTier?: RuntimeServiceTier;
}

export interface InterruptedRunExpectation {
  readonly baseline: LiveSpendBaseline;
  readonly knownReservations: readonly InterruptedKnownReservation[];
  readonly unknownReservations: readonly InterruptedUnknownReservation[];
}

export interface SettledRunExpectation {
  readonly baseline: LiveSpendBaseline;
  readonly knownReservations: readonly InterruptedKnownReservation[];
}

interface SumRow {
  readonly value: number;
}

export class LiveSpendLedger {
  private readonly db: Database.Database;

  constructor(filename: string, totalCapUsd: number) {
    const totalCapNano = usdToNano(totalCapUsd, "total cap");
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        total_cap_nano INTEGER NOT NULL,
        prior_spend_nano INTEGER,
        baseline_attempt_nano INTEGER NOT NULL,
        source_report_sha256 TEXT
      );
      CREATE TABLE IF NOT EXISTS run_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        run_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        started_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        agent_id TEXT,
        attempt INTEGER NOT NULL,
        model TEXT NOT NULL,
        service_tier TEXT NOT NULL CHECK (service_tier IN ('standard', 'flex')),
        max_nano INTEGER NOT NULL,
        actual_nano INTEGER,
        status TEXT NOT NULL CHECK (status IN ('active', 'known', 'uncertain')),
        created_at TEXT NOT NULL,
        settled_at TEXT
      );
    `);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ledger_meta (
           id, version, total_cap_nano, prior_spend_nano, baseline_attempt_nano,
           source_report_sha256
         ) VALUES (1, ?, ?, NULL, 0, NULL)`,
      )
      .run(LEDGER_VERSION, totalCapNano);
    let meta = this.readMeta();
    if (meta.version === 1) {
      this.migrateVersionOneLedger();
      meta = this.readMeta();
    }
    if (meta.total_cap_nano > totalCapNano) {
      this.db.close();
      throw new Error("Live spend ledger total cap cannot decrease");
    }
    if (meta.total_cap_nano < totalCapNano) {
      this.db.close();
      throw new Error("Live spend ledger requires an explicit cap increase");
    }
    if (meta.version !== LEDGER_VERSION || meta.total_cap_nano !== totalCapNano) {
      this.db.close();
      throw new Error("Live spend ledger version or total cap does not match this runner");
    }
  }

  acquireRun(runId: string): void {
    validateRunId(runId);
    const transaction = this.db.transaction(() => {
      const existing = this.readRunLock();
      if (existing) {
        throw new Error(`Live spend ledger is locked by run ${existing.run_id}`);
      }
      this.db
        .prepare("INSERT INTO run_lock (id, run_id, pid, started_at) VALUES (1, ?, ?, ?)")
        .run(runId, process.pid, new Date().toISOString());
    });
    transaction.immediate();
  }

  acquireRunWithBaseline(runId: string, baseline: LiveSpendBaseline): void {
    validateRunId(runId);
    validateShaOrFreshId(baseline.sourceReportSha256);
    const priorSpendNano = usdToNano(baseline.priorSpendUsd, "prior spend");
    const attemptCostNano = usdToNano(baseline.attemptCostUsd, "attempt cost");
    const transaction = this.db.transaction(() => {
      const existing = this.readRunLock();
      if (existing) {
        throw new Error(`Live spend ledger is locked by run ${existing.run_id}`);
      }
      const meta = this.readMeta();
      if (
        meta.prior_spend_nano !== null ||
        meta.baseline_attempt_nano !== 0 ||
        meta.source_report_sha256 !== null ||
        this.countAllReservations() !== 0
      ) {
        throw new Error("Atomic run initialization requires a fresh spend ledger");
      }
      if (priorSpendNano + attemptCostNano > meta.total_cap_nano) {
        throw new Error("Atomic run baseline exceeds the live spend cap");
      }
      this.db
        .prepare("INSERT INTO run_lock (id, run_id, pid, started_at) VALUES (1, ?, ?, ?)")
        .run(runId, process.pid, new Date().toISOString());
      const update = this.db
        .prepare(
          `UPDATE ledger_meta
              SET prior_spend_nano = ?, baseline_attempt_nano = ?, source_report_sha256 = ?
            WHERE id = 1 AND prior_spend_nano IS NULL AND source_report_sha256 IS NULL`,
        )
        .run(priorSpendNano, attemptCostNano, baseline.sourceReportSha256);
      if (update.changes !== 1) {
        throw new Error("Atomic run baseline changed during initialization");
      }
    });
    transaction.immediate();
  }

  increaseTotalCap(runId: string, requestedTotalCapUsd: number): void {
    validateRunId(runId);
    const requestedTotalCapNano = usdToNano(requestedTotalCapUsd, "requested total cap");
    const transaction = this.db.transaction(() => {
      this.assertRunOwner(runId);
      const meta = this.readMeta();
      const exposureNano = this.totalExposureNano();
      if (
        meta.total_cap_nano !== ORIGINAL_TOTAL_CAP_NANO ||
        requestedTotalCapNano !== EXTENDED_TOTAL_CAP_NANO
      ) {
        throw new Error("Live spend ledger supports only the explicit $3 to $3.021 cap increase");
      }
      if (this.countReservations("active") !== 0) {
        throw new Error("Live spend ledger cap increase requires zero active reservations");
      }
      if (requestedTotalCapNano < exposureNano) {
        throw new Error("Live spend ledger cap cannot fall below durable exposure");
      }
      const updated = this.db
        .prepare("UPDATE ledger_meta SET total_cap_nano = ? WHERE id = 1 AND total_cap_nano = ?")
        .run(requestedTotalCapNano, ORIGINAL_TOTAL_CAP_NANO);
      if (
        updated.changes !== 1 ||
        this.readMeta().total_cap_nano !== requestedTotalCapNano ||
        this.totalExposureNano() !== exposureNano
      ) {
        throw new Error("Live spend ledger cap migration changed durable exposure");
      }
    });
    transaction.immediate();
  }

  recoverStaleRun(
    staleRunId: string,
    baseline: LiveSpendBaseline,
    recoveredAttemptCostUsd: number,
  ): void {
    validateRunId(staleRunId);
    validateShaOrFreshId(baseline.sourceReportSha256);
    const priorSpendNano = usdToNano(baseline.priorSpendUsd, "prior spend");
    const baselineAttemptNano = usdToNano(baseline.attemptCostUsd, "attempt cost");
    const recoveredAttemptNano = usdToNano(recoveredAttemptCostUsd, "recovered attempt cost");
    const transaction = this.db.transaction(() => {
      const existing = this.readRunLock();
      if (!existing || existing.run_id !== staleRunId) {
        throw new Error("Live spend stale run ID does not match the durable lock");
      }
      if (isProcessRunning(existing.pid)) {
        throw new Error(`Live spend run ${staleRunId} still has a running owner process`);
      }
      if (this.countReservations("active") !== 0) {
        throw new Error("Active provider reservations require external reconciliation");
      }
      const meta = this.readMeta();
      if (
        meta.prior_spend_nano !== priorSpendNano ||
        meta.baseline_attempt_nano !== baselineAttemptNano ||
        meta.source_report_sha256 !== baseline.sourceReportSha256 ||
        baselineAttemptNano + this.settledReservationNano() !== recoveredAttemptNano
      ) {
        throw new Error("Recovered checkpoint does not reconcile with durable exposure");
      }
      const update = this.db
        .prepare(
          `UPDATE run_lock
              SET pid = ?, started_at = ?
            WHERE id = 1 AND run_id = ?`,
        )
        .run(process.pid, new Date().toISOString(), staleRunId);
      if (update.changes !== 1)
        throw new Error("Live spend stale run lock changed during recovery");
    });
    transaction.immediate();
  }

  claimInterruptedRunAtMaximum(staleRunId: string, expectation: InterruptedRunExpectation): void {
    validateRunId(staleRunId);
    validateShaOrFreshId(expectation.baseline.sourceReportSha256);
    const priorSpendNano = usdToNano(expectation.baseline.priorSpendUsd, "prior spend");
    const baselineAttemptNano = usdToNano(expectation.baseline.attemptCostUsd, "attempt cost");
    const known = expectation.knownReservations.map((reservation) => ({
      ...reservation,
      actualNano: usdToNano(reservation.actualCostUsd, "known reservation actual cost"),
      maximumNano: usdToNano(reservation.maximumCostUsd, "known reservation maximum cost"),
      serviceTier: reservation.serviceTier ?? "standard",
    }));
    const unknown = expectation.unknownReservations.map((reservation) => ({
      ...reservation,
      maximumNano: usdToNano(reservation.maximumCostUsd, "unknown reservation maximum cost"),
      serviceTier: reservation.serviceTier ?? "standard",
    }));
    if (unknown.length === 0) {
      throw new Error("Interrupted run reconciliation requires an unknown reservation");
    }
    const expectedIds = new Set([...known, ...unknown].map(({ id }) => id));
    if (expectedIds.size !== known.length + unknown.length) {
      throw new Error("Interrupted reservation IDs must be unique");
    }
    for (const reservation of [...known, ...unknown]) {
      validateInterruptedReservation(reservation);
    }

    const transaction = this.db.transaction(() => {
      const existing = this.readRunLock();
      if (!existing || existing.run_id !== staleRunId) {
        throw new Error("Live spend stale run ID does not match the durable lock");
      }
      if (isProcessRunning(existing.pid)) {
        throw new Error(`Live spend run ${staleRunId} still has a running owner process`);
      }
      const meta = this.readMeta();
      if (
        meta.prior_spend_nano !== priorSpendNano ||
        meta.baseline_attempt_nano !== baselineAttemptNano ||
        meta.source_report_sha256 !== expectation.baseline.sourceReportSha256
      ) {
        throw new Error("Interrupted ledger baseline does not exactly match registered checkpoint");
      }
      const rows = this.readAllReservations();
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const knownMatch = known.every((expected) => {
        const row = rowsById.get(expected.id);
        return (
          row !== undefined &&
          row.run_id === staleRunId &&
          row.status === "known" &&
          row.agent_id === expected.agentId &&
          row.attempt === expected.attempt &&
          row.model === expected.model &&
          row.service_tier === expected.serviceTier &&
          row.max_nano === expected.maximumNano &&
          row.actual_nano === expected.actualNano
        );
      });
      const unknownMatch = unknown.every((expected) => {
        const row = rowsById.get(expected.id);
        return (
          row !== undefined &&
          row.run_id === staleRunId &&
          (row.status === "active" || row.status === "uncertain") &&
          row.agent_id === expected.agentId &&
          row.attempt === expected.attempt &&
          row.model === expected.model &&
          row.service_tier === expected.serviceTier &&
          row.max_nano === expected.maximumNano &&
          row.actual_nano === null
        );
      });
      if (rows.length !== expectedIds.size || !knownMatch || !unknownMatch) {
        throw new Error("Interrupted reservation rows do not exactly match registered checkpoint");
      }
      const settledAt = new Date().toISOString();
      for (const { id } of unknown) {
        this.db
          .prepare(
            `UPDATE reservations
                SET status = 'uncertain', settled_at = ?
              WHERE id = ? AND status = 'active'`,
          )
          .run(settledAt, id);
      }
      const update = this.db
        .prepare(
          `UPDATE run_lock
              SET pid = ?, started_at = ?
            WHERE id = 1 AND run_id = ?`,
        )
        .run(process.pid, settledAt, staleRunId);
      if (update.changes !== 1) {
        throw new Error("Live spend interruption lock changed during reconciliation");
      }
    });
    transaction.immediate();
  }

  claimSettledRunForReport(runId: string, expectation: SettledRunExpectation): LiveSpendSnapshot {
    validateRunId(runId);
    const transaction = this.db.transaction(() => {
      const existing = this.readRunLock();
      if (existing !== undefined) {
        if (existing.run_id !== runId) {
          throw new Error(`Live spend ledger is locked by run ${existing.run_id}`);
        }
        if (isProcessRunning(existing.pid)) {
          throw new Error(`Live spend run ${runId} still has a running owner process`);
        }
        if (this.countReservations("active") !== 0) {
          throw new Error("Active provider reservations require external reconciliation");
        }
        this.assertSettledRunExpectation(runId, expectation);
        const update = this.db
          .prepare(
            `UPDATE run_lock
                SET pid = ?, started_at = ?
              WHERE id = 1 AND run_id = ?`,
          )
          .run(process.pid, new Date().toISOString(), runId);
        if (update.changes !== 1) {
          throw new Error("Settled report lock changed during recovery");
        }
        return;
      }
      this.assertSettledRunExpectation(runId, expectation);
      this.db
        .prepare("INSERT INTO run_lock (id, run_id, pid, started_at) VALUES (1, ?, ?, ?)")
        .run(runId, process.pid, new Date().toISOString());
    });
    transaction.immediate();
    return this.snapshot();
  }

  completeSettledRunAfterReport(
    runId: string,
    expectation: SettledRunExpectation,
  ): LiveSpendSnapshot {
    validateRunId(runId);
    const transaction = this.db.transaction(() => {
      const lock = this.readRunLock();
      if (lock !== undefined && lock.run_id !== runId) {
        throw new Error(`Live spend ledger is locked by run ${lock.run_id}`);
      }
      this.assertSettledRunExpectation(runId, expectation);
      if (lock !== undefined) {
        this.db.prepare("DELETE FROM run_lock WHERE id = 1 AND run_id = ?").run(runId);
      }
    });
    transaction.immediate();
    return this.snapshot();
  }

  completeRunAfterCommittedReport(
    runId: string,
    expectedSnapshot: LiveSpendSnapshot,
    expectedKnownReservationCount: number,
    expectedUncertainReservationCount: number,
  ): LiveSpendSnapshot {
    validateRunId(runId);
    if (
      !Number.isSafeInteger(expectedKnownReservationCount) ||
      expectedKnownReservationCount < 0 ||
      !Number.isSafeInteger(expectedUncertainReservationCount) ||
      expectedUncertainReservationCount < 0
    ) {
      throw new Error("Committed report reservation counts are invalid");
    }
    const transaction = this.db.transaction(() => {
      const lock = this.readRunLock();
      if (lock !== undefined) {
        if (lock.run_id !== runId) {
          throw new Error(`Live spend ledger is locked by run ${lock.run_id}`);
        }
        if (isProcessRunning(lock.pid)) {
          throw new Error(`Live spend run ${runId} still has a running owner process`);
        }
      }
      if (this.countReservations("active") !== 0) {
        throw new Error("Committed report cannot release active provider reservations");
      }
      const reservations = this.readAllReservations();
      if (reservations.some(({ run_id }) => run_id !== runId)) {
        throw new Error("Committed report contains reservations owned by another run");
      }
      if (
        reservations.filter(({ status }) => status === "known").length !==
        expectedKnownReservationCount
      ) {
        throw new Error("Committed report known reservation count does not match durable rows");
      }
      if (
        reservations.filter(({ status }) => status === "uncertain").length !==
        expectedUncertainReservationCount
      ) {
        throw new Error("Committed report uncertain reservation count does not match durable rows");
      }
      this.assertSnapshotExactly(expectedSnapshot);
      if (lock !== undefined) {
        const deletion = this.db
          .prepare("DELETE FROM run_lock WHERE id = 1 AND run_id = ?")
          .run(runId);
        if (deletion.changes !== 1) {
          throw new Error("Committed report lock changed during recovery");
        }
      }
    });
    transaction.immediate();
    return this.snapshot();
  }

  synchronizeBaseline(runId: string, baseline: LiveSpendBaseline): void {
    validateRunId(runId);
    validateShaOrFreshId(baseline.sourceReportSha256);
    const priorSpendNano = usdToNano(baseline.priorSpendUsd, "prior spend");
    const attemptCostNano = usdToNano(baseline.attemptCostUsd, "attempt cost");
    const transaction = this.db.transaction(() => {
      this.assertRunOwner(runId);
      const activeCount = this.countReservations("active");
      if (activeCount !== 0) {
        throw new Error("Cannot synchronize a baseline with active provider reservations");
      }
      const meta = this.readMeta();
      if (meta.prior_spend_nano === null) {
        if (meta.baseline_attempt_nano !== 0 || this.countAllReservations() !== 0) {
          throw new Error("Uninitialized live spend ledger contains exposure rows");
        }
      }
      const carriedAttemptNano = meta.baseline_attempt_nano + this.settledReservationNano();
      if (meta.source_report_sha256 !== null) {
        const sameReportChain =
          meta.prior_spend_nano === priorSpendNano && carriedAttemptNano === attemptCostNano;
        const foldsCurrentExposureIntoFreshPrior =
          baseline.sourceReportSha256.startsWith("fresh:") &&
          attemptCostNano === 0 &&
          (meta.prior_spend_nano ?? 0) + carriedAttemptNano === priorSpendNano;
        if (!sameReportChain && !foldsCurrentExposureIntoFreshPrior) {
          throw new Error(
            "Resume report attempts do not reconcile with the durable live spend ledger",
          );
        }
      }
      this.db
        .prepare(
          `UPDATE ledger_meta
              SET prior_spend_nano = ?, baseline_attempt_nano = ?, source_report_sha256 = ?
            WHERE id = 1`,
        )
        .run(priorSpendNano, attemptCostNano, baseline.sourceReportSha256);
      this.db.prepare("DELETE FROM reservations").run();
    });
    transaction.immediate();
  }

  createCostHooks(runId: string): RuntimeCostHooks {
    validateRunId(runId);
    return {
      reserve: (reservation) => {
        const maximumNano = usdToNano(reservation.maximumCostUsd, "request reservation");
        const transaction = this.db.transaction(() => {
          this.assertRunOwner(runId);
          const exposureNano = this.totalExposureNano();
          const totalCapNano = this.readMeta().total_cap_nano;
          if (exposureNano + maximumNano > totalCapNano) {
            throw new OpenAIRuntimeError(
              "COST_CAP_EXCEEDED",
              `Global live exposure has $${nanoToUsd(totalCapNano - exposureNano).toFixed(6)} left but request may cost $${reservation.maximumCostUsd.toFixed(6)}`,
            );
          }
          this.db
            .prepare(
              `INSERT INTO reservations (
                 id, run_id, agent_id, attempt, model, service_tier, max_nano, actual_nano, status,
                 created_at, settled_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, NULL)`,
            )
            .run(
              reservation.id,
              runId,
              reservation.agentId,
              reservation.attempt,
              reservation.model,
              reservation.serviceTier,
              maximumNano,
              new Date().toISOString(),
            );
        });
        transaction.immediate();
      },
      settle: (settlement) => {
        const actualNano = usdToNano(settlement.actualCostUsd, "settled request cost");
        const transaction = this.db.transaction(() => {
          this.assertRunOwner(runId);
          const row = this.readReservation(settlement.id);
          if (row.run_id !== runId) throw new Error("Reservation belongs to another live run");
          if (row.status === "known") {
            if (row.actual_nano !== actualNano) {
              throw new Error("Known reservation was settled with a different cost");
            }
            return;
          }
          if (row.status !== "active") {
            throw new Error("Uncertain reservation cannot become known without reconciliation");
          }
          this.db
            .prepare(
              `UPDATE reservations
                  SET actual_nano = ?, status = 'known', settled_at = ?
                WHERE id = ? AND status = 'active'`,
            )
            .run(actualNano, new Date().toISOString(), settlement.id);
        });
        transaction.immediate();
      },
      markUncertain: (reservationId) => {
        const transaction = this.db.transaction(() => {
          this.assertRunOwner(runId);
          const row = this.readReservation(reservationId);
          if (row.run_id !== runId) throw new Error("Reservation belongs to another live run");
          if (row.status !== "active") return;
          this.db
            .prepare(
              `UPDATE reservations
                  SET status = 'uncertain', settled_at = ?
                WHERE id = ? AND status = 'active'`,
            )
            .run(new Date().toISOString(), reservationId);
        });
        transaction.immediate();
      },
    };
  }

  snapshot(): LiveSpendSnapshot {
    return snapshotFromDatabase(this.db);
  }

  releaseRun(runId: string): void {
    validateRunId(runId);
    const transaction = this.db.transaction(() => {
      this.assertRunOwner(runId);
      if (this.countReservations("active") !== 0) {
        throw new Error("Cannot release live run lock with active provider reservations");
      }
      this.db.prepare("DELETE FROM run_lock WHERE id = 1 AND run_id = ?").run(runId);
    });
    transaction.immediate();
  }

  close(): void {
    this.db.close();
  }

  private assertSettledRunExpectation(runId: string, expectation: SettledRunExpectation): void {
    validateShaOrFreshId(expectation.baseline.sourceReportSha256);
    if (expectation.knownReservations.length === 0) {
      throw new Error("Settled run reconciliation requires known reservations");
    }
    const priorSpendNano = usdToNano(expectation.baseline.priorSpendUsd, "prior spend");
    const baselineAttemptNano = usdToNano(expectation.baseline.attemptCostUsd, "attempt cost");
    const known = expectation.knownReservations.map((reservation) => ({
      ...reservation,
      actualNano: usdToNano(reservation.actualCostUsd, "known reservation actual cost"),
      maximumNano: usdToNano(reservation.maximumCostUsd, "known reservation maximum cost"),
      serviceTier: reservation.serviceTier ?? "standard",
    }));
    const expectedIds = new Set(known.map(({ id }) => id));
    if (expectedIds.size !== known.length) {
      throw new Error("Settled reservation IDs must be unique");
    }
    for (const reservation of known) validateInterruptedReservation(reservation);
    const meta = this.readMeta();
    if (
      meta.prior_spend_nano !== priorSpendNano ||
      meta.baseline_attempt_nano !== baselineAttemptNano ||
      meta.source_report_sha256 !== expectation.baseline.sourceReportSha256
    ) {
      throw new Error("Settled ledger baseline does not exactly match registered checkpoint");
    }
    const rows = this.readAllReservations();
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const knownMatch = known.every((expected) => {
      const row = rowsById.get(expected.id);
      return (
        row !== undefined &&
        row.run_id === runId &&
        row.status === "known" &&
        row.agent_id === expected.agentId &&
        row.attempt === expected.attempt &&
        row.model === expected.model &&
        row.service_tier === expected.serviceTier &&
        row.max_nano === expected.maximumNano &&
        row.actual_nano === expected.actualNano
      );
    });
    if (rows.length !== expectedIds.size || !knownMatch) {
      throw new Error("Settled reservation rows do not exactly match registered checkpoint");
    }
  }

  private assertSnapshotExactly(expected: LiveSpendSnapshot): void {
    const actual = this.snapshot();
    const moneyFields = [
      "baselineAttemptCostUsd",
      "headroomUsd",
      "knownReservationCostUsd",
      "priorSpendUsd",
      "totalCapUsd",
      "totalExposureUsd",
      "uncertainReservationCostUsd",
    ] as const;
    if (
      actual.activeReservationCount !== expected.activeReservationCount ||
      actual.sourceReportSha256 !== expected.sourceReportSha256 ||
      moneyFields.some(
        (field) =>
          usdToNano(actual[field], `actual ${field}`) !==
          usdToNano(expected[field], `expected ${field}`),
      )
    ) {
      throw new Error("Committed report snapshot does not exactly match durable exposure");
    }
  }

  private assertRunOwner(runId: string): void {
    const row = this.db.prepare("SELECT run_id FROM run_lock WHERE id = 1").get() as
      { readonly run_id: string } | undefined;
    if (!row || row.run_id !== runId)
      throw new Error("Live run does not own the spend ledger lock");
  }

  private migrateVersionOneLedger(): void {
    const transaction = this.db.transaction(() => {
      const beforeExposureNano = this.totalExposureNano();
      const columns = this.db.prepare("PRAGMA table_info(reservations)").all() as {
        readonly name: string;
      }[];
      if (!columns.some(({ name }) => name === "service_tier")) {
        this.db.exec(
          "ALTER TABLE reservations ADD COLUMN service_tier TEXT NOT NULL DEFAULT 'standard' CHECK (service_tier IN ('standard', 'flex'))",
        );
      }
      const updated = this.db
        .prepare("UPDATE ledger_meta SET version = ? WHERE id = 1 AND version = 1")
        .run(LEDGER_VERSION);
      if (updated.changes !== 1 || this.totalExposureNano() !== beforeExposureNano) {
        throw new Error("Live spend ledger migration changed durable exposure");
      }
    });
    transaction.immediate();
  }

  private countAllReservations(): number {
    return this.readSum("SELECT COUNT(*) AS value FROM reservations");
  }

  private countReservations(status: ReservationRow["status"]): number {
    return this.readSum("SELECT COUNT(*) AS value FROM reservations WHERE status = ?", status);
  }

  private readMeta(): MetaRow {
    return readMetaFromDatabase(this.db);
  }

  private readRunLock(): RunLockRow | undefined {
    return this.db.prepare("SELECT run_id, pid FROM run_lock WHERE id = 1").get() as
      RunLockRow | undefined;
  }

  private readReservation(id: string): ReservationRow {
    const row = this.db
      .prepare("SELECT run_id, max_nano, actual_nano, status FROM reservations WHERE id = ?")
      .get(id) as ReservationRow | undefined;
    if (!row) throw new Error(`Unknown live spend reservation ${id}`);
    return row;
  }

  private readAllReservations(): ReservationAuditRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id, agent_id, attempt, model, service_tier, max_nano, actual_nano, status
           FROM reservations
          ORDER BY id`,
      )
      .all() as ReservationAuditRow[];
  }

  private readSum(sql: string, ...parameters: unknown[]): number {
    return readSafeSum(this.db, sql, ...parameters);
  }

  private settledReservationNano(): number {
    return this.readSum(
      `SELECT COALESCE(SUM(
         CASE WHEN status = 'known' THEN actual_nano ELSE max_nano END
       ), 0) AS value
         FROM reservations
        WHERE status <> 'active'`,
    );
  }

  private sumReservationNano(status: "known" | "uncertain"): number {
    return this.readSum(
      `SELECT COALESCE(SUM(
         CASE WHEN status = 'known' THEN actual_nano ELSE max_nano END
       ), 0) AS value
         FROM reservations
        WHERE status = ?`,
      status,
    );
  }

  private totalExposureNano(): number {
    const meta = this.readMeta();
    return (
      (meta.prior_spend_nano ?? 0) +
      meta.baseline_attempt_nano +
      this.readSum(
        `SELECT COALESCE(SUM(
           CASE WHEN status = 'known' THEN actual_nano ELSE max_nano END
         ), 0) AS value FROM reservations`,
      )
    );
  }
}

export function preflightLiveSpendCap(
  filename: string,
  requestedTotalCapUsd: number,
  options: LiveSpendCapPreflightOptions = {},
): LiveSpendCapPreflight {
  const requestedTotalCapNano = usdToNano(requestedTotalCapUsd, "requested total cap");
  if (
    requestedTotalCapNano !== ORIGINAL_TOTAL_CAP_NANO &&
    requestedTotalCapNano !== EXTENDED_TOTAL_CAP_NANO
  ) {
    throw new Error("Live spend ledger supports only total caps $3 and $3.021");
  }
  const db = new Database(filename, { fileMustExist: true, readonly: true });
  try {
    const meta = readMetaFromDatabase(db);
    if (meta.version !== LEDGER_VERSION) {
      throw new Error("Live spend ledger must be migrated before cap preflight");
    }
    const snapshot = snapshotFromDatabase(db);
    const runLocks = db.prepare("SELECT run_id FROM run_lock").all() as {
      readonly run_id: string;
    }[];
    if (requestedTotalCapNano < meta.total_cap_nano) {
      throw new Error("Live spend ledger total cap cannot decrease");
    }
    if (
      requestedTotalCapNano > meta.total_cap_nano &&
      (meta.total_cap_nano !== ORIGINAL_TOTAL_CAP_NANO ||
        requestedTotalCapNano !== EXTENDED_TOTAL_CAP_NANO)
    ) {
      throw new Error("Live spend ledger supports only the explicit $3 to $3.021 cap increase");
    }
    if (snapshot.activeReservationCount !== 0) {
      throw new Error("Live spend ledger preflight requires zero active reservations");
    }
    if (
      runLocks.length !== 0 &&
      (runLocks.length !== 1 || runLocks[0]?.run_id !== options.allowedLockedRunId)
    ) {
      throw new Error("Live spend ledger preflight requires an unlocked or matching stale run");
    }
    const exposureNano = usdToNano(snapshot.totalExposureUsd, "durable exposure");
    if (requestedTotalCapNano < exposureNano) {
      throw new Error("Live spend ledger cap cannot fall below durable exposure");
    }
    return {
      baselineAttemptCostUsd: snapshot.baselineAttemptCostUsd,
      currentTotalCapUsd: snapshot.totalCapUsd,
      knownReservationCostUsd: snapshot.knownReservationCostUsd,
      migrationRequired: requestedTotalCapNano > meta.total_cap_nano,
      priorSpendUsd: snapshot.priorSpendUsd,
      projectedHeadroomUsd: nanoToUsd(requestedTotalCapNano - exposureNano),
      requestedTotalCapUsd: nanoToUsd(requestedTotalCapNano),
      sourceReportSha256: snapshot.sourceReportSha256,
      totalExposureUsd: snapshot.totalExposureUsd,
      uncertainReservationCostUsd: snapshot.uncertainReservationCostUsd,
    };
  } finally {
    db.close();
  }
}

export function readLiveSpendSnapshot(filename: string): LiveSpendSnapshot {
  const db = new Database(filename, { fileMustExist: true, readonly: true });
  try {
    const meta = readMetaFromDatabase(db);
    if (meta.version !== LEDGER_VERSION) {
      throw new Error("Live spend ledger must be migrated before read-only inspection");
    }
    return snapshotFromDatabase(db);
  } finally {
    db.close();
  }
}

export function inspectLiveSpendRecovery(
  filename: string,
  expectedRunId: string,
): InterruptedRunExpectation {
  validateRunId(expectedRunId);
  const db = new Database(filename, { fileMustExist: true, readonly: true });
  try {
    const meta = readMetaFromDatabase(db);
    if (meta.version !== LEDGER_VERSION || meta.source_report_sha256 === null) {
      throw new Error("Live spend recovery ledger is uninitialized or needs migration");
    }
    const lock = db.prepare("SELECT run_id FROM run_lock WHERE id = 1").get() as
      { readonly run_id: string } | undefined;
    if (lock?.run_id !== expectedRunId) {
      throw new Error("Live spend recovery run ID does not match the durable lock");
    }
    const rows = db
      .prepare(
        `SELECT id, run_id, agent_id, attempt, model, service_tier, max_nano, actual_nano,
                status
           FROM reservations
          ORDER BY id`,
      )
      .all() as ReservationAuditRow[];
    if (rows.some(({ run_id }) => run_id !== expectedRunId)) {
      throw new Error("Live spend recovery contains reservations from another run");
    }
    return {
      baseline: {
        attemptCostUsd: nanoToUsd(meta.baseline_attempt_nano),
        priorSpendUsd: nanoToUsd(meta.prior_spend_nano ?? 0),
        sourceReportSha256: meta.source_report_sha256,
      },
      knownReservations: rows
        .filter((row) => row.status === "known")
        .map((row) => {
          if (row.actual_nano === null) {
            throw new Error("Known live spend reservation lacks actual cost");
          }
          return {
            actualCostUsd: nanoToUsd(row.actual_nano),
            agentId: row.agent_id,
            attempt: row.attempt,
            id: row.id,
            maximumCostUsd: nanoToUsd(row.max_nano),
            model: row.model,
            serviceTier: row.service_tier,
          };
        }),
      unknownReservations: rows
        .filter((row) => row.status === "active" || row.status === "uncertain")
        .map((row) => ({
          agentId: row.agent_id,
          attempt: row.attempt,
          id: row.id,
          maximumCostUsd: nanoToUsd(row.max_nano),
          model: row.model,
          serviceTier: row.service_tier,
        })),
    };
  } finally {
    db.close();
  }
}

function snapshotFromDatabase(db: Database.Database): LiveSpendSnapshot {
  const meta = readMetaFromDatabase(db);
  const activeCount = readSafeSum(
    db,
    "SELECT COUNT(*) AS value FROM reservations WHERE status = 'active'",
  );
  const knownNano = readSafeSum(
    db,
    "SELECT COALESCE(SUM(actual_nano), 0) AS value FROM reservations WHERE status = 'known'",
  );
  const uncertainNano = readSafeSum(
    db,
    "SELECT COALESCE(SUM(max_nano), 0) AS value FROM reservations WHERE status = 'uncertain'",
  );
  const reservationExposureNano = readSafeSum(
    db,
    `SELECT COALESCE(SUM(
       CASE WHEN status = 'known' THEN actual_nano ELSE max_nano END
     ), 0) AS value FROM reservations`,
  );
  const exposureNano =
    (meta.prior_spend_nano ?? 0) + meta.baseline_attempt_nano + reservationExposureNano;
  return {
    activeReservationCount: activeCount,
    baselineAttemptCostUsd: nanoToUsd(meta.baseline_attempt_nano),
    headroomUsd: nanoToUsd(Math.max(0, meta.total_cap_nano - exposureNano)),
    knownReservationCostUsd: nanoToUsd(knownNano),
    priorSpendUsd: nanoToUsd(meta.prior_spend_nano ?? 0),
    sourceReportSha256: meta.source_report_sha256,
    totalCapUsd: nanoToUsd(meta.total_cap_nano),
    totalExposureUsd: nanoToUsd(exposureNano),
    uncertainReservationCostUsd: nanoToUsd(uncertainNano),
  };
}

function readMetaFromDatabase(db: Database.Database): MetaRow {
  const row = db
    .prepare(
      `SELECT version, total_cap_nano, prior_spend_nano, baseline_attempt_nano,
              source_report_sha256
         FROM ledger_meta WHERE id = 1`,
    )
    .get() as MetaRow | undefined;
  if (!row) throw new Error("Live spend ledger metadata is missing");
  return row;
}

function readSafeSum(db: Database.Database, sql: string, ...parameters: unknown[]): number {
  const row = db.prepare(sql).get(...parameters) as SumRow | undefined;
  if (!row || !Number.isSafeInteger(row.value)) throw new Error("Invalid live spend ledger sum");
  return row.value;
}

function validateInterruptedReservation(reservation: {
  readonly agentId: string | null;
  readonly attempt: number;
  readonly id: string;
  readonly maximumCostUsd: number;
  readonly model: RuntimeModel;
}): void {
  if (
    reservation.id.trim().length === 0 ||
    (reservation.agentId !== null && reservation.agentId.trim().length === 0) ||
    !Number.isInteger(reservation.attempt) ||
    reservation.attempt < 0 ||
    reservation.attempt > 2 ||
    !["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(reservation.model)
  ) {
    throw new Error("Invalid interrupted reservation checkpoint");
  }
}

function usdToNano(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative`);
  const nano = Math.round(value * NANO_USD);
  if (!Number.isSafeInteger(nano) || Math.abs(nanoToUsd(nano) - value) >= 0.000_000_000_5) {
    throw new Error(`${label} must use at most nine decimal places`);
  }
  return nano;
}

function nanoToUsd(value: number): number {
  return value / NANO_USD;
}

function validateRunId(runId: string): void {
  if (!/^[a-f0-9-]{36}$/u.test(runId)) throw new Error("Live spend run ID must be a UUID");
}

function validateShaOrFreshId(value: string): void {
  if (!/^(?:[a-f0-9]{64}|fresh:[a-f0-9]{7,40})$/u.test(value)) {
    throw new Error("Live spend baseline needs a report hash or fresh Git identifier");
  }
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
