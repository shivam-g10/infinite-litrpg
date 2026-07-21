import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { LiveSpendLedger, readLiveSpendSnapshot } from "./live-spend-ledger";
import {
  STORY_REVIEW_VARIANT_CONFIG_SHA256,
  STORY_REVIEW_VARIANT_MIGRATION_RUN_ID,
  assertStoryReviewVariantLedger,
  migrateStoryReviewVariant,
  readStoryReviewVariantMarker,
} from "./story-review-variant";

const FROM_SOURCE = "a".repeat(40);
const TO_SOURCE = "b".repeat(40);
const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    // Vitest owns this isolated temporary root. Cleanup runs after handles close.
    try {
      rmSync(directory, { force: true, recursive: true });
    } catch {
      // Windows can retain a transient SQLite handle; the OS temp root remains safe.
    }
  }
});

describe("story-review quality variant migration", () => {
  it("archives the old branch, binds its manifest, and carries exposure exactly once", () => {
    const root = temporaryRoot();
    const reportDirectory = resolve(root, "evals", "reports");
    const storyDirectory = resolve(reportDirectory, "story-review");
    const archiveRoot = resolve(reportDirectory, "story-review-archives");
    const markerPath = resolve(reportDirectory, "story-review-variant.json");
    const ledgerPath = resolve(reportDirectory, "story-review-spend.db");
    mkdirSync(storyDirectory, { recursive: true });

    const trace = historicalTrace();
    const traceCostUsd = trace.totalEstimatedCostUsd as number;
    writeTraceDatabase(resolve(storyDirectory, "rowan-ashborn.db"), trace, true);
    initializeLedger(ledgerPath, traceCostUsd);

    const options = {
      archiveRoot,
      fromSourceGitSha: FROM_SOURCE,
      ledgerPath,
      markerPath,
      reportDirectory,
      storyDirectory,
      toSourceGitSha: TO_SOURCE,
    } as const;
    const first = migrateStoryReviewVariant(options);
    const second = migrateStoryReviewVariant(options);
    const marker = readStoryReviewVariantMarker(markerPath, archiveRoot, TO_SOURCE);
    const snapshot = readLiveSpendSnapshot(ledgerPath);

    expect(second).toEqual(first);
    expect(marker.manifestSha256).toBe(first.manifestSha256);
    expect(marker.variantConfigSha256).toBe(STORY_REVIEW_VARIANT_CONFIG_SHA256);
    expect(marker.carriedExposureUsd).toBeCloseTo(traceCostUsd, 9);
    expect(snapshot.totalExposureUsd).toBeCloseTo(traceCostUsd, 9);
    expect(snapshot.priorSpendUsd).toBeCloseTo(traceCostUsd, 9);
    expect(snapshot.knownReservationCostUsd).toBe(0);
    expect(snapshot.totalCapUsd).toBe(5.088);
    expect(snapshot.sourceReportSha256).toBe(`fresh:${TO_SOURCE}:${marker.manifestSha256}`);
    expect(() => assertStoryReviewVariantLedger(snapshot, marker)).not.toThrow();
    expect(() => assertStoryReviewVariantLedger({ ...snapshot, priorSpendUsd: 0 }, marker)).toThrow(
      /carried exposure/iu,
    );
    expect(() =>
      assertStoryReviewVariantLedger(
        { ...snapshot, sourceReportSha256: `fresh:${TO_SOURCE}` },
        marker,
      ),
    ).toThrow(/source/iu);
    expect(readFileSync(resolve(first.archivePath, "manifest.json"), "utf8")).toContain(
      '"uniqueResponseCostUsd"',
    );
  });

  it("does not move story files while another run owns the spend ledger", () => {
    const root = temporaryRoot();
    const reportDirectory = resolve(root, "evals", "reports");
    const storyDirectory = resolve(reportDirectory, "story-review");
    const archiveRoot = resolve(reportDirectory, "story-review-archives");
    const ledgerPath = resolve(reportDirectory, "story-review-spend.db");
    mkdirSync(storyDirectory, { recursive: true });
    writeFileSync(resolve(storyDirectory, "sentinel.txt"), "preserve", "utf8");
    const ledger = new LiveSpendLedger(ledgerPath, 2.544);
    const ownerRunId = randomUUID();
    ledger.acquireRunWithBaseline(ownerRunId, {
      attemptCostUsd: 0,
      priorSpendUsd: 0.1,
      sourceReportSha256: `fresh:${FROM_SOURCE}`,
    });

    expect(() =>
      migrateStoryReviewVariant({
        archiveRoot,
        fromSourceGitSha: FROM_SOURCE,
        ledgerPath,
        markerPath: resolve(reportDirectory, "story-review-variant.json"),
        reportDirectory,
        storyDirectory,
        toSourceGitSha: TO_SOURCE,
      }),
    ).toThrow(/locked by run/iu);
    expect(existsSync(resolve(storyDirectory, "sentinel.txt"))).toBe(true);
    expect(existsSync(archiveRoot)).toBe(false);
    expect(ledger.snapshot()).toMatchObject({
      totalCapUsd: 2.544,
      totalExposureUsd: 0.1,
    });
    ledger.releaseRun(ownerRunId);
    ledger.close();
  });

  it("resumes after the story archive moves before the manifest is written", () => {
    const fixture = createHistoricalFixture();
    mkdirSync(fixture.archivePath, { recursive: true });
    renameSync(fixture.storyDirectory, resolve(fixture.archivePath, "stories"));

    const marker = migrateStoryReviewVariant(fixture.options);

    expect(existsSync(resolve(fixture.archivePath, "manifest.json"))).toBe(true);
    expect(existsSync(fixture.markerPath)).toBe(true);
    expect(() =>
      assertStoryReviewVariantLedger(readLiveSpendSnapshot(fixture.ledgerPath), marker),
    ).not.toThrow();
  });

  it("resumes after the marker is written before the ledger is folded", () => {
    const fixture = createHistoricalFixture();
    const marker = migrateStoryReviewVariant(fixture.options);
    resetOldLedger(fixture.ledgerPath, fixture.traceCostUsd);

    const resumed = migrateStoryReviewVariant(fixture.options);

    expect(resumed).toEqual(marker);
    expect(() =>
      assertStoryReviewVariantLedger(readLiveSpendSnapshot(fixture.ledgerPath), marker),
    ).not.toThrow();
  });

  it("resumes after the cap increases before the old exposure is folded", () => {
    const fixture = createHistoricalFixture();
    const marker = migrateStoryReviewVariant(fixture.options);
    resetOldLedger(fixture.ledgerPath, fixture.traceCostUsd);
    const ledger = new LiveSpendLedger(fixture.ledgerPath, 2.544);
    const runId = randomUUID();
    ledger.acquireRun(runId);
    ledger.increaseTotalCap(runId, 5.088);
    ledger.releaseRun(runId);
    ledger.close();

    migrateStoryReviewVariant(fixture.options);

    expect(() =>
      assertStoryReviewVariantLedger(readLiveSpendSnapshot(fixture.ledgerPath), marker),
    ).not.toThrow();
  });

  it("recovers its stale migration lock before resuming archive work", () => {
    const fixture = createHistoricalFixture();
    mkdirSync(fixture.archivePath, { recursive: true });
    renameSync(fixture.storyDirectory, resolve(fixture.archivePath, "stories"));
    const ledger = new LiveSpendLedger(fixture.ledgerPath, 2.544);
    ledger.acquireRun(STORY_REVIEW_VARIANT_MIGRATION_RUN_ID);
    ledger.close();
    const database = new Database(fixture.ledgerPath);
    database.prepare("UPDATE run_lock SET pid = ? WHERE id = 1").run(2_147_483_647);
    database.close();

    const marker = migrateStoryReviewVariant(fixture.options);

    expect(() =>
      assertStoryReviewVariantLedger(readLiveSpendSnapshot(fixture.ledgerPath), marker),
    ).not.toThrow();
  });
});

