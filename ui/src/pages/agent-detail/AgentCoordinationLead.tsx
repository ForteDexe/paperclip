import { Pencil, UserRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@outpost/shared";
import { agentsApi } from "@/api/agents";
import { QueryErrorState, useQueryView } from "@/components/QueryView";
import { CoordinationLeadPicker } from "@/components/CoordinationLeadPicker";
import { AgentIdentityChipContent, agentIdentityChipClass } from "@/components/agents/AgentIdentityChip";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import { agentDetailHref } from "../agent-detail-navigation";

/** A coordination lead cannot be the agent itself or any agent it coordinates. */
export function invalidLeadAgentIds(agentId: string, agents: Agent[]): string[] {
  const invalid = new Set([agentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const agent of agents) {
      if (agent.leadAgentId && invalid.has(agent.leadAgentId) && !invalid.has(agent.id)) {
        invalid.add(agent.id);
        changed = true;
      }
    }
  }
  return [...invalid];
}

export function AgentCoordinationLead({ agent }: { agent: Agent }) {
  const client = useQueryClient();
  const directory = useQuery({
    queryKey: queryKeys.agents.list(agent.spaceId),
    queryFn: () => agentsApi.list(agent.spaceId),
  });
  const directoryView = useQueryView(directory);
  const update = useMutation({
    mutationFn: (leadAgentId: string | null) => agentsApi.update(agent.id, { leadAgentId }, agent.spaceId),
    onSuccess: () => client.invalidateQueries({ queryKey: ["agents"] }),
  });
  const agents = directory.data ?? [];
  const lead = agents.find((candidate) => candidate.id === agent.leadAgentId);
  const disabled = !directory.data || directoryView.kind === "error" || update.isPending;
  return <div className="flex flex-col gap-1.5 px-(--agent-detail-module-inset) py-1.5 text-sm">
    <span className="text-muted-foreground">Coordination lead:</span>
    <div className="flex items-center gap-1.5">
      {lead ? <Link to={agentDetailHref(agentRouteRef(lead))} className={`${agentIdentityChipClass} no-underline`}>
        <AgentIdentityChipContent agent={lead} />
      </Link> : null}
      <CoordinationLeadPicker
        agents={agents}
        value={agent.leadAgentId}
        onChange={(id) => update.mutate(id)}
        disabled={disabled}
        disabledAgentIds={invalidLeadAgentIds(agent.id, agents)}
        trigger={<button type="button" disabled={disabled} aria-label={lead ? "Change coordination lead" : "Choose coordination lead"}
          className={`${lead ? "agent-identity-chip inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground transition-colors" : agentIdentityChipClass} disabled:cursor-not-allowed disabled:opacity-50`}>
          {lead ? <Pencil className="size-3.5" aria-hidden /> : <><UserRound className="size-5 text-muted-foreground" aria-hidden /><span>{agent.leadAgentId ? "Lead unavailable" : "No coordination lead"}</span></>}
        </button>}
      />
    </div>
    {directoryView.kind === "error" ? <QueryErrorState error={directoryView.error} size="inline" action="load agents" onRetry={directoryView.retry} retrying={directoryView.isFetching} /> : null}
    {update.error ? <QueryErrorState error={update.error} size="inline" action="change coordination lead" /> : null}
  </div>;
}
