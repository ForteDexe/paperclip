import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { inboxDismissalsApi } from "../api/inboxDismissals";
import { queryKeys } from "../lib/queryKeys";
import {
  useLocalInboxArchiveIssueIds,
} from "../lib/inboxArchiveCache";
import { usePublishSharedQueryData, useSharedPollingQuery } from "./useSharedPolling";
import {
  buildInboxDismissedAtByKey,
  loadDismissedInboxAlerts,
  saveDismissedInboxAlerts,
  loadReadInboxItems,
  saveReadInboxItems,
  READ_ITEMS_KEY,
} from "../lib/inbox";

export function useDismissedInboxAlerts() {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissedInboxAlerts);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "outpost:inbox:dismissed") return;
      setDismissed(loadDismissedInboxAlerts());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissedInboxAlerts(next);
      return next;
    });
  };

  return { dismissed, dismiss };
}

export function useInboxDismissals(spaceId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = spaceId
    ? queryKeys.inboxDismissals(spaceId)
    : ["inbox-dismissals", "__disabled__"] as const;

  const { data: dismissals = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => inboxDismissalsApi.list(spaceId!),
    enabled: !!spaceId,
  });

  const dismissMutation = useMutation({
    mutationFn: ({ itemKey }: { itemKey: string }) => inboxDismissalsApi.dismiss(spaceId!, itemKey),
    onMutate: async ({ itemKey }) => {
      if (!spaceId) return { previous: [] as typeof dismissals };
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<typeof dismissals>(queryKey) ?? [];
      const now = new Date();
      queryClient.setQueryData(queryKey, [
        {
          id: `optimistic:${itemKey}`,
          spaceId,
          userId: "me",
          itemKey,
          dismissedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        ...previous.filter((dismissal) => dismissal.itemKey !== itemKey),
      ]);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      if (!spaceId) return;
      invalidateDismissalConsumers();
    },
  });

  function invalidateDismissalConsumers() {
    if (!spaceId) return;
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(spaceId) });
    // The attention feed derives its rows from server-side dismissals, so any
    // dismiss/snooze/restore must re-pull it to keep the queue and curtains in sync.
    queryClient.invalidateQueries({ queryKey: queryKeys.attention(spaceId) });
  }

  const snoozeMutation = useMutation({
    mutationFn: ({ itemKey, snoozedUntil }: { itemKey: string; snoozedUntil: string }) =>
      inboxDismissalsApi.snooze(spaceId!, itemKey, snoozedUntil),
    onSettled: invalidateDismissalConsumers,
  });

  const restoreMutation = useMutation({
    mutationFn: ({ itemKey }: { itemKey: string }) => inboxDismissalsApi.restore(spaceId!, itemKey),
    onSettled: invalidateDismissalConsumers,
  });

  const dismissedAtByKey = useMemo(
    () => buildInboxDismissedAtByKey(dismissals),
    [dismissals],
  );

  // Stable identities (react-query keeps `mutate` referentially stable) so
  // consumers can hand these to memoized rows without breaking memoization.
  const dismissMutate = dismissMutation.mutate;
  const snoozeMutate = snoozeMutation.mutate;
  const restoreMutate = restoreMutation.mutate;
  const dismiss = useCallback((itemKey: string) => dismissMutate({ itemKey }), [dismissMutate]);
  const snooze = useCallback(
    (itemKey: string, snoozedUntil: string) => snoozeMutate({ itemKey, snoozedUntil }),
    [snoozeMutate],
  );
  const restore = useCallback((itemKey: string) => restoreMutate({ itemKey }), [restoreMutate]);

  return {
    dismissals,
    isLoading,
    error,
    dismissedAtByKey,
    dismiss,
    snooze,
    restore,
    isPending: dismissMutation.isPending || snoozeMutation.isPending || restoreMutation.isPending,
  };
}

export function useReadInboxItems() {
  const [readItems, setReadItems] = useState<Set<string>>(loadReadInboxItems);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== READ_ITEMS_KEY) return;
      setReadItems(loadReadInboxItems());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const markRead = (id: string) => {
    setReadItems((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveReadInboxItems(next);
      return next;
    });
  };

  const markUnread = (id: string) => {
    setReadItems((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveReadInboxItems(next);
      return next;
    });
  };

  return { readItems, markRead, markUnread };
}

export function useInboxBadge(spaceId: string | null | undefined) {
  const locallyArchivedIssueIds = useLocalInboxArchiveIssueIds(spaceId);
  const badgeQueryKey = queryKeys.sidebarBadges(spaceId ?? "__disabled__");
  const sharedBadges = useSharedPollingQuery({
    spaceId,
    resourceKey: "inbox-badge",
    queryKey: badgeQueryKey,
    enabled: !!spaceId,
  });
  const { data: badges, dataUpdatedAt } = useQuery({
    queryKey: badgeQueryKey,
    queryFn: () => sidebarBadgesApi.get(spaceId!),
    enabled: !!spaceId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  usePublishSharedQueryData(sharedBadges, badges, dataUpdatedAt);

  return useMemo(() => {
    const unreadIssueIds = badges?.unreadIssueIds ?? [];
    const archivedUnread = unreadIssueIds.filter((id) => locallyArchivedIssueIds.has(id)).length;
    return {
      inbox: Math.max(0, (badges?.inbox ?? 0) - archivedUnread),
      approvals: badges?.approvals ?? 0,
      failedRuns: badges?.failedRuns ?? 0,
      joinRequests: badges?.joinRequests ?? 0,
      mineIssues: unreadIssueIds.length - archivedUnread,
      alerts: 0,
    };
  }, [badges, locallyArchivedIssueIds]);
}
