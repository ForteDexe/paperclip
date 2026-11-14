import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Space } from "@outpost/shared";
import { sidebarPreferencesApi } from "../api/sidebarPreferences";
import { queryKeys } from "../lib/queryKeys";
import { useAccountBoundMutation } from "./useAccountBoundMutation";

function areEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sortSpacesByOrder(spaces: Space[], orderedIds: string[]): Space[] {
  if (spaces.length === 0) return [];
  if (orderedIds.length === 0) return spaces;

  const byId = new Map(spaces.map((space) => [space.id, space]));
  const sorted: Space[] = [];

  for (const id of orderedIds) {
    const space = byId.get(id);
    if (!space) continue;
    sorted.push(space);
    byId.delete(id);
  }
  for (const space of byId.values()) {
    sorted.push(space);
  }
  return sorted;
}

function buildOrderIds(spaces: Space[], orderedIds: string[]) {
  return sortSpacesByOrder(spaces, orderedIds).map((space) => space.id);
}

type UseSpaceOrderParams = {
  spaces: Space[];
  userId: string | null | undefined;
};

export function useSpaceOrder({ spaces, userId }: UseSpaceOrderParams) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => queryKeys.sidebarPreferences.spaceOrder(userId ?? "__anon__"),
    [userId],
  );

  const { data } = useQuery({
    queryKey,
    queryFn: () => sidebarPreferencesApi.getSpaceOrder(),
    enabled: Boolean(userId),
  });

  const [orderedIds, setOrderedIds] = useState<string[]>(() => buildOrderIds(spaces, []));

  useEffect(() => {
    const nextIds = buildOrderIds(spaces, data?.orderedIds ?? []);
    setOrderedIds((current) => (areEqual(current, nextIds) ? current : nextIds));
  }, [spaces, data?.orderedIds]);

  // The server saves for the request's user, so a restored sidebar must not
  // send (or optimistically apply) an order before the session is verified.
  const mutation = useAccountBoundMutation({
    mutationFn: (nextIds: string[]) => sidebarPreferencesApi.updateSpaceOrder({ orderedIds: nextIds }),
    onMutate: (nextIds) => {
      queryClient.setQueryData(queryKey, (current: { orderedIds?: string[]; updatedAt?: Date | null } | undefined) => ({
        orderedIds: nextIds,
        updatedAt: current?.updatedAt ?? null,
      }));
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(queryKey, preference);
    },
  });

  const orderedSpaces = useMemo(
    () => sortSpacesByOrder(spaces, orderedIds),
    [spaces, orderedIds],
  );

  const persistOrder = useCallback(
    (ids: string[]) => {
      const idSet = new Set(spaces.map((space) => space.id));
      const filtered = ids.filter((id) => idSet.has(id));
      for (const space of spaces) {
        if (!filtered.includes(space.id)) filtered.push(space.id);
      }

      setOrderedIds((current) => (areEqual(current, filtered) ? current : filtered));
      if (!userId) return;

      mutation.mutate(filtered);
    },
    [spaces, mutation, userId],
  );

  return {
    orderedSpaces,
    orderedIds,
    persistOrder,
  };
}
