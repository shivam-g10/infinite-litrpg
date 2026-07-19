import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const source = resolve(".");
const temporaryRoot = mkdtempSync(join(tmpdir(), "infinite-litrpg-clean-"));
const clone = join(temporaryRoot, "repo");
const startedAt = Date.now();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  run("git", ["clone", "--local", source, clone], temporaryRoot);
  run(npmCommand, ["ci"], clone);
  run(npmCommand, ["run", "check"], clone);

  const durationSeconds = (Date.now() - startedAt) / 1_000;
  if (durationSeconds > 300) {
    throw new Error(`Clean-clone setup exceeded five minutes: ${durationSeconds.toFixed(1)}s`);
  }

  console.log(`Clean-clone gate passed in ${durationSeconds.toFixed(1)}s.`);
} finally {
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  const relativeToSystemTemp = relative(resolve(tmpdir()), resolvedTemporaryRoot);
  if (relativeToSystemTemp.startsWith("..") || isAbsolute(relativeToSystemTemp)) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedTemporaryRoot}`);
  }
  rmSync(resolvedTemporaryRoot, { force: true, recursive: true });
}

function run(command: string, arguments_: readonly string[], cwd: string): void {
  execFileSync(command, arguments_, { cwd, stdio: "inherit" });
}
