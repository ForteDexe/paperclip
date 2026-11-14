import { QueryClient } from "@tanstack/react-query";
import type { OperatorBootstrap } from "@outpost/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorAccessQueryOptions } from "./operator-access-query";
import { queryKeys } from "../lib/queryKeys";

const readAccess = vi.hoisted(() => vi.fn());
vi.mock("./access", () => ({ accessApi: { getCurrentBoardAccess: readAccess } }));
afterEach(() => readAccess.mockReset());

const bootstrap = (userId: string): OperatorBootstrap => ({
  userId, spaces: [], operatorAccess: { userId, isInstanceAdmin: false, spaceIds: [`space-${userId}`] },
});

describe("account-scoped operator bootstrap", () => {
  it("opens from the session snapshot and uses the ordinary reader after invalidation", async () => {
    const client = new QueryClient();
    const options = operatorAccessQueryOptions("one", bootstrap("one"), Date.now(), vi.fn());
    expect(await client.fetchQuery({ ...options, staleTime: 30_000 })).toEqual(bootstrap("one").operatorAccess);
    expect(readAccess).not.toHaveBeenCalled();
    await client.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
    readAccess.mockResolvedValue({ userId: "one", isInstanceAdmin: false, spaceIds: [] });
    expect(await client.fetchQuery(options)).toEqual({ userId: "one", isInstanceAdmin: false, spaceIds: [] });
    expect(readAccess).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it("cannot reuse another account's bootstrap or cache entry", async () => {
    const client = new QueryClient();
    const first = operatorAccessQueryOptions("one", bootstrap("one"), Date.now(), vi.fn());
    await client.fetchQuery({ ...first, staleTime: Infinity });
    const second = operatorAccessQueryOptions("two", bootstrap("one"), Date.now(), vi.fn());
    expect(second.initialData).toBeUndefined();
    expect(second.queryKey).not.toEqual(first.queryKey);
    readAccess.mockResolvedValue({ userId: "two", isInstanceAdmin: false, spaceIds: [] });
    expect(await client.fetchQuery(second)).toMatchObject({ userId: "two", spaceIds: [] });
    client.clear();
  });

  it("refreshes identity instead of caching a response from a changed account", async () => {
    const changed = vi.fn();
    readAccess.mockResolvedValue({ userId: "two", isInstanceAdmin: true, spaceIds: ["foreign"] });
    await expect(operatorAccessQueryOptions("one", undefined, 0, changed).queryFn()).rejects.toMatchObject({ status: 401 });
    expect(changed).toHaveBeenCalledOnce();
  });
});