function createHistoricalFixture() {
  const root = temporaryRoot();
  const reportDirectory = resolve(root, "evals", "reports");
  const storyDirectory = resolve(reportDirectory, "story-review");
  const archiveRoot = resolve(reportDirectory, "story-review-archives");
  const archivePath = resolve(archiveRoot, `${FROM_SOURCE}-to-${TO_SOURCE}`);
  const markerPath = resolve(reportDirectory, "story-review-variant.json");
  const ledgerPath = resolve(reportDirectory, "story-review-spend.db");
  mkdirSync(storyDirectory, { recursive: true });
  const trace = historicalTrace();
  const traceCostUsd = trace.totalEstimatedCostUsd as number;
  writeTraceDatabase(resolve(storyDirectory, "rowan-ashborn.db"), trace, true);
  initializeLedger(ledgerPath, traceCostUsd);
  return {
    archivePath,
    ledgerPath,
    markerPath,
    options: {
      archiveRoot,
      fromSourceGitSha: FROM_SOURCE,
      ledgerPath,
      markerPath,
      reportDirectory,
      storyDirectory,
      toSourceGitSha: TO_SOURCE,
    },
    storyDirectory,
    traceCostUsd,
  } as const;
}

function resetOldLedger(path: string, exposureUsd: number): void {
  rmSync(path, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}-wal`, { force: true });
  initializeLedger(path, exposureUsd);
}

function historicalTrace(): Record<string, unknown> {
  const demo = JSON.parse(
    readFileSync(resolve("docs/evidence/rowan-chapter-1-demo.json"), "utf8"),
  ) as { result: { trace: Record<string, unknown> } };
  const trace = structuredClone(demo.result.trace);
  trace.gitSha = FROM_SOURCE;
  return trace;
}

function initializeLedger(path: string, exposureUsd: number): void {
  const ledger = new LiveSpendLedger(path, 2.544);
  const runId = randomUUID();
  ledger.acquireRunWithBaseline(runId, {
    attemptCostUsd: 0,
    priorSpendUsd: exposureUsd,
    sourceReportSha256: `fresh:${FROM_SOURCE}`,
  });
  ledger.releaseRun(runId);
  ledger.close();
}

function temporaryRoot(): string {
  const root = resolve(tmpdir(), `infinite-litrpg-story-variant-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  createdDirectories.push(root);
  return root;
}

