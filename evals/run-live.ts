import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

import {
  CHARACTER_IDS,
  validateWorldState,
  type ChapterRecord,
  type CharacterId,
  type TraceEnvelope,
  type ValidationIssue,
} from "@infinite-litrpg/shared";
import OpenAI from "openai";

import { OpenAIRuntimeError } from "../app/src/server/openai/errors";
import { StoryService } from "../app/src/server/story/story-service";
import { StoryStore } from "../app/src/server/storage/story-store";

const ROOT = process.cwd();
const REPORT_DIRECTORY = resolve(ROOT, "evals", "reports");
const REVIEW_DIRECTORY = resolve(ROOT, "docs", "review-packets");
const DEFAULT_PER_CHAPTER_CAP_USD = 0.1;
const TOTAL_CAP_USD = 3;

interface LiveResult {
  readonly adapterMode: string;
  readonly audit: ChapterRecord["narrativeAudit"];
  readonly chapter: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly povId: CharacterId;
  readonly prose: string;
  readonly streamChunkCount: number;
  readonly streamingLatencyMs: number;
  readonly streamReconstructed: boolean;
  readonly trace: TraceEnvelope;
  readonly usage: ChapterRecord["usage"];
  readonly wordCount: number;
}

interface LiveReport {
  attempts: TraceEnvelope["attempts"];
  auditRejections: { audit: ChapterRecord["narrativeAudit"]; povId: CharacterId }[];
  chapterCostCapUsd: number;
  completedChapters: number;
  cumulativeCostUsd: number;
  error: { code: string; message: string } | null;
  draftRejections: { issues: readonly ValidationIssue[]; povId: CharacterId }[];
  finishedAt: string;
  gates: Record<string, boolean>;
  nativeRequested: boolean;
  povFilter: CharacterId | null;
  priorSpendUsd: number;
  projectedMaximumCumulativeCostUsd: number;
  results: Omit<LiveResult, "prose">[];
  startedAt: string;
  suite: "full" | "smoke";
  totalCostCapUsd: number;
  totalCostUsd: number;
  version: 3;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suite = parseSuite(args);
  const nativeRequested = args.includes("--native");
  const povFilter = parsePov(args);
  const perChapterCapUsd = parseUsdFlag(
    args,
    "--chapter-cap-usd",
    DEFAULT_PER_CHAPTER_CAP_USD,
    false,
    DEFAULT_PER_CHAPTER_CAP_USD,
  );
  const priorSpendUsd = parseUsdFlag(args, "--prior-spend-usd", 0, true, TOTAL_CAP_USD);
  if (suite === "full" && !args.includes("--confirm-cost")) {
    throw new Error("Full live eval requires --confirm-cost");
  }

