import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import { DELIVERY_QUEUES } from "./delivery-work-notifications.js";
import { registerScopedDeadlineWork } from "./scoped-deadline-work.js";
import type { createToolGatewayService } from "./tool-gateway.js";

export function registerToolReviewExpiryWork(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>,
  gateway: Pick<ReturnType<typeof createToolGatewayService>, "sweepExpiredActionReviewsForSpace" | "actionReviewExpiryDeadlines">,
  canRun: () => boolean,
) {
  return registerScopedDeadlineWork(coordinator, {
    queue: DELIVERY_QUEUES.toolReviewExpiry,
    batchSize: 1,
    minimumPassIntervalMs: 0,
    decodeScope: hint => hint === "*" ? undefined : hint,
    matches: (entry, spaceId?: string) => spaceId === undefined || entry.spaceId === spaceId,
    load: async (spaceId?: string) => (await gateway.actionReviewExpiryDeadlines(spaceId))
      .map(row => ({ ...row, id: row.spaceId })),
    check: async entry => {
      await gateway.sweepExpiredActionReviewsForSpace(entry.spaceId);
      const [next] = await gateway.actionReviewExpiryDeadlines(entry.spaceId);
      return next ? { ...next, id: next.spaceId } : null;
    },
  }, canRun);
}
