import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
import { agents, approvals, spaces, heartbeatRuns, issues, type Db } from "@outpost/db";
import { isHeartbeatRunVisibleInMine, latestFailedRunsByAgent } from "@outpost/shared";
import type { sidebarBadgeService } from "../../services/sidebar-badges.js";

export type BadgeOptions = Parameters<ReturnType<typeof sidebarBadgeService>["get"]>[1];
export type CapturedQuery = { sql: string; params: unknown[] };

export function captureSidebarQueries(db: Db, queries: CapturedQuery[]): Db {
  return new Proxy(db, { get(target, key) {
    if (key !== "select") return Reflect.get(target, key);
    return (...fields: Parameters<Db["select"]>) => {
      const builder = target.select(...fields), from = builder.from.bind(builder);
      builder.from = ((...args: Parameters<typeof from>) => {
        const selection = from(...args), execute = selection.execute.bind(selection);
        selection.execute = async () => {
          const query = selection.toSQL();
          if (query.sql.includes('"heartbeat_runs"')) queries.push(query);
          return execute();
        };
        return selection;
      }) as typeof builder.from;
      return builder;
    };
  }});
}

export async function observedSidebarFailures(db: Db, spaceId: string, currentUserId?: string | null) {
  const rows = await db.select({
    id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, spaceId: heartbeatRuns.spaceId,
    scopeKind: heartbeatRuns.scopeKind, issueId: heartbeatRuns.issueId, status: heartbeatRuns.status,
    responsibleUserId: heartbeatRuns.responsibleUserId, createdAt: heartbeatRuns.createdAt,
  }).from(heartbeatRuns).innerJoin(agents, eq(heartbeatRuns.agentId, agents.id)).where(and(
    eq(heartbeatRuns.spaceId, spaceId), eq(agents.spaceId, spaceId), not(eq(agents.status, "terminated")),
  )).orderBy(desc(heartbeatRuns.createdAt)).limit(200);
  return latestFailedRunsByAgent(rows).filter(row => currentUserId === undefined || isHeartbeatRunVisibleInMine(row, currentUserId));
}

