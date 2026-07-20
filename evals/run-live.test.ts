import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CHARACTER_IDS,
  CONTRACT_VERSION,
  NARRATIVE_AUDIT_DIMENSIONS,
  PersistedTraceEnvelopeSchema,
  PROMPT_VERSION,
  RUNTIME_SCHEMA_VERSION,
  TraceEnvelopeSchema,
  buildChapterChoiceOptions,
  buildPovContext,
  canonicalizeChapterFrameCandidate,
  resolveTurn,
  stageWorldDelta,
  type ChapterFrame,
  type PlayerAction,
  type WorldDelta,
  type WorldIntent,
  type WorldState,
  validateWorldState,
} from "@infinite-litrpg/shared";
import { describe, expect, it } from "vitest";

import {
  LegacyLiveReportSchema,
  LiveReportSchema,
  NarrativeCandidateEvidenceSchema,
  Version6LiveReportSchema,
  Version7LiveReportSchema,
  Version8LiveReportSchema,
  assertCommittedReportMatchesSidecar,
  assertRegisteredResumeCheckpoint,
  assertResumeHarnessPaths,
  createLiveRunFinalizationState,
  hasExactFullMatrix,
  isAppendOnlyEvidence,
  parseLiveReport,
  parseRerunFrom,
  prepareResume,
  projectedCumulativeCostUsd,
  readNarrativeEvidenceSidecar,
  resultTraceCostMatches,
  writeAtomicJson,
  writeNarrativeEvidenceSidecar,
  type LiveReport,
  type LiveResult,
  type ResumeRequirements,
  type Version7LiveReport,
} from "./run-live";

const GIT_SHA = "abcdef0";
const REQUIREMENTS: ResumeRequirements = {
  adapterMode: "sequential",
  chapterCostCapUsd: 0.06,
  priorSpendUsd: 2,
  promptVersion: PROMPT_VERSION,
  sourceGitSha: GIT_SHA,
  serviceTier: "flex",
};
const STANDARD_REQUIREMENTS: ResumeRequirements = { ...REQUIREMENTS, serviceTier: "standard" };

