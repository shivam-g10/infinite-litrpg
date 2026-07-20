import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHARACTER_IDS,
  NARRATIVE_AUDIT_DIMENSIONS,
  buildPovContext,
  type WorldState,
} from "@infinite-litrpg/shared";
import { z } from "zod";

import type { LiveReport, LiveResult } from "./run-live";

const PACKET_DIRECTORY = resolve(process.cwd(), "docs", "review-packets");
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HUMAN_REVIEW_START = "<!-- HUMAN REVIEW START -->";
const HUMAN_REVIEW_END = "<!-- HUMAN REVIEW END -->";

const ReviewPacketManifestSchema = z
  .object({
    adapterMode: z.enum(["native-multi-agent", "sequential"]),
    finishedAt: z.string().datetime(),
    formatVersion: z.literal(1),
    packetOrder: z.array(z.string().min(1).max(200)).length(CHARACTER_IDS.length),
    packets: z
      .array(
        z
          .object({
            evidenceSha256: z.string().regex(SHA256_PATTERN),
            filename: z.string().min(1).max(200),
            povId: z.enum(CHARACTER_IDS),
          })
          .strict(),
      )
      .length(CHARACTER_IDS.length),
    pricingVersion: z.string().min(1).max(240),
    promptVersion: z.string().min(1).max(240),
    reportSha256: z.string().regex(SHA256_PATTERN),
    reviewStatus: z.enum([
      "pending-human-review",
      "human-reviewed-rejected",
      "human-reviewed-approved",
    ]),
    schemaVersions: z.array(z.string().min(1).max(240)).min(1).max(12),
    serviceTier: z.enum(["flex", "standard"]),
    sourceGitSha: z.string().regex(/^[a-f0-9]{7,40}$/u),
  })
  .strict();

const DIMENSION_LABELS: Readonly<Record<(typeof NARRATIVE_AUDIT_DIMENSIONS)[number], string>> = {
  arcProgress: "Arc progress",
  characterAutonomy: "Character autonomy",
  choiceFulfillment: "Choice fulfillment",
  continuity: "Continuity",
  litrpgMechanics: "LitRPG mechanics",
  povSafety: "POV safety",
  prose: "Prose",
};

export type ReviewPacketManifest = z.infer<typeof ReviewPacketManifestSchema>;

