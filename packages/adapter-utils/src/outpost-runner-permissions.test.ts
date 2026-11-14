import { resolveOutpostRunnerPiThinkingLevel } from "./outpost-runner-permissions.js";
import { describe, expect, it } from "vitest";

import {
  OUTPOST_RUNNER_DEFAULT_MODELS,
  OUTPOST_RUNNER_ACPX_PROFILES,
  outpostRunnerTransitionConfig,
  isOutpostRunnerProvider,
  resolveOutpostRunnerModel,
  resolveOutpostRunnerPermissionMode,
  resolveOutpostRunnerCursorMode,
} from "./outpost-runner-permissions.js";

describe("Outpost Runner permission defaults", () => {
  it("exposes qualified Kimi Code with an explicit runtime credential", () => {
    expect(OUTPOST_RUNNER_ACPX_PROFILES.find(profile => profile.value === "kimi"))
      .toMatchObject({ qualified: true, credentialEnvironment: ["KIMI_API_KEY"] });
  });
  it("marks Pi and Copilot qualified with their provider credential bindings", () => {
    expect(OUTPOST_RUNNER_ACPX_PROFILES.find(profile => profile.value === "pi"))
      .toMatchObject({ qualified: true, credentialEnvironment: expect.arrayContaining(["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) });
    expect(OUTPOST_RUNNER_ACPX_PROFILES.find(profile => profile.value === "copilot"))
      .toMatchObject({ qualified: true, credentialEnvironment: ["COPILOT_GITHUB_TOKEN"] });
  });
  it("defaults Codex to the only qualified non-interactive mode", () => {
    expect(resolveOutpostRunnerPermissionMode("codex", undefined)).toBe(
      "never",
    );
    expect(resolveOutpostRunnerPermissionMode("codex", "on-request")).toBe("never");
    expect(resolveOutpostRunnerPermissionMode("codex", "untrusted")).toBe("never");
  });

  it("defaults Claude and OpenCode to full auto", () => {
    expect(resolveOutpostRunnerPermissionMode("opencode", undefined)).toBe(
      "allow",
    );
    expect(resolveOutpostRunnerPermissionMode("acpx", undefined)).toBe(
      "approve-all",
    );
  });

  it.each(["approve-outpost", "approve-reads", "deny-all", "approve-all"])("preserves explicit Claude %s settings", (mode) => {
    expect(resolveOutpostRunnerPermissionMode("acpx", mode)).toBe(mode);
  });

  it.each([
    ["claude_local", "acpxPermissionMode", "approve-all"],
    ["codex_local", "codexPermissionMode", "never"],
    ["opencode_local", "opencodePermissionMode", "allow"],
    ["pi_local", "acpxPermissionMode", "approve-all"],
    ["grok_local", "acpxPermissionMode", "approve-all"],
  ])("uses full auto when converting %s to the new runner", (adapter, key, value) => {
    expect(outpostRunnerTransitionConfig(adapter, undefined)).toMatchObject({ [key]: value });
  });

  it("keeps Pi models explicit during conversion", () => {
    expect(outpostRunnerTransitionConfig("pi_local", undefined)).toMatchObject({ provider: "acpx", acpxAgent: "pi", model: "" });
    expect(outpostRunnerTransitionConfig("pi_local", "openrouter/provider/model")).toMatchObject({ provider: "acpx", acpxAgent: "pi", model: "openrouter/provider/model" });
  });

  it("keeps Grok's harness and model when converting its adapter", () => {
    expect(outpostRunnerTransitionConfig("grok_local", "grok-4.7"))
      .toMatchObject({ provider: "acpx", acpxAgent: "grok", model: "grok-4.7" });
  });

  it.each([undefined, "", "grok-build"])("resolves Grok's legacy default %s to the native model", model => {
    expect(outpostRunnerTransitionConfig("grok_local", model)).toMatchObject({ model: "grok-4.7" });
  });

  it("recognizes only exact provider identifiers", () => {
    expect(isOutpostRunnerProvider("cursor_cloud")).toBe(true);
    expect(isOutpostRunnerProvider("codex")).toBe(true);
    expect(isOutpostRunnerProvider("opencode")).toBe(true);
    expect(isOutpostRunnerProvider("claude_managed")).toBe(true);
    expect(isOutpostRunnerProvider("aws_agentcore")).toBe(true);
    expect(isOutpostRunnerProvider("acpx")).toBe(true);
    expect(isOutpostRunnerProvider("toString")).toBe(false);
    expect(isOutpostRunnerProvider("__proto__")).toBe(false);
  });

  it("keeps managed provider permissions under the qualified profile", () => {
    expect(resolveOutpostRunnerPermissionMode("cursor_cloud", "never")).toBe("provider-managed");
    expect(resolveOutpostRunnerPermissionMode("claude_managed", "never"))
      .toBe("provider-managed");
    expect(resolveOutpostRunnerPermissionMode("aws_agentcore", "approve-all"))
      .toBe("provider-managed");
  });

  it("converts Cursor Cloud without substituting an implicit model or adding command permission controls", () => {
    expect(outpostRunnerTransitionConfig("cursor_cloud", "custom-model")).toEqual({ provider: "cursor_cloud", model: "custom-model", lifecycleMode: "per_turn" });
    expect(outpostRunnerTransitionConfig("cursor_cloud", undefined)).toEqual({ provider: "cursor_cloud", model: "", lifecycleMode: "per_turn" });
  });

  it("uses the Codex default for missing or blank models", () => {
    expect(resolveOutpostRunnerModel("codex", undefined)).toBe(
      OUTPOST_RUNNER_DEFAULT_MODELS.codex,
    );
    expect(resolveOutpostRunnerModel("codex", "   ")).toBe(
      OUTPOST_RUNNER_DEFAULT_MODELS.codex,
    );
  });

  it("preserves an explicit Codex model", () => {
    expect(resolveOutpostRunnerModel("codex", "gpt-5.5")).toBe("gpt-5.5");
    expect(resolveOutpostRunnerModel("codex", "  gpt-5.5  ")).toBe("gpt-5.5");
  });
});


describe("Cursor session mode admission", () => {
  it.each([undefined, "agent", "plan", "ask"])("retains mode %s with an explicit Cursor default", mode => {
    expect(resolveOutpostRunnerCursorMode("acpx", "cursor", mode)).toBe(mode ?? "agent");
  });
  it.each([null, "", "auto", "PLAN", true, {}, ["plan"]])("rejects invalid mode %j", mode => {
    expect(() => resolveOutpostRunnerCursorMode("acpx", "cursor", mode)).toThrow("Cursor session mode");
  });
  it.each([["codex", "cursor"], ["acpx", "copilot"], ["acpx", "pi"], ["acpx", "claude"]])("rejects mode on %s/%s", (provider, agent) => {
    expect(resolveOutpostRunnerCursorMode(provider, agent, undefined)).toBeUndefined();
    expect(() => resolveOutpostRunnerCursorMode(provider, agent, "plan")).toThrow("only for Cursor");
  });
});

describe("Pi thinking configuration", () => {
  it.each([undefined, "off", "low", "high", "max"] as const)("persists exact level %s with low as the fresh-config default", value => {
    expect(resolveOutpostRunnerPiThinkingLevel("acpx", "pi", value)).toBe(value ?? "low");
  });
  it.each(["medium", "minimal", "xhigh", "", null, 1])("rejects unsupported alias %s", value => {
    expect(() => resolveOutpostRunnerPiThinkingLevel("acpx", "pi", value)).toThrow();
  });
  it("rejects foreign provider settings", () => {
    expect(() => resolveOutpostRunnerPiThinkingLevel("codex", "pi", "low")).toThrow(/only/);
    expect(() => resolveOutpostRunnerPiThinkingLevel("acpx", "cursor", "low")).toThrow(/only/);
    expect(resolveOutpostRunnerPiThinkingLevel("codex", undefined, undefined)).toBeUndefined();
  });
});
