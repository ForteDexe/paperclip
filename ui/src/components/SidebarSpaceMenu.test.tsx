// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { SidebarSpaceMenu } from "./SidebarSpaceMenu";
import { SidebarSpaceMenu as SidebarSpaceMenuProduction } from "./SidebarSpaceMenu.production";

vi.mock("./PluginOrganizationSwitcher", () => ({ PluginOrganizationSwitcher: ({ children }: { children: ReactNode }) => children }));

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signOut: vi.fn(),
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetSelectedSpaceId = vi.hoisted(() => vi.fn());
const mockSetSidebarOpen = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => ({ pathname: "/PAP/dashboard" }));
const mockSidebarPreferencesApi = vi.hoisted(() => ({
  getSpaceOrder: vi.fn(),
  updateSpaceOrder: vi.fn(),
}));
const mockNavigateTopLevel = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("@/lib/browserNavigation", () => ({
  navigateTopLevel: mockNavigateTopLevel,
}));

vi.mock("@/api/sidebarPreferences", () => ({
  sidebarPreferencesApi: mockSidebarPreferencesApi,
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

// Overridable so the list-unavailable branch can be exercised; null means "use
// the default three spaces below".
const mockSpaceState = vi.hoisted(() => ({
  spaces: null as unknown[] | null,
  spaceListUnavailable: false,
  retrySpaces: vi.fn(),
}));

vi.mock("@/context/SpaceContext", () => ({
  useSpace: () => ({
    spaceListUnavailable: mockSpaceState.spaceListUnavailable,
    retrySpaces: mockSpaceState.retrySpaces,
    spaces: mockSpaceState.spaces ?? [
      {
        id: "space-1",
        issuePrefix: "PAP",
        name: "Acme Labs",
        status: "active",
      },
      {
        id: "space-2",
        issuePrefix: "STR",
        name: "Strata",
        status: "active",
      },
      {
        id: "space-3",
        issuePrefix: "ANA",
        name: "Anachronist Wiki",
        status: "active",
      },
    ],
    selectedSpace: {
      id: "space-1",
      issuePrefix: "PAP",
      name: "Acme Labs",
      logoUrl: "/api/assets/logo-asset-1/content",
      status: "active",
    },
    setSelectedSpaceId: mockSetSelectedSpaceId,
  }),
}));

vi.mock("./SpacePatternIcon", () => ({
  SpacePatternIcon: ({ spaceName, logoUrl }: { spaceName: string; logoUrl?: string | null }) => (
    <span aria-hidden="true" data-logo-url={logoUrl ?? undefined}>{spaceName.slice(0, 1)}</span>
  ),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
    setSidebarOpen: mockSetSidebarOpen,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function act(callback: () => void) {
  flushSync(callback);
}

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

const CLOUD_HEALTH = {
  status: "ok" as const,
  cloud: {
    managed: true as const,
    managedBy: "outpost-cloud" as const,
    stackSlug: "acme-labs",
    cloudBaseUrl: "https://cloud.example.test",
  },
};

describe("SidebarSpaceMenu", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        name: "Jane Example",
        email: "jane@example.com",
      },
    });
    mockAuthApi.signOut.mockResolvedValue(undefined);
    mockSidebarPreferencesApi.getSpaceOrder.mockResolvedValue({
      orderedIds: ["space-1", "space-2", "space-3"],
      updatedAt: null,
    });
    mockSidebarPreferencesApi.updateSpaceOrder.mockResolvedValue({
      orderedIds: ["space-1", "space-2", "space-3"],
      updatedAt: null,
    });
    mockLocation.pathname = "/PAP/dashboard";
    mockSpaceState.spaces = null;
    mockSpaceState.spaceListUnavailable = false;
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function renderMenu(options: { cloud?: boolean; health?: unknown; production?: boolean } = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // CloudAccessGate owns the health fetch in the app; seeding the cache is how
    // useCloudInstance sees a cloud-managed instance under test.
    if (options.cloud || options.health) {
      queryClient.setQueryData(queryKeys.health, options.health ?? CLOUD_HEALTH);
    }
    const root = createRoot(container);
    const Menu = options.production ? SidebarSpaceMenuProduction : SidebarSpaceMenu;
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Menu />
        </QueryClientProvider>,
      );
    });
    return { root, queryClient };
  }

  async function openMenu(ariaLabel: string) {
    const trigger = container.querySelector(`button[aria-label="${ariaLabel}"]`);
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
  }

  // This menu is the one the app renders, so it is the only place a customer can
  // act on a failed space list. Saying "No spaces" there states something
  // about the account that a failed request cannot support, and leaves the tab
  // with no way back short of a browser reload.
  it("offers a way back when the space list could not be loaded", async () => {
    mockSpaceState.spaces = [];
    mockSpaceState.spaceListUnavailable = true;

    const { root } = renderMenu();
    await flushReact();
    await openMenu("Open Acme Labs space switcher");

    expect(document.body.textContent).toContain("Couldn't load spaces");
    expect(document.body.textContent).not.toContain("No spaces");

    const retryItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent?.includes("Try again"),
    );
    expect(retryItem).not.toBeUndefined();

    act(() => {
      retryItem?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      retryItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockSpaceState.retrySpaces).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("still reports an account that owns no spaces as empty, not broken", async () => {
    mockSpaceState.spaces = [];
    mockSpaceState.spaceListUnavailable = false;

    const { root } = renderMenu();
    await flushReact();
    await openMenu("Open Acme Labs space switcher");

    expect(document.body.textContent).toContain("No spaces");
    expect(document.body.textContent).not.toContain("Couldn't load spaces");

    act(() => {
      root.unmount();
    });
  });

  it("shows the requested space actions and signs out through the dropdown", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // The invite shortcut waits for the health response before it shows, so
    // resolve it here the way CloudAccessGate does in the app.
    queryClient.setQueryData(queryKeys.health, { status: "ok" });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSpaceMenu />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Acme Labs");

    const trigger = container.querySelector('button[aria-label="Open Acme Labs space switcher"]');
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Spaces");
    expect(document.body.textContent).toContain("Edit");
    expect(document.body.textContent).toContain("Strata");
    expect(document.body.textContent).toContain("ANA");
    expect(document.body.textContent).toContain("New Space");
    expect(document.body.textContent).not.toContain("Invite people");
    expect(document.body.textContent).not.toContain("Space settings");
    expect(document.body.textContent).toContain("Sign out");

    const signOutButton = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("Sign out"));
    expect(signOutButton).toBeTruthy();

    act(() => {
      signOutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockAuthApi.signOut).toHaveBeenCalledTimes(1);
    expect(mockNavigateTopLevel).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(queryKeys.health)?.isInvalidated).toBe(true);
    expect(document.body.textContent).not.toContain("Spaces");

    act(() => {
      root.unmount();
    });
  });

  it("shows the production-shell invite shortcut when no surface is hidden", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.health, { status: "ok" });
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSpaceMenuProduction />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    await openMenu("Open Acme Labs space switcher");

    expect(document.body.textContent).not.toContain("Invite people");

    act(() => {
      root.unmount();
    });
  });

  it("hides the production-shell invite shortcut when the operator hides the invites surface", async () => {
    // The production shell (streamlined UI disabled) must honor
    // OUTPOST_HIDDEN_SETTINGS like the streamlined menu — this is the knob
    // Outpost Cloud uses to drop the shortcut on its managed stacks.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.health, { status: "ok", hiddenSettings: ["space.invites"] });
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSpaceMenuProduction />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    await openMenu("Open Acme Labs space switcher");

    expect(document.body.textContent).toContain("Spaces");
    expect(document.body.textContent).not.toContain("Invite people");

    act(() => {
      root.unmount();
    });
  });

  it("keeps the invite shortcut out of the menu until hidden settings resolve", async () => {
    // No health data in the cache: the hidden-settings set is unknown, so the
    // shortcut must not flash in and then disappear once the response lands.
    const { root } = renderMenu();
    await flushReact();
    await flushReact();

    await openMenu("Open Acme Labs space switcher");

    expect(document.body.textContent).toContain("Spaces");
    expect(document.body.textContent).not.toContain("Invite people");

    act(() => {
      root.unmount();
    });
  });

  it("hides the invite shortcut when the operator hides the invites surface", async () => {
    const { root } = renderMenu({
      health: { status: "ok", hiddenSettings: ["space.invites"] },
    });
    await flushReact();
    await flushReact();

    await openMenu("Open Acme Labs space switcher");

    expect(document.body.textContent).toContain("Spaces");
    expect(document.body.textContent).not.toContain("Invite people");

    act(() => {
      root.unmount();
    });
  });

  it("hides the invite shortcut when the operator hides the members page", async () => {
    const { root } = renderMenu({
      health: { status: "ok", hiddenSettings: ["space.members"] },
    });
    await flushReact();
    await flushReact();

    await openMenu("Open Acme Labs space switcher");

    expect(document.body.textContent).toContain("Spaces");
    expect(document.body.textContent).not.toContain("Invite people");

    act(() => {
      root.unmount();
    });
  });

  it("toggles space order editing without selecting a space", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSpaceMenu />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const trigger = container.querySelector('button[aria-label="Open Acme Labs space switcher"]');
    expect(trigger).not.toBeNull();

    expect(trigger?.classList).toContain("px-4");
    expect(trigger?.classList).toContain("has-[>svg]:px-4");
    expect(trigger?.classList).toContain("hover:bg-sidebar-accent");
    expect(trigger?.classList).toContain("hover:text-sidebar-accent-foreground");
    expect(trigger?.classList).toContain("dark:hover:bg-sidebar-accent");
    expect(trigger?.classList).toContain("dark:hover:text-sidebar-accent-foreground");
    expect(trigger?.classList).not.toContain("hover:bg-background");
    expect(trigger?.classList).not.toContain("dark:hover:bg-background");
    expect(trigger?.classList).not.toContain("dark:hover:bg-accent/50");

    act(() => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("New Space");
    expect(document.body.textContent).not.toContain("Add space...");

    const editButton = Array.from(document.body.querySelectorAll("button"))
      .find((element) => element.textContent === "Edit");
    expect(editButton).toBeTruthy();

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Done");
    expect(document.body.textContent).not.toContain("PAP");
    expect(document.body.textContent).not.toContain("ANA");
    const reorderButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Reorder Strata"]',
    );
    expect(reorderButton).toBeTruthy();
    expect(reorderButton?.classList).toContain("size-8");

    const strataItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("Strata"));
    expect(strataItem).toBeTruthy();

    act(() => {
      strataItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockSetSelectedSpaceId).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("navigates to the selected space dashboard from space-prefixed routes", async () => {
    mockLocation.pathname = "/PAP/issues";
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSpaceMenu />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const trigger = container.querySelector('button[aria-label="Open Acme Labs space switcher"]');
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const strataItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("Strata"));
    expect(strataItem).toBeTruthy();

    act(() => {
      strataItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockSetSelectedSpaceId).toHaveBeenCalledWith("space-2");
    expect(mockNavigate).toHaveBeenCalledWith("/STR/dashboard");

    act(() => {
      root.unmount();
    });
  });

  it("links to the in-app Space creator and never leaves the app when self-hosted", async () => {
    const { root } = renderMenu();
    await flushReact();
    await flushReact();

    await openMenu("Open Acme Labs space switcher");

    const createItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("New Space"));
    expect(createItem).toBeTruthy();

    expect(createItem?.getAttribute("href")).toBe("/spaces?new=1");
    expect(mockNavigateTopLevel).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  // The trigger sits in a fixed 240px sidebar header beside two shrink-0
  // controls, so a long name may only truncate — never widen the row and push
  // the chevron, search, and collapse controls out of the panel. Truncation
  // needs `min-w-0` on EVERY flex link of the chain (a flex item's default
  // `min-width:auto` floors it at its content width), which is invisible to
  // behavioural assertions, so the class chain itself is the contract.
  it("lets a long workspace name truncate instead of widening the trigger", async () => {
    const { root } = renderMenu();
    await flushReact();

    const trigger = container.querySelector('button[aria-label="Open Acme Labs space switcher"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.className).toContain("min-w-0");

    const labelRow = trigger?.firstElementChild;
    expect(labelRow?.className).toContain("min-w-0");

    const label = labelRow?.lastElementChild;
    expect(label?.textContent).toBe("Acme Labs");
    expect(label?.className).toContain("min-w-0");
    expect(label?.className).toContain("truncate");
    // A truncated name stays recoverable on hover.
    expect(label?.getAttribute("title")).toBe("Acme Labs");

    act(() => {
      root.unmount();
    });
  });

  describe("in Outpost Cloud", () => {
    it("closes the menu and enters the Cloud logout flow without local sign-out", async () => {
      const { root } = renderMenu({ cloud: true });
      await flushReact();
      await flushReact();
      await openMenu("Open Acme Labs space switcher");

      const signOutItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
        .find((element) => element.textContent?.includes("Sign out"));
      expect(signOutItem).toBeTruthy();

      act(() => {
        signOutItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flushReact();

      expect(mockAuthApi.signOut).not.toHaveBeenCalled();
      expect(mockNavigateTopLevel).toHaveBeenCalledOnce();
      expect(mockNavigateTopLevel).toHaveBeenCalledWith("/cloud/logout");
      expect(document.body.textContent).not.toContain("Spaces");

      act(() => {
        root.unmount();
      });
    });

    it.each([false, true])("keeps space navigation and creation available on managed hosts (production=%s)", async (production) => {
      const { root } = renderMenu({ cloud: true, production });
      await flushReact();
      await flushReact();
      await openMenu("Open Acme Labs space switcher");
      expect(document.body.textContent).toContain("Anachronist Wiki");
      expect(document.body.textContent).toContain("ANA");
      expect(document.body.textContent).toContain("New Space");
      const row = [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')]
        .find(element => element.textContent?.includes("Anachronist Wiki"));
      act(() => row?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(mockSetSelectedSpaceId).toHaveBeenCalledWith("space-3");
      expect(mockNavigate).toHaveBeenCalledWith("/ANA/dashboard");
      expect(mockNavigateTopLevel).not.toHaveBeenCalled();
      act(() => root.unmount());
    });
  });
});
