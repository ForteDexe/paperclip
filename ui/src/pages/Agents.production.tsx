import { AgentCoordinationIndicator } from "@/components/AgentCoordinationIndicator";
import { AgentBulkRoster } from "@/components/agents/AgentBulkRoster";
import { AgentRosterFilters, useAgentRosterFilters } from "@/components/agents/AgentRosterFilters";
import { AgentAvatar } from "@/components/AgentAvatar";
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
import { queryKeys } from "../lib/queryKeys";
import { isPlatformManagedEnvironment } from "../lib/managed-sandbox-environment";
import { AgentStatusBadge, AgentStatusCapsule } from "../components/StatusBadge";
import { EntityRow } from "../components/EntityRow";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { QueryErrorState, useQueryView } from "../components/QueryView";
import { relativeTime, cn, agentRouteRef, agentUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bot, Plus, List, GitBranch } from "lucide-react";
import type { Agent, Environment, EnvironmentCapabilities } from "@outpost/shared";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";

import { getAdapterLabel } from "../adapters/adapter-display-registry";


// Lazy-loaded so the roster page doesn't statically pull in the full
// AgentConfigForm module graph (the modal reuses its adapter/model pickers).
export const AGENT_FILTER_TABS = ["all", "active", "paused", "error"] as const;
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

