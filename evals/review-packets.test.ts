import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHARACTER_IDS, NARRATIVE_AUDIT_DIMENSIONS } from "@infinite-litrpg/shared";
import { describe, expect, it } from "vitest";

import { assertPacketDirectory, writeReviewPackets } from "./review-packets";
import type { LiveReport, LiveResult } from "./run-live";

const REPORT_SHA = "a".repeat(64);

describe("review packets", () => {
  it("rejects partial and false-gate reports", () => {
    const partial = fakeReport();
    partial.results = partial.results.slice(0, 2);
    partial.completedChapters = 2;
    expect(() => writeReviewPackets(partial, REPORT_SHA)).toThrow("fully green");

    const failed = fakeReport();
    failed.gates.allAuditsApproved = false;
    expect(() => writeReviewPackets(failed, REPORT_SHA)).toThrow("fully green");
  });

  it("publishes six ordered, reviewable, safe packets and removes stale files", () => {
    const parent = mkdtempSync(join(tmpdir(), "infinite-litrpg-review-"));
    const directory = join(parent, "packets");
    try {
      const manifest = writeReviewPackets(fakeReport(), REPORT_SHA, directory);
      expect(manifest.packetOrder).toEqual(CHARACTER_IDS.map((povId) => `${povId}.md`));
      expect(readdirSync(directory).sort()).toEqual(
        ["manifest.json", ...CHARACTER_IDS.map((povId) => `${povId}.md`)].sort(),
      );
      expect(assertPacketDirectory(directory)).toEqual(manifest);

      const rowan = readFileSync(join(directory, "rowan-ashborn.md"), "utf8");
      expect(rowan).toContain("Source report SHA-256");
      expect(rowan).toContain("Selected Player Action");
      expect(rowan).toContain("Offered Next Choices");
      expect(rowan).toContain("accepted delta is the sole new canon");
      expect(rowan).toContain("Human score 0 to 2");
      expect(rowan).toContain("Exact evidence");
      expect(rowan).toContain("Final verdict: pending");
      expect(rowan).toContain("Reviewer-Only Canon Appendix");
      expect(rowan).toContain("Model Audit Appendix");
      for (const dimension of [
        "Choice fulfillment",
        "Character autonomy",
        "POV safety",
        "LitRPG mechanics",
        "Continuity",
        "Arc progress",
        "Prose",
      ]) {
        expect(rowan).toContain(`| ${dimension} |`);
      }
      expect(rowan).toContain("forbiddenFacts");
      expect(rowan).not.toContain("DO-NOT-SERIALIZE-HIDDEN-STATE");
      const safeEvidence = rowan.slice(0, rowan.indexOf("### Reviewer-Only Canon Appendix"));
      expect(safeEvidence).not.toContain("FUTURE-MILESTONE-SECRET");
      expect(rowan).toContain("FUTURE-MILESTONE-SECRET");

      writeFileSync(join(directory, "stale.md"), "stale", "utf8");
      expect(() => writeReviewPackets(fakeReport(), REPORT_SHA, directory)).toThrow("--force");
      writeReviewPackets(fakeReport(), REPORT_SHA, directory, { force: true });
      expect(readdirSync(directory)).not.toContain("stale.md");
      expect(assertPacketDirectory(directory).packetOrder).toEqual(manifest.packetOrder);
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it("permits human annotations but detects changed generated evidence", () => {
    const parent = mkdtempSync(join(tmpdir(), "infinite-litrpg-review-tamper-"));
    const directory = join(parent, "packets");
    try {
      writeReviewPackets(fakeReport(), REPORT_SHA, directory);
      const path = join(directory, "rowan-ashborn.md");
      const body = readFileSync(path, "utf8");
      writeFileSync(path, body.replace("- Reviewer:", "- Reviewer: Release reviewer"), "utf8");
      expect(() => assertPacketDirectory(directory)).not.toThrow();
      writeFileSync(path, `changed generated evidence\n${body}`, "utf8");
      expect(() => assertPacketDirectory(directory)).toThrow("evidence hash does not match");
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it("rejects marker injection and manifest metadata tampering", () => {
    const parent = mkdtempSync(join(tmpdir(), "infinite-litrpg-review-boundary-"));
    const injectedDirectory = join(parent, "injected");
    const validDirectory = join(parent, "valid");
    try {
      const injected = fakeReport();
      const firstResult = injected.results[0];
      if (firstResult === undefined) throw new Error("Fake report lost its first result");
      injected.results = [
        { ...firstResult, prose: `${firstResult.prose}\n<!-- HUMAN REVIEW START -->` },
        ...injected.results.slice(1),
      ];
      expect(() => writeReviewPackets(injected, REPORT_SHA, injectedDirectory)).toThrow(
        "boundaries must occur exactly once",
      );

      writeReviewPackets(fakeReport(), REPORT_SHA, validDirectory);
      const manifestPath = join(validDirectory, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ ...manifest, promptVersion: "tampered" }, null, 2)}\n`,
        "utf8",
      );
      expect(() => assertPacketDirectory(validDirectory)).toThrow(
        "metadata does not match manifest",
      );
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });
});

function fakeReport(): LiveReport {
  const results = CHARACTER_IDS.flatMap((povId) => [fakeResult(povId, 1), fakeResult(povId, 2)]);
  return {
    adapterMode: "sequential",
    completedChapters: results.length,
    error: null,
    finishedAt: "2026-07-20T10:00:00.000Z",
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
      totalCostWithinCap: true,
      traceCostMatchesAttempts: true,
    },
    pricingVersion: "openai-flex-test",
    promptVersion: "1.4.11",
    results,
    serviceTier: "flex",
    sourceGitSha: "abcdef0",
    suite: "full",
    version: 9,
  } as LiveReport;
}

function fakeResult(povId: (typeof CHARACTER_IDS)[number], chapter: 1 | 2): LiveResult {
  return {
    adapterMode: "sequential",
    audit: {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: `${dimension} passed with exact prose evidence`,
        dimension,
        issueCode: "pass" as const,
      })),
      leakedFactIds: [],
      proseHash: `${String(chapter)}${"b".repeat(63)}`,
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
    canonicalNarrativeInput: {
      chapterRecord: { title: `Ash Road ${chapter}` },
      forbiddenFacts: [{ claim: "Reviewer-only hidden claim", id: "hidden-fact" }],
      frame: {
        choices: [
          { description: "Investigate the ash road", id: "choice-1" },
          { description: "Question the survivor", id: "choice-2" },
        ],
      },
      playerAction: {
        action: { subjectId: "ash-road", type: "investigate" },
        actorId: povId,
        description: "Follow the ash trail",
        source: "suggested",
        stateVersion: chapter,
      },
      stateAfter: fakeState(povId, chapter, chapter + 1),
      stateBefore: fakeState(povId, chapter - 1, chapter),
    },
    chapter,
    costUsd: 0.02,
    latencyMs: 5_000,
    povId,
    prose: `Chapter ${chapter} prose for ${povId}.`,
    streamChunkCount: 2,
    streamingLatencyMs: 20,
    streamReconstructed: true,
    trace: {
      acceptedDelta: {
        clock: {
          fromAct: 1,
          fromChapter: chapter - 1,
          terminal: false,
          toAct: 1,
          toChapter: chapter,
          transitionRequired: false,
        },
        events: [{ id: `event-${chapter}`, summary: "The ash trail advances." }],
        knowledgeMutations: [],
        stateMutations: [],
        surfacedClueFactIds: [],
      },
      attempts: [
        {
          requestedServiceTier: "flex",
          serviceTier: "flex",
        },
      ],
      calls: [
        {
          requestedServiceTier: "flex",
          serviceTier: "flex",
        },
      ],
      gateResult: "passed",
      gitSha: "abcdef0",
      intents: [
        {
          actorId: "nyra-vale",
          goal: "Protect the survivor",
          id: `intent-${chapter}`,
        },
      ],
      promptVersion: "1.4.11",
      runId: `00000000-0000-4000-8000-00000000000${String(chapter)}`,
      schemaVersion: "1.1.0-runtime-candidates-5",
      stateAfterHash: "c".repeat(64),
      stateBeforeHash: "d".repeat(64),
    },
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    },
    wordCount: 900,
  } as unknown as LiveResult;
}

function fakeState(povId: (typeof CHARACTER_IDS)[number], chapter: number, version: number) {
  return {
    act: 1,
    activeEvents: [
      {
        id: `event-${Math.max(1, chapter)}`,
        observerIds: [povId],
        participantIds: [],
        summary: "The ash trail advances.",
        visibility: "participants",
      },
    ],
    arcClock: {
      convergencePressure: false,
      milestones: [
        {
          act: 4,
          compatibleActionTypes: ["investigate"],
          completed: false,
          description: "FUTURE-MILESTONE-SECRET",
          id: "act-four-secret",
          requiredByChapter: 200,
        },
      ],
      transitionRequired: false,
    },
    calendar: { day: 1, label: "Ashfall" },
    chapter,
    characters: [
      {
        id: povId,
        name: povId,
      },
    ],
    facts: [
      {
        claim: "Visible ash trail",
        id: "visible-fact",
        visibility: "public",
      },
      {
        claim: "Reviewer-only hidden claim",
        id: "hidden-fact",
        visibility: "private",
      },
    ],
    knowledgeLedgers: [{ characterId: povId, entries: [{ factId: "visible-fact" }] }],
    secret: "DO-NOT-SERIALIZE-HIDDEN-STATE",
    terminal: false,
    terminalReason: null,
    threat: "Ash raiders",
    version,
  };
}
