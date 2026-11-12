// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanySkillListItem } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstalledSkills } from "./InstalledSkills";

const route = vi.hoisted(() => ({ path: undefined as string | undefined, navigate: vi.fn() }));
const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), file: vi.fn(), importFromSource: vi.fn(), delete: vi.fn() }));

vi.mock("../api/companySkills", () => ({ companySkillsApi: api }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "space-1" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: vi.fn() }) }));
vi.mock("../lib/router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useNavigate: () => route.navigate,
  useParams: () => ({ "*": route.path }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const skill: CompanySkillListItem = {
  id: "skill-1",
  companyId: "space-1",
  key: "code-review",
  slug: "code-review",
  name: "Code review",
  description: "Review changes in this repository.",
  sourceType: "local_path",
  sourceLocator: "C:\\work\\skills\\code-review",
  sourceRef: null,
  trustLevel: "markdown_only",
  compatibility: "compatible",
  fileInventory: [{ path: "SKILL.md", kind: "skill" }],
  iconUrl: null,
  color: null,
  tagline: null,
  authorName: null,
  homepageUrl: null,
  categories: [],
  sharingScope: "company",
  publicShareToken: null,
  forkedFromSkillId: null,
  forkedFromCompanyId: null,
  starCount: 0,
  installCount: 0,
  forkCount: 0,
  currentVersionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  attachedAgentCount: 2,
  editable: false,
  editableReason: null,
  sourceLabel: "Local folder",
  sourceBadge: "local",
  sourcePath: "C:\\work\\skills\\code-review",
  catalogKind: null,
  originHash: null,
  packageName: null,
  packageVersion: null,
};

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("InstalledSkills", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    route.path = undefined;
    route.navigate.mockReset();
    api.list.mockResolvedValue([skill]);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows one simple installed library without marketplace or Studio controls", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    await act(async () => {
      root.render(<QueryClientProvider client={client}><InstalledSkills /></QueryClientProvider>);
      await flushReact();
    });

    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain("Code review"));
    });

    expect(container.textContent).toContain("Installed skills");
    expect(container.textContent).toContain("2 agents");
    expect(container.textContent).toContain("Add skill");
    for (const retired of ["Discover", "My Skills", "Studio", "Sources", "Stars", "Forks"]) {
      expect(container.textContent).not.toContain(retired);
    }

    await act(async () => root.unmount());
  });
});
