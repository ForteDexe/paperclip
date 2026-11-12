// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Companies } from "./Companies";

const mockCompaniesApi = vi.hoisted(() => ({
  stats: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const mockCompanyContext = vi.hoisted(() => ({
  companies: [] as Array<Record<string, unknown>>,
  selectedCompanyId: null as string | null,
  setSelectedCompanyId: vi.fn(),
  loading: false,
  error: null as Error | null,
  retryCompanies: vi.fn(),
  createCompany: vi.fn(),
}));

vi.mock("../api/companies", () => ({
  companiesApi: mockCompaniesApi,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("Spaces page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompaniesApi.stats.mockResolvedValue({});
    mockCompanyContext.companies = [];
    mockCompanyContext.selectedCompanyId = null;
    mockCompanyContext.loading = false;
    mockCompanyContext.error = null;
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderPage(initialEntry = "/spaces") {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <QueryClientProvider client={queryClient}>
            <Companies />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await flushReact();
    });
    return root;
  }

  it("welcomes a new user and opens the first-Space form", async () => {
    const root = await renderPage();

    expect(container.querySelector('[data-testid="spaces-welcome"]')).not.toBeNull();
    expect(container.textContent).toContain("Welcome to Outpost");
    expect(container.textContent).toContain("Create your first Space");

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Choose working directory"),
    );
    await act(async () => {
      startButton?.click();
      await flushReact();
    });

    expect(container.querySelectorAll("input")).toHaveLength(2);
    expect(container.querySelectorAll("input")[1]?.getAttribute("placeholder")).toBe("C:\\work\\maya");
    expect(container.textContent).toContain("Create Space");

    await act(async () => root.unmount());
  });

  it("keeps the management list for existing Spaces", async () => {
    mockCompanyContext.companies = [{
      id: "space-1",
      issuePrefix: "MAYA",
      name: "Maya",
      status: "active",
      workspaceRoot: "C:\\work\\maya",
      createdAt: "2026-11-12T00:00:00.000Z",
    }];
    mockCompanyContext.selectedCompanyId = "space-1";

    const root = await renderPage();

    expect(container.querySelector('[data-testid="spaces-welcome"]')).toBeNull();
    expect(container.textContent).toContain("Spaces");
    expect(container.textContent).toContain("Maya");
    expect(container.textContent).toContain("New Space");

    await act(async () => root.unmount());
  });
});
