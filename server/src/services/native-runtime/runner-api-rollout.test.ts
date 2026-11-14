import { describe, expect, it } from "vitest";
import { runnerApiToolsEnabled } from "./runner-api-rollout.js";

describe("runner API rollout", () => {
  it("enables API tools without operator configuration", () => {
    expect(runnerApiToolsEnabled("space", undefined, {})).toBe(true);
    expect(runnerApiToolsEnabled("space", true, {})).toBe(true);
    expect(runnerApiToolsEnabled("space", false, {})).toBe(false);
  });
  it("fails closed for explicit disabled or invalid settings", () => {
    for (const value of ["false", "", "TRUE", "1", "invalid"]) {
      for (const binding of [undefined, false, true]) expect(runnerApiToolsEnabled("space", binding, { OUTPOST_RUNNER_API_TOOLS_ENABLED: value })).toBe(false);
    }
    expect(runnerApiToolsEnabled("space", undefined, { OUTPOST_RUNNER_API_TOOLS_ENABLED: "true" })).toBe(true);
  });
  it.each([undefined, "true"])("restricts enabled tools to exact space IDs (flag: %s)", (enabled) => {
    const env = { OUTPOST_RUNNER_API_TOOLS_ENABLED: enabled, OUTPOST_RUNNER_API_TOOLS_SPACE_IDS: " alpha, beta " };
    expect(runnerApiToolsEnabled("alpha", undefined, env)).toBe(true);
    expect(runnerApiToolsEnabled("alph", undefined, env)).toBe(false);
    expect(runnerApiToolsEnabled("foreign", true, env)).toBe(false);
    expect(runnerApiToolsEnabled("alpha", undefined, { ...env, OUTPOST_RUNNER_API_TOOLS_SPACE_IDS: "" })).toBe(false);
  });
  it("keeps baseline tools disabled and honors an operator stop over explicit bindings", () => {
    expect(runnerApiToolsEnabled("space", false, { OUTPOST_RUNNER_API_TOOLS_ENABLED: "true" })).toBe(false);
    expect(runnerApiToolsEnabled("space", false, {})).toBe(false);
    expect(runnerApiToolsEnabled("space", true, { OUTPOST_RUNNER_API_TOOLS_ENABLED: "false" })).toBe(false);
  });
});
