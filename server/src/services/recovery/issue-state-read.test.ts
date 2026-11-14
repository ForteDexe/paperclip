import { randomBytes, randomUUID } from "node:crypto";
import { agents, spaces, createDb, issueRecoveryActions, issues } from "@outpost/db";
import { createFullDatabaseResponseCapture, installDatabaseResponseCapture } from "../../__tests__/helpers/full-database-response-capture.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { recoveryService } from "./service.js";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("recovery issue state reads", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("recovery-issue-state-");
    db = createDb(database.connectionString);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.cleanup();
  });

  it.each([false, true])("does not load unused source and child descriptions (child=%s)", async (withChild) => {
    const [space] = await db.insert(spaces).values({
      name: "Recovery state reads",
      issuePrefix: `R${randomUUID().slice(0, 7).toUpperCase()}`,
    }).returning();
    const description = randomBytes(128 * 1024).toString("base64");
    const [parent] = await db.insert(issues).values({
      spaceId: space.id,
      title: "Await the operator decision",
      description,
      status: "blocked",
    }).returning();
    const child = withChild
      ? (await db.insert(issues).values({
          spaceId: space.id,
          title: "A child that also needs a decision",
          description,
          status: "blocked",
          parentId: parent.id,
        }).returning())[0]
      : null;
    const [action] = await db.insert(issueRecoveryActions).values({
      spaceId: space.id,
      sourceIssueId: parent.id,
      kind: "stranded_assigned_issue",
      cause: "stranded_assigned_issue",
      fingerprint: randomUUID(),
      status: "active",
      ownerType: "operator",
      wakePolicy: { type: "operator_escalation" },
      nextAction: "Choose the next disposition",
      evidence: { retainedControl: { proof: "unchanged" } },
    }).returning();
    const enqueueWakeup = vi.fn(async () => {
      throw new Error("Operator-owned work must remain pending");
    });
    const service = recoveryService(db, { enqueueWakeup });
    const events: Array<Record<string, unknown>> = [];
    const now = Date.now();
    const capture = createFullDatabaseResponseCapture({ start: now - 100, end: now + 59_000 }, event => events.push(event));
    installDatabaseResponseCapture(db, { issues, issueRecoveryActions }, capture);
    try {
      await service.reconcileStrandedAssignedIssues();
    } finally {
      capture.flush();
    }
    expect(Number(events.at(-1)?.completedQueries)).toBeGreaterThan(5);
    expect(Number(events.at(-1)?.responseValueBytes)).toBeLessThan(16_384);
    expect(enqueueWakeup).not.toHaveBeenCalled();
    expect((await db.select().from(issues).where(eq(issues.id, parent.id)))[0]).toEqual(parent);
    if (child) {
      expect((await db.select().from(issues).where(eq(issues.id, child.id)))[0]).toEqual(child);
    }
    expect((await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, action.id)))[0]).toEqual(action);
  });

  it("keeps a candidate waiting for agent setup without reading its description", async () => {
    const [space] = await db.insert(spaces).values({
      name: "Recovery candidate read",
      issuePrefix: `R${randomUUID().slice(0, 7).toUpperCase()}`,
    }).returning();
    const [agent] = await db.insert(agents).values({
      spaceId: space.id,
      name: "Preparing agent",
      lifecycleState: "preparing",
    }).returning();
    const [issue] = await db.insert(issues).values({
      spaceId: space.id,
      title: "Wait for agent setup",
      description: randomBytes(128 * 1024).toString("base64"),
      status: "todo",
      assigneeAgentId: agent.id,
    }).returning();
    const enqueueWakeup = vi.fn(async () => {
      throw new Error("Setup still owns this task");
    });
    const service = recoveryService(db, { enqueueWakeup });
    const events: Array<Record<string, unknown>> = [];
    const now = Date.now();
    const capture = createFullDatabaseResponseCapture({ start: now - 100, end: now + 59_000 }, event => events.push(event));
    installDatabaseResponseCapture(db, { agents, issues, issueRecoveryActions }, capture);
    try {
      expect(await service.reconcileStrandedAssignedIssues()).toMatchObject({ skipped: 1 });
    } finally {
      capture.flush();
    }
    expect(Number(events.at(-1)?.completedQueries)).toBeGreaterThan(5);
    expect(Number(events.at(-1)?.responseValueBytes)).toBeLessThan(16_384);
    expect(enqueueWakeup).not.toHaveBeenCalled();
    expect((await db.select().from(issues).where(eq(issues.id, issue.id)))[0]).toEqual(issue);
    expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0]).toEqual(agent);
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.spaceId, space.id))).toEqual([]);
  });
});
