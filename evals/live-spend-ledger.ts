import Database from "better-sqlite3";

import { OpenAIRuntimeError, type RuntimeCostHooks } from "../app/src/server/openai";

const LEDGER_VERSION = 1;
const NANO_USD = 1_000_000_000;

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
    const meta = this.readMeta();
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

  recoverStaleRun(staleRunId: string, newRunId: string): void {
    validateRunId(staleRunId);
    validateRunId(newRunId);
    if (staleRunId === newRunId) throw new Error("Recovery needs a new live run ID");
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
      const update = this.db
        .prepare(
          `UPDATE run_lock
              SET run_id = ?, pid = ?, started_at = ?
            WHERE id = 1 AND run_id = ?`,
        )
        .run(newRunId, process.pid, new Date().toISOString(), staleRunId);
      if (update.changes !== 1)
        throw new Error("Live spend stale run lock changed during recovery");
    });
    transaction.immediate();
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
                 id, run_id, agent_id, attempt, model, max_nano, actual_nano, status,
                 created_at, settled_at
               ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', ?, NULL)`,
            )
            .run(
              reservation.id,
              runId,
              reservation.agentId,
              reservation.attempt,
              reservation.model,
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
    const meta = this.readMeta();
    const knownNano = this.sumReservationNano("known");
    const uncertainNano = this.sumReservationNano("uncertain");
    const exposureNano = this.totalExposureNano();
    return {
      activeReservationCount: this.countReservations("active"),
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

  private assertRunOwner(runId: string): void {
    const row = this.db.prepare("SELECT run_id FROM run_lock WHERE id = 1").get() as
      { readonly run_id: string } | undefined;
    if (!row || row.run_id !== runId)
      throw new Error("Live run does not own the spend ledger lock");
  }

  private countAllReservations(): number {
    return this.readSum("SELECT COUNT(*) AS value FROM reservations");
  }

  private countReservations(status: ReservationRow["status"]): number {
    return this.readSum("SELECT COUNT(*) AS value FROM reservations WHERE status = ?", status);
  }

  private readMeta(): MetaRow {
    const row = this.db
      .prepare(
        `SELECT version, total_cap_nano, prior_spend_nano, baseline_attempt_nano,
                source_report_sha256
           FROM ledger_meta WHERE id = 1`,
      )
      .get() as MetaRow | undefined;
    if (!row) throw new Error("Live spend ledger metadata is missing");
    return row;
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

  private readSum(sql: string, ...parameters: unknown[]): number {
    const row = this.db.prepare(sql).get(...parameters) as SumRow | undefined;
    if (!row || !Number.isSafeInteger(row.value)) throw new Error("Invalid live spend ledger sum");
    return row.value;
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
