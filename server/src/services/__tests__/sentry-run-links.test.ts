import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  closeRegisteredClients,
  spaces,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issues,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { createSentryRunLinkResolver } from "../sentry-run-links.js";

const testDatabaseUrl = process.env.OUTPOST_TEST_DATABASE_URL;
const support = testDatabaseUrl ? { supported: true } : await getEmbeddedPostgresTestSupport();

it.skipIf(!support.supported)("resolves saved task links and rejects foreign space, agent, and task identities", async () => {
  const tempDb = testDatabaseUrl ? null : await startEmbeddedPostgresTestDatabase("outpost-sentry-links-");
  const databaseUrl = testDatabaseUrl ?? tempDb!.connectionString;
  const db = createDb(databaseUrl);
  const spaceIds: string[] = [];
  try {
    if (testDatabaseUrl) await applyPendingMigrations(testDatabaseUrl);
    const spacePrefix = `T${randomUUID().replaceAll("-", "").toUpperCase()}`;
    const taskIdentifier = `${spacePrefix}-42`;
    const [space] = await db.insert(spaces).values({ name: "Fixture", issuePrefix: spacePrefix }).returning();
    const spaceId = space!.id;
    spaceIds.push(spaceId);
    const [agent] = await db.insert(agents).values({
      spaceId, name: "Fixture", role: "engineer", adapterType: "codex_local",
    }).returning();
    const agentId = agent!.id;
    const [task] = await db.insert(issues).values({ spaceId, title: "Fixture task", identifier: taskIdentifier }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      spaceId, agentId, invocationSource: "assignment", status: "failed", issueId: task!.id,
    }).returning();
    const resolve = createSentryRunLinkResolver(db);
    expect(await resolve({ runId: run!.id, spaceId, agentId })).toMatchObject({
      spaceId, agentId, spacePrefix, taskId: task!.id, taskIdentifier,
    });
    expect(await resolve({ runId: run!.id, spaceId: randomUUID() })).toBeNull();
    expect(await resolve({ runId: run!.id, agentId: randomUUID() })).toBeNull();
    const otherPrefix = `O${randomUUID().replaceAll("-", "").toUpperCase()}`;
    const [other] = await db.insert(spaces).values({ name: "Other", issuePrefix: otherPrefix }).returning();
    spaceIds.push(other!.id);
    const [otherTask] = await db.insert(issues).values({
      spaceId: other!.id, title: "Other task", identifier: `${otherPrefix}-1`,
    }).returning();
    const [taskless] = await db.insert(heartbeatRuns).values({
      spaceId, agentId, invocationSource: "assignment", status: "failed",
    }).returning();
    expect(await resolve({ runId: taskless!.id })).toMatchObject({ taskId: null, taskIdentifier: null });
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: otherTask!.id } }).where(eq(heartbeatRuns.id, taskless!.id));
    expect(await resolve({ runId: taskless!.id })).toMatchObject({ taskId: null, taskIdentifier: null });
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: task!.id } }).where(eq(heartbeatRuns.id, taskless!.id));
    expect(await resolve({ runId: taskless!.id })).toMatchObject({ taskId: task!.id, taskIdentifier });
  } finally {
    try {
      if (testDatabaseUrl && spaceIds.length) {
        await db.delete(heartbeatRuns).where(inArray(heartbeatRuns.spaceId, spaceIds));
        await db.delete(issues).where(inArray(issues.spaceId, spaceIds));
        await db.delete(agents).where(inArray(agents.spaceId, spaceIds));
        await db.delete(spaces).where(inArray(spaces.id, spaceIds));
      }
    } finally {
      if (testDatabaseUrl) await closeRegisteredClients(testDatabaseUrl);
      await tempDb?.cleanup();
    }
  }
}, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
