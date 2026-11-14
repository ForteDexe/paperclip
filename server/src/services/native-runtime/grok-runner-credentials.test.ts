import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareGrokRunnerCredentials } from "./grok-runner-credentials.js";

const { spaceHome } = vi.hoisted(() => ({ spaceHome: vi.fn() }));
vi.mock("@outpost/adapter-grok-local/server", () => ({
  resolveManagedGrokHomeDir: spaceHome,
  grokHomeHasUsableAuth: async () => false,
}));
const roots: string[] = [];
async function home() { const root = await realpath(await mkdtemp(join(tmpdir(), "grok-controller-test-"))); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); vi.clearAllMocks(); });

describe("Grok runner space credentials", () => {
  it("requires the space login for remote runs and never borrows a configured host home", async () => {
    const root = await home();
    spaceHome.mockReturnValue(join(root, "space-without-login"));
    const host = join(root, "host"); await mkdir(host, { mode: 0o700 });
    await writeFile(join(host, "auth.json"), "host-secret", { mode: 0o600 });
    await expect(prepareGrokRunnerCredentials({ spaceId: "test-space", remote: true, environment: { GROK_HOME: host, OUTPOST_HOME: host, OUTPOST_INSTANCE_ID: "other" } })).rejects.toThrow("subscription login is unavailable");
    expect(spaceHome).toHaveBeenCalledWith(process.env, "test-space");
  });
  it("uses only an explicitly selected API key and strips subscription payloads and homes", async () => {
    expect(await prepareGrokRunnerCredentials({ spaceId: "test-space", remote: true, environment: { XAI_API_KEY: "selected", GROK_HOME: "/host", OUTPOST_ACPX_GROK_AUTH_JSON_SECRET: "stale" } })).toEqual({ environment: { XAI_API_KEY: "selected" }, home: null });
  });
  it("reads the controller-selected managed connection privately", async () => {
    const root = await home(); spaceHome.mockReturnValue(join(root, "unused"));
    await writeFile(join(root, "auth.json"), '{"private":"fixture"}', { mode: 0o600 });
    const value = await prepareGrokRunnerCredentials({ spaceId: "test-space", remote: true, managedHome: root, environment: { GROK_HOME: "/untrusted", XAI_API_KEY: "" } });
    expect(value).toEqual({ home: root, environment: { OUTPOST_ACPX_GROK_AUTH_JSON_SECRET: '{"private":"fixture"}' } });
  });
});
