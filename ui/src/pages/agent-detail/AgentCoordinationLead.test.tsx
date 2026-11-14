// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@outpost/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCoordinationLead, invalidLeadAgentIds } from "./AgentCoordinationLead";
import { queryKeys } from "@/lib/queryKeys";

const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock("@/api/agents", () => ({ agentsApi: api }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));

const agent = (id: string, leadAgentId: string | null = null) => ({ id, spaceId: "space", name: id, urlKey: id, leadAgentId, status: "idle", role: "general" }) as Agent;
const directory = [agent("Alex"), agent("Report", "Alex"), agent("Nested", "Report"), agent("Morgan")];
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(() => root!.unmount()); host?.remove(); vi.clearAllMocks(); });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function mount(value = directory[0]) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.agents.list("space"), directory);
  api.list.mockResolvedValue(directory);
  await act(() => root!.render(<QueryClientProvider client={client}><AgentCoordinationLead agent={value} /></QueryClientProvider>));
  return client;
}

describe("Agent coordination lead", () => {
  it("blocks self and descendants, even when the directory is unordered", () => {
    expect(new Set(invalidLeadAgentIds("Alex", [...directory].reverse()))).toEqual(new Set(["Alex", "Report", "Nested"]));
  });
  it("saves a selected coordination lead in the current space and disables coordination loops", async () => {
    api.update.mockResolvedValue({ ...directory[0], leadAgentId: "Morgan" });
    await mount();
    expect(host.textContent).toContain("No coordination lead");
    await act(() => (host.querySelector('[aria-label="Choose coordination lead"]') as HTMLButtonElement).click());
    const popup = document.querySelector('[data-slot="popover-content"]')!;
    const buttons = Array.from(popup.querySelectorAll("button"));
    expect(buttons.filter(button => button.disabled)).toHaveLength(3);
    await act(() => buttons.find(button => button.textContent?.startsWith("Morgan"))!.click());
    await flush();
    expect(api.update).toHaveBeenCalledWith("Alex", { leadAgentId: "Morgan" }, "space");
  });
  it("keeps the cached coordination lead and picker available after a transient directory failure", async () => {
    const client = await mount({ ...directory[0], leadAgentId: "Morgan" });
    api.list.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.agents.list("space") }); });
    await flush();
    expect(host.querySelector("a")?.textContent).toBe("Morgan");
    expect((host.querySelector('[aria-label="Change coordination lead"]') as HTMLButtonElement).disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("links the current coordination lead and reports failed changes without hiding them", async () => {
    api.update.mockRejectedValue(new Error("Could not save coordination lead"));
    await mount({ ...directory[0], leadAgentId: "Morgan" });
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/agents/Morgan/overview");
    await act(() => (host.querySelector('[aria-label="Change coordination lead"]') as HTMLButtonElement).click());
    const clear = Array.from(document.querySelectorAll('[data-slot="popover-content"] button')).find(button => button.textContent === "No coordination lead") as HTMLButtonElement;
    await act(() => clear.click()); await flush(); await flush();
    expect(api.update).toHaveBeenCalledWith("Alex", { leadAgentId: null }, "space");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not save coordination lead");
    expect(host.querySelector("a")?.textContent).toBe("Morgan");
  });
});
