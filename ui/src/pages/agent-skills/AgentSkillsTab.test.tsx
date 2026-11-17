// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentSkillSnapshot, SpaceSkillListItem } from "@outpost/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSkillsTab } from "./AgentSkillsTab";

const agents = vi.hoisted(() => ({ skills: vi.fn(), syncSkills: vi.fn() }));
const spaceSkills = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/api/agents", () => ({ agentsApi: agents }));
vi.mock("@/api/spaceSkills", () => ({ spaceSkillsApi: spaceSkills }));
vi.mock("@/lib/router", () => ({ Link: ({ children }: { children: ReactNode }) => children }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const baseSkill: SpaceSkillListItem = {
  id: "skill-1", spaceId: "space-1", key: "code-review", slug: "code-review", name: "Code review",
  description: "Review repository changes.", sourceType: "local_path", sourceLocator: "C:\\skills\\code-review",
  sourceRef: null, trustLevel: "markdown_only", compatibility: "compatible",
  fileInventory: [{ path: "SKILL.md", kind: "skill" }], iconUrl: null, color: null, tagline: null,
  authorName: null, homepageUrl: null, categories: [], sharingScope: "space", publicShareToken: null,
  forkedFromSkillId: null, forkedFromSpaceId: null, starCount: 0, installCount: 0, forkCount: 0,
  currentVersionId: null, createdAt: new Date(), updatedAt: new Date(), attachedAgentCount: 1,
  editable: true, editableReason: null, sourceLabel: "Local folder", sourceBadge: "local",
  sourcePath: null, catalogKind: null, originHash: null, packageName: null, packageVersion: null,
};

const coreSkill: SpaceSkillListItem = {
  ...baseSkill,
  id: "skill-core",
  key: "outpost/outpost/outpost-task",
  slug: "outpost-task",
  name: "outpost-task",
  description: "Manage Outpost tasks.",
  sourceType: "managed",
  sourceLocator: null,
  sourceLabel: "Outpost bundled",
  sourceBadge: "outpost",
  attachedAgentCount: 0,
};

const agent = { id: "agent-1", name: "Rocky" } as Agent;
const snapshot: AgentSkillSnapshot = {
  adapterType: "codex_local",
  supported: true,
  mode: "persistent",
  desiredSkills: [baseSkill.key],
  entries: [],
  warnings: [],
};

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("AgentSkillsTab", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    spaceSkills.list.mockResolvedValue([coreSkill, baseSkill]);
    agents.skills.mockResolvedValue(snapshot);
    agents.syncSkills.mockResolvedValue({ ...snapshot, desiredSkills: [] });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows core skills as automatic and lets the operator remove an agent assignment", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const root = createRoot(container);
    await act(async () => {
      root.render(<QueryClientProvider client={client}><AgentSkillsTab agent={agent} spaceId="space-1" /></QueryClientProvider>);
      await flushReact();
    });

    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain("Core skill selected automatically"));
    });

    expect(container.textContent).toContain("Available");
    const toggle = container.querySelector('button[aria-label="Disable Code review"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle.click();
      await vi.waitFor(() => expect(agents.syncSkills).toHaveBeenCalled());
    });

    expect(agents.syncSkills).toHaveBeenCalledWith("agent-1", [], "replace", "space-1");
    await act(async () => root.unmount());
  });
});
