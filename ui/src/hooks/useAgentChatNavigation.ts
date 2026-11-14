import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, Issue } from "@outpost/shared";
import { agentsApi } from "@/api/agents";
import { agentChatsApi } from "@/api/agentChats";
import { authApi } from "@/api/auth";
import { useSpace } from "@/context/SpaceContext";
import { useSidebar } from "@/context/SidebarContext";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import { useAgentChatEnabled } from "./useAgentChatEnabled";

export function useAgentChatNavigation() {
  const { selectedSpaceId: spaceId } = useSpace();
  const { enabled, loaded } = useAgentChatEnabled();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession() });
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? null;
  const agents = useQuery({
    queryKey: queryKeys.agents.list(spaceId!), queryFn: () => agentsApi.list(spaceId!),
    enabled: enabled && !!spaceId,
  });
  const chats = useQuery({
    queryKey: queryKeys.agentChats.list(spaceId, userId), queryFn: () => agentChatsApi.list(spaceId!),
    enabled: enabled && !!spaceId && session.isSuccess,
  });
  return { spaceId, userId, enabled, loaded, agents, chats, session };
}

/** Explicitly adding a chat uses the existing atomic, one-per-agent resolver. */
export function useOpenAgentChat(spaceId: string | null, userId: string | null) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { isMobile, setSidebarOpen } = useSidebar();
  const scope = useRef({ spaceId, userId, mounted: true });
  useEffect(() => {
    const current = { spaceId, userId, mounted: true };
    scope.current = current;
    return () => { current.mounted = false; };
  }, [spaceId, userId]);
  return useCallback(async (agent: Agent, signal?: AbortSignal) => {
    if (!spaceId || agent.spaceId !== spaceId) throw new Error("Choose an agent from this outpost.");
    if (agent.status === "terminated") throw new Error("Terminated agents cannot start a chat.");
    const current = scope.current;
    const chat = await agentChatsApi.ensure(spaceId, agent.id);
    client.setQueryData(queryKeys.agentChats.detail(spaceId, userId, agent.id), chat);
    client.setQueryData(queryKeys.issues.detail(chat.id), chat);
    client.setQueryData<Issue[]>(queryKeys.agentChats.list(spaceId, userId), previous =>
      [chat, ...(previous ?? []).filter(item => item.id !== chat.id)]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || b.id.localeCompare(a.id)));
    if (!current.mounted || scope.current !== current || signal?.aborted) return;
    navigate(`/chats/${encodeURIComponent(agentRouteRef(agent))}`);
    if (isMobile) setSidebarOpen(false);
  }, [client, spaceId, userId, navigate, isMobile, setSidebarOpen]);
}
