import { AgentCoordinationIndicator } from "@/components/AgentCoordinationIndicator";
import { AgentBulkRoster } from "@/components/agents/AgentBulkRoster";
import { AgentRosterFilters, useAgentRosterFilters } from "@/components/agents/AgentRosterFilters";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentChatPin, useAgentChatPins } from "@/components/AgentChatPin";
import { useAgentChatEnabled } from "../hooks/useAgentChatEnabled";
import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type AgentHierarchyNode } from "../api/agents";
import { environmentsApi } from "../api/environments";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { useSpace } from "../context/SpaceContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { useStreamlinedUiEnabled } from "../hooks/useStreamlinedUiEnabled";
import { queryKeys } from "../lib/queryKeys";
import { isPlatformManagedEnvironment } from "../lib/managed-sandbox-environment";
import { AgentStatusBadge, AgentStatusCapsule } from "../components/StatusBadge";
import { EntityRow } from "../components/EntityRow";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { QueryErrorState, useQueryView } from "../components/QueryView";
import { AgentHierarchy } from "./AgentHierarchy";
import { relativeTime, cn, agentRouteRef, agentUrl } from "../lib/utils";
import { AgentsToolbar } from "../components/AgentsToolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { AlertTriangle, Bot, MessagesSquare } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent, type Environment, type EnvironmentCapabilities } from "@outpost/shared";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";

import { agentDisplayAdapterType, getAdapterLabel } from "../adapters/adapter-display-registry";

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

import { AGENT_FILTER_TABS } from "../lib/agent-filter-tabs";
export { AGENT_FILTER_TABS } from "../lib/agent-filter-tabs";
type FilterTab = (typeof AGENT_FILTER_TABS)[number];

function isFilterTab(value: string): value is FilterTab {
  return (AGENT_FILTER_TABS as readonly string[]).includes(value);
}

interface EnvironmentDescriptor {
  label: string;
  detail: string;
  title: string;
}

const localEnvironmentDescriptor: EnvironmentDescriptor = {
  label: "Local",
  detail: "Outpost host",
  title: "Local - Outpost host",
};

const loadingEnvironmentDescriptor: EnvironmentDescriptor = {
  label: "—",
  detail: "Loading environment",
  title: "Loading environment",
};

// Agents in these states never appear in the agents list — `terminated` is
// hidden like an archived space, and `pending_approval` is a creation gate that
// lives in the task thread, not an agent run state (PAP-75).
const HIDDEN_AGENT_STATUSES = new Set(["terminated", "pending_approval"]);

function matchesFilter(status: string, tab: FilterTab): boolean {
  if (tab === "all") return true;
  if (tab === "active") return status === "active" || status === "running" || status === "idle";
  if (tab === "paused") return status === "paused";
  if (tab === "error") return status === "error";
  return true;
}

function matchesSearch(agent: Pick<Agent, "name" | "role" | "title">, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [agent.name, agent.role, roleLabels[agent.role], agent.title].filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every(word => text.includes(word));
}

