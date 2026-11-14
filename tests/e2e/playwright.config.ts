import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Use a dedicated port so e2e tests always start their own server in local_trusted mode,
// even when the dev server is running on :3100 in authenticated mode.
const PORT = Number(process.env.OUTPOST_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUTPOST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "outpost-e2e-home-"));
const OUTPOST_INSTANCE_ID = "playwright-e2e";
const OUTPOST_CONFIG = path.join(OUTPOST_HOME, "instances", OUTPOST_INSTANCE_ID, "config.json");
const OUTPOST_AGENT_JWT_SECRET = process.env.OUTPOST_AGENT_JWT_SECRET ?? "playwright-e2e-agent-jwt-secret";
const OUTPOST_DECISION_SIGNING_SECRET =
  process.env.OUTPOST_DECISION_SIGNING_SECRET ?? "playwright-e2e-decision-signing-secret";
const OUTPOST_TOOL_ACTION_SIGNING_SECRET =
  process.env.OUTPOST_TOOL_ACTION_SIGNING_SECRET ?? "playwright-e2e-tool-action-signing-secret";
const PLAYWRIGHT_CHANNEL = process.env.OUTPOST_PLAYWRIGHT_CHANNEL;

process.env.OUTPOST_HOME = OUTPOST_HOME;
process.env.OUTPOST_CONFIG = OUTPOST_CONFIG;
// Worker processes reload this config; retain the main process's server path
// for specs that seed historical database state in the throwaway instance.
process.env.OUTPOST_E2E_SERVER_CONFIG ??= OUTPOST_CONFIG;
// Specs that mint agent JWTs in-process (via createLocalAgentJwt) must derive
// the same per-instance signing key as the webServer, or verification fails
// with a 401 instead of authenticating as the agent.
process.env.OUTPOST_INSTANCE_ID = OUTPOST_INSTANCE_ID;
process.env.OUTPOST_AGENT_JWT_SECRET = OUTPOST_AGENT_JWT_SECRET;
process.env.OUTPOST_DECISION_SIGNING_SECRET = OUTPOST_DECISION_SIGNING_SECRET;
process.env.OUTPOST_TOOL_ACTION_SIGNING_SECRET = OUTPOST_TOOL_ACTION_SIGNING_SECRET;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // These suites target dedicated multi-user configurations/ports and are
  // intentionally not part of the default local_trusted e2e run.
  testIgnore: ["in-feed-native/**", "multi-user.spec.ts", "multi-user-authenticated.spec.ts"],
  timeout: 60_000,
  retries: 0,
  // All specs share one throwaway server. Run files serially so mutable
  // instance state cannot change another spec mid-flight.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  // The webServer directive bootstraps a throwaway instance and then starts it.
  // `onboard --yes --run` works in a non-interactive temp OUTPOST_HOME.
  webServer: {
    cwd: path.resolve(import.meta.dirname, "../.."),
    // Exercise the shipped UI. Source-checkout onboarding otherwise enables
    // Vite middleware: every reload traverses thousands of modules, including
    // service-worker-intercepted requests, before React can even start.
    // Build the server's first-choice static directory so a prior package build
    // cannot shadow the UI under test with stale server/ui-dist assets.
    command: "pnpm --filter @outpost/ui build --outDir ../server/ui-dist --emptyOutDir && node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts onboard --yes --run",
    url: `${BASE_URL}/api/health`,
    // Always boot a dedicated throwaway instance for e2e so browser tests
    // never attach to the developer's active Outpost home/server.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      OUTPOST_UI_DEV_MIDDLEWARE: "false",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${path.resolve(import.meta.dirname, "fixtures/agent-chat-github.mjs")} --import=${path.resolve(import.meta.dirname, "fixtures/ai-connection-provider.mjs")}`,
      PORT: String(PORT),
      OUTPOST_OPEN_ON_LISTEN: "false",
      OUTPOST_API_URL: BASE_URL,
      OUTPOST_HOME,
      OUTPOST_INSTANCE_ID,
      OUTPOST_CONFIG,
      OUTPOST_AGENT_JWT_SECRET,
      OUTPOST_DECISION_SIGNING_SECRET,
      OUTPOST_TOOL_ACTION_SIGNING_SECRET,
      OUTPOST_BIND: "loopback",
      OUTPOST_DEPLOYMENT_MODE: "local_trusted",
      OUTPOST_DEPLOYMENT_EXPOSURE: "private",
    },
  },
  outputDir: "./test-results",
  reporter: [
    ["list"], ["html", { open: "never", outputFolder: "./playwright-report" }],
    ...(process.env.GITHUB_ACTIONS === "true"
      ? [[path.resolve(import.meta.dirname, "../../scripts/ci/oversized-test-files-playwright.mjs")] as [string]]
      : []),
    ...(process.env.OUTPOST_CI_PROFILE === "true"
      ? [[path.resolve(import.meta.dirname, "../../scripts/ci-profile/playwright-reporter.mjs")] as [string]]
      : []),
  ],
});
