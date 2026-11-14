import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_CATALOG_ROOT_ENV_VAR } from "../services/bundled-plugins.js";
import { distributionBundleDigest } from "../services/distribution-plugin-catalog.js";
import { MANAGED_CONFIG_ENV_KEY } from "../services/managed-config.js";
import { managedPluginEnabledSpaces, managedPluginWorkerEnvGrant } from "../services/managed-plugin-worker-env.js";

describe("managed plugin grants", () => {
  const pluginKey = "outpost.daytona-sandbox-provider";
  const spaceId = "f0679247-e2be-5a76-adb6-6bd360e5a833";
  let root: string;
  const env = (plugins: Record<string, unknown>) => ({
    [BUNDLED_CATALOG_ROOT_ENV_VAR]: root,
    [MANAGED_CONFIG_ENV_KEY]: JSON.stringify({ v: 1, mode: "cloud", catalogVersion: "1", features: {}, plugins }),
  });
  async function distributionPlugin(key: string, id: string) {
    const directory = path.join(root, "distribution", key);
    await mkdir(path.join(directory, "dist"), { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ version: "1.0.0", outpostPlugin: { manifest: "./dist/manifest.js", worker: "./dist/worker.js" } }));
    await writeFile(path.join(directory, "dist/manifest.js"), "export default {};");
    await writeFile(path.join(directory, "dist/worker.js"), "export {};");
    await writeFile(path.join(root, "distribution/catalog.json"), JSON.stringify({ schemaVersion: 1, plugins: [{
      key, pluginKey: id, version: "1.0.0", directory: key, digest: distributionBundleDigest(directory),
    }] }));
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "managed-worker-env-"));
    await mkdir(path.join(root, "sandbox-providers/daytona"), { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("reads each section separately", () => {
    const granted = env({ autoInstall: ["daytona"], workerEnv: { daytona: ["PROVIDER_ORIGIN"] } });
    expect(managedPluginWorkerEnvGrant(pluginKey, granted)).toEqual(["PROVIDER_ORIGIN"]);
    expect(managedPluginEnabledSpaces(pluginKey, granted)).toEqual([]);
    const enabled = env({ autoInstall: ["daytona"], enabledSpaces: { daytona: [spaceId] } });
    expect(managedPluginEnabledSpaces(pluginKey, enabled)).toEqual([spaceId]);
    expect(managedPluginWorkerEnvGrant(pluginKey, enabled)).toEqual([]);
  });

  it("gives nothing on a self-hosted instance or to another plugin", () => {
    expect(managedPluginWorkerEnvGrant(pluginKey, { [BUNDLED_CATALOG_ROOT_ENV_VAR]: root })).toEqual([]);
    const granted = env({ autoInstall: ["daytona"], workerEnv: { daytona: ["PROVIDER_ORIGIN"] }, enabledSpaces: { daytona: [spaceId] } });
    expect(managedPluginWorkerEnvGrant("example.other", granted)).toEqual([]);
    expect(managedPluginEnabledSpaces("example.other", granted)).toEqual([]);
  });

  it("gives variables to a digest-verified distribution plugin", async () => {
    await distributionPlugin("example-extension", "example.extension");
    const granted = env({ autoInstall: ["example-extension"], workerEnv: { "example-extension": ["PROVIDER_ORIGIN"] } });
    expect(managedPluginWorkerEnvGrant("example.extension", granted)).toEqual(["PROVIDER_ORIGIN"]);
  });

  it("does not read inherited properties for a catalog key named after one", async () => {
    await distributionPlugin("constructor", "example.extension");
    const granted = env({ autoInstall: ["constructor"], workerEnv: { constructor: ["PROVIDER_ORIGIN"] }, enabledSpaces: {} });
    expect(managedPluginWorkerEnvGrant("example.extension", granted)).toEqual(["PROVIDER_ORIGIN"]);
    expect(managedPluginEnabledSpaces("example.extension", granted)).toEqual([]);
    const enabled = env({ autoInstall: ["constructor"], workerEnv: {}, enabledSpaces: { constructor: [spaceId] } });
    expect(managedPluginEnabledSpaces("example.extension", enabled)).toEqual([spaceId]);
    expect(managedPluginWorkerEnvGrant("example.extension", enabled)).toEqual([]);
  });
});
