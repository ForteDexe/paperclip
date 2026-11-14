import { and, asc, desc, eq, gt, lte, sql, type SQL } from "drizzle-orm";
import { approvals, spaces, issues, issueWorkProducts, type Db } from "@outpost/db";
import { firstApprovalIssueId } from "./approval-visibility.js";
import { executionIssueCondition } from "./issue-visibility.js";
import { pullRequestSeedProductCondition } from "./decision-queue-seed-rules.js";
import { decisionQueueService } from "./decision-queues.js";
import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import { DELIVERY_QUEUES } from "./delivery-work-notifications.js";

const linkedIssue = firstApprovalIssueId();

export function approvalQueueSeedingService(db: Db) {
  const pending = new Map<string | undefined, { cursor?: string; end?: string; generation: number; failures: number; retryAt: number }>([[undefined, { generation: 0, failures: 0, retryAt: 0 }]]);
  function request(spaceIds: ReadonlySet<string> | undefined) {
    for (const spaceId of spaceIds ?? []) {
      const existing = pending.get(spaceId);
      if (existing) existing.generation++;
      else pending.set(spaceId, { generation: 0, failures: 0, retryAt: 0 });
    }
  }
  function candidates(database: Db, spaceId: string | undefined, condition?: SQL, order = asc) {
    return database.select({ id: approvals.id, spaceId: approvals.spaceId, issueId: linkedIssue }).from(approvals)
      .innerJoin(spaces, eq(spaces.id, approvals.spaceId))
      .where(and(eq(approvals.status, "pending"), eq(spaces.status, "active"), spaceId === undefined ? undefined : eq(approvals.spaceId, spaceId), condition,
        sql`exists (select 1 from ${issues} where ${issues.id} = ${linkedIssue}
          and ${issues.spaceId} = ${approvals.spaceId} and ${executionIssueCondition()}
          and exists (select 1 from ${issueWorkProducts} where ${pullRequestSeedProductCondition(approvals.spaceId)}
            and ${issueWorkProducts.issueId} = ${issues.id}))`,
        sql`not exists (select 1 from decision_queues queue where queue.space_id = ${approvals.spaceId} and queue.key = 'prs'
          and (not queue.seed_rules_enabled or exists (select 1 from decision_queue_items item where item.queue_id = queue.id
            and item.space_id = ${approvals.spaceId} and item.source_kind = 'approval' and item.source_id = ${approvals.id}::text)))`,
      )).orderBy(order(approvals.id));
  }
  async function sweep(signal?: AbortSignal) {
    const scope = [...pending.entries()].find(([, state]) => state.retryAt <= Date.now());
    if (!scope) return;
    const [spaceId, state] = scope;
    try {
      const generation = state.generation;
      state.end ??= (await candidates(db, spaceId, undefined, desc).limit(1))[0]?.id;
      const rows = state.end ? await candidates(db, spaceId, and(lte(approvals.id, state.end),
        state.cursor ? gt(approvals.id, state.cursor) : undefined)).limit(100) : [];
      const errors: unknown[] = [];
      for (const row of rows) {
        if (signal?.aborted) break;
        try {
          await db.transaction(async tx => {
            const database = tx as unknown as Db;
            const [current] = await candidates(database, row.spaceId, eq(approvals.id, row.id)).for("update", { of: approvals });
            if (!current) return;
            await decisionQueueService(database).materializeSeedSources(current.spaceId, [{
              sourceKind: "approval", sourceId: current.id, issueId: current.issueId,
            }]);
          });
        } catch (error) { errors.push(error); }
        state.cursor = row.id;
      }
      if (rows.length < 100) { state.cursor = undefined; state.end = undefined; }
      const remaining = await candidates(db, spaceId).limit(1);
      if (!signal?.aborted && generation === state.generation && remaining.length === 0) pending.delete(spaceId);
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, "Approval queue seeding failed");
      if (rows.length > 0 || remaining.length === 0) state.failures = 0;
      state.retryAt = 0;
    } catch (error) {
      state.failures = Math.min(state.failures + 1, 7);
      state.retryAt = Date.now() + Math.min(60_000, 1_000 * 2 ** (state.failures - 1));
      throw error;
    } finally {
      if (pending.has(spaceId)) {
        pending.delete(spaceId);
        pending.set(spaceId, state);
      }
    }
  }
  function next() {
    let earliest: number | null = null;
    for (const state of pending.values()) earliest = earliest === null ? state.retryAt : Math.min(earliest, state.retryAt);
    return earliest;
  }
  return { sweep, next, request };
}

export function registerApprovalQueueSeedingWork(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>,
  service: ReturnType<typeof approvalQueueSeedingService>,
  canRun: () => boolean,
) {
  let earliest = 0;
  return coordinator.register(DELIVERY_QUEUES.approvalQueueSeeding, {
    retryMs: 1_000,
    pausePassiveMaintenance: true,
    onSettled: service.request,
    run: async signal => {
      if (!canRun()) return;
      if (Date.now() < earliest) return;
      earliest = Date.now() + 1_000;
      await service.sweep(signal);
    },
    hasPending: async () => (service.next() ?? Infinity) <= Date.now(),
    nextRunAt: () => {
      const next = service.next();
      return next === null ? null : Math.max(earliest, next);
    },
  });
}
