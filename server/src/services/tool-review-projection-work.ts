import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import { DELIVERY_QUEUES } from "./delivery-work-notifications.js";
import { registerScopedDeadlineWork } from "./scoped-deadline-work.js";
import type { toolReviewProjectionService } from "./tool-review-projection.js";

export function registerToolReviewProjectionWork(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>,
  service: ReturnType<typeof toolReviewProjectionService>,
  canRun: () => boolean,
) {
  const unresolvedPasses = new Map<string, number>();
  return registerScopedDeadlineWork(coordinator, {
    queue: DELIVERY_QUEUES.toolReviewProjection,
    batchSize: 1,
    decodeScope: hint => hint === "*" ? undefined : hint,
    matches: (entry, spaceId?: string) => spaceId === undefined || entry.spaceId === spaceId,
    load: async (spaceId?: string) => {
      const rows = spaceId ? [{ spaceId }] : await service.spaces();
      for (const scope of unresolvedPasses.keys()) {
        if (!spaceId || scope === spaceId) unresolvedPasses.delete(scope);
      }
      return rows.map(row => ({ ...row, id: row.spaceId, dueAt: Date.now() }));
    },
    check: async (entry, signal) => {
      const result = await service.sweep(entry.spaceId, { maxRows: 500, signal, shouldContinue: canRun });
      if (!result.retry) { unresolvedPasses.delete(entry.id); return null; }
      if (result.truncated) return { ...entry, dueAt: Date.now() + 1000 };
      const count = Math.min((unresolvedPasses.get(entry.id) ?? 0) + 1, 5);
      unresolvedPasses.set(entry.id, count);
      return { ...entry, dueAt: Date.now() + Math.min(300_000, 30_000 * 2 ** (count - 1)) };
    },
  }, canRun);
}
