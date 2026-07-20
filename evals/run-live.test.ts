import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CHARACTER_IDS,
  CONTRACT_VERSION,
  NARRATIVE_AUDIT_DIMENSIONS,
  PROMPT_VERSION,
} from "@infinite-litrpg/shared";
import { describe, expect, it } from "vitest";

import {
  LegacyLiveReportSchema,
  LiveReportSchema,
  Version6LiveReportSchema,
  assertRegisteredResumeCheckpoint,
  assertResumeHarnessPaths,
  hasExactFullMatrix,
  prepareResume,
  projectedCumulativeCostUsd,
  resultTraceCostMatches,
  writeAtomicJson,
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

describe("live report version 7", () => {
  it("atomically replaces a checkpoint and preserves it when serialization fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "infinite-litrpg-report-"));
    const filename = join(directory, "live.json");
    try {
      writeAtomicJson(filename, { checkpoint: 1 });
      writeAtomicJson(filename, { checkpoint: 2 });
      expect(JSON.parse(readFileSync(filename, "utf8"))).toEqual({ checkpoint: 2 });
      expect(readdirSync(directory)).toEqual(["live.json"]);

      const cyclic: { self?: unknown } = {};
      cyclic.self = cyclic;
      expect(() => writeAtomicJson(filename, cyclic)).toThrow();
      expect(JSON.parse(readFileSync(filename, "utf8"))).toEqual({ checkpoint: 2 });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("strictly parses current data and keeps a strict legacy parser", () => {
    const candidate = emptyReportData();
    const version6 = emptyVersion6ReportData();

    expect(LiveReportSchema.safeParse(candidate).success).toBe(true);
    expect(LiveReportSchema.safeParse({ ...candidate, unexpected: true }).success).toBe(false);
    expect(LiveReportSchema.safeParse({ ...candidate, version: 5 }).success).toBe(false);
    expect(Version6LiveReportSchema.safeParse(version6).success).toBe(true);
    expect(LegacyLiveReportSchema.safeParse({ ...version6, version: 5 }).success).toBe(true);
    expect(LiveReportSchema.safeParse({ ...candidate, version: 4 }).success).toBe(false);
  });

  it("retains contiguous chapter prefixes while preserving every old attempt and rejection", () => {
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
      ["elara-voss", 1],
    ]);
    expect(prepared.retainedPovIds).toEqual(["rowan-ashborn", "elara-voss"]);
    expect(prepared.pendingPovIds).toEqual(CHARACTER_IDS.slice(1));
    expect(prepared.discardedResultCount).toBe(0);
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
    expect(prepareResume(report, { ...REQUIREMENTS, chapterCostCapUsd: 0.05 })).toBeDefined();
    expect(prepareResume(report, { ...REQUIREMENTS, chapterCostCapUsd: 0.07 })).toBeDefined();
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

  it("keeps each retained result under its authenticated source cap", () => {
    const report = fakeReport(
      [fakeResult("rowan-ashborn", 1, 0.029751275), fakeResult("rowan-ashborn", 2, 0.038406625)],
      {
        resultChapterCaps: [
          { capUsd: 0.03, chapter: 1, povId: "rowan-ashborn" },
          { capUsd: 0.04, chapter: 2, povId: "rowan-ashborn" },
        ],
      },
    );

    const prepared = prepareResume(report, { ...REQUIREMENTS, chapterCostCapUsd: 0.0424 });
    expect(prepared.retainedPovIds).toEqual(["rowan-ashborn"]);
    expect(prepared.retainedResultCaps.map(({ capUsd }) => capUsd)).toEqual([0.03, 0.04]);

    expect(() =>
      prepareResume(
        {
          ...report,
          resultChapterCaps: [
            { capUsd: 0.03, chapter: 1, povId: "rowan-ashborn" },
            { capUsd: 0.0384, chapter: 2, povId: "rowan-ashborn" },
          ],
        },
        REQUIREMENTS,
      ),
    ).toThrow("exceeded cap");
  });

  it("allows only audited harness and documentation drift", () => {
    expect(() =>
      assertResumeHarnessPaths([
        "evals/run-live.test.ts",
        "app/src/server/story/story-service.test.ts",
        "docs/PLAN.md",
      ]),
    ).not.toThrow();
    expect(() => assertResumeHarnessPaths(["evals/run-live.ts"])).toThrow("runtime path");
    expect(() =>
      assertResumeHarnessPaths(["evals/run-live.ts"], ["evals/run-live.ts"]),
    ).not.toThrow();
    expect(() => assertResumeHarnessPaths(["app/src/server/story/prompts.ts"])).toThrow(
      "runtime path",
    );
  });

  it("pins every resume artifact to the committed checkpoint registry", () => {
    const reportSha256 = "2e83070e4edfeef14fc9e91c2683090d78636551f736f63898b7521ad32f093a";
    const bridgeSha256 = "d".repeat(64);
    const sourceGitSha = "8ceac05c57960388238cb1161ac140178c6e335a";
    const legacy = LegacyLiveReportSchema.parse({
      ...emptyVersion6ReportData(),
      chapterCostCapUsd: 0.0424,
      cumulativeCostUsd: 2.49105695,
      priorSpendUsd: 2.49105695,
      sourceGitSha,
      version: 5,
    });
    const registry = {
      checkpoints: [
        {
          adapterMode: "sequential",
          bridgeFiles: [{ path: "evals/run-live.ts", sha256: bridgeSha256 }],
          chapterCostCapUsd: 0.0424,
          id: "prompt-1-4-9-rowan-pair",
          priorSpendUsd: 2.49105695,
          promptVersion: PROMPT_VERSION,
          reportSha256,
          reportVersion: 5,
          sourceGitSha,
        },
      ],
      version: 2,
    };
    const currentFileHashes = { "evals/run-live.ts": bridgeSha256 };

    expect(() =>
      assertRegisteredResumeCheckpoint(legacy, reportSha256, registry, currentFileHashes),
    ).not.toThrow();
    expect(() =>
      assertRegisteredResumeCheckpoint(legacy, "0".repeat(64), registry, currentFileHashes),
    ).toThrow("committed checkpoint registry");
    const versionFlip = Version6LiveReportSchema.parse({
      ...legacy,
      projectedMaximumCumulativeCostUsd: 2.99985695,
      version: 6,
    });
    expect(() =>
      assertRegisteredResumeCheckpoint(versionFlip, reportSha256, registry, currentFileHashes),
    ).toThrow("committed checkpoint registry");
    expect(() =>
      assertRegisteredResumeCheckpoint(
        legacy,
        reportSha256,
        {
          ...registry,
          checkpoints: [{ ...registry.checkpoints[0], sourceGitSha: GIT_SHA }],
        },
        currentFileHashes,
      ),
    ).toThrow("committed checkpoint registry");
    expect(() =>
      assertRegisteredResumeCheckpoint(
        legacy,
        reportSha256,
        {
          ...registry,
          checkpoints: [...registry.checkpoints, registry.checkpoints[0]],
        },
        currentFileHashes,
      ),
    ).toThrow("Resume checkpoint IDs and report hashes must be unique");
    expect(() =>
      assertRegisteredResumeCheckpoint(legacy, reportSha256, registry, {
        "evals/run-live.ts": "e".repeat(64),
      }),
    ).toThrow("audited hash");
  });

  it("parses declared mixed Git provenance and rejects an unlisted result SHA", () => {
    const currentGitSha = "1234567";
    const results = [
      fakeResult("rowan-ashborn", 1, 0.01),
      fakeResult("rowan-ashborn", 2, 0.01),
      fakeResult("elara-voss", 1, 0.01, [0.01], currentGitSha),
    ];
    const attempts = results.flatMap(({ trace }) => trace.attempts);
    const candidate = {
      ...emptyReportData(),
      attempts,
      budgetLedger: {
        activeReservationCount: 0,
        baselineAttemptCostUsd: 0.02,
        headroomUsd: 0.97,
        knownReservationCostUsd: 0.01,
        priorSpendUsd: 2,
        sourceReportSha256: "c".repeat(64),
        totalCapUsd: 3,
        totalExposureUsd: 2.03,
        uncertainReservationCostUsd: 0,
      },
      completedChapters: results.length,
      cumulativeCostUsd: 2.03,
      projectedMaximumCumulativeCostUsd: 2.62,
      resultChapterCaps: results.map(({ chapter, povId }) => ({
        capUsd: 0.06,
        chapter,
        povId,
      })),
      results,
      resume: {
        bridgeFiles: [{ path: "evals/run-live.ts", sha256: "d".repeat(64) }],
        changedPaths: ["evals/run-live.ts"],
        discardedResultCount: 0,
        existingAttemptCostUsd: 0.02,
        retainedPovIds: ["rowan-ashborn"],
        retainedResults: [
          {
            chapter: 1,
            povId: "rowan-ashborn",
            sourceChapterCapUsd: 0.06,
            sourceGitSha: GIT_SHA,
          },
          {
            chapter: 2,
            povId: "rowan-ashborn",
            sourceChapterCapUsd: 0.06,
            sourceGitSha: GIT_SHA,
          },
        ],
        sourceChapterCostCapUsd: 0.06,
        sourceGitSha: GIT_SHA,
        sourceReportPath: "legacy.json",
        sourceReportSha256: "c".repeat(64),
        sourceReportVersion: 5,
      },
      sourceGitSha: currentGitSha,
      totalCostUsd: 0.03,
    };

    expect(LiveReportSchema.safeParse(candidate).success).toBe(true);
    const tampered = {
      ...candidate,
      results: candidate.results.map((result, index) =>
        index === 2 ? { ...result, trace: { ...result.trace, gitSha: GIT_SHA } } : result,
      ),
    };
    expect(LiveReportSchema.safeParse(tampered).success).toBe(false);
    const inflatedNewResultCap = {
      ...candidate,
      resultChapterCaps: candidate.resultChapterCaps.map((entry, index) =>
        index === 2 ? { ...entry, capUsd: 0.1 } : entry,
      ),
    };
    expect(LiveReportSchema.safeParse(inflatedNewResultCap).success).toBe(false);
    const inflatedRetainedCap = {
      ...candidate,
      resultChapterCaps: candidate.resultChapterCaps.map((entry, index) =>
        index === 0 ? { ...entry, capUsd: 0.1 } : entry,
      ),
    };
    expect(LiveReportSchema.safeParse(inflatedRetainedCap).success).toBe(false);
    expect(
      LiveReportSchema.safeParse({
        ...candidate,
        budgetLedger: { ...candidate.budgetLedger, sourceReportSha256: "e".repeat(64) },
      }).success,
    ).toBe(false);
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
    expect(projectedCumulativeCostUsd(2.49105695, 0.10373065, 10, 0.0405)).toBeCloseTo(
      2.9997876,
      10,
    );
  });
});

function emptyReportData(): Record<string, unknown> {
  return {
    adapterMode: "sequential",
    attempts: [],
    auditRejections: [],
    budgetLedger: {
      activeReservationCount: 0,
      baselineAttemptCostUsd: 0,
      headroomUsd: 1,
      knownReservationCostUsd: 0,
      priorSpendUsd: REQUIREMENTS.priorSpendUsd,
      sourceReportSha256: `fresh:${GIT_SHA}`,
      totalCapUsd: 3,
      totalExposureUsd: REQUIREMENTS.priorSpendUsd,
      uncertainReservationCostUsd: 0,
    },
    budgetMode: "durable-request-reservations",
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
    resultChapterCaps: [],
    results: [],
    resume: null,
    sourceGitSha: GIT_SHA,
    startedAt: "2026-07-20T00:00:00.000Z",
    suite: "full",
    totalCostCapUsd: 3,
    totalCostUsd: 0,
    version: 7,
  };
}

function emptyVersion6ReportData(): Record<string, unknown> {
  const report = { ...emptyReportData() };
  delete report.budgetLedger;
  delete report.budgetMode;
  delete report.resultChapterCaps;
  return { ...report, version: 6 };
}

function fakeReport(results: LiveResult[], overrides: Partial<LiveReport> = {}): LiveReport {
  return {
    ...emptyReportData(),
    resultChapterCaps: results.map(({ chapter, povId }) => ({
      capUsd: REQUIREMENTS.chapterCostCapUsd,
      chapter,
      povId,
    })),
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
  gitSha = GIT_SHA,
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
    audit: {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "Passes fixed release rubric.",
        dimension,
        issueCode: "pass" as const,
      })),
      leakedFactIds: [],
      proseHash,
      scores: {
        arcProgress: 2,
        characterAutonomy: 2,
        choiceFulfillment: 2,
        continuity: 2,
        litrpgMechanics: 2,
        povSafety: 2,
        prose: 2,
      },
    },
    chapter,
    costUsd,
    latencyMs: 1,
    povId,
    prose,
    streamChunkCount: 1,
    streamingLatencyMs: 1,
    streamReconstructed: true,
    trace: {
      acceptedDelta: {
        acceptedIntentIds: [],
        clock: {
          convergencePressure: false,
          fromAct: 1,
          fromChapter: 0,
          terminal: false,
          toAct: 1,
          toChapter: 1,
          transitionRequired: false,
        },
        contractVersion: CONTRACT_VERSION,
        events: [],
        expectedWorldVersion: 1,
        knowledgeMutations: [],
        promptVersion: PROMPT_VERSION,
        rejectedIntents: [],
        stateMutations: [],
        surfacedClueFactIds: [],
      },
      adapterMode: "sequential",
      attempts: attemptCosts.map((attemptCost, index) => ({
        agentId: null,
        attempt: index,
        costUsd: attemptCost,
        errorCode: null,
        latencyMs: 1,
        model: "gpt-5.6-terra" as const,
        phase: "narration" as const,
        responseId: `resp_attempt_${chapter}_${index}`,
        usage,
      })),
      calls: [
        {
          agentId: null,
          errorCode: null,
          estimatedCostUsd: costUsd,
          latencyMs: 1,
          model: "gpt-5.6-terra",
          phase: "narration",
          reasoningEffort: "none",
          refusal: false,
          responseId: `resp_narration_${chapter}`,
          retries: 0,
          timedOut: false,
          usage,
        },
        {
          agentId: null,
          errorCode: null,
          estimatedCostUsd: 0,
          latencyMs: 1,
          model: "gpt-5.6-luna",
          phase: "audit",
          reasoningEffort: "none",
          refusal: false,
          responseId: `resp_audit_${chapter}`,
          retries: 0,
          timedOut: false,
          usage,
        },
      ],
      contractVersion: CONTRACT_VERSION,
      fixtureId: "test-fixture",
      fixtureVersion: "1.1.0",
      gateResult: "passed",
      gitSha,
      intents: [],
      multiAgentOutputItems: [],
      pricingVersion: "test-pricing",
      promptVersion: PROMPT_VERSION,
      runId: "00000000-0000-4000-8000-000000000001",
      schemaVersion: CONTRACT_VERSION,
      seed: 0,
      stateAfterHash: "a".repeat(64),
      stateBeforeHash: "b".repeat(64),
      totalEstimatedCostUsd: costUsd,
      totalLatencyMs: 1,
      totalUsage: usage,
      validationFailures: [],
    },
    usage,
    wordCount: 900,
  } as unknown as LiveResult;
}
