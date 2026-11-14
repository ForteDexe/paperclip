import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, agents, spaces, spaceSkills, spaceSkillVersions, createDb, heartbeatRuns, type Db } from "@outpost/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { prepareOnlineEphemeralEnrollment } from "../services/ephemeral-enrollment.js";
import { cloudTenantPrimarySpaceId } from "../services/cloud-instance.js";
import { initializeDurableAgentFiles } from "../services/agent-file-durability.js";
import { resetCloudControlReplayFenceForTests } from "../services/cloud-runtime-identity.js";

const config = vi.hoisted(() => ({ databaseUrl: "", storageProvider: "s3" }));
vi.mock("../config.js", () => ({ loadConfig: () => config }));
vi.mock("../storage/index.js", () => ({ getStorageService: () => ({ provider: "s3" }) }));
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
beforeAll(async () => {
  database = await startEmbeddedPostgresTestDatabase("ephemeral-enrollment-replay-");
  db = createDb(database.connectionString); config.databaseUrl = database.connectionString;
}, 90_000);
afterAll(async () => { await db?.$client.end({ timeout: 1 }); await database?.cleanup(); });
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  vi.stubEnv("OUTPOST_DURABLE_AGENT_FILES", "true");
  const stackId = `stack-fixture-${randomUUID()}`, spaceId = cloudTenantPrimarySpaceId(stackId), agentId = randomUUID();
  await db.insert(spaces).values({ id: spaceId, name: "Online enrollment fixture", issuePrefix: `P${randomUUID().slice(0, 7).toUpperCase()}` });
  await db.insert(agents).values({ id: agentId, spaceId, name: "Preparing agent" });
  await db.transaction(tx => initializeDurableAgentFiles(tx as unknown as Db, { id: agentId, spaceId }));
  vi.stubEnv("OUTPOST_CLOUD_TENANT_SERVER_TOKEN", "fixture-managed-instance");
  vi.stubEnv("OUTPOST_CLOUD_STACK_ID", stackId);
  vi.stubEnv("OUTPOST_BUILD_COMMIT", "a".repeat(40));
  vi.stubEnv("RAILWAY_DEPLOYMENT_ID", randomUUID());
  vi.stubEnv("OUTPOST_EPHEMERAL_SERVER", "false");
  vi.stubEnv("OUTPOST_DURABLE_AGENT_FILES", "true");
  vi.stubEnv("OUTPOST_SHARED_UI_ASSETS", "true");
  vi.stubEnv("OUTPOST_SECRETS_MASTER_KEY", "a".repeat(64));
  vi.stubEnv("OUTPOST_DECISION_SIGNING_SECRET", "fixture-preserved-original-key-at-least-32");
  vi.stubEnv("OUTPOST_DATABASE_LISTEN_URL", database.connectionString);
  return { spaceId, agentId, attemptId: randomUUID(), control: { requestId: randomUUID(), exp: Math.floor(Date.now() / 1000) + 60 } };
}

it("exports once across simultaneous callers and a cleared process replay map using the durable audit key", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([prepareOnlineEphemeralEnrollment(db, f.attemptId, f.control),
    prepareOnlineEphemeralEnrollment(db, f.attemptId, f.control)]);
  if (!results.some(result => result.status === "fulfilled")) throw new AggregateError(results.map(result => (result as PromiseRejectedResult).reason), "All preparation callers failed");
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ status: 409 });
  resetCloudControlReplayFenceForTests();
  await expect(prepareOnlineEphemeralEnrollment(db, f.attemptId, f.control)).rejects.toMatchObject({ status: 409 });
  const audit = await db.select().from(activityLog).where(eq(activityLog.spaceId, f.spaceId));
  expect(audit).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain(process.env.OUTPOST_DECISION_SIGNING_SECRET);
});

it("prepares during normal admission before skill pins are saved, while preserving installation durability", async () => {
  const f = await fixture(), skillId = randomUUID(), versionId = randomUUID();
  await db.insert(spaceSkills).values({ id: skillId, spaceId: f.spaceId, key: "overlap", slug: "overlap", name: "Overlap",
    sourceType: "managed", markdown: "# Overlap", fileInventory: [{ path: "SKILL.md", kind: "entrypoint" }] });
  await db.insert(spaceSkillVersions).values({ id: versionId, spaceId: f.spaceId, spaceSkillId: skillId, revisionNumber: 1,
    fileInventory: [{ path: "SKILL.md", kind: "skill", content: "# Overlap" }] });
  await db.update(spaceSkills).set({ currentVersionId: versionId }).where(eq(spaceSkills.id, skillId));
  await db.insert(heartbeatRuns).values({ spaceId: f.spaceId, agentId: f.agentId, invocationSource: "on_demand", status: "running", contextSnapshot: {} });
  expect(await prepareOnlineEphemeralEnrollment(db, f.attemptId, f.control)).toMatchObject({ enrollmentReady: false });
  await db.update(spaceSkills).set({ currentVersionId: null }).where(eq(spaceSkills.id, skillId));
  await expect(prepareOnlineEphemeralEnrollment(db, f.attemptId, { ...f.control, requestId: randomUUID() })).rejects.toMatchObject({ status: 409,
    details: { blockers: ["skills_require_migration"] } });
});
