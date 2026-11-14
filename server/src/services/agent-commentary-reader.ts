import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { agentCommentary, agents, heartbeatRuns, issues, type Db } from "@outpost/db";
import type { AgentCommentaryDetail, AgentCommentaryEntry, AgentCommentaryPage, AgentCommentaryQuery } from "@outpost/shared";

const entryFields = {
  id: agentCommentary.id,
  kind: agentCommentary.kind,
  preview: sql<string>`left(${agentCommentary.body}, 280)`,
  createdAt: agentCommentary.createdAt,
  agent: { id: agents.id, name: agents.name, icon: agents.icon },
  runId: agentCommentary.runId,
  task: { id: issues.id, identifier: issues.identifier, title: issues.title },
};

export function agentCommentaryReader(db: Db) {
  function visible(spaceId: string, readCondition: SQL) {
    return and(
      eq(agentCommentary.spaceId, spaceId),
      or(
        and(isNull(agentCommentary.issueId), sql`coalesce(
          ${heartbeatRuns.nativeIssueId}::text,
          ${heartbeatRuns.contextSnapshot}->>'issueId',
          ${heartbeatRuns.contextSnapshot}->>'taskId'
        ) is null`),
        and(sql`${issues.id} is not null`, readCondition),
      ),
    );
  }

  function entries() {
    return db.select(entryFields).from(agentCommentary)
      .innerJoin(agents, and(eq(agents.id, agentCommentary.agentId), eq(agents.spaceId, agentCommentary.spaceId)))
      .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentCommentary.runId), eq(heartbeatRuns.spaceId, agentCommentary.spaceId)))
      .leftJoin(issues, and(eq(issues.id, agentCommentary.issueId), eq(issues.spaceId, agentCommentary.spaceId)));
  }

  return {
    async list(spaceId: string, query: AgentCommentaryQuery, readCondition: SQL): Promise<AgentCommentaryPage> {
      const where = and(
        visible(spaceId, readCondition),
        query.agentId ? eq(agentCommentary.agentId, query.agentId) : undefined,
        query.kind ? eq(agentCommentary.kind, query.kind) : undefined,
        query.q ? ilike(agentCommentary.body, `%${query.q.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
      );
      const [rows, totals] = await Promise.all([
        entries().where(where).orderBy(desc(agentCommentary.createdAt), desc(agentCommentary.id)).limit(query.limit).offset(query.offset),
        db.select({ total: count() }).from(agentCommentary)
          .innerJoin(agents, and(eq(agents.id, agentCommentary.agentId), eq(agents.spaceId, agentCommentary.spaceId)))
          .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentCommentary.runId), eq(heartbeatRuns.spaceId, agentCommentary.spaceId)))
          .leftJoin(issues, and(eq(issues.id, agentCommentary.issueId), eq(issues.spaceId, agentCommentary.spaceId)))
          .where(where),
      ]);
      return {
        items: rows.map((row): AgentCommentaryEntry => ({ ...row, createdAt: row.createdAt.toISOString() })),
        total: totals[0]?.total ?? 0,
        limit: query.limit,
        offset: query.offset,
      };
    },

    async get(spaceId: string, id: string, readCondition: SQL): Promise<AgentCommentaryDetail | null> {
      const [row] = await db.select({ ...entryFields, body: agentCommentary.body }).from(agentCommentary)
        .innerJoin(agents, and(eq(agents.id, agentCommentary.agentId), eq(agents.spaceId, agentCommentary.spaceId)))
        .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentCommentary.runId), eq(heartbeatRuns.spaceId, agentCommentary.spaceId)))
        .leftJoin(issues, and(eq(issues.id, agentCommentary.issueId), eq(issues.spaceId, agentCommentary.spaceId)))
        .where(and(visible(spaceId, readCondition), eq(agentCommentary.id, id))).limit(1);
      return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
    },
  };
}
