import { agents, spaces, heartbeatRuns, type Db } from "@outpost/db";
import { and, asc, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import type { LifecycleEffects } from "./effects.js";
import { applyAgentPolicyHoldsInTransaction } from "./postgres.js";

const inheritedHoldStates = ["preparing", "verifying", "ready", "pausing", "paused", "resuming"] as const;

/** Durable mismatch, also recoverable after a lost notification or a restart. */
export function spaceHoldMismatch(spaceStatus: SQLWrapper = spaces.status) {
  return and(
    inArray(agents.lifecycleState, inheritedHoldStates),
    sql`((coalesce(${agents.lifecycleHolds}, '[]'::jsonb) @> '["space_paused"]'::jsonb) <> (${spaceStatus} = 'paused')
      or (coalesce(${agents.lifecycleHolds}, '[]'::jsonb) @> '["space_archived"]'::jsonb) <> (${spaceStatus} = 'archived')
      or (${spaceStatus} in ('paused', 'archived') and ${agents.lifecycleState} in ('preparing', 'verifying', 'ready', 'resuming')))`,
  );
}

export async function hasSpaceHoldMismatch(db: Db) {
  const rows = await db.select({ id: agents.id }).from(agents).innerJoin(spaces, eq(spaces.id, agents.spaceId))
    .where(spaceHoldMismatch()).limit(1);
  return rows.length > 0;
}

/** One accounting transaction per changed space page, never one per member. */
export async function projectSpaceHolds(db: Db, effects: LifecycleEffects, spaceId?: string) {
  const [candidate] = await db.select({ spaceId: agents.spaceId }).from(agents)
    .innerJoin(spaces, eq(spaces.id, agents.spaceId))
    .where(and(spaceHoldMismatch(), spaceId ? eq(agents.spaceId, spaceId) : undefined))
    .orderBy(asc(agents.spaceId)).limit(1);
  if (!candidate) return 0;
  return effects.transaction(db, candidate.spaceId, async tx => {
    const [space] = await tx.select({ status: spaces.status }).from(spaces).where(eq(spaces.id, candidate.spaceId));
    if (!space) return 0;
    // Space is locked by the accounting boundary; select only stale projections.
    const rows = await tx.select().from(agents).where(and(
      eq(agents.spaceId, candidate.spaceId),
      spaceHoldMismatch(sql`${space.status}::text`),
    )).orderBy(asc(agents.id)).limit(100).for("update", { skipLocked: true });
    const stopping = space.status === "paused" || space.status === "archived";
    const running = stopping && rows.length ? await tx.selectDistinct({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.spaceId, candidate.spaceId), inArray(heartbeatRuns.agentId, rows.map(row => row.id)),
      inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
    )) : [];
    const activeAgents = new Set(running.map(row => row.agentId));
    for (const row of rows) {
      await applyAgentPolicyHoldsInTransaction(tx, effects, candidate.spaceId, row.id,
        { spaceStatus: space.status, restartPause: activeAgents.has(row.id) }, row);
    }
    return rows.length;
  });
}

/** Persist stop ownership for involved agents before a space pause commits.
 * Later reactivation may remove the inherited hold, but cannot erase pausing. */
export async function fenceActiveSpaceAgentStopsInTransaction(tx: Db, effects: LifecycleEffects,
  spaceId: string, status: "paused" | "archived") {
  const active = await tx.selectDistinct({ id: heartbeatRuns.agentId }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.spaceId, spaceId), inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
  )).orderBy(asc(heartbeatRuns.agentId));
  let fenced = 0;
  for (let offset = 0; offset < active.length; offset += 100) {
    const rows = await tx.select().from(agents).where(and(eq(agents.spaceId, spaceId),
      inArray(agents.id, active.slice(offset, offset + 100).map(agent => agent.id)),
      inArray(agents.lifecycleState, inheritedHoldStates),
    )).orderBy(asc(agents.id)).for("update");
    for (const row of rows) {
      await applyAgentPolicyHoldsInTransaction(tx, effects, spaceId, row.id,
        { spaceStatus: status, restartPause: true }, row);
      fenced += 1;
    }
  }
  return fenced;
}
