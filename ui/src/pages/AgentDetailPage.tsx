import { useEffect, useMemo } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "@/lib/router";
import { agentsApi } from "@/api/agents";
import { useSpace } from "@/context/SpaceContext";
import { queryKeys } from "@/lib/queryKeys";
import { useAgentEnvironmentSlots } from "@/plugins/useAgentEnvironmentSlots";
import { PluginSlotMount, usePluginSlots } from "@/plugins/slots";
import { AgentDetail } from "./AgentDetail";

export function AgentDetailPage() {
  const { tab } = useParams<{ tab?: string }>();
  return tab?.startsWith("plugin:") ? <AgentPluginDetail /> : <AgentDetail />;
}

function AgentPluginDetail() {
  const { agentId = "", spacePrefix, tab } = useParams<{ agentId: string; spacePrefix?: string; tab: string }>();
  const { spaces, selectedSpaceId } = useSpace();
  const spaceId = spaces.find(space => space.issuePrefix.toUpperCase() === spacePrefix?.toUpperCase())?.id ?? selectedSpaceId;
  const { data: agent, isLoading, error } = useQuery({
    queryKey: [...queryKeys.agents.detail(agentId), spaceId ?? null],
    queryFn: () => agentsApi.get(agentId, spaceId ?? undefined),
    enabled: Boolean(agentId && spaceId),
  });
  const { slots: declaredSlots, isLoading: slotsLoading, errorMessage } = usePluginSlots({ slotTypes: ["detailTab"], entityType: "agent", spaceId: agent?.spaceId, enabled: Boolean(agent) });
  const requestedSlots = useMemo(() => declaredSlots.filter(item => `plugin:${item.pluginKey}:${item.id}` === tab), [declaredSlots, tab]);
  const { slots: [slot], isLoading: environmentLoading } = useAgentEnvironmentSlots(requestedSlots, agent?.id, agent?.spaceId);
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([
      { label: "Agents", href: "/agents" },
      { label: agent?.name ?? agentId, href: `/agents/${encodeURIComponent(agentId)}/overview` },
      { label: slot?.displayName ?? "Plugin view" },
    ]);
  }, [setBreadcrumbs, agent?.name, agentId, slot?.displayName]);
  if (error) return <p role="alert">Agent unavailable</p>;
  if (!agent || isLoading || slotsLoading || environmentLoading) return <p role="status">Loading agent view…</p>;
  return <div className="mx-auto max-w-5xl space-y-4">
    <Link to={`/agents/${encodeURIComponent(agentId)}/overview`} className="text-sm text-muted-foreground">{agent.name}</Link>
    {slot ? <PluginSlotMount slot={slot} context={{ spaceId: agent.spaceId, spacePrefix: spacePrefix ?? null, entityId: agent.id, entityType: "agent" }} missingBehavior="placeholder" />
      : <p role="status">{errorMessage ? "Agent view unavailable" : "This plugin view is unavailable"}</p>}
  </div>;
}
