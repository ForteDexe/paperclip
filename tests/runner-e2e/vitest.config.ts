import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "runner-e2e-support",
    // CI profiling records per-test timings, like the root and Runner package configs.
    ...(process.env.OUTPOST_CI_PROFILE === "true"
      ? { reporters: [...configDefaults.reporters, fileURLToPath(new URL("../../scripts/ci-profile/vitest-reporter.mjs", import.meta.url))] }
      : {}),
    globalSetup: ["./verified-provider-bundles.setup.mjs"],
    include: ["**/*.test.ts", "**/*.test.mjs"],
    // These use node:test and run separately in test:e2e:runner:unit.
    exclude: [...configDefaults.exclude, "native-completion-{checks,git-source,source-contract}.test.mjs", "artifact-budget.test.mjs"],
    testTimeout: 30_000,
  },
});
