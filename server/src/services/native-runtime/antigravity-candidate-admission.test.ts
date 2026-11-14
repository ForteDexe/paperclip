import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { QUALIFIED_ACPX_PROFILES } from "../../vendor/outpost-runner/index.js";
import { ANTIGRAVITY_CANDIDATE_ADMISSION_ENV, resolveAntigravityCandidateAdmission } from "./acpx-qualification.js";
import { resolveOutpostRunnerNativeProviderInput, resolveOutpostRunnerProviderProfile } from "./provider-profile.js";
import { resolveNativeRuntimeMode } from "./runtime-mode.js";

const spaceId = "candidate-space";
const model = "gemini-3.8-flash-low";
const config = { provider: "acpx", acpxAgent: "antigravity", model };
const localHost = process.platform === "darwin" && process.arch === "arm64";
const distributions = JSON.parse(readFileSync(new URL("../../../../packages/outpost-runner/antigravity-distributions.json", import.meta.url), "utf8"));
const admission = () => ({ schema: "outpost.acpx-candidate-admission.v1", spaceId,
  agent: "antigravity", model, profileDigest: QUALIFIED_ACPX_PROFILES.antigravity.commandDigest,
  nativeClosureDigest: `sha256:${distributions.platforms["darwin-arm64"].closureSha256}`,
  platform: "darwin", architecture: "arm64", expiresAt: Date.now() + 60_000 });

describe("Antigravity operator candidate admission", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps saved configuration and runtime environment from authorizing a candidate", () => {
    vi.stubEnv(ANTIGRAVITY_CANDIDATE_ADMISSION_ENV, undefined);
    const injected = { ...config, candidateAdmission: admission(),
      env: { [ANTIGRAVITY_CANDIDATE_ADMISSION_ENV]: JSON.stringify(admission()) } };
    expect(() => resolveOutpostRunnerProviderProfile(injected, { spaceId }))
      .toThrow(expect.objectContaining({ code: "outpost_runner_acpx_agent_unavailable" }));
  });

  it("requires explicit space authority and never projects it to another space", () => {
    vi.stubEnv(ANTIGRAVITY_CANDIDATE_ADMISSION_ENV, JSON.stringify(admission()));
    expect(resolveAntigravityCandidateAdmission({})).toBeUndefined();
    expect(resolveAntigravityCandidateAdmission({ spaceId: "another-space", model })).toBeUndefined();
    expect(() => resolveOutpostRunnerProviderProfile(config)).toThrow(/awaiting native Runner acceptance/);
    expect(() => resolveOutpostRunnerProviderProfile(config, { spaceId: "another-space" }))
      .toThrow(/awaiting native Runner acceptance/);
  });

  it("admits only the exact configured local candidate while leaving global release pending", () => {
    vi.stubEnv(ANTIGRAVITY_CANDIDATE_ADMISSION_ENV, JSON.stringify(admission()));
    expect(QUALIFIED_ACPX_PROFILES.antigravity.qualificationStatus).toBe("pending");
    if (!localHost) {
      expect(resolveAntigravityCandidateAdmission({ spaceId, model })).toBeUndefined();
      return;
    }
    expect(resolveAntigravityCandidateAdmission({ spaceId })).toMatchObject({ spaceId, model, agent: "antigravity" });
    expect(resolveOutpostRunnerProviderProfile(config, { spaceId })).toMatchObject(config);
    expect(resolveOutpostRunnerNativeProviderInput({ backend: "acpx_runtime", adapterConfig: config, spaceId }))
      .toMatchObject({ ...config, acpxPermissionMode: "approve-all" });
    expect(() => resolveOutpostRunnerProviderProfile({ ...config, model: "different-model" }, { spaceId }))
      .toThrow(expect.objectContaining({ code: "outpost_runner_acpx_qualification_invalid" }));
    expect(resolveNativeRuntimeMode({ enabled: false, runtimeConfig: {}, adapterConfig: config,
      agent: { id: "candidate-agent", spaceId, adapterType: "outpost_runner", status: "active" },
      issue: { id: "candidate-task", workMode: "standard" }, target: { kind: "local" }, workspaceId: null }))
      .toMatchObject({ kind: "native", profile: { backend: "acpx_runtime" } });
  });

  it.runIf(localHost).each([
    { expiresAt: 0 }, { profileDigest: `sha256:${"0".repeat(64)}` },
    { nativeClosureDigest: `sha256:${"0".repeat(64)}` }, { platform: "linux" },
    { architecture: "x64" }, { allowAll: true },
  ])("rejects expired, changed or broad operator authorization %j", changes => {
    vi.stubEnv(ANTIGRAVITY_CANDIDATE_ADMISSION_ENV, JSON.stringify({ ...admission(), ...changes }));
    expect(() => resolveAntigravityCandidateAdmission({ spaceId, model })).toThrow();
    expect(() => resolveOutpostRunnerProviderProfile(config, { spaceId }))
      .toThrow(expect.objectContaining({ code: "outpost_runner_acpx_qualification_invalid" }));
  });
});
