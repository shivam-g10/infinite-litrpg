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
const STORY_REVIEW_HUMAN_BLOCK_PATTERN =
  /<!-- STORY_REVIEW_HUMAN_START:([a-z0-9-]+) -->[\s\S]*?<!-- STORY_REVIEW_HUMAN_END:\1 -->/gu;
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
    const evidenceJson = readFileSync(STORY_REVIEW_EVIDENCE_PATH, "utf8");
    const evidenceSha256 = sha256(evidenceJson);
    const evidence = buildStoryReviewEvidence(JSON.parse(evidenceJson) as unknown);
    validateStoryReviewCheckout(evidence.sourceGitSha);
    const generated = buildStoryReviewMarkdown(evidence);
    const evidenceBoundGenerated = bindHumanReviewTemplate(generated, evidenceSha256);
    const existing = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    if (check) {
      if (!storyReviewMarkdownMatches(evidenceBoundGenerated, existing)) {
        throw new Error("Tracked six ten-chapter story review pack is missing or stale");
      }
      if (requireTenChapters) assertStoryReviewHumanSignoff(existing, evidenceSha256);
      console.log(`six ten-chapter story review pack is current: ${outputPath}`);
      return;
    }
    writeOrCheck(
      mergeFreshStoryReviewHumanSections(generated, existing, evidenceSha256),
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

export function mergeFreshStoryReviewHumanSections(
  generated: string,
  existing: string,
  evidenceSha256: string,
): string {
  const boundGenerated = bindHumanReviewTemplate(generated, evidenceSha256);
  const reusableExisting = humanSectionsMatchEvidence(existing, evidenceSha256) ? existing : "";
  return mergeStoryReviewHumanSections(boundGenerated, reusableExisting);
}

export function assertStoryReviewHumanSignoff(markdown: string, evidenceSha256: string): void {
  if (!/^[a-f0-9]{64}$/u.test(evidenceSha256)) {
    throw new Error("Expected story-review evidence SHA-256 is malformed");
  }
  const blocks = [...markdown.matchAll(STORY_REVIEW_HUMAN_BLOCK_PATTERN)];
  const expectedIds = new Set(PUBLIC_CHARACTERS.map(({ id }) => id));
  const startCount = markdown.match(/<!-- STORY_REVIEW_HUMAN_START:/gu)?.length ?? 0;
  const endCount = markdown.match(/<!-- STORY_REVIEW_HUMAN_END:/gu)?.length ?? 0;
  if (
    blocks.length !== expectedIds.size ||
    startCount !== expectedIds.size ||
    endCount !== expectedIds.size
  ) {
    throw new Error(
      "Human review pack must contain one bounded section for each of the six characters",
    );
  }

  const sections = new Map<CharacterId, string>();
  for (const block of blocks) {
    const characterId = block[1];
    if (
      characterId === undefined ||
      !expectedIds.has(characterId as CharacterId) ||
      sections.has(characterId as CharacterId) ||
      block[0] === undefined
    ) {
      throw new Error(
        "Human review pack must contain one bounded section for each of the six characters",
      );
    }
    sections.set(characterId as CharacterId, block[0]);
  }

  for (const { id } of PUBLIC_CHARACTERS) {
    const section = sections.get(id);
    if (section === undefined) {
      throw new Error(
        "Human review pack must contain one bounded section for each of the six characters",
      );
    }
    assertHumanReviewSection(id, section, evidenceSha256);
  }
}

function bindHumanReviewTemplate(markdown: string, evidenceSha256: string): string {
  return markdown.replace(STORY_REVIEW_HUMAN_BLOCK_PATTERN, (block) =>
    block.replace(
      "### Progression review",
      `### Progression review\n\n- Reviewed evidence SHA-256: \`${evidenceSha256}\``,
    ),
  );
}

function humanSectionsMatchEvidence(markdown: string, evidenceSha256: string): boolean {
  const blocks = [...markdown.matchAll(STORY_REVIEW_HUMAN_BLOCK_PATTERN)];
  if (blocks.length !== PUBLIC_CHARACTERS.length) return false;
  return blocks.every((block) => {
    const section = block[0];
    if (section === undefined) return false;
    const values = section
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("- Reviewed evidence SHA-256:"));
    return (
      values.length === 1 && values[0] === `- Reviewed evidence SHA-256: \`${evidenceSha256}\``
    );
  });
}

