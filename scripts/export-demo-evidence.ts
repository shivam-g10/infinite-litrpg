import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRegisteredResumeCheckpoint,
  parseLiveReport,
  writeAtomicJson,
} from "../evals/run-live";
import {
  buildDemoEvidence,
  defaultDemoEvidencePath,
  parseDemoEvidence,
} from "./seed-demo-evidence";

const ROOT = process.cwd();

export function defaultDemoSourceReportPath(root = ROOT): string {
  return resolve(root, "evals", "reports", "live-full-sequential-renarrated-settled-2.json");
}

function main(): void {
  const sourcePath = process.argv[2] ? resolve(process.argv[2]) : defaultDemoSourceReportPath();
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : defaultDemoEvidencePath();
  const force = process.argv.includes("--force");
  if (!existsSync(sourcePath))
    throw new Error(`Authenticated source report not found: ${sourcePath}`);

  const raw = readFileSync(sourcePath, "utf8");
  const report = parseLiveReport(JSON.parse(raw) as unknown);
  if (report.version !== 9) throw new Error("Demo evidence requires a strict version 9 report");
  const reportSha256 = createHash("sha256").update(raw).digest("hex");
  assertRegisteredResumeCheckpoint(report, reportSha256);
  const result = report.results.find(
    (candidate) => candidate.povId === "rowan-ashborn" && candidate.chapter === 1,
  );
  if (!result) throw new Error("Authenticated source report lacks Rowan chapter 1");
  const evidence = buildDemoEvidence(result, {
    reportSha256,
    reportVersion: 9,
    sourceGitSha: report.sourceGitSha,
  });

  if (existsSync(outputPath) && !force) {
    const existing = parseDemoEvidence(JSON.parse(readFileSync(outputPath, "utf8")) as unknown);
    if (JSON.stringify(existing) === JSON.stringify(evidence)) {
      console.log(`demo evidence already current: ${outputPath}`);
      return;
    }
    throw new Error("Demo evidence exists with different content; pass --force to replace it");
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeAtomicJson(outputPath, evidence);
  console.log(`wrote provider-free demo evidence from ${reportSha256}: ${outputPath}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
