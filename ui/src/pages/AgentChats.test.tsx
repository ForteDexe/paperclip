// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@outpost/shared";
import { recordAgentChatVisit } from "@/lib/recent-agent-chats";
import { AgentChats } from "./AgentChats";

const state = vi.hoisted(() => ({
  primaryAgentId: null as string | null,
  primaryLoading: false,
  spaceId: "space-a",
  userId: "user-a",
  agents: [] as Agent[],
  chats: [] as { id: string; conversationAgentId: string }[],
  chatsFetched: true,
  chatsError: null as Error | null,
  sessionError: null as Error | null,
  navigate: vi.fn(),
}));

vi.mock("@/components/primary-agent/PrimaryAgentPresentation", () => ({ usePrimaryAgentPresentation: () => ({ primaryAgentId: state.primaryAgentId, loading: state.primaryLoading }) }));

vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("@/hooks/useAgentChatNavigation", () => ({
  useAgentChatNavigation: () => ({
    spaceId: state.spaceId,
    userId: state.userId,
    enabled: true,
    loaded: true,
    agents: { data: state.agents, isFetched: true, isPending: false, error: null },
    chats: { data: state.chats, isFetched: state.chatsFetched, isSuccess: state.chatsFetched && !state.chatsError, error: state.chatsError },
    session: { isFetched: !state.sessionError, isPending: false, error: state.sessionError },
  }),
  useOpenAgentChat: () => vi.fn(),
}));
vi.mock("@/lib/router", () => ({
  useNavigate: () => state.navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/AgentAvatar", () => ({ AgentAvatar: () => null }));

let root: Root;
let container: HTMLDivElement;
const agent = (id: string, spaceId = "space-a") => ({
  id, spaceId, name: id, urlKey: `${id}-slug`, role: "engineer", status: "idle",
} as Agent);

async function render() {
  await act(async () => root.render(<AgentChats />));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.primaryAgentId = null;
  state.primaryLoading = false;
  state.spaceId = "space-a";
  state.userId = "user-a";
  state.agents = [agent("alice"), agent("bob")];
  state.chats = [];
  state.chatsFetched = true;
  state.chatsError = null;
  state.sessionError = null;
  state.navigate.mockReset();
  for (const id of ["alice", "bob", "removed", "retired-id"])
    recordAgentChatVisit("space-a", "user-a", id, null);
  localStorage.setItem("outpost.recentAgentChats:space-a:user-a", "[]");
  localStorage.setItem("outpost.recentAgentChats:space-b:user-a", "[]");
  localStorage.setItem("outpost.recentAgentChats:space-a:user-b", "[]");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Chat landing", () => {
  it("uses the primary only when there is no valid recent conversation", async () => {
    state.primaryAgentId = "alice";
    recordAgentChatVisit("space-a", "user-a", "removed");
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice-slug", { replace: true });
    state.navigate.mockClear();
    recordAgentChatVisit("space-a", "user-a", "bob");
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/bob-slug", { replace: true });
  });

  it("waits for the primary without sending anything and preserves the chooser for unavailable primaries", async () => {
    state.primaryLoading = true;
    await render();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Opening chat");
    state.primaryLoading = false;
    state.primaryAgentId = "removed";
    await render();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Who would you like to talk to?");
  });

  it("opens the most recently visited agent and replaces the landing history entry", async () => {
    recordAgentChatVisit("space-a", "user-a", "alice");
    recordAgentChatVisit("space-a", "user-a", "bob");
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/bob-slug", { replace: true });
    expect(container.textContent).toContain("Opening chat");
  });

  it("skips unavailable saved agents and preserves the space and user scope", async () => {
    recordAgentChatVisit("space-a", "user-a", "alice");
    recordAgentChatVisit("space-a", "user-a", "removed");
    recordAgentChatVisit("space-b", "user-a", "other-space-agent");
    recordAgentChatVisit("space-a", "user-b", "other-user-agent");
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice-slug", { replace: true });
  });

  it("does not reopen historical chats for agents missing from the active roster", async () => {
    recordAgentChatVisit("space-a", "user-a", "retired-id");
    state.chats = [{ id: "chat-retired", conversationAgentId: "retired-id" }];
    await render();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Who would you like to talk to?");
  });

  it("skips a missing recent agent without waiting for history", async () => {
    recordAgentChatVisit("space-a", "user-a", "alice");
    recordAgentChatVisit("space-a", "user-a", "retired-id");
    state.chatsFetched = false;
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice-slug", { replace: true });
    state.navigate.mockClear();
    state.chatsFetched = true;
    state.chats = [{ id: "chat-retired", conversationAgentId: "retired-id" }];
    await render();
    // The destination did not change, so React does not need to navigate again.
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Opening chat");
  });

  it("omits terminated agents from the chooser", async () => {
    state.agents = [agent("alice"), { ...agent("retired-id"), status: "terminated" }];
    await render();
    expect(container.textContent).toContain("alice");
    expect(container.textContent).not.toContain("retired-id");
  });

  it("shows the chooser when no saved chat remains available", async () => {
    recordAgentChatVisit("space-a", "user-a", "removed");
    await render();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Who would you like to talk to?");
  });

  it("skips a saved conversation that is no longer accessible even when its agent remains available", async () => {
    recordAgentChatVisit("space-a", "user-a", "alice");
    recordAgentChatVisit("space-a", "user-a", "bob", "deleted-chat");
    state.chats = [{ id: "chat-alice", conversationAgentId: "alice" }];
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice-slug", { replace: true });
  });

  it("reopens an active agent when history fails", async () => {
    recordAgentChatVisit("space-a", "user-a", "alice", "chat-alice");
    state.chatsFetched = false;
    state.chatsError = new Error("History unavailable");
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice-slug", { replace: true });
  });

  it("reopens a visited empty chat without waiting for history", async () => {
    recordAgentChatVisit("space-a", "user-a", "alice", null);
    state.chatsFetched = false;
    await render();
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice-slug", { replace: true });
  });

  it("shows a retry state when identity fails instead of waiting for disabled history", async () => {
    recordAgentChatVisit("space-a", "user-a", "alice");
    state.sessionError = new Error("Session unavailable");
    state.chatsFetched = false;
    await render();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Couldn[’']t load your chats/);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Retry");
  });
});
