import { beforeEach, describe, expect, it, vi } from "vitest";

const updateGeneral = vi.fn();
const listSpaceIds = vi.fn();
const ensureKubernetesEnvironment = vi.fn();

vi.mock("./instance-settings.js", () => ({
  instanceSettingsService: () => ({
    updateGeneral,
    listSpaceIds,
  }),
}));

vi.mock("./environments.js", () => ({
  environmentService: () => ({
    ensureKubernetesEnvironment,
  }),
}));

const {
  parseExecutionPolicyBootstrapEnv,
  applyExecutionPolicyBootstrap,
} = await import("./execution-policy-bootstrap.js");
type ExecutionPolicyBootstrapEnv = import("./execution-policy-bootstrap.js").ExecutionPolicyBootstrapEnv;
type ExecutionPolicyBootstrap = import("./execution-policy-bootstrap.js").ExecutionPolicyBootstrap;

function env(overrides: Record<string, string | undefined>): ExecutionPolicyBootstrapEnv {
  return overrides;
}

const bootstrap: ExecutionPolicyBootstrap = {
  executionMode: "kubernetes",
  kubernetesConfig: { inCluster: true, backend: "job" },
};

// `applyExecutionPolicyBootstrap` constructs its services internally from the
// Db, so we mock the service modules; the Db itself is never touched here.
const fakeDb = {} as never;

