import { notifyStrandedAgentStatus } from "../live-run-recovery-notifications.js";
import { notifyAttentionRetentionWork } from "../retention-work-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "../delivery-work-notifications.js";
import { agents, heartbeatRuns, type Db } from "@outpost/db";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { trackAgentFirstHeartbeat } from "@outpost/shared/telemetry";
import { getTelemetryClient } from "../../telemetry.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { publishLiveEvent } from "../live-events.js";
import { finishedIdleRun, finishedIdleWake, finishedFailedIdleLease } from "../idle-work-proof.js";

type Outcome = "succeeded" | "interrupted" | "failed" | "cancelled" | "timed_out";

const RECONCILIATION_GRACE_MS = 5 * 60_000;
const RECONCILIATION_BATCH_SIZE = 25;

function errorReason(reason: string | null | undefined) {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.length > 500 ? `${trimmed.slice(0, 499)}…` : trimmed;
}

function settledStatus(outcome: string | undefined, keepIdleOnFailure = false) {
  return outcome === "failed" || outcome === "timed_out"
    ? keepIdleOnFailure && outcome === "failed" ? "idle" : "error"
    : "idle";
}

function publishStatus(agent: typeof agents.$inferSelect, outcome: string) {
  publishLiveEvent({
    spaceId: agent.spaceId,
    type: "agent.status",
    payload: {
      agentId: agent.id,
      status: agent.status,
      lastHeartbeatAt: agent.lastHeartbeatAt?.toISOString() ?? null,
      outcome,
    },
  });
}

export function settledAgentWorkCondition(liveRunIds: ReadonlySet<string>, now: Date) {
  const localRuns = liveRunIds.size > 0
    ? sql`AND NOT EXISTS (SELECT 1 FROM heartbeat_runs r
        WHERE r.id IN (${sql.join([...liveRunIds].map(id => sql`${id}::uuid`), sql`, `)})
          AND r.space_id = ${agents.spaceId} AND r.agent_id = ${agents.id})`
    : sql``;
  return sql`NOT EXISTS (SELECT 1 FROM heartbeat_runs r
      WHERE r.space_id = ${agents.spaceId} AND r.agent_id = ${agents.id}
        AND r.status IN ('running', 'queued'))
    AND NOT EXISTS (SELECT 1 FROM heartbeat_runs r
      WHERE r.space_id = ${agents.spaceId} AND r.agent_id = ${agents.id}
        AND ((${sql.raw(finishedIdleRun("r"))}) IS NOT TRUE
          OR r.controller_lease_expires_at > ${now.toISOString()}::timestamptz))
    ${localRuns}
    AND NOT EXISTS (SELECT 1 FROM native_run_finalizations f
      JOIN heartbeat_runs r ON r.id = f.run_id AND r.space_id = f.space_id
      WHERE f.space_id = ${agents.spaceId} AND r.agent_id = ${agents.id}
        AND (f.phase NOT IN ('committed', 'terminal_failure')
          OR f.lease_expires_at > ${now.toISOString()}::timestamptz OR f.next_attempt_at IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM environment_leases l
      JOIN heartbeat_runs r ON r.id = l.heartbeat_run_id AND r.space_id = l.space_id
      WHERE l.space_id = ${agents.spaceId} AND r.agent_id = ${agents.id}
        AND ((l.status NOT IN ('released', 'expired')
            AND (${sql.raw(finishedFailedIdleLease("l"))}) IS NOT TRUE)
          OR COALESCE(l.metadata->>'pendingCleanupInFlight', 'false') <> 'false'
          OR COALESCE(l.metadata, '{}'::jsonb) ?| ARRAY['nativeWorkspaceExportResume', 'sandboxStopAndRetain']))
    AND NOT EXISTS (SELECT 1 FROM agent_wakeup_requests w
      WHERE w.space_id = ${agents.spaceId} AND w.agent_id = ${agents.id}
        AND (${sql.raw(finishedIdleWake("w"))}) IS NOT TRUE)
    AND NOT EXISTS (SELECT 1 FROM agent_instruction_working_copies c
      WHERE c.space_id = ${agents.spaceId} AND c.agent_id = ${agents.id}
        AND (c.state NOT IN ('saved', 'unchanged', 'resolved', 'unavailable', 'conflict')
          OR c.process_stopped_at IS NULL OR c.next_attempt_at IS NOT NULL
          OR c.receipt ? 'baseline' OR c.receipt->>'cleanupPending' = 'true'))`;
}

