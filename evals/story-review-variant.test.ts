import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { CHARACTER_IDS } from "@infinite-litrpg/shared";

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
const ROOT_SOURCE = "0".repeat(40);
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

  it("chains a settled completed variant, preserves its parent marker, and folds exact exposure", () => {
    const fixture = createCompletedRejectedVariantFixture();

    const first = migrateStoryReviewVariant(fixture.options);
    const second = migrateStoryReviewVariant(fixture.options);
    const marker = readStoryReviewVariantMarker(fixture.markerPath, fixture.archiveRoot, TO_SOURCE);
    const snapshot = readLiveSpendSnapshot(fixture.ledgerPath);
    const manifest = JSON.parse(
      readFileSync(resolve(first.archivePath, "manifest.json"), "utf8"),
    ) as {
      readonly priorLineageExposureUsd: number;
      readonly stories: readonly { readonly committedChapters: number }[];
      readonly uniqueResponseCostUsd: number;
    };

    expect(second).toEqual(first);
    expect(first).toMatchObject(marker);
    expect(marker.markerSchemaVersion).toBe("2.0.0-story-review-variant-marker");
    expect(marker.carriedExposureUsd).toBe(0.86713);
    expect(snapshot).toMatchObject({
      activeReservationCount: 0,
      baselineAttemptCostUsd: 0,
      knownReservationCostUsd: 0,
      priorSpendUsd: 0.86713,
      totalCapUsd: 5.088,
      totalExposureUsd: 0.86713,
      uncertainReservationCostUsd: 0,
    });
    expect(snapshot.sourceReportSha256).toBe(`fresh:${TO_SOURCE}:${marker.manifestSha256}`);
    expect(manifest).toMatchObject({
      priorLineageExposureUsd: 0.1635525,
      uniqueResponseCostUsd: 0.7035775,
    });
    expect(manifest.stories.map(({ committedChapters }) => committedChapters)).toEqual(
      CHARACTER_IDS.map(() => 10),
    );
    expect(existsSync(fixture.storyDirectory)).toBe(false);
    expect(() => assertStoryReviewVariantLedger(snapshot, marker)).not.toThrow();

    const parentMarkerPath = resolve(first.archivePath, "parent-marker.json");
    const parentMarkerBytes = readFileSync(parentMarkerPath, "utf8");
    writeFileSync(parentMarkerPath, `${parentMarkerBytes} `, "utf8");
    expect(() =>
      readStoryReviewVariantMarker(fixture.markerPath, fixture.archiveRoot, TO_SOURCE),
    ).toThrow(/parent marker/iu);
  });

  it("resumes a chained migration after the completed story directory already moved", () => {
    const fixture = createCompletedRejectedVariantFixture();
    const archivePath = resolve(archiveRootFor(fixture), `${FROM_SOURCE}-to-${TO_SOURCE}`);
    mkdirSync(archivePath, { recursive: true });
    renameSync(fixture.storyDirectory, resolve(archivePath, "stories"));

    const marker = migrateStoryReviewVariant(fixture.options);

    expect(marker.markerSchemaVersion).toBe("2.0.0-story-review-variant-marker");
    expect(readLiveSpendSnapshot(fixture.ledgerPath)).toMatchObject({
      knownReservationCostUsd: 0,
      priorSpendUsd: 0.86713,
      totalExposureUsd: 0.86713,
    });
  });

  it("resumes a chained migration after its current marker commits before ledger folding", () => {
    const fixture = createCompletedRejectedVariantFixture();
    const marker = migrateStoryReviewVariant(fixture.options);
    resetChainedLedger(fixture.ledgerPath, fixture.parentMarker, fixture.currentCostNanos);

    const resumed = migrateStoryReviewVariant(fixture.options);

    expect(resumed).toEqual(marker);
    expect(() =>
      assertStoryReviewVariantLedger(readLiveSpendSnapshot(fixture.ledgerPath), marker),
    ).not.toThrow();
  });

  it("rejects an incomplete chained pack before moving its active databases", () => {
    const fixture = createCompletedRejectedVariantFixture(9);

    expect(() => migrateStoryReviewVariant(fixture.options)).toThrow(
      /six complete ten-chapter POVs/iu,
    );
    expect(existsSync(fixture.storyDirectory)).toBe(true);
    expect(
      existsSync(resolve(fixture.archiveRoot, `${FROM_SOURCE}-to-${TO_SOURCE}`, "stories")),
    ).toBe(false);
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

function createCompletedRejectedVariantFixture(firstStoryChapters = 10) {
  const root = temporaryRoot();
  const reportDirectory = resolve(root, "evals", "reports");
  const storyDirectory = resolve(reportDirectory, "story-review");
  const archiveRoot = resolve(reportDirectory, "story-review-archives");
  const markerPath = resolve(reportDirectory, "story-review-variant.json");
  const ledgerPath = resolve(reportDirectory, "story-review-spend.db");
  mkdirSync(storyDirectory, { recursive: true });
  mkdirSync(archiveRoot, { recursive: true });
  const parentMarker = writeRejectedVariantLineage(archiveRoot, markerPath);

  const totalChapters = firstStoryChapters + (CHARACTER_IDS.length - 1) * 10;
  const currentExposureNano = 703_577_500;
  const costNanos = Array.from({ length: totalChapters }, (_, index) => {
    const base = Math.floor(currentExposureNano / totalChapters);
    return base + (index < currentExposureNano % totalChapters ? 1 : 0);
  });
  let traceIndex = 0;
  for (const [storyIndex, characterId] of CHARACTER_IDS.entries()) {
    const traces = Array.from({ length: storyIndex === 0 ? firstStoryChapters : 10 }, () => {
      const costUsd = costNanos[traceIndex]! / 1_000_000_000;
      const trace = completedVariantTrace(traceIndex, costUsd);
      traceIndex += 1;
      return trace;
    });
    writeCompletedTraceDatabase(
      resolve(storyDirectory, `${characterId}.db`),
      traces,
      characterId === "maelin-rook",
    );
  }

  initializeChainedLedger(ledgerPath, parentMarker, costNanos);

  return {
    archiveRoot,
    currentCostNanos: costNanos,
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
    parentMarker,
    storyDirectory,
  } as const;
}

function archiveRootFor(fixture: { readonly archiveRoot: string }): string {
  return fixture.archiveRoot;
}

function resetChainedLedger(
  path: string,
  parentMarker: { readonly manifestSha256: string },
  costNanos: readonly number[],
): void {
  rmSync(path, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}-wal`, { force: true });
  initializeChainedLedger(path, parentMarker, costNanos);
}

function initializeChainedLedger(
  path: string,
  parentMarker: { readonly manifestSha256: string },
  costNanos: readonly number[],
): void {
  const ledger = new LiveSpendLedger(path, 5.088);
  const runId = randomUUID();
  ledger.acquireRunWithBaseline(runId, {
    attemptCostUsd: 0,
    priorSpendUsd: 0.1635525,
    sourceReportSha256: `fresh:${FROM_SOURCE}:${parentMarker.manifestSha256}`,
  });
  const hooks = ledger.createCostHooks(runId);
  for (const costNano of costNanos) {
    const id = randomUUID();
    const costUsd = costNano / 1_000_000_000;
    hooks.reserve({
      agentId: null,
      attempt: 0,
      id,
      maximumCostUsd: costUsd,
      model: "gpt-5.6-luna",
      serviceTier: "flex",
    });
    hooks.settle({ actualCostUsd: costUsd, id });
  }
  ledger.releaseRun(runId);
  if (ledger.snapshot().totalExposureUsd !== 0.86713) {
    throw new Error("Chained ledger fixture exposure drifted");
  }
  ledger.close();
}

function resetOldLedger(path: string, exposureUsd: number): void {
  rmSync(path, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}-wal`, { force: true });
  initializeLedger(path, exposureUsd);
}

function writeRejectedVariantLineage(archiveRoot: string, markerPath: string) {
  const archiveDirectory = `${ROOT_SOURCE}-to-${FROM_SOURCE}`;
  const archivePath = resolve(archiveRoot, archiveDirectory);
  const archivedStories = resolve(archivePath, "stories");
  mkdirSync(archivedStories, { recursive: true });
  const priorTrace = completedVariantTrace(600, 0.1635525);
  priorTrace.gitSha = ROOT_SOURCE;
  priorTrace.promptVersion = "1.4.11";
  const priorDatabasePath = resolve(archivedStories, "rowan-ashborn.db");
  writeCompletedTraceDatabase(priorDatabasePath, [priorTrace], false);
  const priorDatabase = readFileSync(priorDatabasePath);
  const firstVariant = {
    branchPolicy: "first-offered-choice",
    promptVersion: "1.4.11",
    schemaVersion: "1.1.0-story-review",
  };
  const rejectedVariant = {
    branchPolicy: "least-used-action-type",
    promptVersion: "1.4.12",
    schemaVersion: "1.2.0-story-review",
  };
  const stories = CHARACTER_IDS.map((characterId) => ({
    characterId,
    committedChapters: characterId === "rowan-ashborn" ? 1 : 0,
    databasePresent: characterId === "rowan-ashborn",
    failedTurns: 0,
    traceRunIds: characterId === "rowan-ashborn" ? [priorTrace.runId] : [],
    uniqueResponseCostUsd: characterId === "rowan-ashborn" ? 0.1635525 : 0,
    uniqueResponseCount:
      characterId === "rowan-ashborn"
        ? (priorTrace.attempts as { responseId: string | null }[]).filter(
            ({ responseId }) => responseId !== null,
          ).length
        : 0,
  }));
  const manifest = {
    archivedAt: "2026-07-21T04:26:38.022Z",
    archiveSchemaVersion: "1.0.0-story-review-variant-archive",
    carriedExposureUsd: 0.1635525,
    files: [
      {
        path: "stories/rowan-ashborn.db",
        sha256: sha256Bytes(priorDatabase),
        sizeBytes: priorDatabase.byteLength,
      },
    ],
    fromLedgerSourceId: `fresh:${ROOT_SOURCE}`,
    fromSourceGitSha: ROOT_SOURCE,
    fromTotalCapUsd: 2.544,
    fromVariant: firstVariant,
    fromVariantConfigSha256: sha256Json(firstVariant),
    reason: "narration-route-reversal-and-repetitive-branching",
    stories,
    toSourceGitSha: FROM_SOURCE,
    toTotalCapUsd: 5.088,
    toVariant: rejectedVariant,
    toVariantConfigSha256: sha256Json(rejectedVariant),
    uniqueResponseCostUsd: 0.1635525,
    uniqueResponseCount: stories.reduce((sum, story) => sum + story.uniqueResponseCount, 0),
  };
  const manifestPath = resolve(archivePath, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const marker = {
    archiveDirectory,
    carriedExposureUsd: 0.1635525,
    fromSourceGitSha: ROOT_SOURCE,
    manifestSha256: sha256Bytes(readFileSync(manifestPath)),
    markerSchemaVersion: "1.0.0-story-review-variant-marker",
    reason: "narration-route-reversal-and-repetitive-branching",
    toSourceGitSha: FROM_SOURCE,
    variantConfigSha256: sha256Json(rejectedVariant),
  };
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return marker;
}

function completedVariantTrace(index: number, costUsd: number): Record<string, unknown> {
  const trace = historicalTrace() as Record<string, unknown> & {
    acceptedDelta: { promptVersion: string };
    attempts: { costUsd: number; responseId: string | null }[];
    calls: { responseId: string }[];
    intents: { promptVersion: string }[];
    promptVersion: string;
    runId: string;
    totalEstimatedCostUsd: number;
  };
  trace.gitSha = FROM_SOURCE;
  trace.promptVersion = "1.4.12";
  trace.acceptedDelta.promptVersion = "1.4.12";
  trace.intents.forEach((intent) => {
    intent.promptVersion = "1.4.12";
  });
  trace.runId = randomUUID();
  trace.totalEstimatedCostUsd = costUsd;
  const responseIds = new Map<string, string>();
  let assignedCost = false;
  trace.attempts.forEach((attempt, attemptIndex) => {
    attempt.costUsd = 0;
    if (attempt.responseId === null) return;
    const oldResponseId = attempt.responseId;
    const responseId = `resp_variant_${index}_${attemptIndex}`;
    responseIds.set(oldResponseId, responseId);
    attempt.responseId = responseId;
    if (!assignedCost) {
      attempt.costUsd = costUsd;
      assignedCost = true;
    }
  });
  if (!assignedCost) throw new Error("Trace fixture lacks a response-bearing attempt");
  trace.calls.forEach((call) => {
    call.responseId = responseIds.get(call.responseId) ?? `resp_variant_${index}_call`;
  });
  return trace;
}

function writeCompletedTraceDatabase(
  path: string,
  traces: readonly Record<string, unknown>[],
  duplicateLastAsFailure: boolean,
): void {
  const database = new Database(path);
  database.exec(
    "CREATE TABLE traces (trace_json TEXT NOT NULL); CREATE TABLE failed_turn_traces (trace_json TEXT NOT NULL);",
  );
  const insertTrace = database.prepare("INSERT INTO traces (trace_json) VALUES (?)");
  for (const trace of traces) insertTrace.run(JSON.stringify(trace));
  if (duplicateLastAsFailure) {
    const trace = traces.at(-1)! as Record<string, unknown> & {
      attempts: unknown;
      contractVersion: unknown;
      fixtureId: unknown;
      fixtureVersion: unknown;
      gitSha: unknown;
      pricingVersion: unknown;
      promptVersion: unknown;
      schemaVersion: unknown;
      stateBeforeHash: unknown;
      totalEstimatedCostUsd: unknown;
      totalLatencyMs: unknown;
      totalUsage: unknown;
    };
    database.prepare("INSERT INTO failed_turn_traces (trace_json) VALUES (?)").run(
      JSON.stringify({
        attempts: trace.attempts,
        attemptedChapter: 10,
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
        worldVersion: 10,
      }),
    );
  }
  database.close();
}

function sha256Json(value: unknown): string {
  return sha256Bytes(Buffer.from(JSON.stringify(value)));
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
