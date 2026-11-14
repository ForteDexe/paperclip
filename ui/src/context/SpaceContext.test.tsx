// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Space } from "@outpost/shared";
import { queryKeys } from "../lib/queryKeys";
import {
  SpaceProvider,
  resolveBootstrapSpaceSelection,
  shouldClearStoredSpaceSelection,
  useSpace,
} from "./SpaceContext";

const mockSpacesApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  detachInflightList: vi.fn(),
}));

vi.mock("../api/spaces", () => ({
  spacesApi: mockSpacesApi,
}));

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  authApi: mockAuthApi,
}));

function sessionFor(userId: string) {
  return {
    session: { id: `session-${userId}`, userId },
    user: { id: userId, name: "Example", email: `${userId}@example.com`, image: null },
  };
}

const activeSpace = { id: "space-1" };
const secondActiveSpace = { id: "space-2" };
const archivedSpace = { id: "archived-space" };

function makeSpace(id: string): Space {
  return {
    id,
    name: "Outpost",
    description: null,
    workspaceRoot: null,
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: "PAP",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    defaultResponsibleUserId: null,
    defaultAgentId: null,
    requireOperatorApprovalForNewAgents: false,
    interactionResolverPolicy: {},
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

let captured: ReturnType<typeof useSpace> | null = null;

function Probe({ onSelectedSpaceId }: { onSelectedSpaceId: (spaceId: string | null) => void }) {
  const space = useSpace();
  captured = space;
  const { selectedSpaceId } = space;
  useEffect(() => {
    onSelectedSpaceId(selectedSpaceId);
  }, [onSelectedSpaceId, selectedSpaceId]);
  return <div data-selected-space-id={selectedSpaceId ?? ""} />;
}

describe("resolveBootstrapSpaceSelection", () => {
  it("boots the addressed space before the remembered space", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [activeSpace, secondActiveSpace], sidebarSpaces: [activeSpace, secondActiveSpace],
      selectedSpaceId: null, storedSpaceId: activeSpace.id, routeSpaceId: secondActiveSpace.id,
    })).toBe(secondActiveSpace.id);
  });

  it("retains a manual selection and does not bootstrap into an archived route", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [activeSpace, secondActiveSpace], sidebarSpaces: [activeSpace, secondActiveSpace],
      selectedSpaceId: activeSpace.id, storedSpaceId: activeSpace.id, routeSpaceId: secondActiveSpace.id,
    })).toBe(activeSpace.id);
    expect(resolveBootstrapSpaceSelection({
      spaces: [activeSpace, archivedSpace], sidebarSpaces: [activeSpace],
      selectedSpaceId: null, storedSpaceId: activeSpace.id, routeSpaceId: archivedSpace.id,
    })).toBe(activeSpace.id);
  });

  it("does not expose a stale stored space id before spaces load", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [],
      sidebarSpaces: [],
      selectedSpaceId: null,
      storedSpaceId: "stale-space",
    })).toBeNull();
  });

  it("replaces a stale stored space id with the first loaded space", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [activeSpace],
      sidebarSpaces: [activeSpace],
      selectedSpaceId: null,
      storedSpaceId: "stale-space",
    })).toBe("space-1");
  });

  it("keeps a valid selected space ahead of stored bootstrap state", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [activeSpace],
      sidebarSpaces: [activeSpace],
      selectedSpaceId: "space-1",
      storedSpaceId: "stale-space",
    })).toBe("space-1");
  });

  it("keeps a valid stored space id instead of falling back to the first space", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [activeSpace, secondActiveSpace],
      sidebarSpaces: [activeSpace, secondActiveSpace],
      selectedSpaceId: null,
      storedSpaceId: "space-2",
    })).toBe("space-2");
  });

  it("uses selectable sidebar spaces before archived spaces", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [archivedSpace, activeSpace],
      sidebarSpaces: [activeSpace],
      selectedSpaceId: null,
      storedSpaceId: "archived-space",
    })).toBe("space-1");
  });

  it("keeps an explicitly selected archived space that still exists", () => {
    // The Layout route-sync selects the space the URL names, archived
    // included. Vetoing that selection here re-selected an active space,
    // the route-sync selected the archived one again, and the two effects
    // ping-ponged until React threw #185 and unmounted the app.
    expect(resolveBootstrapSpaceSelection({
      spaces: [archivedSpace, activeSpace],
      sidebarSpaces: [activeSpace],
      selectedSpaceId: "archived-space",
      storedSpaceId: null,
    })).toBe("archived-space");
  });

  it("still replaces a selected space that no longer exists at all", () => {
    expect(resolveBootstrapSpaceSelection({
      spaces: [activeSpace],
      sidebarSpaces: [activeSpace],
      selectedSpaceId: "deleted-space",
      storedSpaceId: null,
    })).toBe("space-1");
  });
});

