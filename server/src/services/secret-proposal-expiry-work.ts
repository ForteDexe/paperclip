import { logger } from "../middleware/logger.js";
import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import { DELIVERY_QUEUES } from "./delivery-work-notifications.js";
import { registerScopedDeadlineWork } from "./scoped-deadline-work.js";
import type { createSecretProposalsService } from "./secret-proposals.js";

export function registerSecretProposalExpiryWork(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>,
  service: Pick<ReturnType<typeof createSecretProposalsService>, "sweepExpiredForSpace" | "expiryDeadlines">,
  canRun: () => boolean,
) {
  return registerScopedDeadlineWork(coordinator, {
    queue: DELIVERY_QUEUES.secretProposalExpiry,
    batchSize: 1,
    // Saved expiry deadlines are authoritative, including deadlines less than
    // a second away. Only actual failures require a recovery backoff.
    minimumPassIntervalMs: 0,
    decodeScope: hint => hint === "*" ? undefined : hint,
    matches: (entry, spaceId?: string) => spaceId === undefined || entry.spaceId === spaceId,
    load: async (spaceId?: string) => (await service.expiryDeadlines(spaceId))
      .map(row => ({ ...row, id: row.spaceId })),
    check: async entry => {
      const expired = await service.sweepExpiredForSpace(entry.spaceId);
      if (expired > 0) logger.warn({ spaceId: entry.spaceId, expired }, "secret proposal expiry scrubbed proposals");
      const [next] = await service.expiryDeadlines(entry.spaceId);
      return next ? { ...next, id: next.spaceId } : null;
    },
  }, canRun);
}
