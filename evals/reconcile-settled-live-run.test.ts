import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SettledRunCheckpointRegistrySchema,
  SettledRunCheckpointSchema,
  assertEquivalentSettledReport,
  deriveSettledSupersededTurnIds,
  verifySettledAttemptExtension,
} from "./reconcile-settled-live-run";
import type { LiveReport } from "./run-live";

const ZERO_USAGE = {
  cacheWriteTokens: 0,
  cachedInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
} as const;

describe("settled live-run reconciliation", () => {
  it("binds the append-only attempt suffix to exact settled reservation shapes", () => {
    const source = [attempt("resp_source", "intent", 0.01, "rowan-ashborn")];
    const added = [attempt("resp_new", "narration", 0.003612, null)];
    const reservations = [
      {
        actualCostUsd: 0.003612,
        agentId: null,
        attempt: 0,
        id: "8a7fa591-d34b-489f-8b53-d56c5ba39f59",
        maximumCostUsd: 0.0072605,
        model: "gpt-5.6-luna" as const,
        phase: "narration" as const,
        serviceTier: "flex" as const,
      },
    ];

    expect(verifySettledAttemptExtension(source, [...source, ...added], reservations)).toBe(
      0.003612,
    );
    expect(() =>
      verifySettledAttemptExtension(source, [...added, ...source], reservations),
    ).toThrow("append-only");
    expect(() =>
      verifySettledAttemptExtension(
        source,
        [...source, ...added],
        [{ ...reservations[0]!, phase: "audit" }],
      ),
    ).toThrow("reservation evidence");
  });

  it("keeps the real settled checkpoint strict and the CLI provider-free", () => {
    const registry = JSON.parse(
      readFileSync(join(process.cwd(), "evals", "settled-run-checkpoints.json"), "utf8"),
    ) as { checkpoints: unknown[] };
    expect(SettledRunCheckpointSchema.safeParse(registry.checkpoints[0]).success).toBe(true);
    expect(SettledRunCheckpointRegistrySchema.safeParse(registry).success).toBe(true);

    const checkpoint = registry.checkpoints[0] as Record<string, unknown>;
    expect(SettledRunCheckpointSchema.parse(checkpoint).totalCapUsd).toBe(3);
    expect(
      SettledRunCheckpointSchema.safeParse({ ...checkpoint, totalCapUsd: 3.021 }).success,
    ).toBe(true);
    expect(
      SettledRunCheckpointSchema.safeParse({ ...checkpoint, totalCapUsd: 3.0001 }).success,
    ).toBe(false);
    const distinct = {
      ...checkpoint,
      id: "distinct-checkpoint",
      outputReportPath: "evals/reports/distinct-settled.json",
      runId: "00000000-0000-4000-8000-000000000099",
    };
    for (const duplicate of [
      { ...distinct, id: checkpoint.id },
      { ...distinct, runId: checkpoint.runId },
      { ...distinct, outputReportPath: checkpoint.outputReportPath },
    ]) {
      expect(
        SettledRunCheckpointRegistrySchema.safeParse({
          checkpoints: [checkpoint, duplicate],
          version: 1,
        }).success,
      ).toBe(false);
    }

    const source = readFileSync(
      join(process.cwd(), "evals", "reconcile-settled-live-run.ts"),
      "utf8",
    );
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("new OpenAI");
    expect(source).not.toContain("responses.create");
  });

  it("supersedes only the one uncommitted sidecar turn", () => {
    const oldTurn = turn("00000000-0000-4000-8000-000000000001", 1);
    const failedReplacement = turn("00000000-0000-4000-8000-000000000002", 2);
    const sourceEvidence = {
      narrativeCandidates: [],
      narrativeResponses: [],
      results: [],
      runtimeAttemptEvidence: [
        { attempt: attempt("resp_source", "narration", 0.01, null), turn: oldTurn },
      ],
    } satisfies Pick<
      LiveReport,
      "narrativeCandidates" | "narrativeResponses" | "results" | "runtimeAttemptEvidence"
    >;
    const sidecarEvidence = {
      candidates: [],
      narrativeResponses: [],
      runtimeAttemptEvidence: [
        ...sourceEvidence.runtimeAttemptEvidence,
        { attempt: attempt("resp_new", "narration", 0.003612, null), turn: failedReplacement },
      ],
    };
    const rerunFrom = [{ chapter: 2 as const, povId: "rowan-ashborn" as const }];

    expect(deriveSettledSupersededTurnIds(sourceEvidence, sidecarEvidence, rerunFrom)).toEqual([
      failedReplacement.turnId,
    ]);
    expect(() =>
      deriveSettledSupersededTurnIds(
        sourceEvidence,
        {
          ...sidecarEvidence,
          runtimeAttemptEvidence: [
            ...sidecarEvidence.runtimeAttemptEvidence,
            {
              attempt: attempt("resp_other", "narration", 0.003, null),
              turn: turn("00000000-0000-4000-8000-000000000003", 2),
            },
          ],
        },
        rerunFrom,
      ),
    ).toThrow("exactly one uncommitted turn");
    expect(() =>
      deriveSettledSupersededTurnIds(sourceEvidence, sidecarEvidence, [
        { chapter: 1, povId: "elara-voss" },
      ]),
    ).toThrow("does not match a registered rerun target");
  });

  it("accepts only the same settled report on a crash retry", () => {
    const first = {
      finishedAt: "2026-07-20T00:00:01.000Z",
      marker: { attempts: 98, results: 12 },
    } as unknown as LiveReport;
    const retry = {
      ...first,
      finishedAt: "2026-07-20T00:00:02.000Z",
    } as LiveReport;

    expect(() => assertEquivalentSettledReport(first, retry)).not.toThrow();
    expect(() =>
      assertEquivalentSettledReport(first, {
        ...retry,
        marker: { attempts: 97, results: 12 },
      } as unknown as LiveReport),
    ).toThrow("does not match authenticated checkpoint evidence");
  });
});

function attempt(
  responseId: string,
  phase: "intent" | "narration",
  costUsd: number,
  agentId: string | null,
): LiveReport["attempts"][number] {
  return {
    agentId,
    attempt: 0,
    costUsd,
    errorCode: null,
    latencyMs: 1,
    model: "gpt-5.6-luna",
    phase,
    requestedServiceTier: "flex",
    responseId,
    serviceTier: "flex",
    usage: ZERO_USAGE,
  };
}

function turn(turnId: string, chapter: 1 | 2) {
  return {
    chapter,
    povId: "rowan-ashborn" as const,
    requestId: `10000000-0000-4000-8000-${turnId.slice(-12)}`,
    turnId,
    worldVersionAfter: chapter + 1,
    worldVersionBefore: chapter,
  };
}
