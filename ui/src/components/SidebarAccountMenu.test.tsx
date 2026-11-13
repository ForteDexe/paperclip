// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { SidebarAccountMenu as ProductionSidebarAccountMenu } from "./SidebarAccountMenu.production";

const mockSetSidebarOpen = vi.hoisted(() => vi.fn());
const mockToggleTheme = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));
vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
    setSidebarOpen: mockSetSidebarOpen,
    collapsed: false,
    peeking: false,
  }),
}));
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: mockToggleTheme }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  await callback();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe.each([SidebarAccountMenu, ProductionSidebarAccountMenu])(
  "sidebar footer actions without a human profile (%#)",
  (SidebarActions) => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
    });

    afterEach(() => {
      container.remove();
      vi.clearAllMocks();
    });

    it("links directly to settings and exposes appearance without profile, docs, or feedback", async () => {
      const root = createRoot(container);

      await act(async () => root.render(<SidebarActions deploymentMode="authenticated" />));

      const settings = container.querySelector('a[aria-label="Settings"]');
      expect(settings?.getAttribute("href")).toBe("/company/settings");
      expect(container.textContent).toContain("Settings");
      expect(container.textContent).not.toContain("Board");
      expect(container.textContent).not.toContain("Documentation");
      expect(container.querySelector('[aria-label="Share feedback"]')).toBeNull();
      expect(container.querySelector('[aria-label="Open account menu"]')).toBeNull();

      const themeToggle = container.querySelector<HTMLButtonElement>('[aria-label="Switch to light mode"]');
      expect(themeToggle).not.toBeNull();
      themeToggle?.click();
      expect(mockToggleTheme).toHaveBeenCalledOnce();

      await act(async () => root.unmount());
    });
  },
);
