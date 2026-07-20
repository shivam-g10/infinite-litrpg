import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_CHARACTERS, type CharacterId } from "@infinite-litrpg/shared";

import { assertPacketDirectory } from "../evals/review-packets";

const ROOT = process.cwd();
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
  const positional = process.argv.slice(2).filter((argument) => argument !== "--check");
  const packetDirectory = positional[0]
    ? resolve(positional[0])
    : resolve(ROOT, "docs", "review-packets");
  const outputPath = positional[1]
    ? resolve(positional[1])
    : resolve(ROOT, "docs", "SAMPLE_STORIES.md");
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
    "# Six POV Story Samples",
    "",
    "Human review reading pack for Infinite LitRPG. Each selected chapter passed its original human chapter review. This pack does not mark the full twelve-chapter release report approved; three different chapters remain in correction review.",
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

  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== markdown) {
      throw new Error("Tracked six-story review pack is missing or stale");
    }
    console.log(`six-story review pack is current: ${outputPath}`);
    return;
  }

  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, markdown, "utf8");
    renameSync(temporaryPath, outputPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
  console.log(
    `wrote six provider-free story samples from reviewed packet ${manifest.reportSha256}: ${outputPath}`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
