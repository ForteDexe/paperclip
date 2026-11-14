import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import { DELIVERY_QUEUES } from "./delivery-work-notifications.js";
import { registerScopedDeadlineWork } from "./scoped-deadline-work.js";
import type { createToolGatewayService } from "./tool-gateway.js";

export function registerToolReviewRecoveryWork(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>,
  gateway: Pick<ReturnType<typeof createToolGatewayService>, "recoverApprovedActionReviews" | "approvedActionReviewSpaces">,
  canRun: () => boolean,
) {
  // Dispatch failures are reported by the domain owner, not thrown. Preserve
  // their retry deadline when another write reloads the same space's work.
  const retries = new Map<string, number>();
  return registerScopedDeadlineWork(coordinator, {
    queue: DELIVERY_QUEUES.toolReviewRecovery,
    batchSize: 1,
    decodeScope: hint => hint === "*" ? undefined : hint,
    matches: (entry, spaceId?: string) => spaceId === undefined || entry.spaceId === spaceId,
    load: async (spaceId?: string) => {
      const rows = await gateway.approvedActionReviewSpaces(spaceId);
      const retained = new Set(rows.map(row => row.spaceId));
      for (const id of retries.keys()) if ((spaceId === undefined || id === spaceId) && !retained.has(id)) retries.delete(id);
      return rows.map(row => ({ ...row, id: row.spaceId, dueAt: retries.get(row.spaceId) ?? Date.now() }));
    },
    check: async entry => {
      const result = await gateway.recoverApprovedActionReviews(entry.spaceId);
      if (!result.retry) { retries.delete(entry.spaceId); return null; }
      const dueAt = Date.now() + 30_000;
      retries.set(entry.spaceId, dueAt);
      return { ...entry, dueAt };
    },
  }, canRun);
}