export async function seedSidebarFixture(db: Db, mode: "mixed" | "all-failed" | "all-succeeded" | "empty" = "mixed") {
  return db.transaction(async tx => {
    const spaceId = randomUUID(), foreignSpaceId = randomUUID();
    await tx.insert(spaces).values([
      { id: spaceId, name: "Synthetic sidebar", issuePrefix: `B${spaceId.slice(0, 7)}` },
      { id: foreignSpaceId, name: "Foreign sidebar", issuePrefix: `F${foreignSpaceId.slice(0, 7)}` },
    ]);
    const actorId = randomUUID();
    await tx.insert(agents).values({ id: actorId, spaceId, name: "Reader", role: "engineer" });
    const actor = { type: "agent" as const, agentId: actorId, spaceId };
    const privateIssueId = randomUUID(), publicIssueId = randomUUID(), deletedIssueId = randomUUID();
    await tx.insert(issues).values([
      { id: privateIssueId, spaceId, title: "Private", visibility: "private", privacyRootIssueId: privateIssueId, responsibleUserId: "other-user" },
      { id: publicIssueId, spaceId, title: "Public" },
      { id: deletedIssueId, spaceId, title: "Deleted" },
    ]);
    const origin = Date.parse("2026-10-01T00:00:00.000Z");
    const agentIds = Array.from({ length: mode === "all-failed" ? 240 : 30 }, () => randomUUID());
    await tx.insert(agents).values(agentIds.map((id, index) => ({ id, spaceId, name: `Agent ${index}`, role: "engineer" })));
    const runs: (typeof heartbeatRuns.$inferInsert)[] = [];
    if (mode !== "empty") {
      for (let index = 0; index < 420; index++) {
        const agentIndex = index % agentIds.length;
        runs.push({ id: randomUUID(), spaceId, agentId: agentIds[agentIndex]!,
          status: mode === "all-failed" ? "failed" : mode === "all-succeeded" ? "succeeded" : ["failed", "timed_out", "succeeded", "running", "queued", "cancelled"][agentIndex % 6],
          responsibleUserId: ["user-1", "user-2", null, "", "local-operator"][agentIndex % 5],
          createdAt: new Date(origin + index), invocationSource: "manual" });
      }
    }
    const special: Record<string, string> = {};
    if (mode === "mixed") {
      async function add(name: string, values: Partial<typeof heartbeatRuns.$inferInsert> = {}) {
        const agentId = randomUUID(), id = randomUUID();
        await tx.insert(agents).values({ id: agentId, spaceId, name, role: "engineer" });
        runs.push({ id, spaceId, agentId, status: "failed", responsibleUserId: "user-1", createdAt: new Date(origin + 1000 + runs.length), ...values });
        special[name] = id;
        return agentId;
      }
      await add("outside-window", { createdAt: new Date(origin - 1000) });
      const shared = await add("superseded");
      runs.push({ spaceId, agentId: shared, status: "succeeded", responsibleUserId: "user-2", createdAt: new Date(origin + 2000) });
      const foreignOwner = await add("other-user-latest");
      runs.push({ spaceId, agentId: foreignOwner, status: "failed", responsibleUserId: "user-2", createdAt: new Date(origin + 2001) });
      await add("private", { scopeKind: "issue", issueId: privateIssueId });
      await add("public", { scopeKind: "issue", issueId: publicIssueId });
      await add("deleted", { scopeKind: "issue", issueId: deletedIssueId });
      await add("missing", { scopeKind: "issue", issueId: null });
      await add("dismissed");
      for (const [name, status] of [["tied-failure-first", "failed"], ["tied-success-first", "succeeded"]] as const) {
        const agentId = await add(name, { status, createdAt: new Date(origin + 3000) });
        runs.push({ spaceId, agentId, status: status === "failed" ? "succeeded" : "failed", responsibleUserId: "user-1", createdAt: new Date(origin + 3000) });
      }
      const terminated = randomUUID(), crossSpaceAgent = randomUUID();
      await tx.insert(agents).values([
        { id: terminated, spaceId, name: "Terminated", status: "terminated" },
        { id: crossSpaceAgent, spaceId: foreignSpaceId, name: "Foreign" },
      ]);
      for (let index = 0; index < 220; index++) runs.push({ spaceId, agentId: index % 2 ? terminated : crossSpaceAgent,
        status: "failed", responsibleUserId: "user-1", createdAt: new Date(origin + 10000 + index) });
      runs.push({ spaceId: foreignSpaceId, agentId: crossSpaceAgent, status: "failed", createdAt: new Date(origin + 20000) });
    }
    if (runs.length) await tx.insert(heartbeatRuns).values(runs);
    if (mode === "mixed") {
      await tx.delete(issues).where(eq(issues.id, deletedIssueId));
      const microAgent = randomUUID();
      await tx.insert(agents).values({ id: microAgent, spaceId, name: "Submillisecond" });
      await tx.execute(sql`insert into heartbeat_runs (space_id, agent_id, status, responsible_user_id, created_at) values
        (${spaceId}, ${microAgent}, 'failed', 'user-1', '2026-10-01 00:00:04.000100+00'),
        (${spaceId}, ${microAgent}, 'succeeded', 'user-2', '2026-10-01 00:00:04.000900+00')`);
    }
    const approvalId = randomUUID();
    await tx.insert(approvals).values({ id: approvalId, spaceId, type: "create_agent", status: "pending", payload: {}, updatedAt: new Date(origin) });
    const dismissals = new Map<string, number>([[`approval:${approvalId}`, origin]]);
    const dismissed = runs.find(row => row.id === special.dismissed);
    if (dismissed) dismissals.set(`run:${dismissed.id}`, (dismissed.createdAt as Date).getTime());
    return { spaceId, foreignSpaceId, actor, actorId, privateIssueId, publicIssueId, special, dismissals,
      options: { dismissals, joinRequests: [{ id: "join", createdAt: new Date(origin), updatedAt: null }], unreadTouchedIssues: 2, actor } satisfies BadgeOptions };
  });
}

export async function cleanupSidebarFixture(db: Db, fixture: Awaited<ReturnType<typeof seedSidebarFixture>>) {
  const spaceIds = [fixture.spaceId, fixture.foreignSpaceId];
  await db.delete(heartbeatRuns).where(inArray(heartbeatRuns.spaceId, spaceIds));
  await db.delete(approvals).where(inArray(approvals.spaceId, spaceIds));
  await db.delete(issues).where(inArray(issues.spaceId, spaceIds));
  await db.delete(agents).where(inArray(agents.spaceId, spaceIds));
  await db.delete(spaces).where(inArray(spaces.id, spaceIds));
}
