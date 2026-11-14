import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { spaceDirectoryQueryOptions, spaceListQueryOptions, resolveAccountUserId } from "./spaces-query";
import { ApiError } from "./client";
import { queryKeys } from "../lib/queryKeys";

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("./auth", () => ({
  authApi: mockAuthApi,
}));

const mockSpacesApi = vi.hoisted(() => ({
  list: vi.fn(),
  detachInflightList: vi.fn(),
  directory: vi.fn(),
  detachInflightDirectory: vi.fn(),
}));

vi.mock("./spaces", () => ({
  spacesApi: mockSpacesApi,
}));

describe("spaceListQueryOptions", () => {
  it.each([401, 403])("treats %s space-list failures as unauthorized bootstrap state", async (status) => {
    mockSpacesApi.list.mockRejectedValueOnce(new ApiError("Operator access required", status, { error: "Operator access required" }));

    await expect(spaceListQueryOptions("user-1").queryFn()).resolves.toEqual({
      spaces: [],
      unauthorized: true,
    });
  });
});

describe("space list cache keys", () => {
  it("isolates the administration directory from navigation and other accounts", async () => {
    const options = spaceDirectoryQueryOptions("admin");
    expect(options.queryKey).not.toEqual(spaceListQueryOptions("admin").queryKey);
    expect(options.queryKey).not.toEqual(spaceDirectoryQueryOptions("other-admin").queryKey);
    mockSpacesApi.directory.mockResolvedValueOnce([{ id: "non-member-space" }]);
    await expect(options.queryFn()).resolves.toEqual([{ id: "non-member-space" }]);
    expect(mockSpacesApi.detachInflightDirectory).toHaveBeenCalled();
  });
  it("gives each account its own entry, and a stable one for signed-out", () => {
    expect(spaceListQueryOptions("user-1").queryKey).not.toEqual(
      spaceListQueryOptions("user-2").queryKey,
    );
    expect(spaceListQueryOptions(null).queryKey).toEqual(spaceListQueryOptions(null).queryKey);
  });

  it("stays under the `spaces` prefix so existing invalidations still reach it", () => {
    expect(spaceListQueryOptions("user-1").queryKey.slice(0, 1)).toEqual(queryKeys.spaces.all);
  });

  // Coalescing keys on the request path alone, so a `/spaces` request issued
  // under the previous session would otherwise answer this one and land the
  // wrong account's list in an account-keyed entry.
  it("refuses to join an in-flight request issued for another account", async () => {
    mockSpacesApi.list.mockResolvedValueOnce([]);
    await spaceListQueryOptions("user-2").queryFn();
    expect(mockSpacesApi.detachInflightList).toHaveBeenCalled();
  });
});

// 19 call sites invalidate `queryKeys.spaces.all` after mutating a space.
// Keying the list deeper only stays safe while that prefix still matches it, so
// this asserts the matching itself rather than the shape of the key.
describe("existing invalidations still reach the account-keyed list", () => {
  it("marks the list stale when the `spaces` prefix is invalidated", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = spaceListQueryOptions("user-1").queryKey;
    queryClient.setQueryData(key, { spaces: [], unauthorized: false });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    await queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

// A session request that fails answers nothing. `authApi.getSession` returns
// null only for a 401 — a real "signed out" — and throws otherwise, so treating
// a failure as null would key a credentialed response to `anonymous` and hand
// it to every signed-out reader. The original bug, rebuilt for anonymous.
describe("an unavailable session is not an anonymous session", () => {
  it("does not resolve an identity from an errored session entry", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockAuthApi.getSession.mockRejectedValueOnce(new Error("network down"));
    await queryClient
      .fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => mockAuthApi.getSession(), retry: false })
      .catch(() => undefined);
    expect(queryClient.getQueryState(queryKeys.auth.session)?.status).toBe("error");

    // Asked again rather than assumed anonymous.
    mockAuthApi.getSession.mockResolvedValueOnce({ user: { id: "user-9" } });
    await expect(resolveAccountUserId(queryClient)).resolves.toBe("user-9");
  });

  it("fetches the session when the cache has no answer, instead of defaulting to anonymous", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockAuthApi.getSession.mockResolvedValueOnce({ user: { id: "user-7" } });

    await expect(resolveAccountUserId(queryClient)).resolves.toBe("user-7");
    expect(mockAuthApi.getSession).toHaveBeenCalled();
  });

  it("still treats a confirmed 401 as the anonymous identity", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // `getSession` resolves null for a 401 — signed out is an answer.
    mockAuthApi.getSession.mockResolvedValueOnce(null);

    await expect(resolveAccountUserId(queryClient)).resolves.toBeNull();
  });
});


// Invalidation is the app saying "that answer belongs to the previous account".
// The entry stays `success` with the old user until a refetch lands, so a status
// check alone would key the new account's list to the old account's id.
describe("an invalidated session is not a current identity", () => {
  it("re-reads the session rather than trusting an invalidated success", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockAuthApi.getSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    await queryClient.fetchQuery({
      queryKey: queryKeys.auth.session,
      queryFn: () => mockAuthApi.getSession(),
      retry: false,
    });

    // Signed in as somebody else; the invite page invalidates and asks at once.
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
    expect(queryClient.getQueryState(queryKeys.auth.session)?.status).toBe("success");
    mockAuthApi.getSession.mockResolvedValueOnce({ user: { id: "user-2" } });

    await expect(resolveAccountUserId(queryClient)).resolves.toBe("user-2");
  });
});
