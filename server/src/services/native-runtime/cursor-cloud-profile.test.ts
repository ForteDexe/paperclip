import { describe, expect, it } from "vitest";
import { projectOutpostRunnerTaskConfig, resolveOutpostRunnerNativeProviderInput, resolveOutpostRunnerProviderProfile } from "./provider-profile.js";

const config = { provider: "cursor_cloud", model: "caller-custom-model", repoUrl: "https://github.com/acme/repo", env: { CURSOR_API_KEY: { type: "secret_ref", secretId: "space-secret", version: "latest" } } };

describe("Cursor Cloud native provider admission", () => {
  it("forwards the task-selected exact model without applying an effort policy", () => {
    const projected = projectOutpostRunnerTaskConfig("cursor_cloud_api", config, { model: "task-selected-model", modelReasoningEffort: "high" });
    expect(resolveOutpostRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: projected })).toMatchObject({ model: "task-selected-model" });
    expect(projected).not.toHaveProperty("modelReasoningEffort");
  });
  it("preserves the exact caller model and provider-owned remote configuration", () => {
    expect(resolveOutpostRunnerProviderProfile(config)).toEqual({ provider: "cursor_cloud", backend: "cursor_cloud_api", model: "caller-custom-model" });
    expect(resolveOutpostRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: { ...config, repoRef: "feature", autoCreatePR: true } })).toEqual({
      provider: "cursor_cloud", model: "caller-custom-model", cursorCloud: { schema: "outpost.cursor-cloud.config.v1", repos: [{ url: config.repoUrl, startingRef: "feature" }], env: { type: "cloud" }, autoCreatePR: true },
    });
  });

  it("reads saved legacy repository fields and rejects conflicting aliases", () => {
    expect(resolveOutpostRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: { ...config, repoStartingRef: "legacy", runtimeEnvType: "cloud" } })).toMatchObject({ cursorCloud: { repos: [{ startingRef: "legacy" }] } });
    expect(() => resolveOutpostRunnerProviderProfile({ ...config, repoStartingRef: "legacy", repoRef: "different" })).toThrow(expect.objectContaining({ code: "outpost_runner_cursor_cloud_config_invalid" }));
  });

  it.each(["plain", "secret_ref"])("rejects selected hosted secrets instead of dropping their %s binding", type => {
    const env = { ...config.env, GH_TOKEN: type === "plain" ? { type, value: "unforwarded-test-value" } : { type, secretId: "hosted-secret", version: "latest" } };
    for (const admit of [
      () => resolveOutpostRunnerProviderProfile({ ...config, env }),
      () => resolveOutpostRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: { ...config, env } }),
    ]) {
      expect(admit).toThrow("Configure hosted secrets in your Cursor Cloud environment");
      expect(admit).toThrow("GH_TOKEN");
      expect(admit).not.toThrow("unforwarded-test-value");
    }
  });

  it.each(["", undefined])("requires an explicit model (%s)", model => {
    expect(() => resolveOutpostRunnerProviderProfile({ ...config, model })).toThrow(expect.objectContaining({ code: "outpost_runner_cursor_cloud_model_required" }));
  });

  it.each([
    { cloudEnvType: "pool" }, { lifecycleMode: "warm" }, { codexPermissionMode: "never" },
    { acpxPermissionMode: "approve-all" }, { promptTemplate: "replace assigned instructions" },
    { modelReasoningEffort: "high" }, { reasoningEffort: "high" }, { effort: "high" }, { modelParams: [{ key: "reasoning", value: "high" }] }, { homeMode: "preconfigured" },
    { cursorCloudTimeoutMs: 3_600_001 }, { repoUrl: "https://user:secret@github.com/acme/repo" },
  ])("rejects unsupported or unsafe configuration %j", patch => {
    expect(() => resolveOutpostRunnerProviderProfile({ ...config, ...patch })).toThrow(expect.objectContaining({ code: "outpost_runner_cursor_cloud_config_invalid" }));
  });
});
