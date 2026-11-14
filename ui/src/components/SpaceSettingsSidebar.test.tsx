// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { SpaceSettingsSidebar } from "./SpaceSettingsSidebar";
import { SpaceSettingsSidebar as ProductionSpaceSettingsSidebar } from "./SpaceSettingsSidebar.production";
import { primarySidebarStyles } from "./primary-sidebar-styles";

const sidebarNavItemMock = vi.hoisted(() => vi.fn());
const mockPluginsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));
const mockUsePluginSlots = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    to,
    onClick,
  }: {
    children: React.ReactNode;
    to: string;
    onClick?: () => void;
  }) => (
    <button type="button" data-to={to} onClick={onClick}>
      {children}
    </button>
  ),
  NavLink: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
  }) => <a href={to}>{children}</a>,
}));

vi.mock("@/context/SpaceContext", () => ({
  useSpace: () => ({
    selectedSpaceId: "space-1",
    selectedSpace: { id: "space-1", issuePrefix: "PAP", name: "Outpost" },
  }),
}));

vi.mock("@/context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
    setSidebarOpen: vi.fn(),
  }),
}));

vi.mock("./SidebarNavItem", () => ({
  SidebarNavExpandedProvider: ({ children }: { children: React.ReactNode }) => children,
  SidebarNavItem: (props: {
    to: string;
    label: string;
    end?: boolean;
    badge?: number;
  }) => {
    sidebarNavItemMock(props);
    return <div>{props.label}</div>;
  },
}));

vi.mock("./SidebarNavItem.production", () => ({
  SidebarNavItem: ({ label, to }: { label: string; to: string }) => <a href={to}>{label}</a>,
}));

vi.mock("./SidebarSpaceMenu", () => ({
  SidebarSpaceMenu: () => <div>Workspace switcher</div>,
}));

vi.mock("@/api/plugins", () => ({
  pluginsApi: mockPluginsApi,
}));

vi.mock("@/plugins/slots", () => ({
  usePluginSlots: mockUsePluginSlots,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  await callback();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function flushReact() {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

describe("SpaceSettingsSidebar", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockPluginsApi.list.mockResolvedValue([]);
    mockUsePluginSlots.mockReturnValue({
      slots: [],
      isLoading: false,
      errorMessage: null,
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders a primary-style settings takeover with a back-to-app link", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SpaceSettingsSidebar />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(container.textContent).not.toContain("Outpost");
    expect(container.textContent).not.toContain("Settings");
    expect(container.querySelector('[aria-label="Back from Settings"]')).toBeNull();
    const settingsSurface = container.querySelector('[data-contextual-sidebar="settings"]');
    expect(settingsSurface?.classList).toContain("primary-sidebar-surface");
    expect(container.querySelector('[data-slot="contextual-sidebar-nav"]')?.className).toBe(
      primarySidebarStyles.nav,
    );
    const settingsHeader = container.querySelector('[data-slot="settings-sidebar-header"]');
    expect(settingsHeader?.classList).toContain("h-(--sz-60px)");
    expect(settingsHeader?.classList).toContain("items-center");
    expect(settingsHeader?.textContent).toContain("Back to app");
    const backGroup = container.querySelector('[data-slot="settings-back-group"]');
    expect(backGroup?.classList).toContain("w-full");
    for (const className of primarySidebarStyles.group.split(" ")) {
      expect(backGroup?.classList).toContain(className);
    }
    expect(container.querySelector('[data-slot="contextual-sidebar-group"]')?.className).toBe(
      primarySidebarStyles.group,
    );
    expect(container.textContent).toContain("Back to app");
    expect(container.querySelector('nav[aria-label="Settings"]')?.textContent).not.toContain(
      "Back to app",
    );
    expect(container.textContent).not.toContain("Space Settings");
    expect(container.textContent).not.toContain("Instance Settings");
    expect(container.textContent).toContain("General");
    expect(container.textContent).not.toContain("Connections");
    expect(container.textContent).not.toContain("Environments");
    expect(container.textContent).not.toContain("Export");
    expect(container.textContent).not.toContain("Import");
    expect(container.textContent).not.toContain("Members");
    expect(container.textContent).not.toContain("Secrets");
    expect(container.textContent).not.toContain("Access");
    expect(container.textContent).not.toContain("Profile");
    expect(container.textContent).not.toContain("Tools & Access");
    expect(sidebarNavItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/dashboard",
        label: "Back to app",
      }),
    );
    expect(sidebarNavItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/space/settings",
        label: "General",
        end: true,
      }),
    );
    expect(sidebarNavItemMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "/space/export" }),
    );
    expect(sidebarNavItemMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "/space/import" }),
    );
    expect(sidebarNavItemMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/space/settings/instance/environments",
        label: "Environments",
      }),
    );
    expect(sidebarNavItemMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/space/settings/secrets",
        label: "Secrets",
      }),
    );
    expect(new Set(
      sidebarNavItemMock.mock.calls
        .filter(([props]) => props.label === "General")
        .map(([props]) => props.to),
    )).toEqual(new Set(["/space/settings"]));
    expect(sidebarNavItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/space/settings/instance/plugins",
        label: "Plugins",
      }),
    );
    expect(sidebarNavItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/space/settings/instance/adapters",
        label: "Adapters",
      }),
    );
    expect(sidebarNavItemMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/space/settings/tools",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps Connections out of the production sidebar", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={queryClient}><ProductionSpaceSettingsSidebar /></QueryClientProvider>));
    await flushReact();
    expect(container.querySelector('a[href="/space/settings/connections"]')).toBeNull();
    expect(queryClient.getQueryCache().getAll().some(query => String(query.queryKey[0]).includes("experimental"))).toBe(false);
    await act(async () => root.unmount());
  });

  it("renders space settings pages contributed by ready plugins", async () => {
    mockUsePluginSlots.mockReturnValue({
      slots: [
        {
          type: "spaceSettingsPage",
          id: "permissions",
          displayName: "Permissions",
          exportName: "PermissionsPage",
          routePath: "permissions",
          pluginId: "plugin-1",
          pluginKey: "permissions-extension",
          pluginDisplayName: "Permissions Extension",
          pluginVersion: "0.1.0",
        },
      ],
      isLoading: false,
      errorMessage: null,
    });
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SpaceSettingsSidebar />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(container.textContent).toContain("Permissions");
    expect(sidebarNavItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/space/settings/permissions",
        label: "Permissions",
        end: true,
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("renders instance plugin links while filtering sandbox-provider-only plugins", async () => {
    mockPluginsApi.list.mockResolvedValue([
      {
        id: "linear",
        packageName: "@example/linear",
        manifestJson: {
          displayName: "Linear",
          environmentDrivers: [],
        },
      },
      {
        id: "sandbox-only",
        packageName: "@example/sandbox",
        manifestJson: {
          displayName: "Sandbox only",
          environmentDrivers: [{ kind: "sandbox_provider", driverKey: "e2b" }],
        },
      },
      {
        id: "hybrid",
        packageName: "@example/hybrid",
        manifestJson: {
          displayName: "Hybrid",
          environmentDrivers: [
            { kind: "sandbox_provider", driverKey: "e2b" },
            { kind: "environment_driver", driverKey: "ssh" },
          ],
        },
      },
    ]);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SpaceSettingsSidebar />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const pluginLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href^="/space/settings/instance/plugins/"]'),
    );
    expect(pluginLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/space/settings/instance/plugins/linear",
      "/space/settings/instance/plugins/hybrid",
    ]);
    expect(container.textContent).toContain("Linear");
    expect(container.textContent).toContain("Hybrid");
    expect(container.textContent).not.toContain("Sandbox only");

    await act(async () => {
      root.unmount();
    });
  });
});