function filterAgents(agents: Agent[], tab: FilterTab): Agent[] {
  return agents
    .filter((a) => {
      if (HIDDEN_AGENT_STATUSES.has(a.status)) return false;
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

function filterAgentHierarchy(nodes: AgentHierarchyNode[], tab: FilterTab, matchingIds?: Set<string>): AgentHierarchyNode[] {
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

export function Agents() {
  const { selectedSpaceId } = useSpace();
  const { openNewAgent } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useSidebar();
  const pathSegment = location.pathname.split("/").pop() ?? "all";
  const requestedTab: FilterTab = isFilterTab(pathSegment) ? pathSegment : "all";
  const [view, setView] = useState<"list" | "agent-hierarchy">("agent-hierarchy");
  const forceListView = isMobile;
  const effectiveView: "list" | "agent-hierarchy" = forceListView ? "list" : view;

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

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

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
    return <EmptyState icon={Bot} message="Select an Outpost to view agents." />;
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

  const filtered = filterAgents(agents ?? [], tab).filter(rosterFilters.matches);
  const filteredHierarchy = filterAgentHierarchy(agentHierarchy ?? [], tab, rosterFilters.activeCount ? new Set(filtered.map(agent => agent.id)) : undefined);
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
      <EntityRow
        key={agent.id}
        title={agent.name}
        titleAccessory={<AgentCoordinationIndicator directReportCount={directReportCount} />}
        // Fixed (truncating) title width at xl so the `meta` group starts at a
        // constant x on every row — that's what makes the model + timestamp
        // columns line up vertically. Below xl the meta columns are hidden, so
        // the title flexes instead: a fixed width there let the shrink-0
        // trailing actions squeeze the name to zero width on mobile.
        titleClassName="flex-1"
        titleTextClassName="whitespace-normal break-words xl:truncate xl:whitespace-nowrap"
        subtitleClassName="whitespace-normal break-words xl:truncate xl:whitespace-nowrap"
        subtitle={agent.title || "Scope owner"}
        to={agentUrl(agent)}
        className="agent-roster-identity group py-3"
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          {/* View toggle */}
          {!forceListView && (
            <div className="flex items-center border border-border" role="group" aria-label="View mode">
              <button
                className={cn(
                  "p-1.5 transition-colors",
                  effectiveView === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                )}
                onClick={() => setView("list")}
                title="List view"
                aria-label="List view"
                aria-pressed={effectiveView === "list"}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                className={cn(
                  "p-1.5 transition-colors",
                  effectiveView === "agent-hierarchy" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                )}
                onClick={() => setView("agent-hierarchy")}
                title="Agent hierarchy view"
                aria-label="Agent hierarchy view"
                aria-pressed={effectiveView === "agent-hierarchy"}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={openNewAgent}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Agent
          </Button>
        </div>
      </div>

      <AgentRosterFilters {...rosterFilters} count={filtered.length} />

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
          visibleAgents={filtered} renderAgent={renderAgentRow} renderStatus={renderAgentStatus} />
      )}



      {/* Agent hierarchy view */}
      {effectiveView === "agent-hierarchy" && filteredHierarchy.length > 0 && (
        <div className="py-1">
          {filteredHierarchy.map((node) => (
            <HierarchyNode
              key={node.id}
              node={node}
              depth={0}
              agentMap={agentMap}
              liveRunByAgent={liveRunByAgent}
              environmentByAgentId={environmentByAgentId}
              environmentDataLoading={environmentDataLoading}
              showEnvironment={showEnvironmentColumn}
            />
          ))}
        </div>
      )}

      {effectiveView === "agent-hierarchy" && agentHierarchy && agentHierarchy.length > 0 && filteredHierarchy.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agents match the selected filters.
        </p>
      )}

      {effectiveView === "agent-hierarchy" && agentHierarchy && agentHierarchy.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agent hierarchy defined.
        </p>
      )}
    </div>
  );
}

function HierarchyNode({
  node,
  depth,
  agentMap,
  liveRunByAgent,
  environmentByAgentId,
  environmentDataLoading,
  showEnvironment,
}: {
  node: AgentHierarchyNode;
  depth: number;
  agentMap: Map<string, Agent>;
  liveRunByAgent: Map<string, { runId: string; liveCount: number }>;
  environmentByAgentId: Map<string, EnvironmentDescriptor>;
  environmentDataLoading: boolean;
  showEnvironment: boolean;
}) {
  const agent = agentMap.get(node.id);
  const hasInvalidCoordination = Boolean(agent && agent.coordinationHealth?.status === "invalid_coordination_chain");

  return (
    <div style={{ paddingLeft: depth * 24 }}>
      <Link
        to={agent ? agentUrl(agent) : `/agents/${node.id}`}
        className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors w-full text-left no-underline text-inherit"
      >
        {hasInvalidCoordination ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Invalid coordination chain" />
        ) : (
          <AgentAvatar agent={agent ?? node} size={24} />
        )}
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
          {/* Name floor + `truncate` keeps the primary identifier readable; the
              cluster wraps to a second line under pressure instead of starving
              the name at narrow widths. */}
          <div className="min-w-(--sz-7rem) truncate">
            <span className="text-sm font-medium">{node.name}</span>
            <span className="text-xs text-muted-foreground ml-2">{agent?.title || "Scope owner"}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="sm:hidden">
            {liveRunByAgent.has(node.id) ? (
              <LiveRunIndicator
                agentRef={agent ? agentRouteRef(agent) : node.id}
                runId={liveRunByAgent.get(node.id)!.runId}
                liveCount={liveRunByAgent.get(node.id)!.liveCount}
              />
            ) : (
              <AgentStatusBadge status={node.status} />
            )}
          </span>
          <div className="hidden sm:flex items-center gap-3">
            {liveRunByAgent.has(node.id) && (
              <LiveRunIndicator
                agentRef={agent ? agentRouteRef(agent) : node.id}
                runId={liveRunByAgent.get(node.id)!.runId}
                liveCount={liveRunByAgent.get(node.id)!.liveCount}
              />
            )}
            {agent && (
              <div className="hidden xl:flex items-center gap-3">
                <AgentMetaColumns
                  agent={agent}
                  environment={
                    environmentDataLoading
                      ? loadingEnvironmentDescriptor
                      : environmentByAgentId.get(agent.id) ?? localEnvironmentDescriptor
                  }
                  showEnvironment={showEnvironment}
                />
              </div>
            )}
            <span className="w-20 flex justify-end">
              <AgentStatusBadge status={node.status} />
            </span>
          </div>
        </div>
      </Link>
      {node.children && node.children.length > 0 && (
        <div className="border-l border-border ml-4">
          {node.children.map((child) => (
            <HierarchyNode
              key={child.id}
              node={child}
              depth={depth + 1}
              agentMap={agentMap}
              liveRunByAgent={liveRunByAgent}
              environmentByAgentId={environmentByAgentId}
              environmentDataLoading={environmentDataLoading}
              showEnvironment={showEnvironment}
            />
          ))}
        </div>
      )}
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
  const adapterLabel = getAdapterLabel(agent.adapterType);
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
