import { access, readFile, readdir } from "node:fs/promises";
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
  {
    name: "@outpost/outpost-eval-kernel",
    root: "packages/outpost-eval-kernel",
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
  "evals",
  "docs/pr-screenshots",
  "screenshots",
  "scripts/screenshot-blocked-inbox.mjs",
  "scripts/screenshot-file-viewer.mjs",
  "scripts/screenshot-fork-flow.mjs",
  "scripts/screenshot-notion-connect-flow.mjs",
  "scripts/screenshot-one.mjs",
  "scripts/screenshot-pap2373.mjs",
  "scripts/screenshot-recovery-card.cjs",
  "scripts/screenshot-subissues.mjs",
  "scripts/screenshot-verdicts.mjs",
  "scripts/screenshot.cjs",
  "packages/plugins/examples",
  "packages/plugins/plugin-workspace-diff",
  ".github/workflows/chat-catalog-testops.yml",
  ".github/workflows/chat-catalog-testops-case.yml",
  ".github/workflows/chat-feature-testops-retained-verification.yml",
  ".github/workflows/runner-e2e-testops-registration.yml",
  ".github/workflows/runner-protocol-live-evals.yml",
  ".github/workflows/runner-live-evals.yml",
  ".github/workflows/runner-chaos-evals.yml",
  "packages/outpost-runner/scripts/runner-protocol-testops.mjs",
  "tests/runner-e2e/chat-full-catalog-testops-manifest.json",
  "tests/runner-e2e/testops-chat-admission.ts",
  "tests/runner-e2e/chat-remote-host.ts",
  "tests/runner-e2e/runner-eval-observability.test.ts",
  "packages/outpost-runner/src/eval",
  "packages/outpost-runner/src/evals",
  "packages/outpost-runner/src/cli/eval-session.ts",
  "packages/outpost-runner/infra/aws-agentcore-outpost.yaml",
  "packages/outpost-runner/scripts/aws-agentcore.sh",
  "packages/outpost-runner/scripts/aws-agentcore-provisioning.test.mjs",
  "packages/outpost-runner/scripts/capability-aws-agentcore-smoke.mjs",
  "packages/outpost-runner/scripts/materialize-opencode-binary.mjs",
  "packages/outpost-runner/scripts/materialize-opencode-binary.test.mjs",
  "packages/outpost-runner/scripts/qualify-opencode-runtime.test.mjs",
  ".github/workflows/crash-points.yml",
  "scripts/crash-points.mjs",
  "tests/restart-chaos",
  "tests/hiring-ai-connections",
  "docker/daytona-runner",
  "scripts/prepare-runner-release-image.mjs",
];

const retiredFilenamePrefixes = [
  { root: "tests/runner-e2e", prefix: "catalog-overview" },
  { root: "tests/runner-e2e", prefix: "chat-campaign" },
  { root: "tests/runner-e2e", prefix: "public-mcp-" },
  { root: "tests/runner-e2e/chat-catalog-domains", prefix: "external-" },
  { root: "tests/runner-e2e/chat-catalog-domains", prefix: "runtime-grok" },
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

for (const retired of retiredFilenamePrefixes) {
  const entries = await readdir(path.join(repoRoot, retired.root));
  for (const entry of entries) {
    if (entry.startsWith(retired.prefix)) {
      failures.push(`retired file family exists: ${retired.root}/${entry}`);
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
