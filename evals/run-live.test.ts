import { createHash } from "node:crypto";

import { CHARACTER_IDS, PROMPT_VERSION } from "@infinite-litrpg/shared";
import { describe, expect, it } from "vitest";

import {
  LiveReportSchema,
  hasExactFullMatrix,
  prepareResume,
  projectedCumulativeCostUsd,
  resultTraceCostMatches,
  type LiveReport,
  type LiveResult,
  type ResumeRequirements,
} from "./run-live";

const GIT_SHA = "abcdef0";
const REQUIREMENTS: ResumeRequirements = {
  adapterMode: "sequential",
  chapterCostCapUsd: 0.06,
  priorSpendUsd: 2,
  promptVersion: PROMPT_VERSION,
  sourceGitSha: GIT_SHA,
};

describe("live report version 5", () => {
  it("strictly parses an empty resumable full report", () => {
    const candidate = emptyReportData();

    expect(LiveReportSchema.safeParse(candidate).success).toBe(true);
    expect(LiveReportSchema.safeParse({ ...candidate, unexpected: true }).success).toBe(false);
    expect(LiveReportSchema.safeParse({ ...candidate, version: 4 }).success).toBe(false);
  });

  it("retains only exact chapter pairs while preserving every old attempt and rejection", () => {
    const attempts = [{ costUsd: 0.08 }, { costUsd: 0.11 }] as LiveReport["attempts"];
    const auditRejections = [{ marker: "audit" }] as unknown as LiveReport["auditRejections"];
    const draftRejections = [{ marker: "draft" }] as unknown as LiveReport["draftRejections"];
    const report = fakeReport(
      [
        fakeResult("rowan-ashborn", 2, 0.02),
        fakeResult("elara-voss", 1, 0.03),
        fakeResult("rowan-ashborn", 1, 0.01),
      ],
      { attempts, auditRejections, draftRejections },
    );

    const prepared = prepareResume(report, REQUIREMENTS);

    expect(prepared.retainedResults.map(({ povId, chapter }) => [povId, chapter])).toEqual([
      ["rowan-ashborn", 1],
      ["rowan-ashborn", 2],
    ]);
    expect(prepared.retainedPovIds).toEqual(["rowan-ashborn"]);
    expect(prepared.pendingPovIds).toEqual(CHARACTER_IDS.slice(1));
    expect(prepared.discardedResultCount).toBe(1);
    expect(prepared.attempts).toEqual(attempts);
    expect(prepared.auditRejections).toEqual(auditRejections);
    expect(prepared.draftRejections).toEqual(draftRejections);
    expect(prepared.existingAttemptCostUsd).toBeCloseTo(0.19, 10);
  });

  it("discards duplicate chapter numbers instead of treating them as a pair", () => {
    const prepared = prepareResume(
      fakeReport([fakeResult("rowan-ashborn", 1, 0.01), fakeResult("rowan-ashborn", 1, 0.01)]),
      REQUIREMENTS,
    );

    expect(prepared.retainedResults).toEqual([]);
    expect(prepared.discardedResultCount).toBe(2);
    expect(prepared.pendingPovIds).toContain("rowan-ashborn");
  });

  it("rejects checkpoint drift", () => {
    const report = fakeReport([]);

    expect(() => prepareResume(report, { ...REQUIREMENTS, priorSpendUsd: 2.01 })).toThrow(
      "prior spend",
    );
    expect(() => prepareResume(report, { ...REQUIREMENTS, chapterCostCapUsd: 0.05 })).toThrow(
      "chapter cap",
    );
    expect(() =>
      prepareResume(report, { ...REQUIREMENTS, adapterMode: "native-multi-agent" }),
    ).toThrow("adapter");
    expect(() => prepareResume(report, { ...REQUIREMENTS, promptVersion: "changed" })).toThrow(
      "prompt version",
    );
    expect(() => prepareResume(report, { ...REQUIREMENTS, sourceGitSha: "1234567" })).toThrow(
      "Git SHA",
    );
  });

  it("rejects a retained result whose prose and audit hash disagree", () => {
    const first = fakeResult("rowan-ashborn", 1, 0.01);
    const corrupt = {
      ...first,
      audit: { ...first.audit, proseHash: "b".repeat(64) },
    };
    const report = fakeReport([corrupt, fakeResult("rowan-ashborn", 2, 0.01)]);

    expect(() => prepareResume(report, REQUIREMENTS)).toThrow("prose hash");
  });
});

