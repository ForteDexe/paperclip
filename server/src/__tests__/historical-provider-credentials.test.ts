import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spaces, spaceSecrets, spaceSecretVersions, createDb } from "@outpost/db";
import type { SandboxEnvironmentConfig } from "@outpost/shared";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("../services/secrets.js", () => ({ secretService: () => ({ resolveSecretValueForSandboxCleanup: resolve }) }));
import { historicalProviderCredentials } from "../services/historical-provider-credentials.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const value = "fixture-original-provider-key";
const hash = createHash("sha256").update(value).digest("hex");
const schema = { properties: { apiKey: { type: "string", format: "secret-ref" } } };
const context = { issueId: null, heartbeatRunId: null };
const support = await getEmbeddedPostgresTestSupport();
if (!support.supported) console.warn(`Skipping provider credential database tests: ${support.reason}`);
(support.supported ? describe : describe.skip)("historical provider credential identity", () => {
  let db: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("historical-credentials-"); db = createDb(database.connectionString); }, 60_000);
  afterEach(async () => { resolve.mockReset(); await db.execute(sql`SET client_min_messages = warning; TRUNCATE spaces CASCADE`); });
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });
  async function seed() {
    const spaceId = randomUUID(); await db.insert(spaces).values({ id: spaceId, name: "Credential fixture", issuePrefix: `T${spaceId.slice(0, 6)}` });
    const [secret] = await db.insert(spaceSecrets).values({ spaceId, key: "provider-key", name: "Provider key" }).returning();
    await db.insert(spaceSecretVersions).values({ secretId: secret!.id, version: 1, material: {}, valueSha256: hash, fingerprintSha256: hash });
    resolve.mockResolvedValue(value); return { spaceId, secret: secret! };
  }
  const inspect = (spaceId: string, apiKey: unknown, manifest = schema) => historicalProviderCredentials(db, spaceId,
    { provider: "daytona", apiKey, reuseLease: false } as SandboxEnvironmentConfig, manifest, context);
  it("uses exact recorded literal credentials without resolving another account", async () => {
    const f = await seed(); expect(await inspect(f.spaceId, value)).toMatchObject({ apiKey: value }); expect(resolve).not.toHaveBeenCalled();
  });
  it("defers missing credentials instead of relying on an ambient account", async () => {
    const f = await seed(); expect(await inspect(f.spaceId, undefined)).toBeUndefined(); expect(resolve).not.toHaveBeenCalled();
  });
  it.each([false, true])("pins and checks an unrotated initial secret version (binding %s)", async binding => {
    const f = await seed(); expect(await inspect(f.spaceId, binding ? { type: "secret_ref", secretId: f.secret.id, version: "latest" } : f.secret.id)).toMatchObject({ apiKey: value });
    expect(resolve).toHaveBeenCalledExactlyOnceWith(f.spaceId, f.secret.id, 1, { ...context, configPath: "apiKey" });
  });
  it.each(["rotated", "rolled_back", "foreign", "revoked", "deleted", "unknown_manifest", "different_pin"])("defers uncertain credential identity: %s", async mode => {
    const f = await seed(); let spaceId = f.spaceId;
    if (["rotated", "rolled_back"].includes(mode)) {
      await db.insert(spaceSecretVersions).values({ secretId: f.secret.id, version: 2, material: {}, valueSha256: hash, fingerprintSha256: hash });
      if (mode === "rotated") await db.update(spaceSecrets).set({ latestVersion: 2 }).where(eq(spaceSecrets.id, f.secret.id));
    }
    if (mode === "foreign") spaceId = randomUUID();
    if (mode === "revoked") await db.update(spaceSecretVersions).set({ revokedAt: new Date() });
    if (mode === "deleted") await db.update(spaceSecrets).set({ status: "deleted" });
    const key = mode === "different_pin" ? { type: "secret_ref", secretId: f.secret.id, version: 2 } : f.secret.id;
    expect(await inspect(spaceId, key, mode === "unknown_manifest" ? {} as typeof schema : schema)).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("rejects externally mutable secret material whose current bytes changed accounts", async () => {
    const f = await seed(); resolve.mockResolvedValue("fixture-replacement-account-key");
    expect(await inspect(f.spaceId, f.secret.id)).toBeUndefined();
  });
  it("propagates credential read errors instead of calling them resource deletion", async () => {
    const f = await seed(); resolve.mockRejectedValue(new Error("credential backend unavailable"));
    await expect(inspect(f.spaceId, f.secret.id)).rejects.toThrow("credential backend unavailable");
  });
});
