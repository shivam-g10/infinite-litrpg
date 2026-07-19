import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface LockPackage {
  readonly license?: string;
  readonly link?: boolean;
  readonly name?: string;
  readonly version?: string;
}

interface PackageLock {
  readonly packages: Readonly<Record<string, LockPackage>>;
}

const allowedLicenseTokens = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
]);

const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as PackageLock;
const inventory = Object.entries(lock.packages)
  .filter(([path, metadata]) => path.startsWith("node_modules/") && !metadata.link)
  .map(([path, metadata]) => {
    const packageJsonPath = join(path, "package.json");
    let license = metadata.license;
    let name = metadata.name ?? path.replace(/^node_modules\//u, "");
    let version = metadata.version ?? "unknown";

    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        license?: string;
        name?: string;
        version?: string;
      };
      license = packageJson.license ?? license;
      name = packageJson.name ?? name;
      version = packageJson.version ?? version;
    }

    return { license: license ?? "UNKNOWN", name, version };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const rejected = inventory.filter(({ license }) => !isAllowed(license));
const reportPath = join("evals", "reports", "licenses.json");

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), inventory }, null, 2)}\n`,
);

if (rejected.length > 0) {
  console.error(`License gate failed for ${rejected.length} package(s):`);
  for (const item of rejected) {
    console.error(`- ${item.name}@${item.version}: ${item.license}`);
  }
  process.exit(1);
}

console.log(
  `License gate passed for ${inventory.length} installed packages. Report: ${reportPath}`,
);

function isAllowed(expression: string): boolean {
  const tokens = expression.match(/[A-Za-z0-9.-]+/gu) ?? [];
  const licenseTokens = tokens.filter((token) => token !== "AND" && token !== "OR");
  return (
    licenseTokens.length > 0 && licenseTokens.every((token) => allowedLicenseTokens.has(token))
  );
}
