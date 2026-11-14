import { and, asc, eq, exists, gt, inArray, isNotNull, ne } from "drizzle-orm";
import { heartbeatRuns, issues, nativeRunFinalizations, statusDecisionEffects, type Db } from "@outpost/db";
import type { createDeliveryWorkCoordinator } from "../delivery-work-coordinator.js";
import { DELIVERY_QUEUES } from "../delivery-work-notifications.js";
import type { NativeFinalizationWorkScope } from "../native-finalization-notifications.js";
import { registerScopedDeadlineWork } from "../scoped-deadline-work.js";
import { dispatchPendingNativeStatusEffects, nativePendingEffectDueAt } from "./status-decision-committer.js";

export function pendingNativeStatusEffectsCondition(db: Db) {
  return exists(db.select({ id: statusDecisionEffects.id }).from(statusDecisionEffects).where(and(
    eq(statusDecisionEffects.spaceId, nativeRunFinalizations.spaceId),
    eq(statusDecisionEffects.issueId, nativeRunFinalizations.issueId),
    eq(statusDecisionEffects.decisionId, nativeRunFinalizations.decisionId),
    inArray(statusDecisionEffects.deliveryState, ["pending", "failed"]),
  )));
}

function findPendingEffects(db: Db, scope?: NativeFinalizationWorkScope, after?: string) {
  return db.select({
    id: nativeRunFinalizations.runId, spaceId: nativeRunFinalizations.spaceId,
    issueId: nativeRunFinalizations.issueId, decisionId: nativeRunFinalizations.decisionId,
    phase: nativeRunFinalizations.phase, resultId: nativeRunFinalizations.resultId,
    nextAttemptAt: nativeRunFinalizations.nextAttemptAt,
    leaseOwner: nativeRunFinalizations.leaseOwner, leaseExpiresAt: nativeRunFinalizations.leaseExpiresAt,
  }).from(nativeRunFinalizations)
    .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, nativeRunFinalizations.runId),
      eq(heartbeatRuns.spaceId, nativeRunFinalizations.spaceId)))
    .innerJoin(issues, and(eq(issues.id, nativeRunFinalizations.issueId), eq(issues.spaceId, nativeRunFinalizations.spaceId)))
    .where(and(eq(heartbeatRuns.runtimeMode, "native"), isNotNull(nativeRunFinalizations.resultId),
      isNotNull(nativeRunFinalizations.decisionId), ne(nativeRunFinalizations.phase, "terminal_failure"),
      scope ? and(eq(nativeRunFinalizations.spaceId, scope.spaceId), scope.runId ? eq(nativeRunFinalizations.runId, scope.runId) : undefined) : undefined,
      after ? gt(nativeRunFinalizations.runId, after) : undefined,
      pendingNativeStatusEffectsCondition(db),
    )).orderBy(asc(nativeRunFinalizations.runId)).limit(100);
}

export function registerNativePendingEffectWork(db: Db, coordinator: ReturnType<typeof createDeliveryWorkCoordinator>, canRun: () => boolean) {
  type Entry = { id: string; spaceId: string; dueAt: number };
  async function load(scope?: NativeFinalizationWorkScope, signal?: AbortSignal): Promise<Entry[]> {
    const entries: Entry[] = [];
    let after: string | undefined;
    while (canRun() && !signal?.aborted) {
      const rows = await findPendingEffects(db, scope, after);
      for (const row of rows) entries.push({ id: row.id, spaceId: row.spaceId, dueAt: nativePendingEffectDueAt(row)! });
      if (rows.length < 100) return entries;
      after = rows[rows.length - 1].id;
    }
    throw new Error("Native pending effect discovery stopped");
  }
  return registerScopedDeadlineWork(coordinator, {
    queue: DELIVERY_QUEUES.nativePendingEffects, batchSize: 25,
    decodeScope: (hint: string): NativeFinalizationWorkScope | undefined => hint === "*" ? undefined : JSON.parse(hint),
    matches: (entry: Entry, scope?: NativeFinalizationWorkScope) => !scope || entry.spaceId === scope.spaceId && (!scope.runId || entry.id === scope.runId),
    load,
    check: async (entry: Entry, signal?: AbortSignal) => {
      if (!canRun() || signal?.aborted) throw new Error("Native pending effect recovery stopped");
      const scope = { spaceId: entry.spaceId, runId: entry.id };
      const [current] = await findPendingEffects(db, scope);
      if (!current) return null;
      const dueAt = nativePendingEffectDueAt(current)!;
      if (dueAt > Date.now()) return { ...entry, dueAt };
      if (!canRun() || signal?.aborted) throw new Error("Native pending effect recovery stopped");
      await dispatchPendingNativeStatusEffects({ db, spaceId: current.spaceId, issueId: current.issueId,
        runId: current.id, decisionId: current.decisionId!, onlyWhenDue: true });
      const [pending] = await findPendingEffects(db, scope);
      if (!pending) return null;
      const nextDueAt = nativePendingEffectDueAt(pending)!;
      return { ...entry, dueAt: nextDueAt > Date.now() ? nextDueAt : Date.now() + 30_000 };
    },
  }, canRun);
}
