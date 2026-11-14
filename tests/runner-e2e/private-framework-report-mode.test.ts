import { afterEach, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { buildRunnerE2EProcessEnvironment } from "./harness-env.js";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it.each([
  [undefined, ["list", "blob", "junit", "html"]],
  ["/tmp/owned/preflight.json", ["list", "blob", "junit", "html"]],
] as const)("uses the local private reporter set for preflight=%s", async (preflight, expected) => {
  const root = path.join(os.tmpdir(), "outpost-private-reporter");
  const source = { OUTPOST_RUNNER_E2E_PRIVATE_PREFLIGHT: preflight ? path.join(root, "preflight.json") : undefined };
  for (const [key, value] of Object.entries({ ...source, OUTPOST_RUNNER_E2E_PORT: "3104", OUTPOST_RUNNER_E2E_TEMP_ROOT: root, OUTPOST_RUNNER_E2E_PRIVATE_DIR: path.join(root, "private"),
    OUTPOST_HOME: path.join(root, "home"), OUTPOST_CONFIG: path.join(root, "config.json"), OUTPOST_INSTANCE_ID: "synthetic", OUTPOST_AGENT_JWT_SECRET: "synthetic", OUTPOST_DECISION_SIGNING_SECRET: "synthetic", OUTPOST_TOOL_ACTION_SIGNING_SECRET: "synthetic", BETTER_AUTH_SECRET: "synthetic" })) vi.stubEnv(key, value);
  const { default: config } = await import("./playwright.config.js");
  expect((config.reporter as Array<[string]>).map(row => row[0])).toEqual(expected);
});