export function filterAgents(agents: Agent[], tab: FilterTab, query = ""): Agent[] {
  return agents
    .filter((a) => {
      if (HIDDEN_AGENT_STATUSES.has(a.status) || !matchesSearch(a, query)) return false;
      return matchesFilter(a.status, tab);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getConfiguredModel(agent: Agent): string | null {
  const value = agent.adapterConfig?.model;
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model.length > 0 ? model : null;
}

function formatEnvironmentDriver(driver: Environment["driver"]): string {
  if (driver === "ssh") return "SSH";
  return driver.charAt(0).toUpperCase() + driver.slice(1);
}

function getSandboxProviderLabel(
  environment: Environment,
  capabilities?: EnvironmentCapabilities | null,
): string {
  const provider = typeof environment.config.provider === "string"
    ? environment.config.provider.trim()
    : "";
  if (!provider) return "Sandbox";
  return capabilities?.sandboxProviders?.[provider]?.displayName ?? provider;
}

function describeEnvironment(
  environment: Environment,
  capabilities?: EnvironmentCapabilities | null,
): EnvironmentDescriptor {
  const detail = isPlatformManagedEnvironment(environment)
    ? "Managed by Outpost"
    : environment.driver === "sandbox"
      ? `${getSandboxProviderLabel(environment, capabilities)} sandbox provider`
      : environment.driver === "local"
        ? "Outpost host"
        : formatEnvironmentDriver(environment.driver);

  return {
    label: environment.name,
    detail,
    title: `${environment.name} - ${detail}`,
  };
}

function describeMissingEnvironment(environmentId: string): EnvironmentDescriptor {
  return {
    label: "Unknown environment",
    detail: environmentId.slice(0, 8),
    title: `Unknown environment - ${environmentId}`,
  };
}

function resolveAgentEnvironment(
  agent: Agent,
  environmentsById: Map<string, Environment>,
  instanceDefaultEnvironmentId: string | null,
  capabilities?: EnvironmentCapabilities | null,
): EnvironmentDescriptor {
  const environmentId = agent.defaultEnvironmentId ?? instanceDefaultEnvironmentId;
  if (!environmentId) return localEnvironmentDescriptor;
  const environment = environmentsById.get(environmentId);
  return environment
    ? describeEnvironment(environment, capabilities)
    : describeMissingEnvironment(environmentId);
}

export function filterAgentHierarchy(nodes: AgentHierarchyNode[], tab: FilterTab, matchingIds?: Set<string>): AgentHierarchyNode[] {
  return nodes
    .reduce<AgentHierarchyNode[]>((acc, node) => {
      const filteredChildren = filterAgentHierarchy(node.children, tab, matchingIds);
      // Hidden agents (terminated / pending_approval) never render as a row, but
      // any visible reports are promoted so the tree doesn't lose live agents.
      if (HIDDEN_AGENT_STATUSES.has(node.status)) {
        acc.push(...filteredChildren);
        return acc;
      }
      const nodeMatches = matchesFilter(node.status, tab);
      if ((nodeMatches && (!matchingIds || matchingIds.has(node.id))) || filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
      return acc;
    }, [])
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type AgentsView = "list" | "agent-hierarchy";

export function Agents({ initialView = "list" }: { initialView?: AgentsView } = {}) {
  const agentChatPins = useAgentChatPins();
  const [query, setQuery] = useState("");
  const agentChat = useAgentChatEnabled();
  const { selectedSpaceId } = useSpace();
  const { openNewAgent } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useSidebar();
  const { enabled: streamlinedUiEnabled } = useStreamlinedUiEnabled();
  const pathSegment = location.pathname.split("/").pop() ?? "all";
  const requestedTab: FilterTab = isFilterTab(pathSegment) ? pathSegment : "all";
  const [view, setView] = useState<AgentsView>(() => streamlinedUiEnabled ? initialView : "agent-hierarchy");
  const forceListView = !streamlinedUiEnabled && isMobile;
  const effectiveView: AgentsView = forceListView ? "list" : view;

  useEffect(() => {
    setView(streamlinedUiEnabled ? initialView : "agent-hierarchy");
  }, [initialView, streamlinedUiEnabled]);

  const { data: instanceSettings } = useQuery({
    queryKey: queryKeys.instance.settings,
    queryFn: () => instanceSettingsApi.get(),
    enabled: !!selectedSpaceId,
  });
  const tab: FilterTab = "all";

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedSpaceId!),
    queryFn: () => agentsApi.list(selectedSpaceId!),
    enabled: !!selectedSpaceId,
  });
  const { data: agents, isLoading } = agentsQuery;
  const rosterFilters = useAgentRosterFilters(selectedSpaceId, agents);
  const agentsView = useQueryView(agentsQuery);

  const { data: agentHierarchy } = useQuery({
    queryKey: queryKeys.agentHierarchy(selectedSpaceId!),
    queryFn: () => agentsApi.hierarchy(selectedSpaceId!),
    enabled: !!selectedSpaceId && effectiveView === "agent-hierarchy",
  });

  const environmentsEnabled = instanceSettings?.experimental.enableEnvironments === true;

  const { data: environments } = useQuery({
    queryKey: queryKeys.environments.list(selectedSpaceId!),
    queryFn: () => environmentsApi.list(selectedSpaceId!),
    enabled: !!selectedSpaceId && environmentsEnabled,
  });

  const { data: environmentCapabilities } = useQuery({
    queryKey: queryKeys.environments.capabilities(selectedSpaceId!),
    queryFn: () => environmentsApi.capabilities(selectedSpaceId!),
    enabled: !!selectedSpaceId && environmentsEnabled,
  });

  const runsQueryKey = [...queryKeys.liveRuns(selectedSpaceId!), "agents-page"] as const;
  const sharedRuns = useSharedPollingQuery({
    spaceId: selectedSpaceId,
    resourceKey: "live-runs:agents-page",
    queryKey: runsQueryKey,
    enabled: !!selectedSpaceId,
    refetchInterval: 15_000,
    leaderOnly: true,
  });
  const { data: runs, dataUpdatedAt: runsUpdatedAt } = useQuery({
    queryKey: runsQueryKey,
    queryFn: () => heartbeatsApi.liveRunsForSpace(selectedSpaceId!),
    enabled: sharedRuns.enabled,
    refetchInterval: sharedRuns.refetchInterval,
  });
  usePublishSharedQueryData(sharedRuns, runs, runsUpdatedAt);

  // Map agentId -> first live run + live run count
  const liveRunByAgent = useMemo(() => {
    const map = new Map<string, { runId: string; liveCount: number }>();
    for (const r of runs ?? []) {
      if (r.status !== "running" && r.status !== "queued") continue;
      const existing = map.get(r.agentId);
      if (existing) {
        existing.liveCount += 1;
        continue;
      }
      map.set(r.agentId, { runId: r.id, liveCount: 1 });
    }
    return map;
  }, [runs]);

  const environmentsById = useMemo(() => {
    const map = new Map<string, Environment>();
    for (const environment of environments ?? []) map.set(environment.id, environment);
    return map;
  }, [environments]);

  const environmentByAgentId = useMemo(() => {
    const map = new Map<string, EnvironmentDescriptor>();
    for (const agent of agents ?? []) {
      map.set(
        agent.id,
        resolveAgentEnvironment(
          agent,
          environmentsById,
          instanceSettings?.defaultEnvironmentId ?? null,
          environmentCapabilities,
        ),
      );
    }
    return map;
  }, [agents, environmentsById, environmentCapabilities, instanceSettings?.defaultEnvironmentId]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Agents" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (requestedTab !== "all") {
      navigate("/agents/all", { replace: true });
    }
  }, [navigate, requestedTab]);

  if (!selectedSpaceId) {
    return <EmptyState icon={Bot} message="Select an outpost to view agents." />;
  }

  // Keep a loaded list on screen through a failed refetch; only a real
  // failure, or an outage before the first load, replaces the page.
  if (isLoading || agentsView.kind === "reconnecting") {
    return <PageSkeleton variant="list" />;
  }
  if (agentsView.kind === "error") {
    return (
      <QueryErrorState
        size="page"
        error={agentsView.error}
        action="load agents"
        onRetry={agentsView.retry}
        retrying={agentsView.isFetching}
      />
    );
  }

  const filtered = filterAgents(agents ?? [], tab, query).filter(rosterFilters.matches);
  const filteredHierarchy = filterAgentHierarchy(agentHierarchy ?? [], tab, query.trim() || rosterFilters.activeCount ? new Set(filtered.map(agent => agent.id)) : undefined);
  const environmentDataLoading = environmentsEnabled && environments === undefined;
  const showEnvironmentColumn = environmentsEnabled && (environments === undefined || environments.length > 1);
  const resolveRenderedEnvironment = (agentId: string) => (
    environmentDataLoading
      ? loadingEnvironmentDescriptor
      : environmentByAgentId.get(agentId) ?? localEnvironmentDescriptor
  );

  const renderAgentRow = (agent: Agent) => {
    const directReportCount = (agents ?? []).filter(
      (candidate) => candidate.leadAgentId === agent.id && !HIDDEN_AGENT_STATUSES.has(candidate.status),
    ).length;
    const hasInvalidCoordination = agent.coordinationHealth?.status === "invalid_coordination_chain";
    return (
      <div key={agent.id} className="agent-pin-row agent-roster-pin-row group/agent-pin relative">
      <EntityRow
        title={agent.name}
        titleAccessory={<AgentCoordinationIndicator directReportCount={directReportCount} />}
        titleClassName="agent-pin-text flex-1"
        titleTextClassName="truncate"
        subtitleClassName="truncate"
        subtitle={agent.title || "Scope owner"}
        to={agentUrl(agent)}
        className="agent-roster-identity group py-3 group-hover/agent-pin:bg-accent/50 group-focus-within/agent-pin:bg-accent/50"
        leading={hasInvalidCoordination ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label="Invalid coordination chain" />
        ) : (
          <AgentAvatar agent={agent} size={32} />
        )}
        secondaryRowClassName={cn("pl-11", !showEnvironmentColumn && !agent.lastHeartbeatAt && "sm:hidden")}
        secondaryRow={(agent.status === "paused" || showEnvironmentColumn || agent.lastHeartbeatAt) && (
          <div className="flex flex-wrap items-center gap-2">
            {showEnvironmentColumn && <span className="text-xs text-muted-foreground" title={resolveRenderedEnvironment(agent.id).title}>
              {resolveRenderedEnvironment(agent.id).label} · {resolveRenderedEnvironment(agent.id).detail}
            </span>}
            {agent.lastHeartbeatAt && <span className="text-xs text-muted-foreground" title="Last heartbeat">{relativeTime(agent.lastHeartbeatAt)}</span>}
          </div>
        )}
      />
      <AgentChatPin agent={agent} pins={agentChatPins} />
      </div>
    );
  };

  const renderAgentStatus = (agent: Agent) => (
    <div className="flex items-center gap-3">
      {liveRunByAgent.has(agent.id) && (
        <LiveRunIndicator
          agentRef={agentRouteRef(agent)}
          runId={liveRunByAgent.get(agent.id)!.runId}
          liveCount={liveRunByAgent.get(agent.id)!.liveCount}
        />
      )}
      <AgentStatusBadge status={agent.status} />
    </div>
  );

  return (
    <div className={cn(
      "flex flex-col gap-4 @container",
      effectiveView === "agent-hierarchy" && "h-full min-h-0",
    )}>
      <AgentsToolbar query={query} onQueryChange={setQuery} view={effectiveView} onViewChange={setView}
        hideViewToggle={forceListView} onNewAgent={openNewAgent} />

      <AgentRosterFilters {...rosterFilters} count={filtered.length} />

      <div className={cn("min-h-0 space-y-4", effectiveView === "agent-hierarchy" && "flex flex-1 flex-col")}>

      {agents && agents.length === 0 && (
        <EmptyState
          icon={Bot}
          message="Create your first agent to get started."
          action="New Agent"
          onAction={openNewAgent}
        />
      )}

      {/* List view */}
      {effectiveView === "list" && agents && agents.length > 0 && (
        <AgentBulkRoster key={selectedSpaceId} spaceId={selectedSpaceId}
          agents={agents}
          visibleAgents={filtered} renderAgent={renderAgentRow} renderStatus={renderAgentStatus}
          renderChat={agentChat.enabled ? agent => (
            // Use Radix's standard hover delay, isolated from the app's instant provider.
            <TooltipPrimitive.Provider skipDelayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/agent-row:opacity-100 focus-visible:opacity-100"
                    aria-label={`Chat with ${agent.name}`}
                    onClick={() => navigate(`/chats/${agentRouteRef(agent)}`)}
                  >
                    <MessagesSquare className="size-3.5" aria-hidden />
                    Chat
                  </button>
                </TooltipTrigger>
                <TooltipContent>chat with this agent</TooltipContent>
              </Tooltip>
            </TooltipPrimitive.Provider>
          ) : undefined} />
      )}



      {/* Agent hierarchy view */}
      {effectiveView === "agent-hierarchy" && filteredHierarchy.length > 0 && (
        <AgentHierarchy embedded agentHierarchy={filteredHierarchy} agents={agents ?? []} />
      )}

      {effectiveView === "agent-hierarchy" && agentHierarchy && agentHierarchy.length > 0 && filteredHierarchy.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agents match your search and filters.
        </p>
      )}

      {effectiveView === "agent-hierarchy" && agentHierarchy && agentHierarchy.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agent hierarchy defined.
        </p>
      )}
      </div>
    </div>
  );
}

