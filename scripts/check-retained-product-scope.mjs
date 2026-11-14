import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");

const requiredPackageRoots = [
  "packages/adapters/claude-local",
  "packages/adapters/codex-local",
  "packages/db",
  "packages/outpost-runner",
  "packages/plugins/plugin-campfire",
  "packages/plugins/sdk",
  "packages/shared",
];

const retiredPackages = [
  {
    name: "@outpost/plugin-llm-wiki",
    root: "packages/plugins/plugin-llm-wiki",
  },
];

const registrationFiles = [
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "server/src/routes/plugins.ts",
  "pnpm-workspace.yaml",
];

async function exists(relativePath) {
  return access(path.join(repoRoot, relativePath)).then(() => true, () => false);
}

const failures = [];

for (const packageRoot of requiredPackageRoots) {
  if (!(await exists(packageRoot))) {
    failures.push(`required product package is missing: ${packageRoot}`);
  }
}

for (const retired of retiredPackages) {
  if (await exists(retired.root)) {
    failures.push(`retired package root exists: ${retired.root}`);
  }

  for (const registrationFile of registrationFiles) {
    const content = await readFile(path.join(repoRoot, registrationFile), "utf8");
    if (content.includes(retired.name) || content.includes(retired.root)) {
      failures.push(`retired package is registered in ${registrationFile}: ${retired.name}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Retained product scope check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Retained product scope check passed.");
}
