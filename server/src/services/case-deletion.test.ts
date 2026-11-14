import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, caseAccessSources, caseHandoffs, cases, spaces, createDb, issues } from "@outpost/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { createAgentLifecycle } from "./agent-lifecycle.js";
import { deleteSpace } from "./space-deletion.js";

describe("deletion with retained case handoffs", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("case-deletion-");
    db = createDb(temporary.connectionString);
  });
  afterAll(async () => { await temporary?.cleanup(); });

  async function fixture(state: "delivered" | "cancelled" | "pending_dispatch" = "delivered") {
    const spaceId = randomUUID(), sourceId = randomUUID(), targetId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Case deletion", issuePrefix: `D${spaceId.slice(0, 6)}` });
    await db.insert(agents).values([sourceId, targetId].map(id => ({ id, spaceId,
      name: "Retained worker", status: "terminated", lifecycleState: "terminated" as const })));
    const [issue] = await db.insert(issues).values({ spaceId, title: "Workflow task", status: "todo",
      assigneeAgentId: targetId }).returning();
    const [record] = await db.insert(cases).values({ spaceId, caseNumber: 1, identifier: `D${spaceId}-C1`,
      caseType: "deletion", title: "Workflow record", workIssueId: issue!.id }).returning();
    await db.insert(caseAccessSources).values({ spaceId, caseId: record!.id, sourceKind: "issue", sourceId: issue!.id });
    const [handoff] = await db.insert(caseHandoffs).values({ spaceId, caseId: record!.id, issueId: issue!.id,
      version: 1, fromAgentId: sourceId, toAgentId: targetId, phase: "verification", instructions: "Retain this history",
      actorType: "user", actorId: "operator", wakeupRequestId: randomUUID(), idempotencyKey: randomUUID(),
      inputFingerprint: "fixture", state }).returning();
    return { spaceId, sourceId, targetId, issue: issue!, record: record!, handoff: handoff! };
  }

  it.each(["delivered", "cancelled", "pending_dispatch"] as const)("deletes the whole space with a %s handoff", async state => {
    const f = await fixture(state), other = await fixture();

    expect(await deleteSpace(db, f.spaceId)).toMatchObject({ id: f.spaceId });

    expect(await db.select().from(spaces).where(eq(spaces.id, f.spaceId))).toHaveLength(0);
    expect(await db.select().from(cases).where(eq(cases.id, f.record.id))).toHaveLength(0);
    expect(await db.select().from(caseHandoffs).where(eq(caseHandoffs.id, f.handoff.id))).toHaveLength(0);
    expect(await db.select().from(caseAccessSources).where(eq(caseAccessSources.caseId, f.record.id))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.id, f.issue.id))).toHaveLength(0);
    expect(await db.select().from(caseHandoffs).where(eq(caseHandoffs.id, other.handoff.id))).toEqual([other.handoff]);
  });

  it.each(["sourceId", "targetId"] as const)("preserves history and explains why its %s cannot be purged", async role => {
    const f = await fixture();

    await expect(createAgentLifecycle(db).purgeAgent(f[role])).rejects.toMatchObject({ status: 409,
      details: { code: "agent_case_history_retained" } });

    expect(await db.select().from(caseHandoffs).where(eq(caseHandoffs.id, f.handoff.id))).toEqual([f.handoff]);
    expect(await db.select().from(issues).where(eq(issues.id, f.issue.id))).toEqual([f.issue]);
    expect(await db.select().from(agents).where(eq(agents.id, f[role]))).toMatchObject([{ lifecycleState: "terminated" }]);
  });

  it("still purges an unrelated terminated agent without deleting case history", async () => {
    const f = await fixture();
    const [unrelated] = await db.insert(agents).values({ spaceId: f.spaceId, name: "Unrelated worker",
      status: "terminated", lifecycleState: "terminated" }).returning();

    expect(await createAgentLifecycle(db).purgeAgent(unrelated!.id)).toMatchObject({ id: unrelated!.id });

    expect(await db.select().from(agents).where(eq(agents.id, unrelated!.id))).toHaveLength(0);
    expect(await db.select().from(caseHandoffs).where(eq(caseHandoffs.id, f.handoff.id))).toEqual([f.handoff]);
  });
});
