import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasUsableGrokAuthValue, parseGrokAuthPayload, resolveManagedGrokHomeDir } from "../../packages/adapters/grok-local/src/server/grok-home.js";

function credential(raw: string) {
  if (Buffer.byteLength(raw) > 256 * 1024) throw new Error("Grok fixture credential exceeds its bound");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Grok fixture credential is malformed"); }
  const result = parseGrokAuthPayload(parsed);
  if (!result || !hasUsableGrokAuthValue(result.value)) throw new Error("Grok fixture credential is malformed");
  return result;
}

/** Test setup only: seed the explicit login in a new disposable space slot.
 * Production credential discovery, process fencing, and refresh remain unchanged.
 */
export async function stageGrokSubscriptionFixture(input: {
  raw: string;
  spaceId: string;
  environment: NodeJS.ProcessEnv;
}): Promise<() => Promise<void>> {
  credential(input.raw);
  const env = input.environment;
  const root = env.OUTPOST_RUNNER_E2E_TEMP_ROOT;
  if (!root || !/^[0-9a-f-]{36}$/i.test(input.spaceId) ||
      !/^runner-e2e-[a-z0-9-]+$/.test(env.OUTPOST_INSTANCE_ID ?? "")) {
    throw new Error("Grok fixture requires an isolated test space and instance");
  }
  const canonicalRoot = await realpath(root);
  const home = env.OUTPOST_HOME;
  if (!home || await realpath(home) !== path.join(canonicalRoot, "outpost-home")) {
    throw new Error("Grok fixture refuses a home outside its isolated test root");
  }
  const spaceHome = resolveManagedGrokHomeDir(env, input.spaceId);
  await mkdir(spaceHome, { recursive: true, mode: 0o700 });
  if (!(await realpath(spaceHome)).startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("Grok fixture refuses a redirected space home");
  }
  // Never replace an existing space's login, including through a symlink.
  await writeFile(path.join(spaceHome, "auth.json"), input.raw, { flag: "wx", mode: 0o600 });
  return () => rm(spaceHome, { recursive: true, force: true });
}