describe("shouldClearStoredSpaceSelection", () => {
  it("does not clear the stored space selection during an unauthorized space list response", () => {
    expect(shouldClearStoredSpaceSelection({
      spaces: [],
      isLoading: false,
      unauthorized: true,
      errored: false,
    })).toBe(false);
  });

  it("clears the stored space selection when an authorized space list is empty", () => {
    expect(shouldClearStoredSpaceSelection({
      spaces: [],
      isLoading: false,
      unauthorized: false,
      errored: false,
    })).toBe(true);
  });

  it("does not clear the stored space selection when the request failed", () => {
    // `spacesListQueryOptions` sets `retry: false`, and a failure before any
    // success leaves `data` undefined — which the provider defaults to an empty
    // list. That is indistinguishable from "asked, and owns nothing", so
    // without this a single failed request on a cold load would drop the
    // customer's stored space.
    expect(shouldClearStoredSpaceSelection({
      spaces: [],
      isLoading: false,
      unauthorized: false,
      errored: true,
    })).toBe(false);
  });
});

describe("SpaceProvider", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    captured = null;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    mockAuthApi.getSession.mockResolvedValue(null);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  it("seeds navigation from the session and preserves ordinary space invalidation", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
    mockAuthApi.getSession.mockResolvedValue({ ...sessionFor("one"), operatorBootstrap: {
      userId: "one", spaces: [makeSpace("bootstrap-space")],
      operatorAccess: { userId: "one", isInstanceAdmin: false, spaceIds: ["bootstrap-space"] },
    } });
    await act(() => root.render(<QueryClientProvider client={queryClient}><SpaceProvider>
      <Probe onSelectedSpaceId={() => {}} />
    </SpaceProvider></QueryClientProvider>));
    await vi.waitFor(() => expect(captured?.selectedSpaceId).toBe("bootstrap-space"));
    expect(mockSpacesApi.list).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(queryKeys.spaces.list("one"))).toMatchObject({ spaces: [{ id: "bootstrap-space" }] });
    mockSpacesApi.list.mockResolvedValue([makeSpace("fresh-space")]);
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all }));
    await vi.waitFor(() => expect(captured?.selectedSpaceId).toBe("fresh-space"));
    expect(mockSpacesApi.list).toHaveBeenCalledOnce();
  });

  it("never exposes the previous account's selection while a new bootstrap is ready", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
    const boot = (userId: string) => ({ ...sessionFor(userId), operatorBootstrap: {
      userId, spaces: [makeSpace(`space-${userId}`)],
      operatorAccess: { userId, isInstanceAdmin: false, spaceIds: [`space-${userId}`] },
    } });
    mockAuthApi.getSession.mockResolvedValue(boot("one"));
    const snapshots: Array<{ selected: string | null; space: string | undefined }> = [];
    function AccountProbe() {
      const current = useSpace();
      snapshots.push({ selected: current.selectedSpaceId, space: current.spaces[0]?.id });
      return null;
    }
    await act(() => root.render(<QueryClientProvider client={queryClient}><SpaceProvider><AccountProbe /></SpaceProvider></QueryClientProvider>));
    await vi.waitFor(() => expect(snapshots.at(-1)?.selected).toBe("space-one"));
    await act(() => { queryClient.setQueryData(queryKeys.auth.session, boot("two")); });
    await vi.waitFor(() => expect(snapshots.at(-1)?.selected).toBe("space-two"));
    expect(snapshots.filter(value => value.space === "space-two").some(value => value.selected === "space-one")).toBe(false);
    expect(mockSpacesApi.list).not.toHaveBeenCalled();
  });

  it("replaces a returning account's cached spaces with its revoked session snapshot once", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
    const boot = (userId: string, ids: string[]) => ({ ...sessionFor(userId), operatorBootstrap: {
      userId, spaces: ids.map(makeSpace),
      operatorAccess: { userId, isInstanceAdmin: false, spaceIds: ids },
    } });
    const seen: Array<{ selected: string | null; spaces: string[] }> = [];
    function AccountProbe() {
      const current = useSpace();
      seen.push({ selected: current.selectedSpaceId, spaces: current.spaces.map(space => space.id) });
      return null;
    }
    mockAuthApi.getSession.mockResolvedValue(boot("one", ["revoked-space"]));
    await act(() => root.render(<QueryClientProvider client={queryClient}><SpaceProvider><AccountProbe /></SpaceProvider></QueryClientProvider>));
    await vi.waitFor(() => expect(seen.at(-1)?.selected).toBe("revoked-space"));
    await act(() => { queryClient.setQueryData(queryKeys.auth.session, boot("two", ["space-two"])); });
    await vi.waitFor(() => expect(seen.at(-1)?.selected).toBe("space-two"));
    const returningAt = seen.length;
    await act(() => { queryClient.setQueryData(queryKeys.auth.session, boot("one", [])); });
    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ selected: null, spaces: [] }));
    expect(seen.slice(returningAt).some(value => value.spaces.includes("revoked-space"))).toBe(false);
    expect(queryClient.getQueryData(queryKeys.spaces.list("one"))).toEqual({ spaces: [], unauthorized: false });
    expect(mockSpacesApi.list).not.toHaveBeenCalled();

    // The session seed must not overwrite a later authoritative read.
    mockSpacesApi.list.mockResolvedValue([makeSpace("new-membership")]);
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all }));
    await vi.waitFor(() => expect(seen.at(-1)?.selected).toBe("new-membership"));
    expect(mockSpacesApi.list).toHaveBeenCalledOnce();
  });

  it("reseeds a collected bootstrap query and restores ordinary reads after remount", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: 0 } });
    const bootstrap = {
      userId: "one", spaces: [makeSpace("bootstrap-space")],
      operatorAccess: { userId: "one", isInstanceAdmin: false, spaceIds: ["bootstrap-space"] },
    };
    mockAuthApi.getSession.mockResolvedValue({ ...sessionFor("one"), operatorBootstrap: bootstrap });
    const render = (mounted: boolean) => root.render(<QueryClientProvider client={queryClient}>
      {mounted ? <SpaceProvider><Probe onSelectedSpaceId={() => {}} /></SpaceProvider> : null}
    </QueryClientProvider>);
    await act(() => render(true));
    await vi.waitFor(() => expect(captured?.selectedSpaceId).toBe("bootstrap-space"));
    expect(mockSpacesApi.list).not.toHaveBeenCalled();
    await act(() => render(false));
    await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.spaces.list("one"))).toBeUndefined());
    captured = null;
    await act(() => render(true));
    await vi.waitFor(() => expect(captured?.selectedSpaceId).toBe("bootstrap-space"));

    mockSpacesApi.list.mockResolvedValue([makeSpace("ordinary-reader-space")]);
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all }));
    await vi.waitFor(() => expect(mockSpacesApi.list).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(captured?.selectedSpaceId).toBe("ordinary-reader-space"));
    expect(queryClient.getQueryData(queryKeys.spaces.list("one"))).toMatchObject({ spaces: [{ id: "ordinary-reader-space" }] });
  });

  it("publishes the URL space without first exposing the remembered space", async () => {
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", "/TWO/issues");
    localStorage.setItem("outpost.selectedSpaceId", "space-1");
    queryClient.setQueryData(queryKeys.auth.session, null);
    queryClient.setQueryData(queryKeys.spaces.list(null), {
      spaces: [{ ...makeSpace("space-1"), issuePrefix: "ONE" }, { ...makeSpace("space-2"), issuePrefix: "TWO" }],
      unauthorized: false,
    });
    mockSpacesApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];
    try {
      await act(async () => root.render(<QueryClientProvider client={queryClient}><SpaceProvider>
        <Probe onSelectedSpaceId={id => seen.push(id)} />
      </SpaceProvider></QueryClientProvider>));
      expect(seen.filter(Boolean)).toEqual(["space-2"]);
      expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-2");
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  it("keeps the stored space when the space request fails", async () => {
    // The seam the predicate test above cannot reach: the provider defaults a
    // failed request to an empty list, so the effect has to be told the
    // request errored or it reads that as "asked, and owns nothing" and clears
    // the customer's stored space.
    localStorage.setItem("outpost.selectedSpaceId", "space-a");
    mockSpacesApi.list.mockRejectedValue(new Error("spaces unavailable"));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SpaceProvider>
            <Probe onSelectedSpaceId={() => {}} />
          </SpaceProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-a");
  });

  it("does not expose a stale stored space id before spaces load", async () => {
    localStorage.setItem("outpost.selectedSpaceId", "stale-space");
    mockSpacesApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SpaceProvider>
            <Probe onSelectedSpaceId={(spaceId) => seen.push(spaceId)} />
          </SpaceProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null]);
  });

  it("replaces a stale stored space id with the first loaded space", async () => {
    localStorage.setItem("outpost.selectedSpaceId", "stale-space");
    // Signed out, and *known* to be: the list is keyed by account, so it cannot
    // resolve before the session does. Seeding the answer is how this test says
    // the account lookup has already happened.
    queryClient.setQueryData(queryKeys.auth.session, null);
    queryClient.setQueryData(queryKeys.spaces.list(null), {
      spaces: [makeSpace("space-1")],
      unauthorized: false,
    });
    mockSpacesApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SpaceProvider>
            <Probe onSelectedSpaceId={(spaceId) => seen.push(spaceId)} />
          </SpaceProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null, "space-1"]);
    expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-1");
  });

  // The `["spaces"]` cache entry is shared app-wide and carries no account
  // identity, so it survives a change of account in this tab. Cached data is
  // served whether or not it is stale, so freshness cannot stand in for
  // "belongs to the account signed in now".
  describe("when the account changes in this tab", () => {
    async function bootWithFirstAccount(seen: Array<string | null>) {
      mockAuthApi.getSession.mockResolvedValue(sessionFor("user-1"));
      queryClient.setQueryData(queryKeys.spaces.list("user-1"), {
        spaces: [makeSpace("space-1")],
        unauthorized: false,
      });
      mockSpacesApi.list.mockImplementation(() => new Promise(() => {}));

      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <SpaceProvider>
              <Probe onSelectedSpaceId={(spaceId) => seen.push(spaceId)} />
            </SpaceProvider>
          </QueryClientProvider>,
        );
      });
      await flushReact();

      expect(seen).toEqual([null, "space-1"]);
      expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-1");
    }

    it("drops the previous account's selection and re-reads the list", async () => {
      const seen: Array<string | null> = [];
      await bootWithFirstAccount(seen);

      let resolveSecondList: ((spaces: Space[]) => void) | null = null;
      mockSpacesApi.list.mockImplementation(
        () =>
          new Promise<Space[]>((resolve) => {
            resolveSecondList = resolve;
          }),
      );

      await act(async () => {
        queryClient.setQueryData(queryKeys.auth.session, sessionFor("user-2"));
      });
      await flushReact();

      // Nothing from the previous account is exposed while the new list loads.
      expect(seen).toEqual([null, "space-1", null]);
      expect(queryClient.getQueryData(queryKeys.spaces.list("user-2"))).toBeUndefined();
      // The previous account's entry may still sit in the cache; keying by
      // account is what makes that harmless, since nothing reads it now.
      expect(queryClient.getQueryData(queryKeys.spaces.list("user-1"))).toMatchObject({
        spaces: [{ id: "space-1" }],
      });
      expect(resolveSecondList).not.toBeNull();
      // The replacement fetch must not be coalesced into a `/spaces` request
      // issued under the previous session.
      expect(mockSpacesApi.detachInflightList).toHaveBeenCalled();

      await act(async () => {
        resolveSecondList?.([makeSpace("space-2")]);
        await Promise.resolve();
      });
      await flushReact();

      expect(seen).toEqual([null, "space-1", null, "space-2"]);
      expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-2");
    });

    // The replacement fetch is the only thing standing between the account
    // change and a usable app: the cache entry has already been removed, so a
    // failure here leaves the tab with no list and no selection. It must not
    // also leave it with no way out.
    it("recovers the list when the replacement fetch fails and is retried", async () => {
      const seen: Array<string | null> = [];
      await bootWithFirstAccount(seen);

      mockSpacesApi.list.mockRejectedValue(new Error("network down"));

      await act(async () => {
        queryClient.setQueryData(queryKeys.auth.session, sessionFor("user-2"));
      });
      await flushReact();
      // Past the bounded retries, so the failure has actually settled.
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      });
      await flushReact();

      // The previous account's space is gone and nothing took its place.
      expect(seen).toEqual([null, "space-1", null]);
      // Reported as unavailable, not as an account that owns nothing. Without
      // this the switcher renders "No spaces", which is a false claim.
      expect(captured?.spaceListUnavailable).toBe(true);
      expect(captured?.spaces).toEqual([]);

      // The recovery path actually recovers.
      mockSpacesApi.list.mockResolvedValue([makeSpace("space-2")]);
      await act(async () => {
        await captured?.retrySpaces();
      });
      await flushReact();

      expect(captured?.spaceListUnavailable).toBe(false);
      expect(seen).toEqual([null, "space-1", null, "space-2"]);
      expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-2");
    });

    // A transient blip must not need the customer to notice and click anything.
    // Nothing configures a retry — the second attempt is the observer's own,
    // issued when it rebinds to a fresh query after the removal above. This
    // pins that, so the recovery affordance stays reserved for real outages
    // rather than becoming the only way back from a one-off blip.
    it("rides out a single failed replacement request without help", async () => {
      const seen: Array<string | null> = [];
      await bootWithFirstAccount(seen);

      mockSpacesApi.list
        .mockRejectedValueOnce(new Error("blip"))
        .mockResolvedValue([makeSpace("space-2")]);

      await act(async () => {
        queryClient.setQueryData(queryKeys.auth.session, sessionFor("user-2"));
      });
      await flushReact();
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      });
      await flushReact();

      expect(captured?.spaceListUnavailable).toBe(false);
      expect(seen).toEqual([null, "space-1", null, "space-2"]);
    });

    // The failure flag must not outlive the failure. A later success — a focus
    // refetch, an invalidation from anywhere — settles the question, including
    // when the honest answer is an empty list. Otherwise an account that owns
    // nothing reads as "couldn't load", behind a retry that cannot change it.
    it("stops reporting the list as unavailable once any fetch succeeds", async () => {
      const seen: Array<string | null> = [];
      await bootWithFirstAccount(seen);

      mockSpacesApi.list.mockRejectedValue(new Error("network down"));
      await act(async () => {
        queryClient.setQueryData(queryKeys.auth.session, sessionFor("user-2"));
      });
      await flushReact();
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      });
      await flushReact();

      expect(captured?.spaceListUnavailable).toBe(true);

      // This account genuinely owns no spaces, and the request says so.
      mockSpacesApi.list.mockResolvedValue([]);
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: queryKeys.spaces.list("user-2") });
      });
      await flushReact();

      expect(captured?.spaces).toEqual([]);
      expect(captured?.spaceListUnavailable).toBe(false);
    });

    // The guarantee the account-keyed entry buys, stated directly: a list sitting
    // in the cache for another account is not merely distrusted, it is not
    // reachable. No gate, no freshness check, no refetch stands between the two —
    // they are different entries.
    it("cannot read another account's cached list at all", async () => {
      const seen: Array<string | null> = [];
      await bootWithFirstAccount(seen);

      // user-2's list is slow. If the entries were shared, the cached user-1
      // list would answer in the meantime — which is the whole bug.
      mockSpacesApi.list.mockImplementation(() => new Promise(() => {}));

      await act(async () => {
        queryClient.setQueryData(queryKeys.auth.session, sessionFor("user-2"));
      });
      await flushReact();

      expect(captured?.spaces).toEqual([]);
      expect(captured?.selectedSpaceId).toBeNull();
      expect(captured?.loading).toBe(true);
      // Still cached, still keyed to whom it belongs, still unread.
      expect(queryClient.getQueryData(queryKeys.spaces.list("user-1"))).toMatchObject({
        spaces: [{ id: "space-1" }],
      });
    });

    // A session request that failed answers nothing. Keying the list to
    // `anonymous` on that basis would write an authenticated response — the
    // request still carries the cookie — into the entry every signed-out reader
    // trusts, which is the original bug rebuilt for anonymous.
    //
    // Cold cache on purpose: after a prior success React Query retains the old
    // session `data` through a failed refetch, so the identity survives anyway
    // and the bug does not show. It needs a session that never answered.
    it("does not treat a never-answered session as a signed-out session", async () => {
      mockAuthApi.getSession.mockRejectedValue(new Error("network down"));
      localStorage.setItem("outpost.selectedSpaceId", "space-1");
      mockSpacesApi.list.mockResolvedValue([makeSpace("space-1")]);

      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <SpaceProvider>
              <Probe onSelectedSpaceId={() => undefined} />
            </SpaceProvider>
          </QueryClientProvider>,
        );
      });
      await flushReact();
      await flushReact();

      // Nothing asked for a list it could not attribute, and nothing landed in
      // the anonymous entry.
      expect(mockSpacesApi.list).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(queryKeys.spaces.list(null))).toBeUndefined();
      // And the stored space survives: unavailable is not "owns nothing".
      expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-1");
    });

    it("leaves the selection alone when the same account is observed again", async () => {
      const seen: Array<string | null> = [];
      await bootWithFirstAccount(seen);
      const listCallsAfterBoot = mockSpacesApi.list.mock.calls.length;

      // A session refetch returns an equal-but-new object for the same account.
      await act(async () => {
        queryClient.setQueryData(queryKeys.auth.session, sessionFor("user-1"));
      });
      await flushReact();

      expect(seen).toEqual([null, "space-1"]);
      expect(localStorage.getItem("outpost.selectedSpaceId")).toBe("space-1");
      expect(mockSpacesApi.list.mock.calls.length).toBe(listCallsAfterBoot);
    });
  });
});