describe("SpaceSettingsSidebar operator-hidden entries", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockPluginsApi.list.mockResolvedValue([]);
    mockUsePluginSlots.mockReturnValue({ slots: [], isLoading: false, errorMessage: null });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderSidebar(hiddenSettings?: string[], cloud?: { managed: boolean }) {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.health, {
      status: "ok",
      ...(hiddenSettings ? { hiddenSettings } : {}),
      ...(cloud ? { cloud } : {}),
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SpaceSettingsSidebar />
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  it("skips operator-hidden pages and their queries", async () => {
    await renderSidebar(["instance.plugins"]);

    expect(container.textContent).not.toContain("Plugins");
    expect(container.textContent).toContain("General");
    expect(container.textContent).toContain("Adapters");
    expect(container.textContent).not.toContain("Access");
    expect(mockPluginsApi.list).not.toHaveBeenCalled();
  });

  it("keeps every entry when nothing is hidden", async () => {
    await renderSidebar();

    expect(container.textContent).not.toContain("Access");
    expect(container.textContent).toContain("Plugins");
    expect(container.textContent).toContain("Adapters");
    expect(container.textContent).not.toContain("Import");
    expect(mockPluginsApi.list).toHaveBeenCalled();
  });

  it("keeps retired portability controls hidden on a Cloud-managed instance", async () => {
    await renderSidebar(undefined, { managed: true });

    expect(container.textContent).not.toContain("Import");
    expect(container.textContent).not.toContain("Export");
  });

  it("hides operator-hidden space pages", async () => {
    await renderSidebar([
      "space.members",
      "space.invites",
      "space.secrets",
      "space.export",
      "space.import",
    ]);

    expect(container.textContent).toContain("General");
    expect(container.textContent).not.toContain("Members");
    expect(container.textContent).not.toContain("Invites");
    expect(container.textContent).not.toContain("Secrets");
    expect(container.textContent).not.toContain("Export");
    expect(container.textContent).not.toContain("Import");
  });
});
