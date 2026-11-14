import type { InboxDismissal } from "@outpost/shared";
import { api } from "./client";

export const inboxDismissalsApi = {
  list: (spaceId: string) => api.get<InboxDismissal[]>(`/spaces/${spaceId}/inbox-dismissals`),
  dismiss: (spaceId: string, itemKey: string) =>
    api.post<InboxDismissal>(`/spaces/${spaceId}/inbox-dismissals`, { itemKey }),
  snooze: (spaceId: string, itemKey: string, snoozedUntil: string) =>
    api.post<InboxDismissal>(`/spaces/${spaceId}/inbox-dismissals`, {
      itemKey,
      kind: "snooze",
      snoozedUntil,
    }),
  restore: (spaceId: string, itemKey: string) =>
    api.delete<void>(`/spaces/${spaceId}/inbox-dismissals/${encodeURIComponent(itemKey)}`),
};
