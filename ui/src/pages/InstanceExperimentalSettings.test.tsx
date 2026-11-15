// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  InstanceExperimentalSettings,
  InstanceExperimentalSettingsWithManaged,
} from "@outpost/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceExperimentalSettings as ExperimentalSettingsPage } from "./InstanceExperimentalSettings";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
  updateExperimental: vi.fn(),
}));

const mockHiddenSettings = vi.hoisted(() => new Set<string>());

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("@/hooks/useHiddenSettings", () => ({
  useHiddenSettings: () => ({ hidden: mockHiddenSettings }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

const CASES = 'button[aria-label="Toggle cases experimental setting"]';
const CAMPFIRE = 'button[aria-label="Toggle Campfire experimental setting"]';
const DECISIONS = 'button[aria-label="Toggle decisions experimental setting"]';
const NORTH_STARS = 'button[aria-label="Toggle north stars sidebar link experimental setting"]';
const DEVELOPER_MODE = 'button[aria-label="Toggle Outpost developer mode experimental setting"]';

const removedProductLabels = [
  "Assistant connections (MCP)",
  "Beta skills",
  "Built-in Agents",
  "Combined Inbox + Task List",
  "Command/Ctrl+Enter to Submit",
  "Enable Environments",
  "Enable External Objects",
  "Enable Isolated Workspaces",
  "Experimental fast responses",
  "Experimental File Viewer",
  "First task: propose with a plan document",
  "GitHub review bots",
  "Grok Bot",
  "Muse — Personal agent",
  "OpenAI Dot",
  "Outpost Runner",
  "Simplified English Interactions",
  "Summaries",
  "Classic Task Interface",
  "Managed Environment Only",
  "Smoke Lab",
  "Task Plan Decomposition",
  "Run tasks in this worktree",
];

function settings(
  overrides: Partial<InstanceExperimentalSettingsWithManaged> = {},
): InstanceExperimentalSettingsWithManaged {
  return {
    enableCases: false,
    enableCampfire: false,
    enableDecisions: false,
    enableGoalsSidebarLink: false,
    enableManagedSandboxOnly: false,
    enableOutpostDeveloperMode: false,
    enableServerInfoDebugView: false,
    enableSmokeLab: false,
    enableIssuePlanDecompositions: false,
    autoRestartDevServerWhenIdle: false,
    enableWorktreeRunExecution: false,
    worktreeRunExecutionActivatedAt: null,
    worktreeRunExecutionActivationInstanceId: null,
    ...overrides,
  } as InstanceExperimentalSettingsWithManaged;
}

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("InstanceExperimentalSettings", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let queryClient: QueryClient;
  let current: InstanceExperimentalSettingsWithManaged;

  async function renderPage() {
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/SAN/space/settings/instance/experimental"]}>
            <ExperimentalSettingsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    current = settings();
    mockHiddenSettings.clear();
    mockInstanceSettingsApi.getExperimental.mockImplementation(async () => ({ ...current }));
    mockInstanceSettingsApi.updateExperimental.mockImplementation(
      async (patch: Partial<InstanceExperimentalSettings>) => {
        current = { ...current, ...patch };
        return { ...current };
      },
    );
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    queryClient?.clear();
    container.remove();
    vi.clearAllMocks();
  });

  it("shows only the retained Outpost product experiments", async () => {
    await renderPage();

    expect([...container.querySelectorAll("h3")].map((node) => node.textContent)).toEqual([
      "Cases",
      "Campfire",
      "Decisions",
      "North Stars",
      "Auto-Restart Dev Server When Idle",
      "Outpost Developer Mode",
      "Server Info Debug View",
    ]);
    for (const label of removedProductLabels) expect(container.textContent).not.toContain(label);
  });

  it("preserves the complete Developer Mode section", async () => {
    await renderPage();

    expect(container.textContent).toContain("Internal tools for developing, testing, and debugging Outpost.");
    expect(container.querySelector(DEVELOPER_MODE)).not.toBeNull();
    expect(container.textContent).toContain("Auto-Restart Dev Server When Idle");
    expect(container.textContent).toContain("Server Info Debug View");
  });

  it.each([
    [CASES, "enableCases"],
    [CAMPFIRE, "enableCampfire"],
    [DECISIONS, "enableDecisions"],
    [NORTH_STARS, "enableGoalsSidebarLink"],
  ] as const)("persists %s", async (selector, key) => {
    await renderPage();
    const toggle = container.querySelector<HTMLButtonElement>(selector);

    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    flushSync(() => toggle?.click());
    await flushReact();

    expect(mockInstanceSettingsApi.updateExperimental).toHaveBeenCalledWith({ [key]: true });
    expect(container.querySelector(selector)?.getAttribute("aria-checked")).toBe("true");
  });

  it("locks a cloud-managed retained setting", async () => {
    current = settings({
      enableDecisions: true,
      managedKeys: {
        enableDecisions: { managed: true, managedBy: "outpost-cloud" },
      },
    });
    await renderPage();

    const toggle = container.querySelector<HTMLButtonElement>(DECISIONS);
    expect(toggle?.disabled).toBe(true);
    expect(container.textContent).toContain("Managed by Outpost Cloud");
    flushSync(() => toggle?.click());
    await flushReact();
    expect(mockInstanceSettingsApi.updateExperimental).not.toHaveBeenCalled();
  });

  it("omits an operator-hidden retained setting", async () => {
    mockHiddenSettings.add("instance.experimental.enableCases");
    await renderPage();

    expect(container.querySelector(CASES)).toBeNull();
    expect(container.querySelector(DECISIONS)).not.toBeNull();
    expect(container.querySelector(NORTH_STARS)).not.toBeNull();
  });

  it("rolls an optimistic toggle back when saving fails", async () => {
    mockInstanceSettingsApi.updateExperimental.mockRejectedValue(new Error("save failed"));
    await renderPage();
    const toggle = container.querySelector<HTMLButtonElement>(CASES);

    flushSync(() => toggle?.click());
    await flushReact();

    expect(container.querySelector(CASES)?.getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("save failed");
  });

  it("shows a retryable page error when settings cannot load", async () => {
    mockInstanceSettingsApi.getExperimental.mockRejectedValue(new Error("offline"));
    await renderPage();

    expect(container.querySelector('[data-query-view="error"]')).not.toBeNull();
    expect(container.textContent).toContain("Retry");
  });
});