  config({ path: resolve(ROOT, ".env"), quiet: true });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey });
  mkdirSync(REPORT_DIRECTORY, { recursive: true });

  const startedAt = new Date().toISOString();
  const results: LiveResult[] = [];
  const attempts: TraceEnvelope["attempts"] = [];
  const auditRejections: LiveReport["auditRejections"] = [];
  const draftRejections: LiveReport["draftRejections"] = [];
  let failure: unknown = null;
  try {
    const povs = suite === "smoke" ? [povFilter ?? "rowan-ashborn"] : CHARACTER_IDS;
    const turnsPerPov = suite === "smoke" ? 1 : 2;
    const expectedChapters = povs.length * turnsPerPov;
    if (priorSpendUsd + expectedChapters * perChapterCapUsd > TOTAL_CAP_USD) {
      throw new Error("Prior spend plus configured chapter caps can exceed the $3 total cap");
    }
    for (const povId of povs) {
      const store = new StoryStore();
      try {
        const service = new StoryService(store, client, {
          maxBackgroundAgents: 3,
          maxCostUsdPerChapter: perChapterCapUsd,
          nativeMultiAgent: nativeRequested,
          onNarrativeAudit: (audit) => {
            if (!audit.approved) {
              auditRejections.push({ audit, povId });
              console.log(
                `audit rejected: ${JSON.stringify(audit.scores)}; leaks=${audit.leakedFactIds.join(",") || "none"}; ${audit.evidence.map(({ detail }) => detail).join(" ")}`,
              );
            }
          },
          onNarrativeDraftRejected: (issues) => {
            draftRejections.push({ issues, povId });
            console.log(
              `draft rejected: ${issues.map(({ code, message }) => `${code}: ${message}`).join("; ")}`,
            );
          },
          onRuntimeAttempt: (attempt) => {
            attempts.push(attempt);
            if (attempt.errorCode !== null) {
              console.log(
                `${attempt.model} attempt ${attempt.attempt + 1}: ${attempt.errorCode}, $${attempt.costUsd.toFixed(5)}`,
              );
            }
          },
        });
        let view = service.selectPov(povId);
        for (let turn = 0; turn < turnsPerPov; turn += 1) {
          const beforeTurn = store.loadWorldState("ashen-crown-v1");
          if (!beforeTurn) throw new Error("World disappeared before live turn");
          const streamedChunks: string[] = [];
          const streamingStartedAt = performance.now();
          view = await service.takeTurn(
            turn === 0
              ? {
                  choiceId: view.chapter.choices[0]?.id ?? "missing-choice",
                  expectedWorldVersion: beforeTurn.version,
                  requestId: randomUUID(),
                  type: "take_action",
                }
              : {
                  description: "Investigate the immediate area for fresh tracks.",
                  expectedWorldVersion: beforeTurn.version,
                  requestId: randomUUID(),
                  type: "custom_action",
                },
            (chunk) => {
              streamedChunks.push(chunk);
            },
          );
          const streamingLatencyMs = Math.max(
            0,
            Math.round(performance.now() - streamingStartedAt),
          );
          const state = store.loadWorldState("ashen-crown-v1");
          if (!state || !validateWorldState(state).ok) {
            throw new Error("World is invalid after live chapter");
          }
          const chapter = store.loadChapter("ashen-crown-v1", state.chapter);
          if (!chapter) throw new Error(`Committed chapter ${state.chapter} is missing`);
          const trace = store.loadTrace(chapter.traceId);
          if (!trace) throw new Error(`Trace ${chapter.traceId} is missing`);
          const result: LiveResult = {
            adapterMode: trace.adapterMode,
            audit: chapter.narrativeAudit,
            chapter: chapter.chapter,
            costUsd: chapter.estimatedCostUsd,
            latencyMs: chapter.latencyMs,
            povId,
            prose: chapter.prose,
            streamChunkCount: streamedChunks.length,
            streamingLatencyMs,
            streamReconstructed: streamedChunks.join("") === chapter.prose,
            trace,
            usage: chapter.usage,
            wordCount: wordCount(chapter.prose),
          };
          assertChapterResult(result, nativeRequested, perChapterCapUsd);
          results.push(result);
          const totalCost = sum(attempts.map(({ costUsd }) => costUsd));
          if (totalCost > TOTAL_CAP_USD) throw new Error("Live suite exceeded the $3 total cap");
          console.log(
            `${povId} chapter ${chapter.chapter}: ${result.wordCount} words, $${result.costUsd.toFixed(5)}, ${result.latencyMs}ms, ${result.adapterMode}`,
          );
        }
      } finally {
        store.close();
      }
    }
  } catch (error) {
    failure = error;
  }

  const expected = suite === "smoke" ? 1 : 12;
  const totalCostUsd = sum(attempts.map(({ costUsd }) => costUsd));
  const p95LatencyMs = percentile(
    results.map(({ streamingLatencyMs }) => streamingLatencyMs),
    0.95,
  );
  const gates = {
    allAuditsApproved: results.length === expected && results.every(({ audit }) => audit.approved),
    allCommitsCompleted: results.length === expected,
    allCostsWithinChapterCap:
      results.length === expected && results.every(({ costUsd }) => costUsd <= perChapterCapUsd),
    allPovLeakListsEmpty:
      results.length === expected && results.every(({ audit }) => audit.leakedFactIds.length === 0),
    allProseWithinWordLimit:
      results.length === expected &&
      results.every(({ wordCount: count }) => count >= 900 && count <= 1_300),
    allStreamsReconstructed:
      results.length === expected &&
      results.every(({ streamChunkCount, streamReconstructed }) =>
        Boolean(streamChunkCount > 0 && streamReconstructed),
      ),
    p95WithinSixtySeconds:
      results.length > 0 &&
      percentile(
        results.map(({ streamingLatencyMs }) => streamingLatencyMs),
        0.95,
      ) <= 60_000,
    traceCostMatchesAttempts:
      Math.abs(sum(results.map(({ costUsd }) => costUsd)) - totalCostUsd) < 0.000_000_1,
    totalCostWithinCap: priorSpendUsd + totalCostUsd <= TOTAL_CAP_USD,
  };
  const report: LiveReport = {
    attempts,
    auditRejections,
    chapterCostCapUsd: perChapterCapUsd,
    completedChapters: results.length,
    cumulativeCostUsd: priorSpendUsd + totalCostUsd,
    draftRejections,
    error: failure === null ? null : safeError(failure, apiKey),
    finishedAt: new Date().toISOString(),
    gates,
    nativeRequested,
    povFilter,
    priorSpendUsd,
    projectedMaximumCumulativeCostUsd: priorSpendUsd + expected * perChapterCapUsd,
    results: results.map(toReportResult),
    startedAt,
    suite,
    totalCostCapUsd: TOTAL_CAP_USD,
    totalCostUsd,
    version: 3,
  };
  const reportPath = resolve(
    REPORT_DIRECTORY,
    `live-${suite}-${nativeRequested ? "native" : "sequential"}${povFilter ? `-${povFilter}` : ""}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (suite === "full" && failure === null && Object.values(gates).every(Boolean)) {
    writeReviewPackets(results);
  }

  console.log(
    `report ${reportPath}; ${results.length}/${expected} chapters; $${totalCostUsd.toFixed(5)}; p95 ${p95LatencyMs}ms`,
  );
  if (failure !== null) {
    const safe = safeError(failure, apiKey);
    console.error(`${safe.code}: ${safe.message}`);
    process.exitCode = 1;
    return;
  }
  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedGates.length > 0) {
    console.error(`failed gates: ${failedGates.join(", ")}`);
    process.exitCode = 1;
  }
}

function assertChapterResult(
  result: LiveResult,
  nativeRequested: boolean,
  perChapterCapUsd: number,
): void {
  if (!result.audit.approved || result.audit.leakedFactIds.length > 0) {
    throw new Error(`Narrative audit failed for ${result.povId} chapter ${result.chapter}`);
  }
  if (result.wordCount < 900 || result.wordCount > 1_300) {
    throw new Error(`Chapter word count is invalid: ${result.wordCount}`);
  }
  if (result.costUsd > perChapterCapUsd) {
    throw new Error(`Chapter cost $${result.costUsd.toFixed(6)} exceeded cap`);
  }
  if (result.streamChunkCount < 1 || !result.streamReconstructed) {
    throw new Error("Validated replay did not reconstruct committed prose");
  }
  if (!result.trace.calls.some(({ phase }) => phase === "narration")) {
    throw new Error("Trace omitted narration call");
  }
  if (!result.trace.calls.some(({ phase }) => phase === "audit")) {
    throw new Error("Trace omitted audit call");
  }
  const wantedMode = nativeRequested ? "native-multi-agent" : "sequential";
  if (result.adapterMode !== wantedMode) {
    throw new Error(`Adapter mode ${result.adapterMode} did not match ${wantedMode}`);
  }
}

function writeReviewPackets(results: readonly LiveResult[]): void {
  mkdirSync(REVIEW_DIRECTORY, { recursive: true });
  for (const povId of CHARACTER_IDS) {
    const chapters = results.filter((result) => result.povId === povId);
    const body = [
      `# POV Review Packet: ${povId}`,
      "",
      "Review status: pending human review.",
      "",
      "Dimensions: choice fulfillment, causality, POV voice, progression clarity, continuity, off-screen consequence, repetition.",
      "",
      ...chapters.flatMap((result) => [
        `## Chapter ${result.chapter}`,
        "",
        `- Adapter: ${result.adapterMode}`,
        `- Words: ${result.wordCount}`,
        `- Cost: $${result.costUsd.toFixed(6)}`,
        `- Latency: ${result.latencyMs} ms`,
        `- Audit: ${JSON.stringify(result.audit.scores)}`,
        "",
        result.prose,
        "",
      ]),
    ].join("\n");
    writeFileSync(resolve(REVIEW_DIRECTORY, `${povId}.md`), `${body}\n`, "utf8");
  }
}