describe("resumed live gates", () => {
  it("requires exactly chapters 1 and 2 for every POV", () => {
    const matrix = CHARACTER_IDS.flatMap((povId) => [
      fakeResult(povId, 1, 0.01),
      fakeResult(povId, 2, 0.01),
    ]);

    expect(hasExactFullMatrix(matrix)).toBe(true);
    expect(hasExactFullMatrix([...matrix.slice(0, -1), fakeResult("rowan-ashborn", 2, 0.01)])).toBe(
      false,
    );
  });

  it("checks each committed cost against only that result trace", () => {
    expect(resultTraceCostMatches(fakeResult("rowan-ashborn", 1, 0.03))).toBe(true);
    expect(resultTraceCostMatches(fakeResult("rowan-ashborn", 1, 0.03, [0.01, 0.01]))).toBe(false);
  });

  it("preflights prior spend, all old attempt cost, and only pending chapter caps", () => {
    expect(projectedCumulativeCostUsd(2, 0.19, 10, 0.06)).toBeCloseTo(2.79, 10);
    expect(projectedCumulativeCostUsd(2.3, 0.19, 10, 0.06)).toBeGreaterThan(3);
  });
});

function emptyReportData(): Record<string, unknown> {
  return {
    adapterMode: "sequential",
    attempts: [],
    auditRejections: [],
    chapterCostCapUsd: REQUIREMENTS.chapterCostCapUsd,
    completedChapters: 0,
    cumulativeCostUsd: REQUIREMENTS.priorSpendUsd,
    draftRejections: [],
    error: null,
    finishedAt: "2026-07-20T00:00:00.000Z",
    gates: {
      allAuditsApproved: false,
      allCommitsCompleted: false,
      allCostsWithinChapterCap: false,
      allPovLeakListsEmpty: false,
      allProseWithinWordLimit: false,
      allStreamsReconstructed: false,
      p95WithinSixtySeconds: false,
      traceCostMatchesAttempts: false,
      totalCostWithinCap: true,
    },
    nativeRequested: false,
    povFilter: null,
    priorSpendUsd: REQUIREMENTS.priorSpendUsd,
    projectedMaximumCumulativeCostUsd: 2.72,
    promptVersion: PROMPT_VERSION,
    results: [],
    resume: null,
    sourceGitSha: GIT_SHA,
    startedAt: "2026-07-20T00:00:00.000Z",
    suite: "full",
    totalCostCapUsd: 3,
    totalCostUsd: 0,
    version: 5,
  };
}

function fakeReport(results: LiveResult[], overrides: Partial<LiveReport> = {}): LiveReport {
  return {
    ...emptyReportData(),
    ...overrides,
    completedChapters: results.length,
    results,
  } as unknown as LiveReport;
}

function fakeResult(
  povId: (typeof CHARACTER_IDS)[number],
  chapter: 1 | 2,
  costUsd: number,
  attemptCosts: number[] = [costUsd],
): LiveResult {
  const prose = Array.from({ length: 900 }, () => "Ash").join(" ");
  const proseHash = createHash("sha256").update(prose).digest("hex");
  const usage = {
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
  return {
    adapterMode: "sequential",
    audit: { approved: true, leakedFactIds: [], proseHash },
    chapter,
    costUsd,
    latencyMs: 1,
    povId,
    prose,
    streamChunkCount: 1,
    streamingLatencyMs: 1,
    streamReconstructed: true,
    trace: {
      adapterMode: "sequential",
      attempts: attemptCosts.map((attemptCost) => ({ costUsd: attemptCost })),
      calls: [{ phase: "narration" }, { phase: "audit" }],
      gateResult: "passed",
      totalEstimatedCostUsd: costUsd,
      totalUsage: usage,
    },
    usage,
    wordCount: 900,
  } as unknown as LiveResult;
}
