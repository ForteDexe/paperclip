// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { SpaceSettingsNav, getSpaceSettingsTab } from "./SpaceSettingsNav";

let currentPathname = "/space/settings";
const navigateMock = vi.hoisted(() => vi.fn());
const pageTabBarMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: currentPathname, search: "", hash: "" }),
  useNavigate: () => navigateMock,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div data-testid="tabs-root">{children}</div>,
}));

vi.mock("@/components/PageTabBar", () => ({
  PageTabBar: (props: {
    items: Array<{ value: string; label: string }>;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => {
    pageTabBarMock(props);

    return (
      <div>
        <div data-testid="active-tab">{props.value}</div>
        <button type="button" onClick={() => props.onValueChange?.("instance-experimental")}>
          switch-tab
        </button>
      </div>
    );
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

describe("SpaceSettingsNav", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    currentPathname = "/space/settings";
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("maps space settings routes to the expected shared tab value", () => {
    expect(getSpaceSettingsTab("/space/settings")).toBe("general");
    expect(getSpaceSettingsTab("/PAP/space/settings")).toBe("general");
    expect(getSpaceSettingsTab("/PAP/space/settings/connections")).toBe("general");
    expect(getSpaceSettingsTab("/space/settings/environments")).toBe("general");
    expect(getSpaceSettingsTab("/space/export")).toBe("export");
    expect(getSpaceSettingsTab("/PAP/space/export")).toBe("export");
    expect(getSpaceSettingsTab("/space/import")).toBe("import");
    expect(getSpaceSettingsTab("/PAP/space/import")).toBe("import");
    expect(getSpaceSettingsTab("/space/settings/members")).toBe("general");
    expect(getSpaceSettingsTab("/space/settings/access")).toBe("general");
    expect(getSpaceSettingsTab("/space/settings/invites")).toBe("general");
    expect(getSpaceSettingsTab("/PAP/space/settings/secrets")).toBe("general");
    expect(getSpaceSettingsTab("/space/settings/instance/profile")).toBe("general");
    expect(getSpaceSettingsTab("/PAP/space/settings/instance/general")).toBe("general");
    expect(getSpaceSettingsTab("/space/settings/instance/environments")).toBe("general");
    expect(getSpaceSettingsTab("/space/settings/instance/access")).toBe("general");
    expect(getSpaceSettingsTab("/space/settings/instance/experimental")).toBe("instance-experimental");
    expect(getSpaceSettingsTab("/PAP/space/settings/instance/plugins/example")).toBe("instance-plugins");
    expect(getSpaceSettingsTab("/space/settings/instance/adapters")).toBe("instance-adapters");
  });

  function renderNav(
    root: ReturnType<typeof createRoot>,
    hiddenSettings?: string[],
    cloud?: { managed: boolean },
  ) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.health, {
      status: "ok",
      ...(hiddenSettings ? { hiddenSettings } : {}),
      ...(cloud ? { cloud } : {}),
    });
    root.render(
      <QueryClientProvider client={queryClient}>
        <SpaceSettingsNav />
      </QueryClientProvider>,
    );
  }

  it("renders the active tab and navigates when a different tab is selected", async () => {
    currentPathname = "/PAP/space/settings";
    const root = createRoot(container);

    await act(async () => {
      renderNav(root);
    });

    expect(container.textContent).toContain("general");
    expect(pageTabBarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "general",
        items: [
          { value: "general", label: "General" },
          { value: "export", label: "Export" },
          { value: "import", label: "Import" },
          { value: "instance-experimental", label: "Experimental" },
          { value: "instance-plugins", label: "Plugins" },
          { value: "instance-adapters", label: "Adapters" },
        ],
      }),
    );

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigateMock).toHaveBeenCalledWith("/space/settings/instance/experimental");

    await act(async () => {
      root.unmount();
    });
  });

  it("filters operator-hidden tabs out of the tab bar", async () => {
    currentPathname = "/PAP/space/settings";
    const root = createRoot(container);

    await act(async () => {
      renderNav(root, ["instance.plugins"]);
    });

    const renderedValues = pageTabBarMock.mock.calls.at(-1)?.[0]?.items?.map(
      (item: { value: string }) => item.value,
    );
    expect(renderedValues).toEqual([
      "general",
      "export",
      "import",
      "instance-experimental",
      "instance-adapters",
    ]);

    await act(async () => {
      root.unmount();
    });
  });

  it("filters operator-hidden space tabs out of the tab bar", async () => {
    currentPathname = "/PAP/space/settings";
    const root = createRoot(container);

    await act(async () => {
      renderNav(root, ["space.import", "space.secrets"]);
    });

    const renderedValues = pageTabBarMock.mock.calls.at(-1)?.[0]?.items?.map(
      (item: { value: string }) => item.value,
    );
    expect(renderedValues).not.toContain("import");
    expect(renderedValues).not.toContain("secrets");
    expect(renderedValues).toContain("export");
    expect(renderedValues).not.toContain("members");

    await act(async () => {
      root.unmount();
    });
  });

  it("suppresses the Import tab on a Cloud-managed instance", async () => {
    currentPathname = "/PAP/space/settings";
    const root = createRoot(container);

    await act(async () => {
      renderNav(root, undefined, { managed: true });
    });

    const renderedValues = pageTabBarMock.mock.calls.at(-1)?.[0]?.items?.map(
      (item: { value: string }) => item.value,
    );
    expect(renderedValues).not.toContain("import");
    expect(renderedValues).toContain("export");

    await act(async () => {
      root.unmount();
    });
  });
});