describe("parseExecutionPolicyBootstrapEnv", () => {
  it("returns null when no execution mode is set (default unrestricted)", () => {
    expect(parseExecutionPolicyBootstrapEnv(env({}))).toBeNull();
  });

  it("returns null when execution mode is explicitly any", () => {
    expect(
      parseExecutionPolicyBootstrapEnv(env({ OUTPOST_EXECUTION_MODE: "any" })),
    ).toBeNull();
  });

  it("parses the forced kubernetes policy with a job/gvisor/cilium config", () => {
    const parsed = parseExecutionPolicyBootstrapEnv(
      env({
        OUTPOST_EXECUTION_MODE: "kubernetes",
        OUTPOST_K8S_BACKEND: "job",
        OUTPOST_K8S_IN_CLUSTER: "true",
        OUTPOST_K8S_RUNTIME_CLASS_NAME: "gvisor",
        OUTPOST_K8S_EGRESS_MODE: "cilium",
        OUTPOST_K8S_EGRESS_ALLOW_FQDNS: "api.anthropic.com, api.openai.com",
        OUTPOST_K8S_EGRESS_ALLOW_CIDRS: "10.0.0.0/8",
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.executionMode).toBe("kubernetes");
    expect(parsed?.kubernetesConfig).toMatchObject({
      backend: "job",
      inCluster: true,
      runtimeClassName: "gvisor",
      egressMode: "cilium",
      egressAllowFqdns: ["api.anthropic.com", "api.openai.com"],
      egressAllowCidrs: ["10.0.0.0/8"],
    });
  });

  it("defaults inCluster false and omits unset optional fields", () => {
    const parsed = parseExecutionPolicyBootstrapEnv(
      env({ OUTPOST_EXECUTION_MODE: "kubernetes" }),
    );
    expect(parsed?.kubernetesConfig.inCluster).toBe(false);
    expect(parsed?.kubernetesConfig.runtimeClassName).toBeUndefined();
    expect(parsed?.kubernetesConfig.egressAllowFqdns).toBeUndefined();
  });

  it("throws on an unknown execution mode", () => {
    expect(() =>
      parseExecutionPolicyBootstrapEnv(env({ OUTPOST_EXECUTION_MODE: "vm" })),
    ).toThrow(/OUTPOST_EXECUTION_MODE/);
  });

  it("attaches the declared adapter registry to the kubernetes config", () => {
    const parsed = parseExecutionPolicyBootstrapEnv(
      env({
        OUTPOST_EXECUTION_MODE: "kubernetes",
        OUTPOST_ADAPTERS: JSON.stringify([
          { adapterType: "opencode_local", runtimeImage: "img", envKeys: ["ANTHROPIC_API_KEY"], allowFqdns: [], probeCommand: ["opencode", "--version"], defaultEnv: { ANTHROPIC_BASE_URL: "http://bifrost:8080" } },
        ]),
      }),
    );
    expect(parsed?.kubernetesConfig.adapters).toHaveLength(1);
    expect(parsed?.kubernetesConfig.adapters?.[0].adapterType).toBe("opencode_local");
  });

  it("leaves adapters undefined when OUTPOST_ADAPTERS is absent", () => {
    const parsed = parseExecutionPolicyBootstrapEnv(env({ OUTPOST_EXECUTION_MODE: "kubernetes" }));
    expect(parsed?.kubernetesConfig.adapters).toBeUndefined();
  });

  it("reads OUTPOST_K8S_RPC_TIMEOUT_MS into kubernetesConfig.timeoutMs", () => {
    const parsed = parseExecutionPolicyBootstrapEnv(
      env({
        OUTPOST_EXECUTION_MODE: "kubernetes",
        OUTPOST_K8S_RPC_TIMEOUT_MS: "600000",
      }),
    );
    expect(parsed?.kubernetesConfig.timeoutMs).toBe(600000);
  });

  it("omits timeoutMs when OUTPOST_K8S_RPC_TIMEOUT_MS is absent", () => {
    const parsed = parseExecutionPolicyBootstrapEnv(env({ OUTPOST_EXECUTION_MODE: "kubernetes" }));
    expect(parsed?.kubernetesConfig.timeoutMs).toBeUndefined();
  });

  it("throws when OUTPOST_K8S_RPC_TIMEOUT_MS is not a positive integer", () => {
    expect(() =>
      parseExecutionPolicyBootstrapEnv(
        env({ OUTPOST_EXECUTION_MODE: "kubernetes", OUTPOST_K8S_RPC_TIMEOUT_MS: "0" }),
      ),
    ).toThrow(/OUTPOST_K8S_RPC_TIMEOUT_MS/);
    expect(() =>
      parseExecutionPolicyBootstrapEnv(
        env({ OUTPOST_EXECUTION_MODE: "kubernetes", OUTPOST_K8S_RPC_TIMEOUT_MS: "abc" }),
      ),
    ).toThrow(/OUTPOST_K8S_RPC_TIMEOUT_MS/);
  });
});

describe("applyExecutionPolicyBootstrap", () => {
  beforeEach(() => {
    updateGeneral.mockReset().mockResolvedValue(undefined);
    listSpaceIds.mockReset();
    ensureKubernetesEnvironment.mockReset();
  });

  it("does not throw when every space gets a managed environment", async () => {
    listSpaceIds.mockResolvedValue(["c1", "c2", "c3"]);
    ensureKubernetesEnvironment.mockResolvedValue({ id: "env" });

    const result = await applyExecutionPolicyBootstrap(fakeDb, bootstrap);

    expect(result).toEqual({ executionMode: "kubernetes", spacesConfigured: 3 });
    expect(ensureKubernetesEnvironment).toHaveBeenCalledTimes(3);
  });

  it("throws when at least one space fails, after attempting every space", async () => {
    listSpaceIds.mockResolvedValue(["c1", "c2", "c3"]);
    ensureKubernetesEnvironment.mockImplementation(async (spaceId: string) => {
      if (spaceId === "c2") throw new Error("operator config missing");
      return { id: `env-${spaceId}` };
    });

    await expect(applyExecutionPolicyBootstrap(fakeDb, bootstrap)).rejects.toThrow(
      /execution-policy bootstrap: 1 of 3 spaces failed.*c2/,
    );

    // It keeps going past the failure (attempts all three spaces).
    expect(ensureKubernetesEnvironment).toHaveBeenCalledTimes(3);
  });
});