export function writeReviewPackets(
  report: LiveReport,
  reportSha256: string,
  outputDirectory = PACKET_DIRECTORY,
  options: { readonly force?: boolean } = {},
): ReviewPacketManifest {
  assertReviewableReport(report, reportSha256);
  if (existsSync(outputDirectory) && options.force !== true) {
    throw new Error("Review packet directory exists; pass --force to replace generated evidence");
  }

  const parent = dirname(outputDirectory);
  mkdirSync(parent, { recursive: true });
  const temporaryDirectory = mkdtempSync(join(parent, ".review-packets-"));
  const backupDirectory = `${outputDirectory}.backup-${process.pid}`;
  let movedExistingDirectory = false;

  try {
    const packets = CHARACTER_IDS.map((povId) => {
      const filename = `${povId}.md`;
      const results = report.results
        .filter((result) => result.povId === povId)
        .sort((left, right) => left.chapter - right.chapter);
      const body = renderReviewPacket(report, reportSha256, povId, results);
      writeFileSync(join(temporaryDirectory, filename), body, "utf8");
      return { evidenceSha256: hashText(generatedEvidence(body)), filename, povId };
    });
    const manifest: ReviewPacketManifest = {
      adapterMode: report.adapterMode,
      finishedAt: report.finishedAt,
      formatVersion: 1,
      packetOrder: packets.map(({ filename }) => filename),
      packets,
      pricingVersion: report.pricingVersion,
      promptVersion: report.promptVersion,
      reportSha256,
      reviewStatus: "pending-human-review",
      schemaVersions: [...new Set(report.results.map(({ trace }) => trace.schemaVersion))].sort(),
      serviceTier: report.serviceTier,
      sourceGitSha: report.sourceGitSha,
    };
    writeFileSync(
      join(temporaryDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    assertPacketDirectory(temporaryDirectory, manifest);

    if (existsSync(backupDirectory)) {
      rmSync(backupDirectory, { force: true, recursive: true });
    }
    if (existsSync(outputDirectory)) {
      renameSync(outputDirectory, backupDirectory);
      movedExistingDirectory = true;
    }
    renameSync(temporaryDirectory, outputDirectory);
    if (movedExistingDirectory) {
      rmSync(backupDirectory, { force: true, recursive: true });
    }
    return manifest;
  } catch (error) {
    if (!existsSync(outputDirectory) && movedExistingDirectory && existsSync(backupDirectory)) {
      renameSync(backupDirectory, outputDirectory);
    }
    if (existsSync(temporaryDirectory)) {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
    throw error;
  }
}

export function assertPacketDirectory(
  directory: string,
  manifestCandidate?: ReviewPacketManifest,
): ReviewPacketManifest {
  const rawManifest = readFileSync(join(directory, "manifest.json"), "utf8");
  const manifest = ReviewPacketManifestSchema.parse(JSON.parse(rawManifest) as unknown);
  if (
    manifestCandidate !== undefined &&
    JSON.stringify(manifest) !== JSON.stringify(manifestCandidate)
  ) {
    throw new Error("Review packet manifest write does not match generated metadata");
  }
  if (new Set(manifest.schemaVersions).size !== manifest.schemaVersions.length) {
    throw new Error("Review packet manifest schema versions must be unique");
  }
  const wantedFiles = ["manifest.json", ...CHARACTER_IDS.map((povId) => `${povId}.md`)].sort();
  const actualFiles = readdirSync(directory).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(wantedFiles)) {
    throw new Error("Review packet directory must contain exactly six packets and one manifest");
  }
  if (
    manifest.packetOrder.length !== CHARACTER_IDS.length ||
    manifest.packets.length !== CHARACTER_IDS.length
  ) {
    throw new Error("Review packet manifest must list all six POVs");
  }
  const observedSchemaVersions = new Set<string>();
  const humanVerdicts: Array<HumanReviewVerdict | null> = [];
  CHARACTER_IDS.forEach((povId, index) => {
    const filename = `${povId}.md`;
    const entry = manifest.packets[index];
    if (
      manifest.packetOrder[index] !== filename ||
      entry?.filename !== filename ||
      entry.povId !== povId
    ) {
      throw new Error("Review packet manifest order is invalid");
    }
    const body = readFileSync(join(directory, filename), "utf8");
    assertPacketMetadata(body, manifest, povId);
    const packetSchemaVersions = [...body.matchAll(/^- Schema version: `([^`\r\n]+)`$/gmu)].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    );
    if (packetSchemaVersions.length !== 2) {
      throw new Error(`Review packet ${filename} must contain two schema-version records`);
    }
    for (const schemaVersion of packetSchemaVersions) {
      if (!manifest.schemaVersions.includes(schemaVersion)) {
        throw new Error(`Review packet ${filename} schema version is absent from manifest`);
      }
      observedSchemaVersions.add(schemaVersion);
    }
    if (entry.evidenceSha256 !== hashText(generatedEvidence(body))) {
      throw new Error(`Review packet ${filename} generated evidence hash does not match manifest`);
    }
    humanVerdicts.push(humanReviewVerdict(body));
  });
  if (
    JSON.stringify([...observedSchemaVersions].sort()) !==
    JSON.stringify([...manifest.schemaVersions].sort())
  ) {
    throw new Error("Review packet schema versions do not match manifest");
  }
  if (manifest.reviewStatus !== "pending-human-review") {
    const completedVerdicts = humanVerdicts.flatMap((verdict) =>
      verdict === null ? [] : [verdict],
    );
    if (completedVerdicts.length !== CHARACTER_IDS.length) {
      throw new Error("Completed review manifest requires complete human verdicts");
    }
    if (
      completedVerdicts.some(({ chapters, final }) => {
        const hasRejectedChapter = chapters.includes("reject");
        return (
          (final === "pass" && hasRejectedChapter) || (final === "reject" && !hasRejectedChapter)
        );
      })
    ) {
      throw new Error("Packet final verdict does not match human chapter verdicts");
    }
    const hasRejection = completedVerdicts.some(({ final }) => final === "reject");
    if (
      (manifest.reviewStatus === "human-reviewed-approved" && hasRejection) ||
      (manifest.reviewStatus === "human-reviewed-rejected" && !hasRejection)
    ) {
      throw new Error("Completed review manifest does not match human verdicts");
    }
  }
  return manifest;
}

interface HumanReviewVerdict {
  readonly chapters: readonly ("pass" | "reject")[];
  readonly final: "pass" | "reject";
}

function humanReviewVerdict(body: string): HumanReviewVerdict | null {
  const start = body.indexOf(HUMAN_REVIEW_START);
  const end = body.indexOf(HUMAN_REVIEW_END);
  if (start < 0 || end <= start) return null;
  const review = body.slice(start, end);
  const finalVerdicts = [...review.matchAll(/^- Final verdict: (pass|reject)$/gmu)];
  const chapterVerdicts = [...review.matchAll(/^- Human chapter verdict: (pass|reject)$/gmu)];
  if (finalVerdicts.length !== 1 || chapterVerdicts.length !== 2) return null;
  return {
    chapters: chapterVerdicts.map((match) => (match[1] === "reject" ? "reject" : "pass")),
    final: finalVerdicts[0]?.[1] === "reject" ? "reject" : "pass",
  };
}

function assertPacketMetadata(body: string, manifest: ReviewPacketManifest, povId: string): void {
  const expectedLines = [
    `# POV Review Packet: ${povId}`,
    `- Source report SHA-256: \`${manifest.reportSha256}\``,
    `- Source Git SHA: \`${manifest.sourceGitSha}\``,
    `- Prompt version: \`${manifest.promptVersion}\``,
    `- Service tier: \`${manifest.serviceTier}\``,
    `- Pricing version: \`${manifest.pricingVersion}\``,
    `- Adapter: \`${manifest.adapterMode}\``,
    `- Report finished: \`${manifest.finishedAt}\``,
  ];
  if (expectedLines.some((line) => !body.split(/\r?\n/u).includes(line))) {
    throw new Error(`Review packet ${povId} metadata does not match manifest`);
  }
}

function assertReviewableReport(report: LiveReport, reportSha256: string): void {
  if (!SHA256_PATTERN.test(reportSha256)) {
    throw new Error("Review packets require the exact source report SHA-256");
  }
  if (
    report.version !== 9 ||
    report.suite !== "full" ||
    report.serviceTier !== "flex" ||
    report.error !== null ||
    report.completedChapters !== CHARACTER_IDS.length * 2 ||
    !Object.values(report.gates).every(Boolean)
  ) {
    throw new Error("Review packets require one strict, fully green version 9 full report");
  }
  if (!hasExactMatrix(report.results)) {
    throw new Error("Review packets require chapter 1 and 2 for all six POVs");
  }
  for (const result of report.results) {
    if (
      result.canonicalNarrativeInput === undefined ||
      !result.audit.approved ||
      result.audit.leakedFactIds.length > 0 ||
      result.trace.gateResult !== "passed" ||
      result.trace.promptVersion !== report.promptVersion ||
      result.trace.attempts.some(
        (attempt) =>
          attempt.requestedServiceTier !== report.serviceTier ||
          attempt.serviceTier !== report.serviceTier,
      ) ||
      result.trace.calls.some(
        (call) =>
          call.requestedServiceTier !== report.serviceTier ||
          call.serviceTier !== report.serviceTier,
      )
    ) {
      throw new Error(
        `Review evidence is incomplete for ${result.povId} chapter ${result.chapter}`,
      );
    }
  }
}

function hasExactMatrix(results: readonly LiveResult[]): boolean {
  if (results.length !== CHARACTER_IDS.length * 2) return false;
  return CHARACTER_IDS.every((povId) => {
    const chapters = results
      .filter((result) => result.povId === povId)
      .map(({ chapter }) => chapter)
      .sort((left, right) => left - right);
    return chapters.length === 2 && chapters[0] === 1 && chapters[1] === 2;
  });
}

function renderReviewPacket(
  report: LiveReport,
  reportSha256: string,
  povId: string,
  results: readonly LiveResult[],
): string {
  const chapters = results.flatMap((result) => renderChapterEvidence(result));
  const audits = results.flatMap((result) => renderModelAudit(result));
  return [
    `# POV Review Packet: ${povId}`,
    "",
    "Generated review status: pending human review.",
    "",
    `- Source report SHA-256: \`${reportSha256}\``,
    `- Source Git SHA: \`${report.sourceGitSha}\``,
    `- Prompt version: \`${report.promptVersion}\``,
    `- Service tier: \`${report.serviceTier}\``,
    `- Pricing version: \`${report.pricingVersion}\``,
    `- Adapter: \`${report.adapterMode}\``,
    `- Report finished: \`${report.finishedAt}\``,
    "",
    "Rubric: [`evals/RUBRIC.md`](../../evals/RUBRIC.md). A zero in POV safety, LitRPG mechanics, continuity, or arc progress blocks release.",
    "",
    "Human reviewer: read both chapters and the reviewer-only canon appendices. Score before consulting the model audit appendix.",
    "",
    ...chapters,
    HUMAN_REVIEW_START,
    "",
    ...renderHumanReview(results),
    HUMAN_REVIEW_END,
    "",
    "## Model Audit Appendix",
    "",
    "Advisory only. Human scores above control release.",
    "",
    ...audits,
  ].join("\n");
}

function renderChapterEvidence(result: LiveResult): string[] {
  const canonical = result.canonicalNarrativeInput;
  if (canonical === undefined) throw new Error("Canonical review evidence is missing");
  const before = buildPovContext(canonical.stateBefore, result.povId);
  const after = buildPovContext(canonical.stateAfter, result.povId);
  const visibleAfterEventIds = new Set(after.observedEvents.map(({ id }) => id));
  const visibleDelta = {
    clock: result.trace.acceptedDelta.clock,
    events: result.trace.acceptedDelta.events.filter(({ id }) => visibleAfterEventIds.has(id)),
    knowledgeMutations: result.trace.acceptedDelta.knowledgeMutations.filter(
      ({ characterId }) => characterId === result.povId,
    ),
    stateMutations: result.trace.acceptedDelta.stateMutations.filter(
      (mutation) => "characterId" in mutation && mutation.characterId === result.povId,
    ),
    surfacedClueFactIds: result.trace.acceptedDelta.surfacedClueFactIds.filter((factId) =>
      after.factIds.includes(factId),
    ),
  };
  return [
    `## Chapter ${result.chapter}: ${canonical.chapterRecord.title}`,
    "",
    `- Prose SHA-256: \`${result.audit.proseHash}\``,
    `- Trace run ID: \`${result.trace.runId}\``,
    `- Trace Git SHA: \`${result.trace.gitSha}\``,
    `- State: \`${result.trace.stateBeforeHash}\` to \`${result.trace.stateAfterHash}\``,
    `- Schema version: \`${result.trace.schemaVersion}\``,
    `- Words: ${result.wordCount}`,
    `- Cost: $${result.costUsd.toFixed(6)}`,
    `- Latency: ${result.latencyMs} ms total, ${result.streamingLatencyMs} ms replay`,
    `- Stream: ${result.streamChunkCount} chunks, reconstructed ${String(result.streamReconstructed)}`,
    `- Usage: ${result.usage.inputTokens} input, ${result.usage.outputTokens} output, ${result.usage.totalTokens} total tokens`,
    "",
    "### Selected Player Action",
    "",
    fencedJson(canonical.playerAction),
    "",
    "### Offered Next Choices",
    "",
    fencedJson(canonical.frame.choices),
    "",
    "### POV-Safe Canon Before and After",
    "",
    fencedJson({
      after: {
        arcClock: pickPovSafeArcClock(canonical.stateAfter),
        character: after.povCharacter,
        facts: after.facts,
        observedEvents: after.observedEvents,
        world: pickWorld(canonical.stateAfter),
      },
      before: {
        arcClock: pickPovSafeArcClock(canonical.stateBefore),
        character: before.povCharacter,
        facts: before.facts,
        observedEvents: before.observedEvents,
        world: pickWorld(canonical.stateBefore),
      },
      visibleAcceptedDelta: visibleDelta,
    }),
    "",
    "### Prose",
    "",
    result.prose,
    "",
    "### Reviewer-Only Canon Appendix",
    "",
    "Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.",
    "",
    fencedJson({
      acceptedDelta: result.trace.acceptedDelta,
      arcClockAfter: canonical.stateAfter.arcClock,
      arcClockBefore: canonical.stateBefore.arcClock,
      backgroundIntents: result.trace.intents.filter(({ actorId }) => actorId !== result.povId),
      forbiddenFacts: canonical.forbiddenFacts,
    }),
    "",
  ];
}

function renderHumanReview(results: readonly LiveResult[]): string[] {
  return [
    "## Human Review Record",
    "",
    "- Reviewer:",
    "- Review date:",
    "- Final verdict: pending",
    "- Cross-chapter continuity evidence:",
    "- Repetition evidence:",
    "- Release notes:",
    "",
    "Cite exact prose or canon evidence for every score.",
    "",
    ...results.flatMap((result) => [
      `### Chapter ${result.chapter} Human Scores`,
      "",
      "| Dimension | Human score 0 to 2 | Exact evidence |",
      "| --- | ---: | --- |",
      ...NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => `| ${DIMENSION_LABELS[dimension]} |  |  |`),
      "",
      "- Human chapter verdict: pending",
      "- Human chapter notes:",
      "",
    ]),
  ];
}

function renderModelAudit(result: LiveResult): string[] {
  const rows = NARRATIVE_AUDIT_DIMENSIONS.map((dimension, index) => {
    const evidence = result.audit.evidence[index];
    return `| ${DIMENSION_LABELS[dimension]} | ${result.audit.scores[dimension]} | ${escapeTableCell(evidence?.detail ?? "missing")} |`;
  });
  return [
    `### Chapter ${result.chapter} Model Audit`,
    "",
    `Approved: ${String(result.audit.approved)}. Leaked fact IDs: ${result.audit.leakedFactIds.length}.`,
    "",
    "| Dimension | Model score | Model evidence |",
    "| --- | ---: | --- |",
    ...rows,
    "",
  ];
}

function pickWorld(state: WorldState) {
  return {
    act: state.act,
    calendar: state.calendar,
    chapter: state.chapter,
    terminal: state.terminal,
    terminalReason: state.terminalReason,
    threat: state.threat,
    version: state.version,
  };
}

function pickPovSafeArcClock(state: WorldState) {
  return {
    convergencePressure: state.arcClock.convergencePressure,
    transitionRequired: state.arcClock.transitionRequired,
  };
}

function generatedEvidence(body: string): string {
  if (
    countOccurrences(body, HUMAN_REVIEW_START) !== 1 ||
    countOccurrences(body, HUMAN_REVIEW_END) !== 1
  ) {
    throw new Error("Review packet human-review boundaries must occur exactly once");
  }
  const start = body.indexOf(HUMAN_REVIEW_START);
  const end = body.indexOf(HUMAN_REVIEW_END);
  if (start < 0 || end <= start) {
    throw new Error("Review packet human-review boundary is missing");
  }
  return `${body.slice(0, start + HUMAN_REVIEW_START.length)}\n${body.slice(end)}`;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function fencedJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2).replaceAll("~~~", "\\u007e\\u007e\\u007e");
  return `~~~json\n${json}\n~~~`;
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((argument) => argument !== "--force");
  const reportPath = positional[0];
  if (reportPath === undefined) {
    throw new Error(
      "Usage: npm run evals:review-packets -- <strict-version-9-full-report.json> [output-directory] [--force]",
    );
  }
  const raw = readFileSync(resolve(reportPath), "utf8");
  const candidate = JSON.parse(raw) as unknown;
  const { LiveReportSchema } = await import("./run-live");
  const report = LiveReportSchema.parse(candidate);
  const outputDirectory = positional[1] ? resolve(positional[1]) : PACKET_DIRECTORY;
  const manifest = writeReviewPackets(report, hashText(raw), outputDirectory, { force });
  console.log(
    `wrote ${manifest.packets.length} review packets to ${outputDirectory}; source ${manifest.reportSha256}`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
