import { afterEach, expect, it, vi } from "vitest";
import { assertEphemeralServerConfig } from "../services/ephemeral-server-contract.js";
import { assertEphemeralWorkspaceExecution, assertEphemeralNativeRuntime } from "../services/remote-workspaces.js";
import { assertEphemeralAgentInstructions } from "../services/agent-instructions.js";

const config = { databaseUrl: "postgresql://runtime:fixture@ep-example-pooler.neon.test/tenant", storageProvider: "s3" as const };
const env = { OUTPOST_EPHEMERAL_SERVER: "true", OUTPOST_DURABLE_AGENT_FILES: "true", OUTPOST_SHARED_UI_ASSETS: "true",
  OUTPOST_DECISION_SIGNING_SECRET: "synthetic-decision-key-for-deployment-tests",
  OUTPOST_SECRETS_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), // 32-byte fixture, never an operator key
  OUTPOST_DATABASE_LISTEN_URL: "postgresql://runtime:fixture@ep-example.neon.test/tenant" };
afterEach(() => vi.unstubAllEnvs());
it("requires shared storage and stable secrets without changing volume-backed startup", () => {
  expect(assertEphemeralServerConfig(config, env)).toBe(env.OUTPOST_DATABASE_LISTEN_URL);
  expect(assertEphemeralServerConfig({ storageProvider: "local_disk", databaseUrl: undefined }, {})).toBeNull();
  for (const key of ["OUTPOST_DURABLE_AGENT_FILES", "OUTPOST_SHARED_UI_ASSETS", "OUTPOST_SECRETS_MASTER_KEY", "OUTPOST_DECISION_SIGNING_SECRET", "OUTPOST_DATABASE_LISTEN_URL"]) {
    expect(() => assertEphemeralServerConfig(config, { ...env, [key]: "" })).toThrow("Volume-free server configuration");
  }
  expect(() => assertEphemeralServerConfig({ ...config, storageProvider: "local_disk" }, env)).toThrow("shared S3");
});
it("never connects the listener with migration privileges, another tenant, or through a transaction pooler", () => {
  for (const url of [env.OUTPOST_DATABASE_LISTEN_URL.replace("runtime:", "migration:"),
    env.OUTPOST_DATABASE_LISTEN_URL.replace("/tenant", "/neighbor"), config.databaseUrl,
    env.OUTPOST_DATABASE_LISTEN_URL.replace("ep-example.", "ep-neighbor.")]) {
    expect(() => assertEphemeralServerConfig(config, { ...env, OUTPOST_DATABASE_LISTEN_URL: url })).toThrow("runtime role");
  }
});
it("requires remote workspace authority and native execution independently of provider lifecycle", () => {
  vi.stubEnv("OUTPOST_EPHEMERAL_SERVER", "true");
  const remote = { externalConversation: false, adapterType: "outpost_runner", pluginTaskWorkspace: false, remoteAuthority: true };
  expect(() => assertEphemeralWorkspaceExecution(remote)).not.toThrow();
  expect(() => assertEphemeralWorkspaceExecution({ ...remote, remoteAuthority: false, pluginTaskWorkspace: true })).not.toThrow();
  for (const patch of [{ remoteAuthority: false }, { adapterType: "process" }]) {
    expect(() => assertEphemeralWorkspaceExecution({ ...remote, ...patch })).toThrow("native Outpost Runner");
  }
  expect(() => assertEphemeralNativeRuntime(true)).not.toThrow();
  expect(() => assertEphemeralNativeRuntime(false)).toThrow("native Outpost Runner");
  const agent = { id: "agent", companyId: "company", name: "Agent", adapterConfig: {} };
  expect(() => assertEphemeralAgentInstructions(agent)).not.toThrow();
  expect(() => assertEphemeralAgentInstructions({ ...agent, adapterConfig: { instructionsBundleMode: "external", instructionsRootPath: "/old-volume" } })).toThrow("managed agent instructions");
  vi.stubEnv("OUTPOST_EPHEMERAL_SERVER", "false");
  expect(() => assertEphemeralWorkspaceExecution({ ...remote, remoteAuthority: false })).not.toThrow();
  expect(() => assertEphemeralNativeRuntime(false)).not.toThrow();
});
