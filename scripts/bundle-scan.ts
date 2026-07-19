import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const clientRoot = join("app", ".next", "static");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map"]);

if (!existsSync(clientRoot)) {
  console.error("Client bundle missing. Run npm run build first.");
  process.exit(1);
}

const forbiddenLiterals = ["OPENAI_API_KEY", "NEXT_PUBLIC_OPENAI_API_KEY"];
const configuredKey = process.env.OPENAI_API_KEY;
const hits: string[] = [];

for (const file of walk(clientRoot)) {
  if (!textExtensions.has(extname(file))) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  const containsForbiddenLiteral = forbiddenLiterals.some((literal) => content.includes(literal));
  const containsConfiguredKey = configuredKey !== undefined && content.includes(configuredKey);

  if (containsForbiddenLiteral || containsConfiguredKey || /sk-[A-Za-z0-9_-]{20,}/u.test(content)) {
    hits.push(file);
  }
}

if (hits.length > 0) {
  console.error(`Client bundle secret scan failed in ${hits.length} file(s):`);
  for (const hit of hits) {
    console.error(`- ${hit}`);
  }
  process.exit(1);
}

console.log("Client bundle contains no API key name, configured key value, or key-shaped token.");

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