describe("live report version 9", () => {
  it("keeps the submitted Rowan trace strict and internally totaled", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "docs", "evidence", "rowan-chapter-1-trace.json"), "utf8"),
    ) as unknown;
    const trace = PersistedTraceEnvelopeSchema.parse(raw);
    const attemptCostUsd = trace.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
    const attemptUsage = trace.attempts.reduce(
      (total, attempt) => ({
        cacheWriteTokens: total.cacheWriteTokens + attempt.usage.cacheWriteTokens,
        cachedInputTokens: total.cachedInputTokens + attempt.usage.cachedInputTokens,
        inputTokens: total.inputTokens + attempt.usage.inputTokens,
        outputTokens: total.outputTokens + attempt.usage.outputTokens,
        reasoningTokens: total.reasoningTokens + attempt.usage.reasoningTokens,
        totalTokens: total.totalTokens + attempt.usage.totalTokens,
      }),
      {
        cacheWriteTokens: 0,
        cachedInputTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
    );

    expect(trace.gateResult).toBe("passed");
    expect(trace.promptVersion).toBe("1.4.11");
    expect(trace.schemaVersion).toBe("1.1.0-runtime-candidates-5");
    expect(trace.totalEstimatedCostUsd).toBeCloseTo(attemptCostUsd, 12);
    expect(trace.totalUsage).toEqual(attemptUsage);
    expect(
      trace.attempts.every(
        (attempt) => attempt.requestedServiceTier === "flex" && attempt.serviceTier === "flex",
      ),
    ).toBe(true);
    expect(
      trace.calls.every(
        (call) => call.requestedServiceTier === "flex" && call.serviceTier === "flex",
      ),
    ).toBe(true);
  });

  it("accepts only append-only stale-run evidence", () => {
    const checkpointed = [{ id: 1 }, { id: 2 }];
    expect(isAppendOnlyEvidence(checkpointed, [...checkpointed, { id: 3 }])).toBe(true);
    expect(isAppendOnlyEvidence(checkpointed, [{ id: 1 }, { id: 9 }])).toBe(false);
    expect(isAppendOnlyEvidence(checkpointed, [{ id: 2 }, { id: 1 }])).toBe(false);
    expect(isAppendOnlyEvidence(checkpointed, [{ id: 1 }])).toBe(false);
  });

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

  it("atomically checkpoints narrative evidence before a report exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "infinite-litrpg-evidence-"));
    const filename = join(directory, "narrative-candidates.json");
    try {
      writeNarrativeEvidenceSidecar(
        filename,
        fakeResult("rowan-ashborn", 1, 0).trace.attempts,
        [NarrativeCandidateEvidenceSchema.parse(fakeNarrativeCandidate())],
        fakeNarrativeResponses([fakeNarrativeCandidate()]),
        0,
        [],
        "flex",
        "openai-flex-explicit-no-cache-2026-07-20",
        GIT_SHA,
        "00000000-0000-4000-8000-000000000088",
      );
      const sidecar = JSON.parse(readFileSync(filename, "utf8")) as {
        attempts: LiveReport["attempts"];
        candidates: unknown[];
        pricingVersion: string;
        runtimeAttemptEvidence: LiveReport["runtimeAttemptEvidence"];
        runtimeSchemaVersion: string;
        serviceTier: string;
      };
      expect(sidecar.candidates).toHaveLength(1);
      expect(sidecar.runtimeSchemaVersion).toBe(RUNTIME_SCHEMA_VERSION);
      expect(sidecar.pricingVersion).toBe("openai-flex-explicit-no-cache-2026-07-20");
      expect(sidecar.serviceTier).toBe("flex");
      expect(
        readNarrativeEvidenceSidecar(
          filename,
          "00000000-0000-4000-8000-000000000088",
          GIT_SHA,
          "flex",
          "openai-flex-explicit-no-cache-2026-07-20",
        ).narrativeResponses,
      ).toHaveLength(2);
      expect(() =>
        readNarrativeEvidenceSidecar(
          filename,
          "00000000-0000-4000-8000-000000000089",
          GIT_SHA,
          "flex",
          "openai-flex-explicit-no-cache-2026-07-20",
        ),
      ).toThrow("different stale run");
      expect(() =>
        readNarrativeEvidenceSidecar(
          filename,
          "00000000-0000-4000-8000-000000000088",
          GIT_SHA,
          "standard",
          "openai-standard-explicit-no-cache-2026-07-20",
        ),
      ).toThrow("service tier");
      writeAtomicJson(filename, {
        ...sidecar,
        attempts: sidecar.attempts.map((attempt, index) =>
          index === 0 ? { ...attempt, serviceTier: "standard" } : attempt,
        ),
      });
      expect(() =>
        readNarrativeEvidenceSidecar(
          filename,
          "00000000-0000-4000-8000-000000000088",
          GIT_SHA,
          "flex",
          "openai-flex-explicit-no-cache-2026-07-20",
        ),
      ).toThrow("mixed service-tier attempts");
      expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("authenticates an already committed report against its exact sidecar", () => {
    const directory = mkdtempSync(join(tmpdir(), "infinite-litrpg-committed-report-"));
    const filename = join(directory, "narrative-candidates.json");
    const runId = "00000000-0000-4000-8000-000000000091";
    try {
      const report = fakeSmokeReport();
      writeNarrativeEvidenceSidecar(
        filename,
        report.attempts,
        report.narrativeCandidates,
        report.narrativeResponses,
        report.runtimeEvidenceStartAttemptIndex,
        report.runtimeAttemptEvidence,
        report.serviceTier,
        report.pricingVersion,
        report.sourceGitSha,
        runId,
        report.supersededTurnIds,
      );
      const evidence = readNarrativeEvidenceSidecar(
        filename,
        runId,
        report.sourceGitSha,
        report.serviceTier,
        report.pricingVersion,
      );

      expect(assertCommittedReportMatchesSidecar(report, evidence, runId)).toEqual({
        knownReservationCount: report.attempts.length,
        uncertainReservationCount: 0,
      });
      expect(() =>
        assertCommittedReportMatchesSidecar(report, { ...evidence, candidates: [] }, runId),
      ).toThrow("does not exactly match");
      expect(() =>
        assertCommittedReportMatchesSidecar(
          report,
          evidence,
          "00000000-0000-4000-8000-000000000092",
        ),
      ).toThrow("metadata does not match");

      const uncertainAttempts = report.attempts.map((attempt) => ({
        ...attempt,
        serviceTier: null,
      }));
      const uncertainRuntimeEvidence = report.runtimeAttemptEvidence.map(({ attempt, turn }) => ({
        attempt: { ...attempt, serviceTier: null },
        turn,
      }));
      const uncertainReport = {
        ...report,
        attempts: uncertainAttempts,
        runtimeAttemptEvidence: uncertainRuntimeEvidence,
      } as LiveReport;
      const uncertainEvidence = {
        ...evidence,
        attempts: uncertainAttempts,
        runtimeAttemptEvidence: uncertainRuntimeEvidence,
      };
      expect(
        assertCommittedReportMatchesSidecar(uncertainReport, uncertainEvidence, runId),
      ).toEqual({
        knownReservationCount: 0,
        uncertainReservationCount: report.attempts.length,
      });
      writeAtomicJson(filename, uncertainEvidence);
      expect(() =>
        readNarrativeEvidenceSidecar(
          filename,
          runId,
          report.sourceGitSha,
          report.serviceTier,
          report.pricingVersion,
        ),
      ).toThrow("mixed service-tier attempts");
      expect(
        readNarrativeEvidenceSidecar(
          filename,
          runId,
          report.sourceGitSha,
          report.serviceTier,
          report.pricingVersion,
          true,
        ).attempts,
      ).toHaveLength(report.attempts.length);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("strictly parses exact version 9, 8, 7, 6, and 5 data", () => {
    const candidate = emptyReportData();
    const version8 = emptyVersion8ReportData();
    const version7 = emptyVersion7ReportData();
    const version6 = emptyVersion6ReportData();
    const version5 = { ...version6, version: 5 };

    expect(LiveReportSchema.safeParse(candidate).success).toBe(true);
    expect(LiveReportSchema.safeParse({ ...candidate, unexpected: true }).success).toBe(false);
    expect(LiveReportSchema.safeParse(version7).success).toBe(false);
    expect(Version8LiveReportSchema.safeParse(version8).success).toBe(true);
    expect(Version7LiveReportSchema.safeParse(version7).success).toBe(true);
    expect(Version7LiveReportSchema.safeParse(candidate).success).toBe(false);
    expect(Version6LiveReportSchema.safeParse(version6).success).toBe(true);
    expect(LegacyLiveReportSchema.safeParse(version5).success).toBe(true);
    expect(LiveReportSchema.safeParse({ ...candidate, version: 4 }).success).toBe(false);
    expect(
      [candidate, version8, version7, version6, version5].map(
        (report) => parseLiveReport(report).version,
      ),
    ).toEqual([9, 8, 7, 6, 5]);
  });

  it("recomputes every stored release gate", () => {
    const report = emptyReportData();
    for (const gate of Object.keys(report.gates as Record<string, boolean>)) {
      const gates = report.gates as Record<string, boolean>;
      expect(
        LiveReportSchema.safeParse({
          ...report,
          gates: { ...gates, [gate]: !gates[gate] },
        }).success,
        gate,
      ).toBe(false);
    }
  });

  it.each([
    ["missing", undefined],
    ["mixed", "standard"],
  ])("rejects %s observed service-tier evidence", (_label, observedTier) => {
    const report = fakeSmokeReport();
    const attempts = report.attempts.map((attempt, index) =>
      index === 0 ? { ...attempt, serviceTier: observedTier } : attempt,
    );
    expect(LiveReportSchema.safeParse({ ...report, attempts }).success).toBe(false);
  });

  it("requires explicit tier fields even for Standard version 9 evidence", () => {
    const report = standardSmokeReport();
    expect(LiveReportSchema.safeParse(report).success).toBe(true);
    const firstAttempt = report.attempts[0];
    const firstResult = report.results[0];
    const firstCall = firstResult?.trace.calls[0];
    if (!firstAttempt || !firstResult || !firstCall)
      throw new Error("Standard fixture is incomplete");
    const { serviceTier: _attemptTier, ...attemptWithoutTier } = firstAttempt;
    const { requestedServiceTier: _requestedTier, ...callWithoutRequestedTier } = firstCall;
    void _attemptTier;
    void _requestedTier;

    expect(
      LiveReportSchema.safeParse({
        ...report,
        attempts: [attemptWithoutTier, ...report.attempts.slice(1)],
      }).success,
    ).toBe(false);
    expect(
      LiveReportSchema.safeParse({
        ...report,
        results: [
          {
            ...firstResult,
            trace: {
              ...firstResult.trace,
              calls: [callWithoutRequestedTier, ...firstResult.trace.calls.slice(1)],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("forbids Standard processing on full version 9 reports", () => {
    expect(
      LiveReportSchema.safeParse({
        ...emptyReportData(),
        cleanPathProjectedCostUsd: 0.208988,
        pricingVersion: "openai-standard-explicit-no-cache-2026-07-20",
        projectedFinalExposureUsd: 2.208988,
        serviceTier: "standard",
      }).success,
    ).toBe(false);
  });

  it("binds turns, attempts, canon, and stream transcripts to committed evidence", () => {
    const report = fakeSmokeReport();
    expect(LiveReportSchema.safeParse(report).success).toBe(true);

    const differentTurnId = fakeUuid(999);
    expect(
      LiveReportSchema.safeParse({
        ...report,
        narrativeCandidates: report.narrativeCandidates.map((candidate) => ({
          ...candidate,
          turn: { ...candidate.turn, turnId: differentTurnId },
        })),
        narrativeResponses: report.narrativeResponses.map((response) => ({
          ...response,
          turn: { ...response.turn, turnId: differentTurnId },
        })),
        runtimeAttemptEvidence: report.runtimeAttemptEvidence.map((evidence) => ({
          ...evidence,
          turn: { ...evidence.turn, turnId: differentTurnId },
        })),
      }).success,
    ).toBe(false);

    const narrationIndex = report.attempts.findIndex(({ phase }) => phase === "narration");
    expect(narrationIndex).toBeGreaterThanOrEqual(0);
    const changedAttempts = report.attempts.map((attempt, index) =>
      index === narrationIndex ? { ...attempt, costUsd: attempt.costUsd + 0.001 } : attempt,
    );
    expect(
      LiveReportSchema.safeParse({
        ...report,
        attempts: changedAttempts,
        cumulativeCostUsd: report.cumulativeCostUsd + 0.001,
        runtimeAttemptEvidence: report.runtimeAttemptEvidence.map((evidence, index) =>
          index === narrationIndex ? { ...evidence, attempt: changedAttempts[index] } : evidence,
        ),
        totalCostUsd: report.totalCostUsd + 0.001,
      }).success,
    ).toBe(false);

    const inventedFactId = "invented-visible-fact";
    expect(
      LiveReportSchema.safeParse({
        ...report,
        narrativeCandidates: report.narrativeCandidates.map((candidate) => ({
          ...candidate,
          allowedFactIds: [...candidate.allowedFactIds, inventedFactId],
        })),
        results: report.results.map((result) => ({
          ...result,
          canonicalNarrativeInput: {
            ...result.canonicalNarrativeInput,
            allowedFactIds: [
              ...(result.canonicalNarrativeInput?.allowedFactIds ?? []),
              inventedFactId,
            ],
          },
        })),
      }).success,
    ).toBe(false);

    expect(
      LiveReportSchema.safeParse({
        ...report,
        results: report.results.map((result) => ({ ...result, streamChunks: ["changed"] })),
      }).success,
    ).toBe(false);
  });

  it("binds intent and frame calls to the committed turn", () => {
    const base = fakeResult("rowan-ashborn", 1, 0);
    const intentAttempt = {
      ...base.trace.attempts[0],
      agentId: "maelin-rook",
      attempt: 0,
      errorCode: null,
      phase: "intent" as const,
      responseId: "resp_intent_bound",
    };
    const intentCall = {
      ...base.trace.calls[0],
      agentId: "maelin-rook",
      estimatedCostUsd: 0,
      phase: "intent" as const,
      responseId: "resp_intent_bound",
      retries: 0,
    };
    const result = {
      ...base,
      trace: {
        ...base.trace,
        attempts: [intentAttempt, ...base.trace.attempts],
        calls: [intentCall, ...base.trace.calls],
      },
    } as LiveResult;
    const candidate = fakeNarrativeCandidate(result);
    const report = {
      ...fakeSmokeReport(),
      attempts: result.trace.attempts,
      narrativeCandidates: [candidate],
      narrativeResponses: fakeNarrativeResponses([candidate]),
      results: [result],
      runtimeAttemptEvidence: fakeRuntimeAttemptEvidence([result]),
    };
    expect(LiveReportSchema.safeParse(report).success).toBe(true);

    expect(
      LiveReportSchema.safeParse({
        ...report,
        runtimeAttemptEvidence: report.runtimeAttemptEvidence.map((evidence, index) =>
          index === 0
            ? {
                ...evidence,
                turn: {
                  ...evidence.turn,
                  requestId: fakeUuid(990),
                  turnId: fakeUuid(991),
                },
              }
            : evidence,
        ),
      }).success,
    ).toBe(false);
  });

  it("binds a retried narration call across interleaved nested attempts", () => {
    const base = fakeResult("rowan-ashborn", 1, 0);
    const baseNarration = base.trace.attempts.find(({ phase }) => phase === "narration");
    const baseAudit = base.trace.attempts.find(({ phase }) => phase === "audit");
    const narrationCall = base.trace.calls.find(({ phase }) => phase === "narration");
    const auditCall = base.trace.calls.find(({ phase }) => phase === "audit");
    if (!baseNarration || !baseAudit || !narrationCall || !auditCall) {
      throw new Error("Fake retry trace inputs disappeared");
    }
    const recoveryAttempt = {
      ...baseNarration,
      errorCode: "INVALID_OUTPUT",
      phase: "recovery" as const,
      responseId: "resp_interleaved_recovery",
    };
    const rejectedNarrationAttempt = {
      ...baseNarration,
      errorCode: "NARRATIVE_AUDIT_REJECTED",
      responseId: "resp_interleaved_narration_rejected",
    };
    const acceptedNarrationAttempt = { ...baseNarration, attempt: 1 };
    const result = {
      ...base,
      trace: {
        ...base.trace,
        attempts: [recoveryAttempt, rejectedNarrationAttempt, baseAudit, acceptedNarrationAttempt],
        calls: [{ ...narrationCall, retries: 1 }, auditCall],
      },
    } as LiveResult;
    const candidate = fakeNarrativeCandidate(result);
    const turn = fakeTurnIdentity(result);
    const rawResponse = (
      attempt: LiveReport["attempts"][number],
      phase: "narration" | "recovery",
    ) => ({
      attempt: attempt.attempt,
      bufferedOutputText: result.prose,
      chapter: result.chapter,
      phase,
      povId: result.povId,
      rawOutputText: result.prose,
      responseId: attempt.responseId ?? "missing-response",
      sourceGitSha: result.trace.gitSha,
      status: "completed" as const,
      turn,
      worldVersionAfter: turn.worldVersionAfter,
      worldVersionBefore: turn.worldVersionBefore,
    });
    const report = {
      ...fakeSmokeReport(),
      attempts: result.trace.attempts,
      narrativeCandidates: [candidate],
      narrativeResponses: [
        rawResponse(recoveryAttempt, "recovery"),
        rawResponse(rejectedNarrationAttempt, "narration"),
        ...fakeNarrativeResponses([candidate]),
      ],
      results: [result],
      runtimeAttemptEvidence: fakeRuntimeAttemptEvidence([result]),
    };

    expect(LiveReportSchema.safeParse(report).success).toBe(true);
  });

  it("allows authenticated retries of the same pending chapter to use new turn IDs", () => {
    const report = fakeSmokeReport();
    const acceptedCandidate = report.narrativeCandidates[0];
    const acceptedNarration = report.attempts.find(({ phase }) => phase === "narration");
    if (!acceptedCandidate || !acceptedNarration)
      throw new Error("Fake smoke evidence disappeared");
    const failedTurn = {
      ...acceptedCandidate.turn,
      requestId: fakeUuid(992),
      turnId: fakeUuid(993),
    };
    const failedAttempt = {
      ...acceptedNarration,
      errorCode: "INVALID_OUTPUT",
      responseId: "resp_failed_prior_turn",
    };
    const failedCandidate = NarrativeCandidateEvidenceSchema.parse({
      ...acceptedCandidate,
      accepted: false,
      audit: null,
      auditAttempts: [],
      auditResponseId: null,
      deterministicIssues: [
        { code: "INVALID_SCHEMA", message: "Prior draft failed", path: "prose" },
      ],
      frame: { ...acceptedCandidate.frame, title: "Prior Failed Frame" },
      narratorResponseId: failedAttempt.responseId,
      rejectionStage: "deterministic",
      turn: failedTurn,
    });
    const failedResponse = {
      ...report.narrativeResponses.find(({ phase }) => phase === "narration"),
      responseId: failedAttempt.responseId,
      turn: failedTurn,
    };
    const resumed = {
      ...report,
      attempts: [failedAttempt, ...report.attempts],
      narrativeCandidates: [failedCandidate, ...report.narrativeCandidates],
      narrativeResponses: [failedResponse, ...report.narrativeResponses],
      runtimeAttemptEvidence: [
        { attempt: failedAttempt, turn: failedTurn },
        ...report.runtimeAttemptEvidence,
      ],
    };

    expect(LiveReportSchema.safeParse(resumed).success).toBe(true);
  });

  it("carries a legacy runtime-evidence gap across version 8 resumes", () => {
    const report = fakeSmokeReport();
    const legacyAttempt = {
      ...report.attempts[0],
      agentId: "maelin-rook",
      phase: "intent" as const,
      responseId: "resp_legacy_without_v8_evidence",
    };
    const sourceHash = "c".repeat(64);
    const resumedFromVersion7 = {
      ...report,
      attempts: [legacyAttempt, ...report.attempts],
      budgetLedger: { ...report.budgetLedger, sourceReportSha256: sourceHash },
      resume: {
        bridgeFiles: [],
        changedPaths: [],
        discardedResultCount: 0,
        existingAttemptCostUsd: 0,
        retainedPovIds: ["rowan-ashborn"],
        retainedResults: [
          {
            chapter: 1,
            povId: "rowan-ashborn",
            sourceChapterCapUsd: REQUIREMENTS.chapterCostCapUsd,
            sourceGitSha: GIT_SHA,
          },
        ],
        sourceChapterCostCapUsd: REQUIREMENTS.chapterCostCapUsd,
        sourceGitSha: GIT_SHA,
        sourceReportPath: "version-7.json",
        sourceReportSha256: sourceHash,
        sourceReportVersion: 7,
      },
      runtimeEvidenceStartAttemptIndex: 1,
    };
    expect(LiveReportSchema.safeParse(resumedFromVersion7).success).toBe(true);

    const resumedAgain = {
      ...resumedFromVersion7,
      resume: { ...resumedFromVersion7.resume, sourceReportVersion: 8 },
    };
    expect(LiveReportSchema.safeParse(resumedAgain).success).toBe(true);
    expect(
      prepareResume(
        { ...LiveReportSchema.parse(resumedAgain), suite: "full" } as LiveReport,
        REQUIREMENTS,
      ),
    ).toMatchObject({ runtimeEvidenceStartAttemptIndex: 1 });
  });

  it("parses a crash checkpoint with settled audit response evidence before a candidate", () => {
    const result = fakeResult("rowan-ashborn", 1, 0);
    const auditAttempt = result.trace.attempts.find(({ phase }) => phase === "audit");
    const auditResponse = fakeNarrativeResponses([fakeNarrativeCandidate(result)]).find(
      ({ phase }) => phase === "audit",
    );
    if (!auditAttempt || !auditResponse) throw new Error("Fake audit evidence disappeared");
    const report = {
      ...emptyReportData(),
      attempts: [auditAttempt],
      gates: {
        ...(emptyReportData().gates as Record<string, boolean>),
        serviceTierEvidenceComplete: true,
      },
      narrativeResponses: [auditResponse],
      runtimeAttemptEvidence: [{ attempt: auditAttempt, turn: fakeTurnIdentity(result) }],
    };
    expect(LiveReportSchema.safeParse(report).success).toBe(true);
    expect(LiveReportSchema.safeParse({ ...report, narrativeResponses: [] }).success).toBe(false);
  });

  it("cannot claim commit completion when the run ended with an error", () => {
    const report = fakeSmokeReport();
    const failed = {
      ...report,
      error: { code: "FAILED", message: "Failure after evidence capture" },
      gates: { ...report.gates, allCommitsCompleted: false },
    };
    expect(LiveReportSchema.safeParse(failed).success).toBe(true);
    expect(
      LiveReportSchema.safeParse({
        ...failed,
        gates: { ...failed.gates, allCommitsCompleted: true },
      }).success,
    ).toBe(false);
  });

  it("requires complete, internally consistent failed-candidate evidence", () => {
    const evidenceResult = fakeResult("rowan-ashborn", 1, 0);
    const candidate = fakeNarrativeCandidate(evidenceResult);

    expect(NarrativeCandidateEvidenceSchema.safeParse(candidate).success).toBe(true);
    expect(
      NarrativeCandidateEvidenceSchema.safeParse({ ...candidate, rawWordCount: 899 }).success,
    ).toBe(false);
    const report = {
      ...emptyReportData(),
      attempts: evidenceResult.trace.attempts,
      gates: {
        ...(emptyReportData().gates as Record<string, boolean>),
        serviceTierEvidenceComplete: true,
      },
      narrativeCandidates: [candidate],
      narrativeResponses: fakeNarrativeResponses([candidate]),
      runtimeAttemptEvidence: fakeRuntimeAttemptEvidence([evidenceResult]),
    };
    expect(LiveReportSchema.safeParse(report).success).toBe(true);
    expect(
      NarrativeCandidateEvidenceSchema.safeParse({
        ...candidate,
        auditAttempts: candidate.auditAttempts.map((attempt, index) =>
          index === 0 ? { ...attempt, rawOutputText: '{"scores":[]}' } : attempt,
        ),
      }).success,
    ).toBe(false);
    expect(
      NarrativeCandidateEvidenceSchema.safeParse({
        ...candidate,
        audit: {
          ...candidate.audit,
          evidence: candidate.audit?.evidence.map((entry, index) =>
            index === 0 ? { ...entry, detail: "Fabricated approval." } : entry,
          ),
        },
      }).success,
    ).toBe(false);
    expect(LiveReportSchema.safeParse({ ...report, narrativeResponses: [] }).success).toBe(false);
    expect(
      LiveReportSchema.safeParse({
        ...report,
        narrativeCandidates: [candidate, candidate],
      }).success,
    ).toBe(false);
    expect(
      Version7LiveReportSchema.safeParse({
        ...emptyVersion7ReportData(),
        narrativeCandidates: [candidate],
      }).success,
    ).toBe(false);
  });

  it("reads authenticated 1.4.9 traces without weakening current writes", () => {
    const result = historicalResult(fakeResult("rowan-ashborn", 1, 0.01));
    const candidate = {
      ...emptyVersion7ReportData(),
      attempts: result.trace.attempts,
      budgetLedger: {
        activeReservationCount: 0,
        baselineAttemptCostUsd: 0,
        headroomUsd: 0.99,
        knownReservationCostUsd: 0.01,
        priorSpendUsd: REQUIREMENTS.priorSpendUsd,
        sourceReportSha256: `fresh:${GIT_SHA}`,
        totalCapUsd: 3,
        totalExposureUsd: 2.01,
        uncertainReservationCostUsd: 0,
      },
      completedChapters: 1,
      cumulativeCostUsd: 2.01,
      gates: {
        ...(emptyVersion7ReportData().gates as Record<string, boolean>),
        p95WithinSixtySeconds: true,
      },
      promptVersion: "1.4.9",
      resultChapterCaps: [
        { capUsd: REQUIREMENTS.chapterCostCapUsd, chapter: 1, povId: "rowan-ashborn" },
      ],
      results: [result],
      totalCostUsd: 0.01,
    };

    expect(TraceEnvelopeSchema.safeParse(result.trace).success).toBe(false);
    expect(PersistedTraceEnvelopeSchema.safeParse(result.trace).success).toBe(true);
    const historicalParse = Version7LiveReportSchema.safeParse(candidate);
    expect(
      historicalParse.success,
      historicalParse.success ? undefined : JSON.stringify(historicalParse.error.issues),
    ).toBe(true);
    expect(
      Version7LiveReportSchema.safeParse({
        ...candidate,
        results: [
          {
            ...result,
            trace: {
              ...result.trace,
              acceptedDelta: {
                ...result.trace.acceptedDelta,
                promptVersion: PROMPT_VERSION,
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("retains contiguous chapter prefixes while preserving every old attempt and rejection", () => {
    const seedAttempt = fakeResult("rowan-ashborn", 1, 0).trace.attempts[0];
    if (!seedAttempt) throw new Error("Fake result lost its first runtime attempt");
    const attempts: LiveReport["attempts"] = [
      { ...seedAttempt, costUsd: 0.08, responseId: "resp_retained_attempt_0" },
      { ...seedAttempt, attempt: 1, costUsd: 0.11, responseId: "resp_retained_attempt_1" },
    ];
    const auditRejections = [{ marker: "audit" }] as unknown as LiveReport["auditRejections"];
    const draftRejections = [{ marker: "draft" }] as unknown as LiveReport["draftRejections"];
    const narrativeCandidates = [
      fakeNarrativeCandidate(),
    ] as unknown as LiveReport["narrativeCandidates"];
    const report = fakeReport(
      [
        fakeResult("rowan-ashborn", 2, 0.02),
        fakeResult("elara-voss", 1, 0.03),
        fakeResult("rowan-ashborn", 1, 0.01),
      ],
      {
        attempts,
        auditRejections,
        draftRejections,
        gates: {
          ...(emptyReportData().gates as LiveReport["gates"]),
          serviceTierEvidenceComplete: true,
        },
        narrativeCandidates,
      },
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
    expect(prepared.narrativeCandidates).toEqual(narrativeCandidates);
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

  it("reruns only explicitly human-rejected chapter suffixes", () => {
    const report = fakeReport([
      fakeResult("rowan-ashborn", 1, 0.01),
      fakeResult("rowan-ashborn", 2, 0.01),
      fakeResult("elara-voss", 1, 0.01),
      fakeResult("elara-voss", 2, 0.01),
      fakeResult("maelin-rook", 1, 0.01),
      fakeResult("maelin-rook", 2, 0.01),
    ]);

    const prepared = prepareResume(report, REQUIREMENTS, [
      { chapter: 2, povId: "rowan-ashborn" },
      { chapter: 1, povId: "elara-voss" },
    ]);

    expect(prepared.rerunFrom).toEqual([
      { chapter: 2, povId: "rowan-ashborn" },
      { chapter: 1, povId: "elara-voss" },
    ]);
    expect(prepared.retainedPovIds).toEqual(["rowan-ashborn", "maelin-rook"]);
    expect(prepared.retainedResults.map(({ povId, chapter }) => [povId, chapter])).toEqual([
      ["rowan-ashborn", 1],
      ["maelin-rook", 1],
      ["maelin-rook", 2],
    ]);
    expect(prepared.pendingPovIds).toEqual([
      "rowan-ashborn",
      "elara-voss",
      "varek-thorn",
      "lucan-aurelis",
      "nyra-vale",
    ]);
    expect(prepared.discardedResultCount).toBe(3);
    expect(prepared.existingAttemptCostUsd).toBeCloseTo(report.totalCostUsd, 10);
  });

  it("marks discarded source turns superseded without deleting paid evidence", () => {
    const results = [fakeResult("rowan-ashborn", 1, 0.01), fakeResult("rowan-ashborn", 2, 0.01)];
    const narrativeCandidates = results.map((result) => fakeNarrativeCandidate(result));
    const report = fakeReport(results, {
      attempts: results.flatMap(({ trace }) => trace.attempts),
      gates: {
        ...(emptyReportData().gates as LiveReport["gates"]),
        serviceTierEvidenceComplete: true,
      },
      narrativeCandidates,
      narrativeResponses: fakeNarrativeResponses(narrativeCandidates),
      runtimeAttemptEvidence: fakeRuntimeAttemptEvidence(results),
    });

    const prepared = prepareResume(report, REQUIREMENTS, [{ chapter: 2, povId: "rowan-ashborn" }]);

    expect(prepared.attempts).toHaveLength(report.attempts.length);
    expect(prepared.narrativeCandidates).toHaveLength(report.narrativeCandidates.length);
    expect(prepared.narrativeResponses).toHaveLength(report.narrativeResponses.length);
    expect(prepared.runtimeAttemptEvidence).toHaveLength(report.runtimeAttemptEvidence.length);
    expect(prepared.supersededTurnIds).toEqual([results[1]!.trace.runId]);
  });

  it("holds the ledger lock until the final report commits", () => {
    const normalRun = createLiveRunFinalizationState();
    const recoveryRun = createLiveRunFinalizationState();

    expect(normalRun.reportCommitted).toBe(false);
    expect(recoveryRun.reportCommitted).toBe(false);
    normalRun.reportCommitted = true;
    expect(normalRun.reportCommitted).toBe(true);
  });

  it("rejects duplicate or incomplete explicit chapter suffix reruns", () => {
    const complete = fakeReport([
      fakeResult("rowan-ashborn", 1, 0.01),
      fakeResult("rowan-ashborn", 2, 0.01),
    ]);
    expect(() =>
      prepareResume(complete, REQUIREMENTS, [
        { chapter: 1, povId: "rowan-ashborn" },
        { chapter: 2, povId: "rowan-ashborn" },
      ]),
    ).toThrow("repeats a POV");
    expect(() =>
      prepareResume(fakeReport([fakeResult("rowan-ashborn", 1, 0.01)]), REQUIREMENTS, [
        { chapter: 2, povId: "rowan-ashborn" },
      ]),
    ).toThrow("complete chapter pair");
  });

  it("cannot clear a settled failure without its exact recorded rerun targets", () => {
    const report = fakeReport([
      fakeResult("rowan-ashborn", 1, 0.01),
      fakeResult("rowan-ashborn", 2, 0.01),
    ]);
    report.settledFailure = {
      checkpointId: "settled-test-1",
      rerunFrom: [{ chapter: 2, povId: "rowan-ashborn" }],
      runId: fakeUuid(910),
      sidecarSha256: "a".repeat(64),
      turnIds: [fakeUuid(911)],
    };

    expect(() => prepareResume(report, REQUIREMENTS)).toThrow(
      "requires its exact recorded rerun targets",
    );
    expect(() =>
      prepareResume(report, REQUIREMENTS, [{ chapter: 1, povId: "rowan-ashborn" }]),
    ).toThrow("requires its exact recorded rerun targets");
    expect(
      prepareResume(report, REQUIREMENTS, [{ chapter: 2, povId: "rowan-ashborn" }]).retainedResults,
    ).toHaveLength(1);
  });

  it("parses repeated explicit chapter suffix rerun flags strictly", () => {
    expect(
      parseRerunFrom(["--rerun-from", "rowan-ashborn:2", "--rerun-from", "elara-voss:1"]),
    ).toEqual([
      { chapter: 2, povId: "rowan-ashborn" },
      { chapter: 1, povId: "elara-voss" },
    ]);
    expect(() => parseRerunFrom(["--rerun-from"])).toThrow("requires a value");
    expect(() => parseRerunFrom(["--rerun-from", "unknown:1"])).toThrow("Unknown");
    expect(() => parseRerunFrom(["--rerun-from", "rowan-ashborn:3"])).toThrow("chapter 1 or 2");
    expect(() =>
      parseRerunFrom(["--rerun-from", "rowan-ashborn:1", "--rerun-from", "rowan-ashborn:2"]),
    ).toThrow("repeats");
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
    expect(() => prepareResume(report, STANDARD_REQUIREMENTS)).toThrow("service tier");
  });

  it("refuses to resume retained attempts with incomplete tier evidence", () => {
    const smoke = fakeSmokeReport();
    const report = {
      ...smoke,
      cleanPathProjectedCostUsd: 0.104494,
      gates: {
        ...smoke.gates,
        allAuditsApproved: false,
        allCommitsCompleted: false,
        allCostsWithinChapterCap: false,
        allPovLeakListsEmpty: false,
        allProseWithinWordLimit: false,
        allStreamsReconstructed: false,
        narrativeEvidenceComplete: false,
        serviceTierEvidenceComplete: true,
        traceCostMatchesAttempts: false,
      },
      povFilter: null,
      projectedFinalExposureUsd: 2.104494,
      projectedMaximumCumulativeCostUsd: 2.72,
      suite: "full" as const,
    };
    expect(LiveReportSchema.safeParse(report).success).toBe(true);
    const poisonAttempt = (attempt: LiveReport["attempts"][number]) => ({
      ...attempt,
      serviceTier: "standard" as const,
    });
    const poisoned = {
      ...report,
      attempts: report.attempts.map(poisonAttempt),
      gates: { ...report.gates, serviceTierEvidenceComplete: false },
      results: report.results.map((result) => ({
        ...result,
        trace: {
          ...result.trace,
          attempts: result.trace.attempts.map(poisonAttempt),
          calls: result.trace.calls.map((call) => ({ ...call, serviceTier: "standard" as const })),
        },
      })),
      runtimeAttemptEvidence: report.runtimeAttemptEvidence.map((evidence) => ({
        ...evidence,
        attempt: poisonAttempt(evidence.attempt),
      })),
    };
    expect(LiveReportSchema.safeParse(poisoned).success).toBe(true);
    expect(() => prepareResume(poisoned as LiveReport, REQUIREMENTS)).toThrow(
      "incomplete service-tier evidence",
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

    const version7Data = Object.fromEntries(
      Object.entries(report).filter(([key]) => key !== "narrativeCandidates"),
    );
    const version7 = { ...version7Data, version: 7 } as unknown as Version7LiveReport;
    const preparedVersion7 = prepareResume(version7, {
      ...STANDARD_REQUIREMENTS,
      chapterCostCapUsd: 0.0424,
    });
    expect(preparedVersion7.retainedResultCaps.map(({ capUsd }) => capUsd)).toEqual([0.03, 0.04]);

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
          checkpoints: [{ ...registry.checkpoints[0], serviceTier: "flex" }],
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

    const maximumBridgeFiles = Array.from({ length: 30 }, (_, index) => ({
      path: `release/bridge-${index}.txt`,
      sha256: bridgeSha256,
    }));
    const maximumBridgeHashes = Object.fromEntries(
      maximumBridgeFiles.map(({ path, sha256 }) => [path, sha256]),
    );
    const maximumBridgeRegistry = {
      ...registry,
      checkpoints: [{ ...registry.checkpoints[0], bridgeFiles: maximumBridgeFiles }],
    };
    expect(
      assertRegisteredResumeCheckpoint(
        legacy,
        reportSha256,
        maximumBridgeRegistry,
        maximumBridgeHashes,
      ),
    ).toHaveLength(30);
    expect(() =>
      assertRegisteredResumeCheckpoint(
        legacy,
        reportSha256,
        {
          ...maximumBridgeRegistry,
          checkpoints: [
            {
              ...maximumBridgeRegistry.checkpoints[0],
              bridgeFiles: [
                ...maximumBridgeFiles,
                { path: "release/bridge-30.txt", sha256: bridgeSha256 },
              ],
            },
          ],
        },
        { ...maximumBridgeHashes, "release/bridge-30.txt": bridgeSha256 },
      ),
    ).toThrow();

    const binaryBridgePath = "docs/screenshots/reader-desktop.png";
    const binaryBridgeSha256 = createHash("sha256")
      .update(readFileSync(binaryBridgePath))
      .digest("hex");
    expect(() =>
      assertRegisteredResumeCheckpoint(legacy, reportSha256, {
        ...registry,
        checkpoints: [
          {
            ...registry.checkpoints[0],
            bridgeFiles: [{ path: binaryBridgePath, sha256: binaryBridgeSha256 }],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("keeps the registered prompt 1.4.10 version 7 checkpoint parseable", () => {
    const sourceGitSha = "a4f34af649055e4dfa52448aa3a8a66425577c1b";
    const priorSpendUsd = 2.735142975;
    const chapterCostCapUsd = 0.0424;
    const report = Version7LiveReportSchema.parse({
      ...emptyVersion7ReportData(),
      budgetLedger: {
        activeReservationCount: 0,
        baselineAttemptCostUsd: 0,
        headroomUsd: 3 - priorSpendUsd,
        knownReservationCostUsd: 0,
        priorSpendUsd,
        sourceReportSha256: `fresh:${sourceGitSha}`,
        totalCapUsd: 3,
        totalExposureUsd: priorSpendUsd,
        uncertainReservationCostUsd: 0,
      },
      chapterCostCapUsd,
      cumulativeCostUsd: priorSpendUsd,
      priorSpendUsd,
      projectedMaximumCumulativeCostUsd:
        priorSpendUsd + CHARACTER_IDS.length * 2 * chapterCostCapUsd,
      promptVersion: "1.4.10",
      sourceGitSha,
    });
    const registry = JSON.parse(
      readFileSync(join(process.cwd(), "evals", "resume-checkpoints.json"), "utf8"),
    ) as unknown;

    expect(
      assertRegisteredResumeCheckpoint(
        report,
        "7d907207f8cfa4b1806820d8ae23fdab7acf7a418624bf74b4d953c7eccc82c8",
        registry,
      ),
    ).toEqual([]);
  });

  it("parses declared mixed Git provenance and rejects an unlisted result SHA", () => {
    const currentGitSha = "1234567";
    const bridgeFiles = Array.from({ length: 27 }, (_, index) => ({
      path: `release/bridge-${index}.txt`,
      sha256: "d".repeat(64),
    }));
    const changedPaths = [
      ...bridgeFiles.map(({ path }) => path),
      "app/src/server/openai/stable.test.ts",
      "app/src/server/story/story-service.test.ts",
      "docs/ARCHITECTURE.md",
      "docs/PLAN.md",
      "docs/STATUS.md",
      "evals/resume-checkpoints.json",
      "evals/run-live-restore.test.ts",
      "evals/run-live.test.ts",
    ];
    const results = [
      fakeResult("rowan-ashborn", 1, 0.01),
      fakeResult("rowan-ashborn", 2, 0.01, [0.01], currentGitSha),
      fakeResult("elara-voss", 1, 0.01, [0.01], currentGitSha),
    ];
    const narrativeCandidates = results.map((result) => fakeNarrativeCandidate(result));
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
      projectedMaximumCumulativeCostUsd: 2.68,
      narrativeCandidates,
      narrativeResponses: fakeNarrativeResponses(narrativeCandidates),
      gates: {
        ...(emptyReportData().gates as Record<string, boolean>),
        p95WithinSixtySeconds: true,
        serviceTierEvidenceComplete: true,
      },
      resultChapterCaps: results.map(({ chapter, povId }) => ({
        capUsd: 0.06,
        chapter,
        povId,
      })),
      results,
      runtimeAttemptEvidence: fakeRuntimeAttemptEvidence(results),
      resume: {
        bridgeFiles,
        changedPaths,
        discardedResultCount: 1,
        existingAttemptCostUsd: 0.02,
        rerunFrom: [{ chapter: 2, povId: "rowan-ashborn" }],
        retainedPovIds: ["rowan-ashborn"],
        retainedResults: [
          {
            chapter: 1,
            povId: "rowan-ashborn",
            sourceChapterCapUsd: 0.06,
            sourceGitSha: GIT_SHA,
          },
        ],
        sourceChapterCostCapUsd: 0.06,
        sourceGitSha: GIT_SHA,
        sourceReportPath: "legacy.json",
        sourceReportSha256: "c".repeat(64),
        sourceReportVersion: 8,
      },
      sourceGitSha: currentGitSha,
      totalCostUsd: 0.03,
    };

    expect(candidate.resume.changedPaths).toHaveLength(35);
    expect(LiveReportSchema.safeParse(candidate).success).toBe(true);
    expect(
      LiveReportSchema.safeParse({
        ...candidate,
        resume: {
          ...candidate.resume,
          rerunFrom: [{ chapter: 1, povId: "rowan-ashborn" }],
        },
      }).success,
    ).toBe(false);
    expect(LiveReportSchema.safeParse({ ...candidate, narrativeCandidates: [] }).success).toBe(
      false,
    );
    expect(
      LiveReportSchema.safeParse({
        ...candidate,
        narrativeCandidates: candidate.narrativeCandidates.map((entry, index) =>
          index === 0 ? { ...entry, narratorResponseId: "resp_unlinked" } : entry,
        ),
      }).success,
    ).toBe(false);
    const version7Candidate: Record<string, unknown> = { ...candidate };
    delete version7Candidate.narrativeCandidates;
    delete version7Candidate.narrativeResponses;
    expect(
      Version7LiveReportSchema.safeParse({
        ...version7Candidate,
        resume: { ...candidate.resume, sourceReportVersion: 8 },
        version: 7,
      }).success,
    ).toBe(false);
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

  it("keeps superseded rerun turns as authenticated historical evidence", () => {
    const report = fakeSmokeReport();
    const currentCandidate = report.narrativeCandidates[0]!;
    const historicalTurn = {
      ...currentCandidate.turn,
      requestId: fakeUuid(901),
      turnId: fakeUuid(902),
    };
    const historicalNarratorResponseId = "resp_historical_narration";
    const historicalAuditResponseId = "resp_historical_audit";
    const historicalCandidate = NarrativeCandidateEvidenceSchema.parse({
      ...currentCandidate,
      auditAttempts: currentCandidate.auditAttempts.map((attempt) => ({
        ...attempt,
        responseId: historicalAuditResponseId,
      })),
      auditResponseId: historicalAuditResponseId,
      narratorResponseId: historicalNarratorResponseId,
      turn: historicalTurn,
    });
    const historicalAttempts = report.attempts.map((attempt) => ({
      ...attempt,
      responseId:
        attempt.phase === "audit" ? historicalAuditResponseId : historicalNarratorResponseId,
    }));
    const historicalResponses = fakeNarrativeResponses([historicalCandidate]);
    const sourceReportSha256 = "f".repeat(64);
    const candidate = {
      ...report,
      attempts: [...historicalAttempts, ...report.attempts],
      budgetLedger: { ...report.budgetLedger, sourceReportSha256 },
      narrativeCandidates: [historicalCandidate, currentCandidate],
      narrativeResponses: [...historicalResponses, ...report.narrativeResponses],
      resume: {
        bridgeFiles: [],
        changedPaths: [],
        discardedResultCount: 1,
        existingAttemptCostUsd: 0,
        rerunFrom: [],
        retainedPovIds: [],
        retainedResults: [],
        sourceChapterCostCapUsd: report.chapterCostCapUsd,
        sourceEvidenceBoundary: {
          attemptCount: historicalAttempts.length,
          narrativeCandidateCount: 1,
          narrativeResponseCount: historicalResponses.length,
          runtimeAttemptEvidenceCount: historicalAttempts.length,
        },
        sourceGitSha: report.sourceGitSha,
        sourceReportPath: "evals/reports/source.json",
        sourceReportSha256,
        sourceReportVersion: 9 as const,
      },
      runtimeAttemptEvidence: [
        ...historicalAttempts.map((attempt) => ({ attempt, turn: historicalTurn })),
        ...report.runtimeAttemptEvidence,
      ],
      supersededTurnIds: [historicalTurn.turnId],
    };

    expect(LiveReportSchema.safeParse(candidate).success).toBe(true);
    expect(LiveReportSchema.safeParse({ ...candidate, supersededTurnIds: [] }).success).toBe(false);
    expect(
      LiveReportSchema.safeParse({
        ...candidate,
        supersededTurnIds: [currentCandidate.turn.turnId],
      }).success,
    ).toBe(false);
    expect(
      LiveReportSchema.safeParse({ ...candidate, supersededTurnIds: [fakeUuid(999)] }).success,
    ).toBe(false);
    const forgedCurrentTurn = {
      ...currentCandidate.turn,
      requestId: fakeUuid(903),
      turnId: fakeUuid(904),
    };
    const forgedCurrentCandidate = {
      ...historicalCandidate,
      turn: forgedCurrentTurn,
    };
    const forgedCurrentAttempts = historicalAttempts.map((attempt, index) => ({
      ...attempt,
      responseId: `resp_forged_current_${index}`,
    }));
    const forged = LiveReportSchema.safeParse({
      ...candidate,
      attempts: [...candidate.attempts, ...forgedCurrentAttempts],
      narrativeCandidates: [...candidate.narrativeCandidates, forgedCurrentCandidate],
      narrativeResponses: [
        ...candidate.narrativeResponses,
        ...fakeNarrativeResponses([forgedCurrentCandidate]),
      ],
      runtimeAttemptEvidence: [
        ...candidate.runtimeAttemptEvidence,
        ...forgedCurrentAttempts.map((attempt) => ({ attempt, turn: forgedCurrentTurn })),
      ],
      supersededTurnIds: [historicalTurn.turnId, forgedCurrentTurn.turnId],
    });
    expect(forged.success).toBe(false);
    if (!forged.success) {
      expect(forged.error.issues.map(({ message }) => message)).toContain(
        "Superseded narrative turn is outside authenticated source evidence",
      );
    }

    const settledNarratorResponseId = "resp_settled_narration";
    const settledAuditResponseId = "resp_settled_audit";
    const settledCandidate = NarrativeCandidateEvidenceSchema.parse({
      ...currentCandidate,
      auditAttempts: currentCandidate.auditAttempts.map((attempt) => ({
        ...attempt,
        responseId: settledAuditResponseId,
      })),
      auditResponseId: settledAuditResponseId,
      narratorResponseId: settledNarratorResponseId,
      turn: forgedCurrentTurn,
    });
    const settledAttempts = report.attempts.map((attempt) => ({
      ...attempt,
      responseId: attempt.phase === "audit" ? settledAuditResponseId : settledNarratorResponseId,
    }));
    const settledReport = {
      ...candidate,
      attempts: [...candidate.attempts, ...settledAttempts],
      error: { code: "LIVE_EVAL_FAILED", message: "settled failure" },
      gates: { ...candidate.gates, allCommitsCompleted: false },
      narrativeCandidates: [...candidate.narrativeCandidates, settledCandidate],
      narrativeResponses: [
        ...candidate.narrativeResponses,
        ...fakeNarrativeResponses([settledCandidate]),
      ],
      resume: {
        ...candidate.resume,
        sourceEvidenceBoundary: {
          attemptCount: candidate.attempts.length,
          narrativeCandidateCount: candidate.narrativeCandidates.length,
          narrativeResponseCount: candidate.narrativeResponses.length,
          runtimeAttemptEvidenceCount: candidate.runtimeAttemptEvidence.length,
        },
      },
      runtimeAttemptEvidence: [
        ...candidate.runtimeAttemptEvidence,
        ...settledAttempts.map((attempt) => ({ attempt, turn: forgedCurrentTurn })),
      ],
      settledFailure: {
        checkpointId: "settled-test-1",
        rerunFrom: [{ chapter: 1 as const, povId: "rowan-ashborn" as const }],
        runId: fakeUuid(905),
        sidecarSha256: "a".repeat(64),
        turnIds: [forgedCurrentTurn.turnId],
      },
    };
    expect(LiveReportSchema.safeParse(settledReport).success).toBe(true);
    expect(
      LiveReportSchema.safeParse({
        ...settledReport,
        settledFailure: {
          ...settledReport.settledFailure,
          rerunFrom: [
            settledReport.settledFailure.rerunFrom[0],
            settledReport.settledFailure.rerunFrom[0],
          ],
        },
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
    cleanPathProjectedCostUsd: 0.104494,
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
      narrativeEvidenceComplete: false,
      p95WithinSixtySeconds: false,
      serviceTierEvidenceComplete: false,
      traceCostMatchesAttempts: false,
      totalCostWithinCap: true,
    },
    nativeRequested: false,
    narrativeCandidates: [],
    narrativeResponses: [],
    runtimeEvidenceStartAttemptIndex: 0,
    runtimeAttemptEvidence: [],
    povFilter: null,
    priorSpendUsd: REQUIREMENTS.priorSpendUsd,
    pricingVersion: "openai-flex-explicit-no-cache-2026-07-20",
    projectedFinalExposureUsd: 2.104494,
    projectedMaximumCumulativeCostUsd: 2.72,
    promptVersion: PROMPT_VERSION,
    resultChapterCaps: [],
    results: [],
    resume: null,
    sourceGitSha: GIT_SHA,
    serviceTier: "flex",
    startedAt: "2026-07-20T00:00:00.000Z",
    suite: "full",
    totalCostCapUsd: 3,
    totalCostUsd: 0,
    version: 9,
  };
}

function emptyVersion8ReportData(): Record<string, unknown> {
  const report = { ...emptyReportData() };
  delete report.cleanPathProjectedCostUsd;
  delete report.pricingVersion;
  delete report.projectedFinalExposureUsd;
  delete report.serviceTier;
  const gates = { ...(report.gates as Record<string, unknown>) };
  delete gates.serviceTierEvidenceComplete;
  report.gates = gates;
  return { ...report, version: 8 };
}

function emptyVersion7ReportData(): Record<string, unknown> {
  const report = { ...emptyVersion8ReportData() };
  delete report.narrativeCandidates;
  delete report.narrativeResponses;
  delete report.runtimeEvidenceStartAttemptIndex;
  delete report.runtimeAttemptEvidence;
  const gates = { ...(report.gates as Record<string, unknown>) };
  delete gates.narrativeEvidenceComplete;
  report.gates = gates;
  return { ...report, version: 7 };
}

function emptyVersion6ReportData(): Record<string, unknown> {
  const report = { ...emptyVersion7ReportData() };
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
    runtimeAttemptEvidence: fakeRuntimeAttemptEvidence(results),
    ...overrides,
    completedChapters: results.length,
    results,
  } as unknown as LiveReport;
}

function fakeSmokeReport(): LiveReport {
  const result = fakeResult("rowan-ashborn", 1, 0);
  const narrativeCandidates = [fakeNarrativeCandidate(result)];
  return {
    ...emptyReportData(),
    attempts: result.trace.attempts,
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
    completedChapters: 1,
    cleanPathProjectedCostUsd: null,
    gates: {
      allAuditsApproved: true,
      allCommitsCompleted: true,
      allCostsWithinChapterCap: true,
      allPovLeakListsEmpty: true,
      allProseWithinWordLimit: true,
      allStreamsReconstructed: true,
      narrativeEvidenceComplete: true,
      p95WithinSixtySeconds: true,
      serviceTierEvidenceComplete: true,
      traceCostMatchesAttempts: true,
      totalCostWithinCap: true,
    },
    narrativeCandidates,
    narrativeResponses: fakeNarrativeResponses(narrativeCandidates),
    povFilter: "rowan-ashborn",
    projectedFinalExposureUsd: null,
    projectedMaximumCumulativeCostUsd: REQUIREMENTS.priorSpendUsd + REQUIREMENTS.chapterCostCapUsd,
    resultChapterCaps: [
      {
        capUsd: REQUIREMENTS.chapterCostCapUsd,
        chapter: result.chapter,
        povId: result.povId,
      },
    ],
    results: [result],
    runtimeAttemptEvidence: fakeRuntimeAttemptEvidence([result]),
    suite: "smoke",
  } as LiveReport;
}

function standardSmokeReport(): LiveReport {
  const report = fakeSmokeReport();
  const standardAttempt = (attempt: LiveReport["attempts"][number]) => ({
    ...attempt,
    requestedServiceTier: "standard" as const,
    serviceTier: "standard" as const,
  });
  return {
    ...report,
    attempts: report.attempts.map(standardAttempt),
    pricingVersion: "openai-standard-explicit-no-cache-2026-07-20",
    results: report.results.map((result) => ({
      ...result,
      trace: {
        ...result.trace,
        attempts: result.trace.attempts.map(standardAttempt),
        calls: result.trace.calls.map((call) => ({
          ...call,
          requestedServiceTier: "standard" as const,
          serviceTier: "standard" as const,
        })),
        pricingVersion: "openai-standard-explicit-no-cache-2026-07-20",
      },
    })),
    runtimeAttemptEvidence: report.runtimeAttemptEvidence.map((evidence) => ({
      ...evidence,
      attempt: standardAttempt(evidence.attempt),
    })),
    serviceTier: "standard",
  };
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
  const canonical = fakeCanonicalTurn(povId, chapter);
  const turnId = fakeUuid(CHARACTER_IDS.indexOf(povId) * 10 + chapter);
  const requestId = fakeUuid(100 + CHARACTER_IDS.indexOf(povId) * 10 + chapter);
  const attempts = [
    ...attemptCosts.map((attemptCost, index) => ({
      agentId: null,
      attempt: index,
      costUsd: attemptCost,
      errorCode: index === attemptCosts.length - 1 ? null : ("NARRATIVE_AUDIT_REJECTED" as const),
      latencyMs: 1,
      model: "gpt-5.6-luna" as const,
      phase: "narration" as const,
      requestedServiceTier: "flex" as const,
      responseId: `resp_narration_${povId}_${chapter}_${index}`,
      serviceTier: "flex" as const,
      usage,
    })),
    {
      agentId: null,
      attempt: 0,
      costUsd: 0,
      errorCode: null,
      latencyMs: 1,
      model: "gpt-5.6-luna" as const,
      phase: "audit" as const,
      requestedServiceTier: "flex" as const,
      responseId: `resp_audit_${povId}_${chapter}`,
      serviceTier: "flex" as const,
      usage,
    },
  ];
  const trace = {
    acceptedDelta: canonical.delta,
    adapterMode: "sequential" as const,
    attempts,
    calls: [
      {
        agentId: null,
        errorCode: null,
        estimatedCostUsd: costUsd,
        latencyMs: 1,
        model: "gpt-5.6-luna" as const,
        phase: "narration" as const,
        reasoningEffort: "none" as const,
        refusal: false,
        requestedServiceTier: "flex" as const,
        responseId: `resp_narration_${povId}_${chapter}_${attemptCosts.length - 1}`,
        retries: 0,
        serviceTier: "flex" as const,
        timedOut: false,
        usage,
      },
      {
        agentId: null,
        errorCode: null,
        estimatedCostUsd: 0,
        latencyMs: 1,
        model: "gpt-5.6-luna" as const,
        phase: "audit" as const,
        reasoningEffort: "none" as const,
        refusal: false,
        requestedServiceTier: "flex" as const,
        responseId: `resp_audit_${povId}_${chapter}`,
        retries: 0,
        serviceTier: "flex" as const,
        timedOut: false,
        usage,
      },
    ],
    contractVersion: CONTRACT_VERSION,
    fixtureId: canonical.stateBefore.id,
    fixtureVersion: canonical.stateBefore.fixtureVersion,
    gateResult: "passed" as const,
    gitSha,
    intents: canonical.intents,
    multiAgentOutputItems: [],
    pricingVersion: "openai-flex-explicit-no-cache-2026-07-20",
    promptVersion: PROMPT_VERSION,
    runId: turnId,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    seed: canonical.stateBefore.chapter,
    stateAfterHash: hashJson(canonical.stateAfter),
    stateBeforeHash: hashJson(canonical.stateBefore),
    totalEstimatedCostUsd: costUsd,
    totalLatencyMs: 1,
    totalUsage: usage,
    validationFailures: [],
  };
  const chapterRecord = {
    chapter,
    choices: canonical.frame.choices,
    estimatedCostUsd: costUsd,
    id: `chapter-${String(chapter).padStart(3, "0")}`,
    latencyMs: 1,
    narrativeAudit: {
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
    playerAction: canonical.playerAction,
    povCharacterId: povId,
    prose,
    proseHash,
    requestId,
    safeContextHash: hashJson(buildPovContext(canonical.stateAfter, povId)),
    stateAfterVersion: canonical.stateAfter.version,
    stateBeforeVersion: canonical.stateBefore.version,
    terminal: canonical.stateAfter.terminal,
    title: canonical.frame.title,
    traceId: turnId,
    usage,
  };
  return {
    adapterMode: "sequential",
    audit: chapterRecord.narrativeAudit,
    canonicalNarrativeInput: {
      allowedFactIds: canonical.allowedFactIds,
      chapterRecord,
      forbiddenFacts: canonical.forbiddenFacts,
      frame: canonical.frame,
      playerAction: canonical.playerAction,
      stateAfter: canonical.stateAfter,
      stateBefore: canonical.stateBefore,
      worldVersionAfter: canonical.stateAfter.version,
      worldVersionBefore: canonical.stateBefore.version,
    },
    chapter,
    costUsd,
    latencyMs: 1,
    povId,
    prose,
    streamChunkCount: 1,
    streamChunks: [prose],
    streamingLatencyMs: 1,
    streamReconstructed: true,
    trace,
    usage,
    wordCount: 900,
  } as unknown as LiveResult;
}

function fakeCanonicalTurn(povId: (typeof CHARACTER_IDS)[number], chapter: 1 | 2) {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "evals", "fixtures", "demon-king-world.json"), "utf8"),
  ) as unknown;
  const validated = validateWorldState(raw);
  if (!validated.ok) throw new Error("Fake live seed is invalid");
  const locked = structuredClone(validated.data);
  locked.lockedPovId = povId;
  const lockedValidation = validateWorldState(locked);
  if (!lockedValidation.ok) throw new Error("Fake live seed cannot lock POV");
  let state = lockedValidation.data;
  let finalTurn:
    | {
        allowedFactIds: string[];
        delta: WorldDelta;
        forbiddenFacts: { claim: string; id: string }[];
        frame: ChapterFrame;
        intents: readonly WorldIntent[];
        playerAction: PlayerAction;
        stateAfter: WorldState;
        stateBefore: WorldState;
      }
    | undefined;
  for (let currentChapter = 1; currentChapter <= chapter; currentChapter += 1) {
    const stateBefore = state;
    const choice = buildChapterChoiceOptions(stateBefore)[0];
    if (!choice) throw new Error("Fake live state has no choice");
    const playerAction = {
      action: choice.action,
      actorId: povId,
      description: choice.description,
      milestoneId: choice.milestoneId,
      source: "suggested" as const,
      stateVersion: stateBefore.version,
    };
    const resolved = resolveTurn(stateBefore, playerAction, []);
    if (!resolved.ok) throw new Error("Fake live turn cannot resolve");
    const staged = stageWorldDelta(stateBefore, resolved.data.intents, resolved.data.delta);
    if (!staged.ok) throw new Error("Fake live turn cannot stage");
    const options = buildChapterChoiceOptions(staged.data.state);
    const frame = canonicalizeChapterFrameCandidate(staged.data.state, {
      optionIds: options.slice(0, 2).map(({ id }) => id),
      title: `Ash Road ${currentChapter}`,
    });
    if (!frame.ok) throw new Error("Fake live frame is invalid");
    const povContext = buildPovContext(staged.data.state, povId);
    const allowedFactIds = [...povContext.factIds].sort();
    const allowed = new Set(allowedFactIds);
    finalTurn = {
      allowedFactIds,
      delta: resolved.data.delta,
      forbiddenFacts: staged.data.state.facts
        .filter(({ id }) => !allowed.has(id))
        .map(({ claim, id }) => ({ claim, id })),
      frame: frame.data,
      intents: resolved.data.intents,
      playerAction,
      stateAfter: staged.data.state,
      stateBefore,
    };
    state = staged.data.state;
  }
  if (finalTurn === undefined) throw new Error("Fake live turn disappeared");
  return finalTurn;
}

function fakeTurnIdentity(result: LiveResult) {
  const canonical = result.canonicalNarrativeInput;
  if (canonical === undefined || canonical.chapterRecord.requestId === undefined) {
    throw new Error("Fake result lacks turn identity");
  }
  return {
    chapter: result.chapter,
    povId: result.povId,
    requestId: canonical.chapterRecord.requestId,
    turnId: result.trace.runId,
    worldVersionAfter: canonical.worldVersionAfter,
    worldVersionBefore: canonical.worldVersionBefore,
  } as const;
}

function fakeRuntimeAttemptEvidence(results: readonly LiveResult[]) {
  return results.flatMap((result) =>
    result.trace.attempts.map((attempt) => ({ attempt, turn: fakeTurnIdentity(result) })),
  );
}

function fakeUuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fakeNarrativeCandidate(
  result: LiveResult = fakeResult("rowan-ashborn", 1, 0),
): LiveReport["narrativeCandidates"][number] {
  const narratorAttempt = result.trace.attempts.findLast(
    ({ errorCode, phase }) => phase === "narration" && errorCode === null,
  );
  const auditResponseId = result.trace.calls.find(({ phase }) => phase === "audit")?.responseId;
  if (!narratorAttempt?.responseId || !auditResponseId) {
    throw new Error("Fake narrative evidence needs narrator and audit response IDs");
  }
  const canonical = result.canonicalNarrativeInput;
  if (canonical === undefined || canonical.chapterRecord.requestId === undefined) {
    throw new Error("Fake narrative evidence needs canonical turn data");
  }
  const auditCandidate = {
    evidence: NARRATIVE_AUDIT_DIMENSIONS.map(() => "Passes fixed release rubric."),
    leakEvidence: [],
    scores: [2, 2, 2, 2, 2, 2, 2],
  } as const;
  return NarrativeCandidateEvidenceSchema.parse({
    accepted: true,
    adapterMode: "sequential",
    allowedFactIds: canonical.allowedFactIds,
    audit: result.audit,
    auditAttempts: [
      {
        attempt: 0,
        candidate: auditCandidate,
        rawOutputText: JSON.stringify(auditCandidate),
        responseId: auditResponseId,
        status: "completed",
      },
    ],
    auditResponseId,
    backgroundIntents: result.trace.intents,
    chapter: result.chapter,
    delta: result.trace.acceptedDelta,
    deterministicIssues: [],
    forbiddenFacts: canonical.forbiddenFacts,
    frame: canonical.frame,
    mergedProse: result.prose,
    mergedWordCount: 900,
    multiAgentOutputItems: result.trace.multiAgentOutputItems,
    narratorAttempt: narratorAttempt.attempt,
    narratorResponseId: narratorAttempt.responseId,
    playerAction: canonical.playerAction,
    povId: result.povId,
    promptVersion: PROMPT_VERSION,
    rawProse: result.prose,
    rawWordCount: 900,
    recovery: null,
    rejectionStage: "accepted",
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    sourceGitSha: result.trace.gitSha,
    stateAfter: canonical.stateAfter,
    stateBefore: canonical.stateBefore,
    turn: fakeTurnIdentity(result),
    worldVersionAfter: canonical.worldVersionAfter,
    worldVersionBefore: canonical.worldVersionBefore,
  });
}

function fakeNarrativeResponses(
  candidates: readonly LiveReport["narrativeCandidates"][number][],
): LiveReport["narrativeResponses"] {
  return candidates.flatMap((candidate) => [
    {
      attempt: candidate.narratorAttempt,
      bufferedOutputText: candidate.rawProse,
      chapter: candidate.chapter,
      phase: "narration" as const,
      povId: candidate.povId,
      rawOutputText: candidate.rawProse,
      responseId: candidate.narratorResponseId,
      sourceGitSha: candidate.sourceGitSha,
      status: "completed" as const,
      turn: candidate.turn,
      worldVersionAfter: candidate.worldVersionAfter,
      worldVersionBefore: candidate.worldVersionBefore,
    },
    ...(candidate.recovery === null
      ? []
      : [
          {
            attempt: candidate.recovery.attempt,
            bufferedOutputText: candidate.recovery.prose,
            chapter: candidate.chapter,
            phase: "recovery" as const,
            povId: candidate.povId,
            rawOutputText: candidate.recovery.prose,
            responseId: candidate.recovery.responseId,
            sourceGitSha: candidate.sourceGitSha,
            status: "completed" as const,
            turn: candidate.turn,
            worldVersionAfter: candidate.worldVersionAfter,
            worldVersionBefore: candidate.worldVersionBefore,
          },
        ]),
    ...candidate.auditAttempts.map((auditAttempt) => ({
      attempt: auditAttempt.attempt,
      bufferedOutputText: auditAttempt.rawOutputText,
      chapter: candidate.chapter,
      phase: "audit" as const,
      povId: candidate.povId,
      rawOutputText: auditAttempt.rawOutputText,
      responseId: auditAttempt.responseId,
      sourceGitSha: candidate.sourceGitSha,
      status: auditAttempt.status,
      turn: candidate.turn,
      worldVersionAfter: candidate.worldVersionAfter,
      worldVersionBefore: candidate.worldVersionBefore,
    })),
  ]);
}

function historicalResult(result: LiveResult): LiveResult {
  return {
    ...result,
    trace: {
      ...result.trace,
      acceptedDelta: { ...result.trace.acceptedDelta, promptVersion: "1.4.9" },
      intents: result.trace.intents.map((intent) => ({ ...intent, promptVersion: "1.4.9" })),
      promptVersion: "1.4.9",
    },
  };
}
