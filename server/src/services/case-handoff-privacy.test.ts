import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { activityLog, agents, caseAccessSources, caseEvents, caseHandoffs, caseIssueLinks, cases, spaces, createDb, issueAccessGrants, issueComments, issues } from "@outpost/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { canActorReadCase, retainCaseAccessSource } from "./case-access.js";
import { caseHandoffService } from "./case-handoffs.js";
import { instanceSettingsService } from "./instance-settings.js";

describe("case handoff retained private task ancestry", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const operator = { type: "operator" as const, source: "local_implicit" as const };

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("case-handoff-privacy-");
    db = createDb(temporary.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableCases: true });
  });
  afterAll(async () => { await temporary?.cleanup(); });
  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(caseHandoffs);
    await db.delete(caseIssueLinks);
    await db.delete(cases);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(spaces);
  });

  async function fixture() {
    const spaceId = randomUUID(), ownerId = randomUUID(), readerId = randomUUID();
    const rootId = randomUUID(), sourceId = randomUUID(), targetId = randomUUID(), caseId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Private factory", issuePrefix: `P${spaceId.slice(0, 6)}` });
    await db.insert(agents).values([
      { id: ownerId, spaceId, name: "Private source owner", role: "lead", status: "active", adapterType: "process" },
      { id: readerId, spaceId, name: "Target-only reader", role: "engineer", status: "active", adapterType: "process", reportsTo: ownerId },
    ]);
    await db.insert(issues).values({ id: rootId, spaceId, title: "Private root", visibility: "private" });
    await db.insert(issues).values([
      { id: sourceId, spaceId, title: "Private source B", status: "todo", visibility: "private", privacyParentIssueId: rootId, privacyRootIssueId: rootId, assigneeAgentId: ownerId },
      { id: targetId, spaceId, title: "Private sibling A", status: "todo", visibility: "private", privacyParentIssueId: rootId, privacyRootIssueId: rootId, assigneeAgentId: ownerId },
    ]);
    await db.insert(issueAccessGrants).values({ issueId: targetId, subjectType: "agent", subjectId: readerId, source: "explicit" });
    await db.insert(cases).values({ id: caseId, spaceId, caseNumber: 1, identifier: `P${spaceId.slice(0, 6)}-C1`, caseType: "research", title: "Private B findings", fields: { finding: "Confidential receipt" } });
    await retainCaseAccessSource(db, { spaceId, caseId, sourceKind: "issue", sourceId });
    const reader = { type: "agent" as const, agentId: readerId, spaceId, source: "agent_key" as const };
    const input = { case: { id: caseId }, bindIssueId: targetId, expectedHandoffVersion: 0,
      expectedIssueStatusVersion: 0, idempotencyKey: randomUUID(), toAgentId: ownerId,
      phase: "verification", instructions: "Private B finding: receipt total is 6 USD" };
    return { spaceId, ownerId, reader, rootId, sourceId, targetId, caseId, input };
  }

  async function readable(actor: AuthorizationActor, spaceId: string, issueId: string) {
    return (await authorizationService(db).decide({ actor, action: "issue:read", resource: { type: "issue", spaceId, issueId } })).allowed;
  }

  it("rejects same-root siblings before copying private findings into the target audience", async () => {
    const f = await fixture();
    expect(await readable(f.reader, f.spaceId, f.targetId)).toBe(true);
    expect(await readable(f.reader, f.spaceId, f.sourceId)).toBe(false);
    expect(await canActorReadCase(db, f.reader, f.caseId)).toBe(false);
    const beforeTask = await db.select().from(issues).where(eq(issues.id, f.targetId));
    const beforeCase = await db.select().from(cases).where(eq(cases.id, f.caseId));
    const beforeEvents = await db.select().from(caseEvents).where(eq(caseEvents.caseId, f.caseId));
    const beforeSources = await db.select().from(caseAccessSources).where(eq(caseAccessSources.caseId, f.caseId));

    await expect(caseHandoffService(db).handoff(f.spaceId, operator, f.input))
      .rejects.toMatchObject({ status: 422, message: "Primary task must preserve the case's private task boundary" });

    expect(await db.select().from(issues).where(eq(issues.id, f.targetId))).toEqual(beforeTask);
    expect(await db.select().from(cases).where(eq(cases.id, f.caseId))).toEqual(beforeCase);
    expect(await db.select().from(caseEvents).where(eq(caseEvents.caseId, f.caseId))).toEqual(beforeEvents);
    expect(await db.select().from(caseAccessSources).where(eq(caseAccessSources.caseId, f.caseId))).toEqual(beforeSources);
    for (const table of [issueComments, caseHandoffs, caseIssueLinks, activityLog]) {
      expect(await db.select().from(table).where(eq(table.spaceId, f.spaceId))).toHaveLength(0);
    }
  });

  it("accepts a real transitive privacy descendant even when root metadata is not authoritative", async () => {
    const f = await fixture(), middleId = randomUUID();
    await db.insert(issues).values({ id: middleId, spaceId: f.spaceId, title: "Private middle", visibility: "private",
      privacyParentIssueId: f.sourceId, privacyRootIssueId: f.rootId });
    await db.update(issues).set({ privacyParentIssueId: middleId, privacyRootIssueId: f.targetId }).where(eq(issues.id, f.targetId));
    const receipt = await caseHandoffService(db).handoff(f.spaceId, operator, f.input);
    expect(receipt).toMatchObject({ caseId: f.caseId, taskId: f.targetId, handoffVersion: 1, state: "pending_dispatch" });
    const [record] = await db.select().from(cases).where(eq(cases.id, f.caseId));
    expect(record).toMatchObject({ workIssueId: f.targetId, phase: "verification", handoffVersion: 1 });
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, f.targetId))).toHaveLength(1);
  });

  it("rejects a disconnected cyclic privacy chain without accepting a shared root", async () => {
    const f = await fixture(), otherId = randomUUID();
    await db.insert(issues).values({ id: otherId, spaceId: f.spaceId, title: "Cycle member", visibility: "private",
      privacyParentIssueId: f.targetId, privacyRootIssueId: f.rootId });
    await db.update(issues).set({ privacyParentIssueId: otherId }).where(eq(issues.id, f.targetId));
    await expect(caseHandoffService(db).handoff(f.spaceId, operator, f.input)).rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(caseHandoffs).where(and(eq(caseHandoffs.spaceId, f.spaceId), eq(caseHandoffs.caseId, f.caseId)))).toHaveLength(0);
  });
});
