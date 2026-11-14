import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import { useQueryView } from "@/components/QueryView";
import { authApi } from "@/api/auth";
import { useSpace } from "@/context/SpaceContext";
import {
  useResourceMemberships,
  useResourceMembershipMutation,
} from "@/hooks/useResourceMemberships";
import { useRecentAgentChats } from "@/lib/recent-agent-chats";
import { queryKeys } from "@/lib/queryKeys";
import { useLocation, useNavigate } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import { AgentChatSidebar } from "./AgentChatSidebar";
import { AgentChatPicker } from "./AgentChatPicker";
import { useSidebar } from "@/context/SidebarContext";

export function SidebarAgentChats() {
  const { selectedSpaceId } = useSpace();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const userId = session?.user?.id ?? session?.session?.userId;
  return (
    <SpaceAgentChats
      key={`${selectedSpaceId}:${userId ?? "local-operator"}`}
      spaceId={selectedSpaceId}
      userId={userId}
    />
  );
}

// A scope change unmounts the picker, including its open state and search.
function SpaceAgentChats({ spaceId, userId }: { spaceId: string | null; userId?: string }) {
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(spaceId!),
    queryFn: () => agentsApi.list(spaceId!),
    enabled: !!spaceId,
  });
  // The picker keeps the last roster through an outage; it only reports a real failure.
  const agentsView = useQueryView(agentsQuery);
  const agents = agentsQuery.data ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const navigate = useNavigate();
  const { isMobile, setSidebarOpen } = useSidebar();
  const recentIds = useRecentAgentChats(spaceId ?? "", userId);
  const memberships = useResourceMemberships(spaceId);
  const mutation = useResourceMembershipMutation(spaceId);
  const stars = memberships.data?.starredAgentIds ?? [];
  const location = useLocation();
  const activeRef = location.pathname.match(/\/chats\/([^/]+)/)?.[1];
  const active = agents.find((agent) => agent.id === activeRef || agentRouteRef(agent) === activeRef);
  return (
    <>
      <AgentChatSidebar
        agents={agents}
        onOpenChat={() => setPickerOpen(true)}
        activeId={active?.id ?? ""}
        starredIds={stars}
        recentIds={recentIds}
        onToggleStar={(id) => {
          mutation.mutate({
            resourceType: "agent",
            resourceId: id,
            resourceName: agents.find((agent) => agent.id === id)?.name ?? "Agent",
            starred: !stars.includes(id),
          });
        }}
      />
      <AgentChatPicker
        agents={agents}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        loading={agentsView.kind === "loading" || agentsView.kind === "reconnecting"}
        error={agentsView.kind === "error" ? agentsQuery.error : null}
        onRetry={agentsView.retry}
        onSelect={(agent) => {
          if (isMobile) setSidebarOpen(false);
          navigate(`/chats/${encodeURIComponent(agentRouteRef(agent))}`);
        }}
      />
    </>
  );
}
