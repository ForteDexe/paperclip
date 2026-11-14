import type { SubscriptionCostReport, UpdateSubscriptionPrice } from "@outpost/shared";
import { api } from "./client";

export const subscriptionsApi = {
  report(spaceId: string, from?: string, to?: string) {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (!from && !to) query.set("period", "all");
    return api.get<SubscriptionCostReport>(`/spaces/${spaceId}/costs/subscriptions?${query}`);
  },
  refresh: (spaceId: string) => api.post<{ status: string }>(`/spaces/${spaceId}/costs/subscriptions/refresh`, {}),
  update: (spaceId: string, id: string, input: UpdateSubscriptionPrice) =>
    api.patch(`/spaces/${spaceId}/costs/subscriptions/${id}`, input),
  link: (spaceId: string, id: string, targetId: string, expectedRevision: number, targetRevision: number) =>
    api.post(`/spaces/${spaceId}/costs/subscriptions/${id}/link`, { targetId, expectedRevision, targetRevision }),
};