function assertHumanReviewSection(
  characterId: CharacterId,
  section: string,
  evidenceSha256: string,
): void {
  const reviewedEvidence = readSingleReviewValue(
    characterId,
    section,
    "Reviewed evidence SHA-256",
    "one reviewed evidence SHA-256",
  );
  if (reviewedEvidence !== `\`${evidenceSha256}\``) {
    throw new Error(`${characterId} reviewed evidence SHA-256 must be ${evidenceSha256}`);
  }

  assertNumberedCitations(characterId, section, "Memorable scene", 3, "three memorable scene");
  assertNumberedCitations(characterId, section, "Relationship turn", 2, "two relationship turn");
  assertNumberedCitations(characterId, section, "System tradeoff", 2, "two System tradeoff");
  assertSingleCitation(characterId, section, "Earned payoff", "one earned payoff");

  const filler = readSingleReviewValue(
    characterId,
    section,
    "Filler chapters",
    "one numeric filler chapter count",
  );
  if (!/^[01]$/u.test(filler)) {
    throw new Error(`${characterId} filler chapters must be 0 or 1`);
  }

  const wouldRead = readSingleReviewValue(
    characterId,
    section,
    "Would read chapter 11",
    "one would-read-chapter-11 answer",
  );
  if (wouldRead.toLowerCase() !== "yes") {
    throw new Error(`${characterId} would-read-chapter-11 answer must be yes`);
  }

  const verdict = readSingleReviewValue(
    characterId,
    section,
    "Overall verdict",
    "one overall verdict",
  );
  if (verdict.toLowerCase() !== "pass") {
    throw new Error(`${characterId} overall verdict must be pass`);
  }
}

function assertNumberedCitations(
  characterId: CharacterId,
  section: string,
  label: string,
  expectedCount: number,
  requirement: string,
): void {
  const lines = section.split(/\r?\n/u).filter((line) => line.startsWith(`- ${label} `));
  if (lines.length !== expectedCount) {
    throw new Error(`${characterId} human review requires ${requirement} citations`);
  }

  const indexes = new Set<number>();
  for (const line of lines) {
    const match = new RegExp(
      `^- ${escapeRegExp(label)} ([1-${expectedCount}]): Chapter (10|[1-9]): (.+)$`,
      "u",
    ).exec(line);
    if (match === null) {
      throw new Error(
        `${characterId} ${label.toLowerCase()} citation must use "- ${label} N: Chapter 1-10: evidence"`,
      );
    }
    indexes.add(Number(match[1]));
    assertSubstantiveCitation(characterId, label.toLowerCase(), match[2]!, match[3]!);
  }
  if (indexes.size !== expectedCount) {
    throw new Error(
      `${characterId} ${label.toLowerCase()} citations must be numbered 1 through ${expectedCount} once each`,
    );
  }
}

function assertSingleCitation(
  characterId: CharacterId,
  section: string,
  label: string,
  requirement: string,
): void {
  const lines = section.split(/\r?\n/u).filter((line) => line.startsWith(`- ${label}:`));
  if (lines.length !== 1) {
    throw new Error(`${characterId} human review requires ${requirement} citation`);
  }
  const match = new RegExp(`^- ${escapeRegExp(label)}: Chapter (10|[1-9]): (.+)$`, "u").exec(
    lines[0]!,
  );
  if (match === null) {
    throw new Error(
      `${characterId} ${label.toLowerCase()} citation must use "- ${label}: Chapter 1-10: evidence"`,
    );
  }
  assertSubstantiveCitation(characterId, label.toLowerCase(), match[1]!, match[2]!);
}

function assertSubstantiveCitation(
  characterId: CharacterId,
  label: string,
  chapter: string,
  evidence: string,
): void {
  const normalized = evidence.trim().toLowerCase();
  if (
    Number(chapter) < 1 ||
    Number(chapter) > 10 ||
    normalized === "" ||
    /^(?:tbd|todo|none|n\/a|pass|yes|no|placeholder)[.!]?$/u.test(normalized)
  ) {
    throw new Error(`${characterId} ${label} citation needs substantive evidence`);
  }
}

function readSingleReviewValue(
  characterId: CharacterId,
  section: string,
  label: string,
  requirement: string,
): string {
  const prefix = `- ${label}:`;
  const lines = section.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) {
    throw new Error(`${characterId} human review requires ${requirement}`);
  }
  return lines[0]!.slice(prefix.length).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
