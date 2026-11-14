import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Space } from "@outpost/shared";
import { spacesApi } from "../api/spaces";
import {
  fetchSpaceListForCurrentAccount,
  useAccountIdentity,
  useSpaceListQuery,
} from "../api/spaces-query";
import { queryKeys } from "../lib/queryKeys";
import type { SpaceSelectionSource } from "../lib/space-selection";
type SpaceSelectionOptions = { source?: SpaceSelectionSource };

interface SpaceContextValue {
  spaces: Space[];
  selectedSpaceId: string | null;
  selectedSpace: Space | null;
  selectionSource: SpaceSelectionSource;
  loading: boolean;
  error: Error | null;
  /**
   * There is no usable space list *and* the reason is a failed request rather
   * than an account that owns nothing. Consumers need the two apart: an empty
   * list is a fact to render, this is a dead end to offer a way out of.
   */
  spaceListUnavailable: boolean;
  /** Re-fetches the list for the account signed in now. Pairs with the flag above. */
  retrySpaces: () => Promise<void>;
  setSelectedSpaceId: (spaceId: string, options?: SpaceSelectionOptions) => void;
  reloadSpaces: () => Promise<void>;
  createSpace: (data: {
    name: string;
    workspaceRoot?: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) => Promise<Space>;
}

const STORAGE_KEY = "outpost.selectedSpaceId";

// A refresh can replace consumers before a mounted provider is replaced. Keep
// their context identity in Vite's per-module data; never store account state.
const SpaceContext: Context<SpaceContextValue | null> =
  import.meta.hot?.data?.spaceContext ?? createContext<SpaceContextValue | null>(null);
if (import.meta.hot?.data) import.meta.hot.data.spaceContext = SpaceContext;

export function resolveBootstrapSpaceSelection(input: {
  spaces: Array<Pick<Space, "id">>;
  sidebarSpaces: Array<Pick<Space, "id">>;
  selectedSpaceId: string | null;
  storedSpaceId: string | null;
  routeSpaceId?: string | null;
}) {
  if (input.spaces.length === 0) return null;

  const selectableSpaces = input.sidebarSpaces.length > 0
    ? input.sidebarSpaces
    : input.spaces;
  // An already-selected space only needs to EXIST — not to be featured in
  // the sidebar. The Layout route-sync selects whatever space the URL names
  // (archived included, since archived pages are still routable); if this
  // resolver vetoed that selection against the sidebar-filtered list, the two
  // effects would re-select against each other forever and blow React's
  // nested-update limit (the archived-space blank-screen crash). The
  // sidebar filter keeps shaping fresh boots below, where no explicit
  // selection exists yet.
  if (input.selectedSpaceId && input.spaces.some((space) => space.id === input.selectedSpaceId)) {
    return input.selectedSpaceId;
  }
  if (input.routeSpaceId && input.sidebarSpaces.some((space) => space.id === input.routeSpaceId)) {
    return input.routeSpaceId;
  }
  if (input.storedSpaceId && selectableSpaces.some((space) => space.id === input.storedSpaceId)) {
    return input.storedSpaceId;
  }
  return selectableSpaces[0]?.id ?? null;
}

export function shouldClearStoredSpaceSelection(input: {
  spaces: Array<Pick<Space, "id">>;
  isLoading: boolean;
  unauthorized: boolean;
  /**
   * Whether the space request failed. An error is not an answer, and this
   * branch is destructive.
   *
   * `spacesListQueryOptions` sets `retry: false`, and a request that fails
   * before ever succeeding leaves `data` undefined - which the provider
   * defaults to `{ spaces: [], unauthorized: false }`. That is
   * indistinguishable from "this account was asked, and owns nothing", so a
   * single failed request on a cold load would clear the customer's stored
   * space and drop them onto whichever space sorts first next time.
   *
   * Not clearing costs nothing: a stored id that no longer resolves is
   * ignored by {@link resolveBootstrapSpaceSelection}, which checks it
   * against the current list before using it.
   */
  errored: boolean;
}) {
  if (input.errored) return false;
  return !input.isLoading && !input.unauthorized && input.spaces.length === 0;
}

export function SpaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [selectionSource, setSelectionSource] = useState<SpaceSelectionSource>("bootstrap");
  const [selectedSpaceId, setSelectedSpaceIdState] = useState<string | null>(null);

  // Keyed by account, so there is no such thing here as "the list, but whose?".
  // A change of account changes the key, which leaves this observer pending
  // rather than holding the previous account's answer.
  const { data: spacesResult = { spaces: [], unauthorized: false }, isLoading, error } =
    useSpaceListQuery({
      // `retry: 1` against the shared `retry: false`, and it is load-bearing
      // here even though an earlier measurement found retries pointless. That
      // measurement was taken against an implementation that removed the cache
      // entry on an account change, which made the observer rebind and issue a
      // second request for free. Keying by account replaced that mechanism, and
      // the free attempt went with it: without this, one blip during a switch
      // leaves the customer with no spaces until they find Try again.
      retry: 1,
    });
  const spaces = spacesResult.spaces;
  const spaceListUnauthorized = spacesResult.unauthorized;
  const sidebarSpaces = useMemo(
    () => spaces.filter((space) => space.status !== "archived"),
    [spaces],
  );

