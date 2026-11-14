import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import {
  SharedPollingCoordinator,
  type SharedMessage,
  type SharedPollingSnapshot,
} from "../lib/cross-tab-poll";
import { filterLocalInboxArchivedQueryData } from "../lib/inboxArchiveCache";

type RefetchInterval = number | false;

export interface SharedPollingQueryOptions {
  spaceId: string | null | undefined;
  resourceKey: string;
  queryKey: QueryKey;
  enabled?: boolean;
  refetchInterval?: RefetchInterval;
  /**
   * When true, non-leader tabs disable their active polling/query fetch for this
   * resource and render from broadcast/cache data. Use for interval-polled hot
   * endpoints. Leave false for one-shot reads where blank first paint is worse
   * than a duplicated initial fetch.
   */
  leaderOnly?: boolean;
}

export interface SharedPollingQueryState<TData> {
  isLeader: boolean;
  enabled: boolean;
  refetchInterval: RefetchInterval;
  publish: (data: TData | undefined, dataUpdatedAt: number) => void;
}

type RegistryEntry = {
  coordinator: SharedPollingCoordinator;
  refs: number;
};

const coordinators = new Map<string, RegistryEntry>();

function acquireCoordinator(spaceId: string): SharedPollingCoordinator {
  const existing = coordinators.get(spaceId);
  if (existing) {
    existing.refs += 1;
    return existing.coordinator;
  }
  const coordinator = new SharedPollingCoordinator(spaceId);
  coordinator.start();
  coordinators.set(spaceId, { coordinator, refs: 1 });
  return coordinator;
}

function releaseCoordinator(spaceId: string): void {
  const existing = coordinators.get(spaceId);
  if (!existing) return;
  existing.refs -= 1;
  if (existing.refs > 0) return;
  existing.coordinator.stop();
  coordinators.delete(spaceId);
}

function resourceKey(spaceId: string, key: string, queryKeyHash: string): string {
  return `${spaceId}:${key}:${queryKeyHash}`;
}

export function applySharedPollingResult<TData>(
  queryClient: Pick<QueryClient, "getQueryState" | "setQueryData">,
  queryKey: QueryKey,
  message: SharedMessage,
): boolean {
  if (message.type !== "result") return false;
  const incomingUpdatedAt = message.dataUpdatedAt ?? message.at;
  if (incomingUpdatedAt <= 0) return false;
  const localUpdatedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
  if (localUpdatedAt >= incomingUpdatedAt) return false;
  const data = filterLocalInboxArchivedQueryData(queryKey, message.data as TData);
  queryClient.setQueryData(queryKey, data, { updatedAt: incomingUpdatedAt });
  return true;
}

export function useSharedPollingQuery<TData>({
  spaceId,
  resourceKey: rawResourceKey,
  queryKey,
  enabled = true,
  refetchInterval = false,
  leaderOnly = false,
}: SharedPollingQueryOptions): SharedPollingQueryState<TData> {
  const queryClient = useQueryClient();
  const activeSpaceId = enabled && spaceId ? spaceId : null;
  const queryKeyHash = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const fullResourceKey = activeSpaceId ? resourceKey(activeSpaceId, rawResourceKey, queryKeyHash) : null;
  const queryKeyRef = useRef(queryKey);
  const [snapshot, setSnapshot] = useState<SharedPollingSnapshot>({ isLeader: true });

  // Coordinator notifications arrive as fresh snapshot objects, and
  // `subscribe` invokes its listener synchronously from inside the mount
  // effect. Passing `setSnapshot` straight through would schedule a nested
  // re-render for every notification — including value-equal ones — and those
  // wasted commits count toward React's nested-update limit. Under a hostile
  // mount cascade (many shared-polling hooks mounting while the backend is
  // cold) that budget is shared with every other effect-driven update, so
  // keep the previous state object whenever leadership did not change and
  // let React bail out instead.
  const applySnapshot = useCallback((next: SharedPollingSnapshot) => {
    setSnapshot((prev) => (prev.isLeader === next.isLeader ? prev : next));
  }, []);

  useEffect(() => {
    queryKeyRef.current = queryKey;
  }, [queryKey, queryKeyHash]);

  useEffect(() => {
    if (!activeSpaceId || !fullResourceKey) {
      applySnapshot({ isLeader: true });
      return;
    }

    const coordinator = acquireCoordinator(activeSpaceId);
    const unsubscribeState = coordinator.subscribe(applySnapshot);
    const unsubscribeResource = coordinator.subscribeResource(fullResourceKey, (message) => {
      applySharedPollingResult(queryClient, queryKeyRef.current, message);
    });
    coordinator.request(fullResourceKey);

    return () => {
      unsubscribeResource();
      unsubscribeState();
      releaseCoordinator(activeSpaceId);
    };
  }, [activeSpaceId, applySnapshot, fullResourceKey, leaderOnly, queryClient, queryKeyHash]);

  const isLeader = !leaderOnly || snapshot.isLeader;
  const queryEnabled = enabled && (!leaderOnly || snapshot.isLeader);
  const coordinatedInterval = leaderOnly && !snapshot.isLeader ? false : refetchInterval;

  const publish = useCallback((data: TData | undefined, dataUpdatedAt: number) => {
    if (!activeSpaceId || !fullResourceKey || data === undefined) return;
    const entry = coordinators.get(activeSpaceId);
    entry?.coordinator.publish(fullResourceKey, data, dataUpdatedAt);
  }, [activeSpaceId, fullResourceKey]);

  return useMemo(
    () => ({
      isLeader,
      enabled: queryEnabled,
      refetchInterval: coordinatedInterval,
      publish,
    }),
    [coordinatedInterval, isLeader, publish, queryEnabled],
  );
}

export function usePublishSharedQueryData<TData>(
  shared: Pick<SharedPollingQueryState<TData>, "publish" | "isLeader">,
  data: TData | undefined,
  dataUpdatedAt: number,
): void {
  useEffect(() => {
    if (!shared.isLeader || dataUpdatedAt <= 0) return;
    shared.publish(data, dataUpdatedAt);
  }, [data, dataUpdatedAt, shared]);
}
