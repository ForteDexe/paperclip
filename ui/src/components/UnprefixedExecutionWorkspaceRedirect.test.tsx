// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { ConnectivityProvider, createConnectivityStore, type ConnectivityStore } from "@/lib/connectivity";
import {
  ExecutionWorkspaceSpaceGate,
  UnprefixedExecutionWorkspaceRedirect,
} from "./UnprefixedExecutionWorkspaceRedirect";

const mockExecutionWorkspacesApi = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/execution-workspaces", () => ({
  executionWorkspacesApi: mockExecutionWorkspacesApi,
}));

const PAP = { id: "space-pap", name: "Outpost", issuePrefix: "PAP", status: "active" };
const FOR = { id: "space-for", name: "Forgotten Runes", issuePrefix: "FOR", status: "active" };
vi.mock("@/context/SpaceContext", () => ({
  useSpace: () => ({
    spaces: [PAP, FOR],
    selectedSpaceId: FOR.id,
    selectedSpace: FOR,
    loading: false,
  }),
}));

vi.mock("../pages/NotFound", () => ({
  NotFoundPage: () => <div>NOT_FOUND</div>,
}));

function Destination() {
  const location = useLocation();
  return <div>{`DESTINATION@${location.pathname}${location.search}${location.hash}`}</div>;
}

describe("UnprefixedExecutionWorkspaceRedirect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(path: string, options: { store?: ConnectivityStore } = {}) {
    root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="execution-workspaces/:workspaceId/issues" element={<UnprefixedExecutionWorkspaceRedirect />} />
            <Route path=":spacePrefix/execution-workspaces/:workspaceId/issues" element={<Destination />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    flushSync(() => {
      root.render(options.store ? <ConnectivityProvider store={options.store}>{tree}</ConnectivityProvider> : tree);
    });
  }

  function renderGate(path: string) {
    root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path=":spacePrefix" element={<ExecutionWorkspaceSpaceGate />}>
                <Route path="execution-workspaces/:workspaceId/issues" element={<Destination />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  it("uses the workspace owner instead of the selected space after login", async () => {
    mockExecutionWorkspacesApi.get.mockResolvedValue({ id: "workspace-1", spaceId: PAP.id });
    render("/execution-workspaces/workspace-1/issues?tab=open#latest");

    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "DESTINATION@/PAP/execution-workspaces/workspace-1/issues?tab=open#latest",
      );
    });
    expect(container.textContent).not.toContain("/FOR/execution-workspaces");
  });

  it("shows not found when the workspace does not exist", async () => {
    mockExecutionWorkspacesApi.get.mockRejectedValue(new ApiError("Execution workspace not found", 404, { error: "not_found" }));
    render("/execution-workspaces/missing/issues");

    await vi.waitFor(() => expect(container.textContent).toContain("NOT_FOUND"));
    expect(container.textContent).not.toContain("DESTINATION@");
  });

  it("keeps loading instead of showing not found during an outage", async () => {
    mockExecutionWorkspacesApi.get.mockRejectedValue(
      new ApiError("tenant_app_unavailable", 503, { error: "tenant_app_unavailable" }),
    );
    // The app-wide store is waiting out the outage, so the probe loop will refetch on recovery.
    const store = createConnectivityStore({ browserOnline: false });
    render("/execution-workspaces/workspace-1/issues", { store });

    await vi.waitFor(() => expect(mockExecutionWorkspacesApi.get).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).not.toContain("NOT_FOUND");
    expect(container.textContent).not.toContain("DESTINATION@");
    expect(container.querySelector('[data-query-view="error"]')).toBeNull();
    store.dispose();
  });

  it("shows readable copy with a retry when the route keeps failing while the server is reachable", async () => {
    mockExecutionWorkspacesApi.get.mockRejectedValue(
      new ApiError("tenant_app_unavailable", 503, { error: "tenant_app_unavailable" }),
    );
    render("/execution-workspaces/workspace-1/issues");

    await vi.waitFor(() => expect(container.querySelector('[data-query-view="error"]')).not.toBeNull());
    expect(container.textContent).not.toContain("NOT_FOUND");
    expect(container.textContent).not.toContain("tenant_app_unavailable");
    expect(container.textContent).toContain("Retry");
  });

  it("shows readable copy with a retry for an unexpected failure", async () => {
    mockExecutionWorkspacesApi.get.mockRejectedValue(new ApiError("internal_error", 500, { error: "internal_error" }));
    render("/execution-workspaces/workspace-1/issues");

    await vi.waitFor(() => expect(container.querySelector('[data-query-view="error"]')).not.toBeNull());
    expect(container.textContent).not.toContain("NOT_FOUND");
    expect(container.textContent).not.toContain("internal_error");
    expect(container.textContent).toContain("Retry");
  });

  it("rejects a prefixed route for a different space's workspace", async () => {
    mockExecutionWorkspacesApi.get.mockResolvedValue({ id: "workspace-1", spaceId: PAP.id });
    renderGate("/FOR/execution-workspaces/workspace-1/issues");

    await vi.waitFor(() => expect(container.textContent).toContain("NOT_FOUND"));
    expect(container.textContent).not.toContain("DESTINATION@");
  });
});