  // The list is account-keyed, but the *selection* is component state and does
  // not change key with it. It belongs to the account that just went away, so it
  // is dropped here. The stored id deliberately survives:
  // resolveBootstrapSpaceSelection re-validates it against the incoming list,
  // so an account signing back in keeps its space while an unrelated account
  // cannot inherit it.
  const { userId: sessionUserId, settled: isSessionSettled } = useAccountIdentity();
  const observedUserIdRef = useRef<string | null | undefined>(undefined);
  const selectionBelongsToPreviousAccount = isSessionSettled
    && observedUserIdRef.current !== undefined && observedUserIdRef.current !== sessionUserId;

  useEffect(() => {
    // Until the session settles the account is unknown, not changed.
    if (!isSessionSettled) return;
    const previousUserId = observedUserIdRef.current;
    observedUserIdRef.current = sessionUserId;
    // First settled observation is this tab's boot: no previous account to leave.
    if (previousUserId === undefined || previousUserId === sessionUserId) return;

    setSelectedSpaceIdState(null);
    setSelectionSource("bootstrap");
  }, [isSessionSettled, sessionUserId]);

  // Auto-select first space when list loads
  useEffect(() => {
    // `isLoading` covers the account change too: the key moved, so this observer
    // is pending on a list for the new account rather than holding the old one.
    if (isLoading) return;
    // An errored list says nothing about which spaces this account has, and
    // `retry: false` makes a single network blip stick. Treat it as undecided
    // rather than as "no spaces", which would clear the stored selection.
    if (error) return;
    if (spaces.length === 0) {
      if (shouldClearStoredSpaceSelection({
        spaces,
        isLoading: false,
        unauthorized: spaceListUnauthorized,
        errored: error !== null,
      })) {
        if (selectedSpaceId !== null) {
          setSelectedSpaceIdState(null);
        }
        localStorage.removeItem(STORAGE_KEY);
      }
      return;
    }

    const next = resolveBootstrapSpaceSelection({
      spaces,
      sidebarSpaces,
      selectedSpaceId,
      storedSpaceId: localStorage.getItem(STORAGE_KEY),
      routeSpaceId: spaces.find(space =>
        space.issuePrefix.toLowerCase() === window.location.pathname.split("/")[1]?.toLowerCase(),
      )?.id,
    });
    if (next === null || next === selectedSpaceId) return;
    setSelectedSpaceIdState(next);
    setSelectionSource("bootstrap");
    localStorage.setItem(STORAGE_KEY, next);
  }, [
    spaces,
    spaceListUnauthorized,
    error,
    isLoading,
    selectedSpaceId,
    sidebarSpaces,
  ]);

  const setSelectedSpaceId = useCallback((spaceId: string, options?: SpaceSelectionOptions) => {
    setSelectedSpaceIdState(spaceId);
    setSelectionSource(options?.source ?? "manual");
    localStorage.setItem(STORAGE_KEY, spaceId);
  }, []);

  const reloadSpaces = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all });
  }, [queryClient]);

  // The way out of the dead end. Not `reloadSpaces`: invalidation refetches
  // only through a mounted observer, and it leaves an errored query reporting
  // its old error, so the recovery affordance would keep telling the customer
  // the list is unavailable after a retry had already succeeded.
  const retrySpaces = useCallback(async () => {
    try {
      await fetchSpaceListForCurrentAccount(queryClient);
    } catch {
      // Not swallowed — `fetchQuery` records it on the query, which is where
      // `spaceListUnavailable` below reads it from. Caught only so the
      // rejection does not go unhandled.
    }
  }, [queryClient]);

  // Empty because we could not find out, as opposed to empty because the account
  // owns nothing. Derived from the query rather than tracked alongside it: the
  // query is the only thing that knows whether the last attempt succeeded, and a
  // second copy of that answer drifts — it did, reporting a failure over a later
  // empty list that was simply the truth.
  const spaceListUnavailable = spaces.length === 0 && Boolean(error);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      workspaceRoot?: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) =>
      spacesApi.create(data),
    onSuccess: (space) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all });
      setSelectedSpaceId(space.id);
    },
  });

  const createSpace = useCallback(
    async (data: {
      name: string;
      workspaceRoot?: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation],
  );

  const selectedSpace = useMemo(
    () => selectionBelongsToPreviousAccount ? null : spaces.find((space) => space.id === selectedSpaceId) ?? null,
    [spaces, selectedSpaceId, selectionBelongsToPreviousAccount],
  );

  const value = useMemo(
    () => ({
      spaces,
      selectedSpaceId: selectionBelongsToPreviousAccount ? null : selectedSpaceId,
      selectedSpace,
      selectionSource,
      loading: isLoading,
      error: error as Error | null,
      spaceListUnavailable,
      retrySpaces,
      setSelectedSpaceId,
      reloadSpaces,
      createSpace,
    }),
    [
      spaces,
      selectedSpaceId,
      selectionBelongsToPreviousAccount,
      selectedSpace,
      selectionSource,
      isLoading,
      error,
      spaceListUnavailable,
      retrySpaces,
      setSelectedSpaceId,
      reloadSpaces,
      createSpace,
    ],
  );

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

export function useSpace() {
  const ctx = useContext(SpaceContext);
  if (!ctx) {
    throw new Error("useSpace must be used within SpaceProvider");
  }
  return ctx;
}

/**
 * Non-throwing variant of {@link useSpace}. Returns null when called outside a
 * SpaceProvider instead of throwing, so components that may render in
 * provider-less surfaces (e.g. exported/standalone markdown) can read space
 * state without crashing.
 */
export function useOptionalSpace(): SpaceContextValue | null {
  return useContext(SpaceContext);
}
