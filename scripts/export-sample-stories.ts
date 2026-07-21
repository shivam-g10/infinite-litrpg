import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_CHARACTERS, type CharacterId } from "@infinite-litrpg/shared";

import { assertPacketDirectory } from "../evals/review-packets";
import {
  buildStoryReviewEvidence,
  buildStoryReviewMarkdown,
  mergeStoryReviewHumanSections,
  parseStoryReviewWorktreePaths,
  splitStoryReviewGitLines,
  storyReviewMarkdownMatches,
  validateStoryReviewGitBridge,
} from "../evals/story-review";

const ROOT = process.cwd();
const STORY_REVIEW_EVIDENCE_PATH = resolve(ROOT, "docs", "story-review-evidence.json");
const SAMPLE_CHAPTERS: Readonly<Record<CharacterId, number>> = {
  "elara-voss": 2,
  "lucan-aurelis": 2,
  "maelin-rook": 1,
  "nyra-vale": 1,
  "rowan-ashborn": 1,
  "varek-thorn": 1,
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sampleFromPacket(
  packet: string,
  characterId: CharacterId,
  chapter: number,
): { readonly prose: string; readonly title: string } {
  const reviewHeading = `### Chapter ${chapter} Human Scores`;
  const reviewStart = packet.indexOf(reviewHeading);
  const nextReview = packet.indexOf("### Chapter ", reviewStart + reviewHeading.length);
  const chapterReview =
    reviewStart < 0 ? "" : packet.slice(reviewStart, nextReview < 0 ? undefined : nextReview);
  if (!chapterReview.includes("- Human chapter verdict: pass")) {
    throw new Error(
      `Selected sample lacks a passed human chapter review: ${characterId}:${chapter}`,
    );
  }

  const chapterHeading = new RegExp(`^## Chapter ${chapter}: (.+)$`, "mu").exec(packet);
  if (!chapterHeading?.[1] || chapterHeading.index === undefined) {
    throw new Error(`Selected sample lacks a chapter heading: ${characterId}:${chapter}`);
  }
  const chapterBody = packet.slice(chapterHeading.index);
  const proseMarker = "### Prose\n\n";
  const proseStart = chapterBody.indexOf(proseMarker);
  const proseEnd = chapterBody.indexOf("\n\n### Reviewer-Only Canon Appendix", proseStart);
  if (proseStart < 0 || proseEnd < 0) {
    throw new Error(`Selected sample lacks a bounded prose section: ${characterId}:${chapter}`);
  }
  return {
    prose: chapterBody.slice(proseStart + proseMarker.length, proseEnd).trim(),
    title: chapterHeading[1],
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  const requireTenChapters = process.argv.includes("--require-ten-chapters");
  const positional = process.argv
    .slice(2)
    .filter((argument) => argument !== "--check" && argument !== "--require-ten-chapters");
  const packetDirectory = positional[0]
    ? resolve(positional[0])
    : resolve(ROOT, "docs", "review-packets");
  const outputPath = positional[1]
    ? resolve(positional[1])
    : resolve(ROOT, "docs", "SAMPLE_STORIES.md");
  if (existsSync(STORY_REVIEW_EVIDENCE_PATH)) {
    const evidence = buildStoryReviewEvidence(
      JSON.parse(readFileSync(STORY_REVIEW_EVIDENCE_PATH, "utf8")) as unknown,
    );
    validateStoryReviewCheckout(evidence.sourceGitSha);
    const generated = buildStoryReviewMarkdown(evidence);
    const existing = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    if (check) {
      if (!storyReviewMarkdownMatches(generated, existing)) {
        throw new Error("Tracked six ten-chapter story review pack is missing or stale");
      }
      console.log(`six ten-chapter story review pack is current: ${outputPath}`);
      return;
    }
    writeOrCheck(
      mergeStoryReviewHumanSections(generated, existing),
      outputPath,
      false,
      "six ten-chapter story review pack",
    );
    return;
  }
  if (requireTenChapters) {
    throw new Error("Provenance-checked six-by-ten runtime evidence is missing");
  }

  const manifest = assertPacketDirectory(packetDirectory);

  const sections = PUBLIC_CHARACTERS.map((character, index) => {
    const chapter = SAMPLE_CHAPTERS[character.id];
    const packet = readFileSync(resolve(packetDirectory, `${character.id}.md`), "utf8");
    const sample = sampleFromPacket(packet, character.id, chapter);
    return [
      `## ${index + 1}. ${character.name}`,
      "",
      `_${character.publicRole}. ${character.characterClass}, level ${character.level}._`,
      "",
      `Sample source: chapter ${chapter}. Human chapter verdict: **pass**. Prose SHA-256: \`${sha256(sample.prose)}\`.`,
      "",
      `### ${sample.title}`,
      "",
      sample.prose,
      "",
      "### Review notes",
      "",
      "- Voice and character:",
      "- Story hook and pacing:",
      "- LitRPG clarity:",
      "- Continuity concerns:",
      "- Keep reading: yes or no",
      "",
    ].join("\n");
  });

  const markdown = [
    "# Legacy One-Chapter POV Excerpts",
    "",
    `Voice-only reference for Infinite LitRPG. This file is insufficient for progression review and will be replaced by six contiguous ten-chapter stories. Each selected excerpt passed its original human chapter review. Full twelve-chapter packet status: **${manifest.reviewStatus}**. This curated selection does not replace that packet verdict.`,
    "",
    `- Source report SHA-256: \`${manifest.reportSha256}\``,
    `- Source Git SHA: \`${manifest.sourceGitSha}\``,
    `- Prompt version: \`${manifest.promptVersion}\``,
    `- Service tier: \`${manifest.serviceTier}\``,
    "- Generated provider-free from authenticated local review packets.",
    "",
    "## Reading order",
    "",
    ...PUBLIC_CHARACTERS.map(
      (character, index) =>
        `${index + 1}. [${character.name}](#${index + 1}-${character.name.toLowerCase().replaceAll(" ", "-")})`,
    ),
    "",
    ...sections,
  ].join("\n");

  writeOrCheck(
    markdown,
    outputPath,
    check,
    `six legacy one-chapter samples from reviewed packet ${manifest.reportSha256}`,
  );
}

function validateStoryReviewCheckout(sourceGitSha: string): void {
  const currentGitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const sourceIsAncestor =
    spawnSync("git", ["merge-base", "--is-ancestor", sourceGitSha, currentGitSha], {
      cwd: ROOT,
      stdio: "ignore",
    }).status === 0;
  const committedPaths =
    sourceGitSha === currentGitSha
      ? []
      : gitLines(["diff", "--no-renames", "--name-only", `${sourceGitSha}..${currentGitSha}`]);
  const worktreePaths = parseStoryReviewWorktreePaths(
    gitLines(["status", "--porcelain=v1", "--untracked-files=all"]),
  );
  validateStoryReviewGitBridge({ committedPaths, sourceIsAncestor, worktreePaths });
}

function gitLines(args: readonly string[]): string[] {
  return splitStoryReviewGitLines(execFileSync("git", [...args], { cwd: ROOT, encoding: "utf8" }));
}

function writeOrCheck(markdown: string, outputPath: string, check: boolean, label: string): void {
  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== markdown) {
      throw new Error(`Tracked ${label} is missing or stale`);
    }
    console.log(`${label} is current: ${outputPath}`);
    return;
  }

  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, markdown, "utf8");
    renameSync(temporaryPath, outputPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
  console.log(`wrote ${label}: ${outputPath}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
