import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /OPENAI_API_KEY[ \t]*=[ \t]*[^\s#]+/,
];

const files = new Set(
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .filter(Boolean),
);
for (const ignoredDirectory of ["logs", "evals/reports"]) {
  collectFiles(resolve(ignoredDirectory), files);
}

const hits: string[] = [];

for (const file of files) {
  let content: string;

  try {
    const buffer = readFileSync(file);
    if (buffer.includes(0)) {
      continue;
    }
    content = buffer.toString("utf8");
  } catch {
    continue;
  }

  if (secretPatterns.some((pattern) => pattern.test(content))) {
    hits.push(file);
  }
}

const history = execFileSync("git", ["log", "--all", "-p", "--no-ext-diff"], {
  encoding: "utf8",
  maxBuffer: 100 * 1024 * 1024,
});
if (secretPatterns.some((pattern) => pattern.test(history))) {
  hits.push("git-history");
}

if (hits.length > 0) {
  console.error(`Secret scan failed in ${hits.length} file(s):`);
  for (const hit of hits) {
    console.error(`- ${hit}`);
  }
  process.exit(1);
}

console.log(
  `Secret scan passed across ${files.size} working files, ignored logs and reports, and Git history.`,
);

function collectFiles(directory: string, output: Set<string>): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      collectFiles(path, output);
    } else if (entry.isFile()) {
      output.add(relative(process.cwd(), path));
    }
  }
}