function toReportResult(result: LiveResult): Omit<LiveResult, "prose"> {
  return {
    adapterMode: result.adapterMode,
    audit: result.audit,
    chapter: result.chapter,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    povId: result.povId,
    streamChunkCount: result.streamChunkCount,
    streamingLatencyMs: result.streamingLatencyMs,
    streamReconstructed: result.streamReconstructed,
    trace: result.trace,
    usage: result.usage,
    wordCount: result.wordCount,
  };
}

function parseSuite(args: readonly string[]): "full" | "smoke" {
  const index = args.indexOf("--suite");
  const value = index === -1 ? undefined : args[index + 1];
  if (value !== "smoke" && value !== "full") {
    throw new Error("Use --suite smoke or --suite full");
  }
  return value;
}

function parsePov(args: readonly string[]): CharacterId | null {
  const index = args.indexOf("--pov");
  if (index === -1) return null;
  const value = args[index + 1];
  if (!CHARACTER_IDS.includes(value as CharacterId)) {
    throw new Error(`Unknown --pov value ${value ?? "missing"}`);
  }
  return value as CharacterId;
}

function parseUsdFlag(
  args: readonly string[],
  name: string,
  fallback: number,
  allowZero: boolean,
  maximum: number,
): number {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value > maximum || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(
      `${name} must be ${allowZero ? "nonnegative" : "positive"} and at most ${maximum}`,
    );
  }
  return value;
}

function safeError(error: unknown, apiKey: string): { code: string; message: string } {
  const code = error instanceof OpenAIRuntimeError ? error.code : "LIVE_EVAL_FAILED";
  const raw = error instanceof Error ? error.message : String(error);
  return { code, message: raw.split(apiKey).join("[REDACTED]") };
}

function wordCount(prose: string): number {
  return prose.trim().split(/\s+/u).filter(Boolean).length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? sorted.at(-1) ?? 0;
}

void main().catch((error: unknown) => {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const safe = safeError(error, apiKey || "never-match-empty-key");
  console.error(`${safe.code}: ${safe.message}`);
  process.exitCode = 1;
});