export function createHeartbeatAgentStatus(db: Db) {
  async function finalizeAgentStatus(
    agentId: string,
    outcome: Outcome,
    failureReason?: string | null,
    options?: { keepIdleOnFailure?: boolean; wasFirstHeartbeat?: boolean },
  ) {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(agents)
        .where(eq(agents.id, agentId)).for("no key update");
      if (!existing || existing.lifecycleState !== "ready" ||
          existing.status === "paused" || existing.status === "terminated") return null;
      const [running] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.spaceId, existing.spaceId),
        eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "running"),
      )).limit(1);
      const nextStatus = running ? "running" : settledStatus(outcome, options?.keepIdleOnFailure);
      const now = new Date();
      await notifyStrandedAgentStatus(tx, { spaceId: existing.spaceId, agentId });
      await notifyAttentionRetentionWork(tx, { spaceId: existing.spaceId });
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
      const [updated] = await tx.update(agents).set({
        status: nextStatus,
        errorReason: nextStatus === "error" ? errorReason(failureReason) : null,
        lastHeartbeatAt: now,
        updatedAt: now,
      }).where(and(eq(agents.id, agentId), eq(agents.spaceId, existing.spaceId),
        eq(agents.lifecycleState, "ready"))).returning();
      return { updated, isFirstHeartbeat: options?.wasFirstHeartbeat ?? !existing.lastHeartbeatAt };
    });
    if (!result?.updated) return;
    if (result.isFirstHeartbeat) {
      const client = getTelemetryClient();
      if (client) trackAgentFirstHeartbeat(client, { agentRole: result.updated.role, agentId: result.updated.id });
    }
    publishStatus(result.updated, outcome);
  }

  async function reconcileStrandedAgentStatuses(liveRunIds: () => ReadonlySet<string>, scope: { spaceId?: string; agentId?: string; onDeferredDeadline?: (at: number) => void } = {}) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - RECONCILIATION_GRACE_MS);
    const candidates = await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
      return tx.select({ id: agents.id, spaceId: agents.spaceId }).from(agents)
      .where(and(eq(agents.status, "running"), eq(agents.lifecycleState, "ready"),
        scope.spaceId ? eq(agents.spaceId, scope.spaceId) : undefined,
        scope.agentId ? eq(agents.id, scope.agentId) : undefined,
        lte(agents.updatedAt, cutoff), settledAgentWorkCondition(liveRunIds(), now)))
      .orderBy(asc(agents.updatedAt), asc(agents.id)).limit(RECONCILIATION_BATCH_SIZE);
    });
    const reconciled: string[] = [];
    for (const candidate of candidates) {
      if (Date.now() - now.getTime() > 5_000) break;
      const publications: ActivityPublication[] = [];
      const updated = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
        const [locked] = await tx.select({ id: agents.id }).from(agents).where(and(
          eq(agents.id, candidate.id), eq(agents.spaceId, candidate.spaceId),
        )).for("update", { skipLocked: true });
        if (!locked) {
          const [pending] = await tx.select({ id: agents.id }).from(agents).where(and(
            eq(agents.id, candidate.id), eq(agents.spaceId, candidate.spaceId),
          ));
          if (pending) scope.onDeferredDeadline?.(Date.now() + 30_000);
          return null;
        }
        const [current] = await tx.select().from(agents).where(and(
          eq(agents.id, candidate.id), eq(agents.spaceId, candidate.spaceId),
          eq(agents.status, "running"), eq(agents.lifecycleState, "ready"),
          lte(agents.updatedAt, cutoff), settledAgentWorkCondition(liveRunIds(), now),
        ));
        if (!current) return null;
        const [lastRun] = await tx.select({ status: heartbeatRuns.status, error: heartbeatRuns.error })
          .from(heartbeatRuns).where(and(eq(heartbeatRuns.spaceId, candidate.spaceId),
            eq(heartbeatRuns.agentId, candidate.id)))
          .orderBy(desc(heartbeatRuns.finishedAt), desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id)).limit(1);
        const nextStatus = settledStatus(lastRun?.status);
        await notifyAttentionRetentionWork(tx, { spaceId: candidate.spaceId });
        const [agent] = await tx.update(agents).set({ status: nextStatus,
          errorReason: nextStatus === "error" ? errorReason(lastRun?.error) : null, updatedAt: now,
        }).where(and(eq(agents.id, candidate.id), eq(agents.spaceId, candidate.spaceId),
          eq(agents.status, "running"), eq(agents.lifecycleState, "ready"))).returning();
        await logActivity(tx as unknown as Db, {
          spaceId: candidate.spaceId, actorType: "system", actorId: "system",
          action: "agent.status_reconciled", entityType: "agent", entityId: candidate.id,
          details: { previousStatus: "running", nextStatus, reason: "no_unsettled_execution" },
        }, publications);
        return agent;
      });
      if (!updated) continue;
      reconciled.push(updated.id);
      for (const publication of publications) publishActivity(publication);
      publishStatus(updated, "reconciled");
    }
    if (scope.spaceId && scope.agentId && reconciled.length === 0 && scope.onDeferredDeadline) {
      const rows = await db.execute(sql`select min(deadline) as deadline from (
        select r.controller_lease_expires_at as deadline from heartbeat_runs r
          where r.space_id = ${scope.spaceId} and r.agent_id = ${scope.agentId}
        union all
        select f.lease_expires_at as deadline from native_run_finalizations f
          inner join heartbeat_runs r on r.id = f.run_id and r.space_id = f.space_id
          where r.space_id = ${scope.spaceId} and r.agent_id = ${scope.agentId}
      ) authority where deadline > ${now.toISOString()}::timestamptz`);
      const deadline = rows[0]?.deadline;
      if (deadline) {
        const at = deadline instanceof Date ? deadline.getTime() : Date.parse(String(deadline));
        if (Number.isFinite(at) && at > Date.now()) scope.onDeferredDeadline(at);
      }
    }
    return reconciled;
  }

  return { finalizeAgentStatus, reconcileStrandedAgentStatuses };
}
