import type { Db } from "@paperclipai/db";
import { withBudgetSpan } from "./budget-tracing.js";
import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import { DELIVERY_QUEUES, subscribeDeliveryWork } from "./delivery-work-notifications.js";
import type { BudgetServiceHooks } from "./budgets.js";
import { readCostAccountingWork } from "./run-cost-accounting.js";
import { subscribeAllCompanyLiveEvents } from "./live-events.js";

type Coordinator = Pick<ReturnType<typeof createDeliveryWorkCoordinator>, "register">;
const accountingWakes = new WeakMap<Db, () => void>();

/** A durable filesystem receipt can need recovery even when its database
 * attempt failed before a transaction identity existed. Startup also replays it. */
export function wakeCostAccountingWork(db: Db): void {
  accountingWakes.get(db)?.();
}

/** Compatibility seam retained for callers; Outpost does not register a
 * monetary enforcement worker. */
export function registerBudgetEnforcementWork(db: Db, coordinator: Coordinator, hooks: BudgetServiceHooks) {
  // Outpost retains budget records for upgrade/data compatibility but never
  // starts the monetary enforcement worker. In particular, stale evaluation
  // rows or cancellation intents from an older Paperclip installation cannot
  // stop current agent work after upgrading to this fork.
  void db;
  void coordinator;
  void hooks;
  return {
    ready: Promise.resolve(),
    wake: () => {},
    stop: async () => {},
  };
}

/** Accounting repairs admitted work and never dispatches another paid turn.
 * A waiting partial receipt stays held without polling unchanged debt. */
export function registerCostAccountingWork(db: Db, coordinator: Coordinator, reconcile: () => Promise<unknown>) {
  let nextDeadline: number | null = null;
  const worker = coordinator.register(DELIVERY_QUEUES.accounting, {
    retryMs: 5_000,
    runDuringDrain: true,
    async run(signal) {
      if (signal.aborted) return;
      await withBudgetSpan("budget.accounting.recover", reconcile);
    },
    async hasPending() {
      const work = await readCostAccountingWork(db);
      nextDeadline = work.nextRunAt;
      return work.pending;
    },
    nextRunAt: () => nextDeadline,
  });
  accountingWakes.set(db, worker.wake);
  // The existing heartbeat terminal event is published after its persisted
  // transition. Receipt writes have transaction-aware accounting signals too.
  const unsubscribe = subscribeAllCompanyLiveEvents(event => {
    if (event.type === "heartbeat.run.status" &&
        ["succeeded", "failed", "timed_out", "cancelled", "interrupted"].includes(String(event.payload.status))) worker.wake();
  });
  // A released or stopped sandbox can close a terminal run's lost receipt.
  // Those lease writers signal environment or retained-session cleanup.
  const unsubscribeLeases = [DELIVERY_QUEUES.environmentCleanup, DELIVERY_QUEUES.retainedNativeSessionCleanup]
    .map(queue => subscribeDeliveryWork(db, queue, worker.wake));
  const stop = () => {
    unsubscribe();
    for (const unsubscribeLease of unsubscribeLeases) unsubscribeLease();
    if (accountingWakes.get(db) === worker.wake) accountingWakes.delete(db);
  };
  return { ...worker, stop };
}
