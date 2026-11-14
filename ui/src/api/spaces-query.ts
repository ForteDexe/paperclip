import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { OperatorBootstrap, Space } from "@outpost/shared";
import { authApi } from "./auth";
import { spacesApi } from "./spaces";
import { ApiError } from "./client";
import { queryKeys } from "../lib/queryKeys";
import { useBootstrapQuery } from "./bootstrap-query";
import { hasUnverifiedSession } from "../lib/cached-session";

export type SpaceListResult = { spaces: Space[]; unauthorized: boolean };

// Single source of truth for the space-list query. Every consumer reads the
// same cache entry, so they must agree on the shape — returning a bare
// `Space[]` from one and this wrapped object from another silently corrupts
// the entry and crashes whichever reads the other's shape.
//
// The entry is keyed by account. Callers therefore cannot ask for "the space
// list" without saying whose, which is the point: the previous design let a
// list fetched for one account answer a question about another, and every
// consumer had to defend against that individually.
export function spaceListQueryOptions(userId: string | null) {
  return {
    queryKey: queryKeys.spaces.list(userId),
    queryFn: async (): Promise<SpaceListResult> => {
      // Request coalescing keys on the path alone, so it would happily answer a
      // fetch for this account with a `/spaces` request issued under the
      // previous one — putting the wrong account's list in an account-keyed
      // entry. Coalescing has nothing to offer here anyway: React Query already
      // dedupes concurrent fetches within a key, and *across* keys the accounts
      // differ by construction, which is exactly when sharing is wrong.
      spacesApi.detachInflightList();
      try {
        return { spaces: await spacesApi.list(), unauthorized: false };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          return { spaces: [], unauthorized: true };
        }
        throw err;
      }
    },
  } as const;
}

/** The administration directory has its own account-scoped cache and request. */
export function spaceDirectoryQueryOptions(userId: string | null) {
  return {
    queryKey: queryKeys.spaces.directory(userId),
    queryFn: async () => {
      spacesApi.detachInflightDirectory();
      return spacesApi.directory();
    },
  } as const;
}

const sessionQueryOptions = {
  queryKey: queryKeys.auth.session,
  queryFn: () => authApi.getSession(),
} as const;

/** Observe the shared session read when a surface needs error and retry state. */
export function useAccountSessionQuery() {
  return useQuery(sessionQueryOptions);
}

/**
 * The signed-in account, as the cache currently understands it.
 *
 * `settled` means the session query *answered*, not merely that it stopped
 * being pending. The distinction is the whole point of this helper. `null` is a
 * real answer — `authApi.getSession` returns it for a 401, meaning "signed out"
 * — but a session request that *failed* answers nothing, and it throws rather
 * than returning null. Treating that failure as `null` would key an account's
 * list to `anonymous` while the request still carried their cookie, writing a
 * credentialed response into the entry every signed-out reader trusts. Which is
 * the original bug, rebuilt for anonymous.
 *
 * So: settled on success only. A failed session lookup leaves the list unfetched
 * until the query recovers, which it does on the next refetch.
 */
export function useAccountIdentity(): {
  userId: string | null;
  settled: boolean;
  failed: boolean;
  bootstrap: OperatorBootstrap | undefined;
  updatedAt: number;
} {
  const { data: session, isSuccess, isError, dataUpdatedAt } = useAccountSessionQuery();
  const userId = session?.user.id ?? null;
  return {
    userId, settled: isSuccess, failed: isError, updatedAt: dataUpdatedAt,
    bootstrap: isSuccess && session?.operatorBootstrap?.userId === userId ? session.operatorBootstrap : undefined,
  };
}

/**
 * Observe the space list for the account signed in now.
 *
 * Pass `enabled: false` to hold for a caller's own reasons; the session gate is
 * applied on top of it either way.
 */
export function useSpaceListQuery(
  options: { enabled?: boolean; staleTime?: number; retry?: number | boolean } = {},
) {
  const { userId, settled, bootstrap, updatedAt } = useAccountIdentity();
  const query = useBootstrapQuery<SpaceListResult>({
    ...spaceListQueryOptions(userId),
    ...options,
    enabled: settled && (options.enabled ?? true),
  }, bootstrap ? { identity: bootstrap, data: { spaces: bootstrap.spaces, unauthorized: false }, updatedAt } : undefined);

  // While the account is unknown this query is disabled, and a disabled query
  // reports `isLoading: false` with `data: undefined` — which consumers default
  // to an empty list and read as "asked, and owns nothing". That is the
  // destructive reading: `shouldClearStoredSpaceSelection` would throw away
  // the customer's stored space on every cold boot, before the session had
  // even landed.
  //
  // Waiting for the account is part of getting the list, so it is reported as
  // part of getting the list. Consumers gate on these two, and both must mean
  // "no answer yet" for the whole window in which there is no answer.
  const waitingForAccount = !settled && (options.enabled ?? true);
  return {
    ...query,
    isLoading: query.isLoading || waitingForAccount,
    isFetching: query.isFetching || waitingForAccount,
  };
}

/**
 * Resolve the account identity for an imperative path, fetching the session if
 * the cache has no answer yet.
 *
 * Not `getQueryData` with a `?? null` fallback: an empty or errored session
 * entry would read as "signed out" and key an authenticated response to
 * `anonymous`. There is no safe default here — the identity is either known or
 * must be obtained, and if it cannot be obtained the caller must fail rather
 * than guess.
 */
export async function resolveAccountUserId(queryClient: QueryClient): Promise<string | null> {
  const state = queryClient.getQueryState<Awaited<ReturnType<typeof authApi.getSession>>>(
    queryKeys.auth.session,
  );
  // `isInvalidated` matters as much as `status` here. Invalidation is how the
  // app says "this is the previous account's answer" — authentication flows invalidate
  // the session immediately after a sign-in and resolve an identity in the next
  // breath. The entry is still `success`, still holding the *old* user, until a
  // refetch lands; trusting it would key the new account's list to the old
  // account's id, which is the misattribution this whole file exists to prevent.
  if (state?.status === "success" && !state.isInvalidated && !hasUnverifiedSession(queryClient)) {
    return state.data?.user.id ?? null;
  }
  const session = await queryClient.fetchQuery({ ...sessionQueryOptions, staleTime: 0 });
  return session?.user.id ?? null;
}

/** Fetch the space list for the account signed in now, ignoring what is cached. */
export async function fetchSpaceListForCurrentAccount(
  queryClient: QueryClient,
): Promise<SpaceListResult> {
  const userId = await resolveAccountUserId(queryClient);
  return queryClient.fetchQuery({
    ...spaceListQueryOptions(userId),
    staleTime: 0,
  });
}