/**
 * Provider/model + heartbeat columns shared by the list and org views. The
 * model and adapter label share one fixed-width cell, each line truncating with
 * an ellipsis so a long model id can never overlap the heartbeat column. The
 * heartbeat is single-line (`whitespace-nowrap`) and wide enough for a full
 * date like "Apr 30, 2026".
 */
function AgentMetaColumns({
  agent,
  environment,
  showEnvironment,
}: {
  agent: Agent;
  environment: EnvironmentDescriptor;
  showEnvironment: boolean;
}) {
  const model = getConfiguredModel(agent);
  const adapterLabel = getAdapterLabel(agentDisplayAdapterType(agent));
  return (
    <>
      <div className="w-44 min-w-0 leading-tight">
        <div
          className="truncate font-mono text-xs text-muted-foreground"
          title={model ?? undefined}
        >
          {model ?? "—"}
        </div>
        <div className="truncate font-mono text-(length:--text-micro) text-muted-foreground/70" title={adapterLabel}>
          {adapterLabel}
        </div>
      </div>
      {showEnvironment && (
        <div className="w-44 min-w-0 leading-tight">
          <div className="truncate text-xs text-muted-foreground" title={environment.title}>
            {environment.label}
          </div>
          <div className="truncate text-(length:--text-micro) text-muted-foreground/70">
            {environment.detail}
          </div>
        </div>
      )}
      <span className="w-24 whitespace-nowrap text-right text-xs text-muted-foreground">
        {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"}
      </span>
    </>
  );
}

function LiveRunIndicator({
  agentRef,
  runId,
  liveCount,
}: {
  agentRef: string;
  runId: string;
  liveCount: number;
}) {
  return (
    <Link
      to={`/agents/${agentRef}/runs/${runId}`}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
      <span className="text-(length:--text-micro) font-medium text-blue-600 dark:text-blue-400">
        Live{liveCount > 1 ? ` (${liveCount})` : ""}
      </span>
    </Link>
  );
}