function writeTraceDatabase(
  path: string,
  trace: Record<string, unknown>,
  duplicateAsFailure: boolean,
) {
  const database = new Database(path);
  database.exec(
    "CREATE TABLE traces (trace_json TEXT NOT NULL); CREATE TABLE failed_turn_traces (trace_json TEXT NOT NULL);",
  );
  database.prepare("INSERT INTO traces (trace_json) VALUES (?)").run(JSON.stringify(trace));
  if (duplicateAsFailure) {
    const failed = {
      attempts: trace.attempts,
      attemptedChapter: 1,
      commandType: "take_action",
      contractVersion: trace.contractVersion,
      errorCode: "NARRATIVE_AUDIT_REJECTED",
      fixtureId: trace.fixtureId,
      fixtureVersion: trace.fixtureVersion,
      gateResult: "failed",
      gitSha: trace.gitSha,
      pricingVersion: trace.pricingVersion,
      promptVersion: trace.promptVersion,
      requestId: randomUUID(),
      runId: randomUUID(),
      schemaVersion: trace.schemaVersion,
      stateBeforeHash: trace.stateBeforeHash,
      totalEstimatedCostUsd: trace.totalEstimatedCostUsd,
      totalLatencyMs: trace.totalLatencyMs,
      totalUsage: trace.totalUsage,
      worldVersion: 1,
    };
    database
      .prepare("INSERT INTO failed_turn_traces (trace_json) VALUES (?)")
      .run(JSON.stringify(failed));
  }
  database.close();
  writeFileSync(`${path}-wal`, "", "utf8");
}
