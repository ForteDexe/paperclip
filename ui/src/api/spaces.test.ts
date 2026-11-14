import { afterEach, expect, it, vi } from "vitest";
import { spacesApi } from "./spaces";

afterEach(() => vi.unstubAllGlobals());

it("keeps directory requests separate from navigation and previous accounts", async () => {
  let resolveOldDirectory!: (response: Response) => void;
  const oldDirectory = new Promise<Response>((resolve) => { resolveOldDirectory = resolve; });
  const fetchMock = vi.fn()
    .mockReturnValueOnce(oldDirectory)
    .mockResolvedValueOnce(Response.json([{ id: "member-space" }]))
    .mockResolvedValueOnce(Response.json([{ id: "directory-space" }]));
  vi.stubGlobal("fetch", fetchMock);
  const previousAccount = spacesApi.directory();
  const navigation = spacesApi.list();
  spacesApi.detachInflightDirectory();
  const currentDirectory = spacesApi.directory();
  try {
    await expect(navigation).resolves.toEqual([{ id: "member-space" }]);
    await expect(currentDirectory).resolves.toEqual([{ id: "directory-space" }]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/spaces", "/api/spaces?scope=accessible", "/api/spaces",
    ]);
  } finally {
    resolveOldDirectory(Response.json([]));
    await previousAccount;
  }
});

it("requests navigable spaces and detaches the same request when accounts change", async () => {
  let resolveOldRequest!: (response: Response) => void;
  const oldRequest = new Promise<Response>((resolve) => { resolveOldRequest = resolve; });
  const currentSpaces = [{ id: "current-space" }];
  const fetchMock = vi.fn()
    .mockReturnValueOnce(oldRequest)
    .mockResolvedValueOnce(Response.json(currentSpaces));
  vi.stubGlobal("fetch", fetchMock);

  const previousAccount = spacesApi.list();
  spacesApi.detachInflightList();
  const currentAccount = spacesApi.list();
  try {
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/spaces?scope=accessible",
      "/api/spaces?scope=accessible",
    ]);
    await expect(currentAccount).resolves.toEqual(currentSpaces);
  } finally {
    resolveOldRequest(Response.json([{ id: "previous-space" }]));
    await previousAccount;
  }
});
