import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { STORY_REVIEW_CHAPTER_CAP_USD, STORY_REVIEW_TOTAL_CAP_USD } from "./story-review";
import { migrateStoryReviewVariant } from "./story-review-variant";

const ROOT = process.cwd();
const REPORT_DIRECTORY = resolve(ROOT, "evals", "reports");

function main(): void {
  const fromSourceGitSha = parseArgs(process.argv.slice(2));
  const toSourceGitSha = git(["rev-parse", "HEAD"]);
  if (git(["status", "--porcelain", "--untracked-files=all"]) !== "") {
    throw new Error("Story-review variant migration requires a clean committed worktree");
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", fromSourceGitSha, toSourceGitSha], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    throw new Error("Variant migration source is not an ancestor of the current checkout");
  }
  const result = migrateStoryReviewVariant({
    archiveRoot: resolve(REPORT_DIRECTORY, "story-review-archives"),
    fromSourceGitSha,
    ledgerPath: resolve(REPORT_DIRECTORY, "story-review-spend.db"),
    markerPath: resolve(REPORT_DIRECTORY, "story-review-variant.json"),
    reportDirectory: REPORT_DIRECTORY,
    storyDirectory: resolve(REPORT_DIRECTORY, "story-review"),
    toSourceGitSha,
  });
  console.log(
    JSON.stringify(
      {
        ...result,
        newChapterCapUsd: STORY_REVIEW_CHAPTER_CAP_USD,
        newTotalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
        providerRequests: 0,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: readonly string[]): string {
  if (args.length !== 3 || args[0] !== "--from-source-git-sha" || args[2] !== "--confirm-archive") {
    throw new Error(
      "Usage: npm run review:stories:migrate-variant -- --from-source-git-sha <sha> --confirm-archive",
    );
  }
  const source = args[1]!;
  if (!/^[a-f0-9]{40}$/u.test(source)) throw new Error("Migration source Git SHA is invalid");
  return source;
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
