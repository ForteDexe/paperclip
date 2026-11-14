import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  FileCode2,
  Fingerprint,
  History,
  KeyRound,
  MessageSquare,
  PlayCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useAgentEnvironmentSlots } from "@/plugins/useAgentEnvironmentSlots";
import { usePluginSlots } from "@/plugins/slots";
import { agentsApi } from "@/api/agents";
import { useSpace } from "@/context/SpaceContext";
import { queryKeys } from "@/lib/queryKeys";
import { ContextualSidebarFrame } from "./ContextualSidebarFrame";
import { SidebarNavItem } from "./SidebarNavItem";
import { contextualSidebarStyles } from "./contextual-sidebar-styles";
import {
  AGENT_DETAIL_NAVIGATION,
  agentDetailHref,
  type AgentLocalDetailView,
} from "@/pages/agent-detail-navigation";

const localIcons = {
  overview: Sparkles,
  instructions: Fingerprint,
  runtime: Settings2,
  tools: Wrench,
  channels: MessageSquare,
  permissions: ShieldCheck,
  "api-keys": KeyRound,
  revisions: History,
  advanced: FileCode2,
  activity: Activity,
  runs: PlayCircle,
} satisfies Record<AgentLocalDetailView, typeof Sparkles>;

export function AgentContextualSidebar({
  agentRef,
  agentId,
  agentName,
  labels,
}: {
  agentRef: string;
  agentId?: string;
  agentName?: string;
  labels?: Partial<Record<AgentLocalDetailView, string>>;
}) {
  const { selectedSpaceId } = useSpace();
  const shouldResolveAgent = !agentId || !agentName;
  const { data: resolvedAgent } = useQuery({
    queryKey: [...queryKeys.agents.detail(agentRef), selectedSpaceId ?? null, "contextual-sidebar"],
    queryFn: () => agentsApi.get(agentRef, selectedSpaceId ?? undefined),
    enabled: shouldResolveAgent && Boolean(agentRef && selectedSpaceId),
  });
  const resolvedId = agentId ?? resolvedAgent?.id;
  const { slots: declaredTabs } = usePluginSlots({ slotTypes: ["detailTab"], entityType: "agent", spaceId: resolvedAgent?.spaceId ?? selectedSpaceId, enabled: Boolean(resolvedId) });
  const { slots: pluginTabs } = useAgentEnvironmentSlots(declaredTabs, resolvedId, resolvedAgent?.spaceId ?? selectedSpaceId);
  const resolvedName = agentName ?? resolvedAgent?.name ?? "Agent";

  return (
    <ContextualSidebarFrame
      surface="agent"
      title={resolvedName}
      fallbackTo="/agents/all"
      showHeader={false}
      className="border-r border-border bg-background"
    >
      <nav
        aria-label={`${resolvedName} navigation`}
        data-slot="contextual-sidebar-nav"
        className={contextualSidebarStyles.nav}
      >
        {AGENT_DETAIL_NAVIGATION.map((section) => (
          <div key={section.label} className="contents">
            {section.label === "Audit" && pluginTabs.length > 0 ? (
              <div data-slot="contextual-sidebar-section" className={contextualSidebarStyles.section}>
                <p className={contextualSidebarStyles.sectionLabel}>Apps</p>
                <div className={contextualSidebarStyles.group}>
                  {pluginTabs.map(slot => <SidebarNavItem key={`${slot.pluginKey}:${slot.id}`} to={`/agents/${encodeURIComponent(agentRef)}/${encodeURIComponent(`plugin:${slot.pluginKey}:${slot.id}`)}`} label={slot.displayName} icon={Wrench} />)}
                </div>
              </div>
            ) : null}
            <div data-slot="contextual-sidebar-section" className={contextualSidebarStyles.section}>
              <p data-slot="contextual-sidebar-section-label" className={contextualSidebarStyles.sectionLabel}>
                {section.label}
              </p>
              <div data-slot="contextual-sidebar-group" className={contextualSidebarStyles.group}>
                {section.items.map((item) => (
                  <SidebarNavItem
                    key={item.value}
                    to={agentDetailHref(agentRef, item.value)}
                    label={labels?.[item.value] ?? item.label}
                    icon={localIcons[item.value]}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </nav>
    </ContextualSidebarFrame>
  );
}
