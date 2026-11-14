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
  {
    name: "@outpost/plugin-fake-sandbox",
    root: "packages/plugins/outpost-plugin-fake-sandbox",
  },
  {
    name: "@outpost/create-outpost-plugin",
    root: "packages/plugins/create-outpost-plugin",
  },
];

const registrationFiles = [
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "server/src/routes/plugins.ts",
  "pnpm-workspace.yaml",
];

const retiredInfrastructure = [
  ".github/workflows/chat-catalog-testops.yml",
  ".github/workflows/chat-catalog-testops-case.yml",
  ".github/workflows/chat-feature-testops-retained-verification.yml",
  ".github/workflows/runner-e2e-testops-registration.yml",
  ".github/workflows/runner-protocol-live-evals.yml",
  "packages/outpost-runner/scripts/runner-protocol-testops.mjs",
  "tests/runner-e2e/chat-full-catalog-testops-manifest.json",
  "tests/runner-e2e/testops-chat-admission.ts",
  "tests/runner-e2e/chat-remote-host.ts",
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

for (const retiredPath of retiredInfrastructure) {
  if (await exists(retiredPath)) {
    failures.push(`retired infrastructure exists: ${retiredPath}`);
  }
}

if (failures.length > 0) {
  console.error("Retained product scope check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Retained product scope check passed.");
}
