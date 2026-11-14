import type { AgentStatus } from "./constants.js";

export type AgentEligibilityLifecycleReason =
  | "eligible"
  | "terminated"
  | "pending_approval"
  | "paused"
  | "invalid_coordination_chain"
  | "unknown_status";

export interface AgentEligibilityAgent {
  id: string;
  spaceId: string;
  name: string;
  status: AgentStatus | string;
  leadAgentId?: string | null;
}

export interface AgentCoordinationChainEntry {
  id: string;
  spaceId: string;
  name: string;
  status: AgentStatus | string;
  leadAgentId: string | null;
  depth: number;
  relation: "self" | "ancestor";
}

export interface AgentInvalidCoordinationAncestor {
  id: string;
  name: string;
  status: AgentStatus | string;
}

export type AgentCoordinationInvalidReason =
  | "healthy"
  | "terminated_ancestor"
  | "missing_lead_agent"
  | "cycle";

export interface AgentCoordinationHealth {
  status: "healthy" | "invalid_coordination_chain";
  reason: AgentCoordinationInvalidReason;
  fullChain: AgentCoordinationChainEntry[];
  firstInvalidAncestor: AgentInvalidCoordinationAncestor | null;
  invalidAncestors: AgentInvalidCoordinationAncestor[];
  repairGuidance: string | null;
  /**
   * Paused ancestors of a non-paused agent. A paused coordination lead does not make
   * the chain invalid (the agent stays invokable), but escalations routed to
   * it dead-letter: assigned work never runs and nothing surfaces it. This is
   * a warning, not a block.
   */
  pausedAncestors?: AgentInvalidCoordinationAncestor[];
  /** Human-readable warning when the escalation path routes to a paused agent. */
  escalationWarning?: string | null;
}

export interface AgentWorkEligibility {
  assignable: boolean;
  invokable: boolean;
  assignabilityReason: AgentEligibilityLifecycleReason;
  invokabilityReason: AgentEligibilityLifecycleReason;
  coordinationHealth: AgentCoordinationHealth;
}

const NON_ASSIGNABLE_AGENT_STATUSES = new Set<string>(["terminated", "pending_approval"]);
const NON_INVOKABLE_AGENT_STATUSES = new Set<string>(["terminated", "pending_approval", "paused"]);
const ASSIGNABLE_AGENT_STATUSES = new Set<string>(["active", "paused", "idle", "running", "error"]);
const INVOKABLE_AGENT_STATUSES = new Set<string>(["active", "idle", "running", "error"]);

export function isAgentStatusAssignableToWork(status: AgentStatus | string): boolean {
  return ASSIGNABLE_AGENT_STATUSES.has(status) && !NON_ASSIGNABLE_AGENT_STATUSES.has(status);
}

export function isAgentStatusInvokable(status: AgentStatus | string): boolean {
  return INVOKABLE_AGENT_STATUSES.has(status) && !NON_INVOKABLE_AGENT_STATUSES.has(status);
}

function chainEntry(
  agent: AgentEligibilityAgent,
  depth: number,
  relation: AgentCoordinationChainEntry["relation"],
): AgentCoordinationChainEntry {
  return {
    id: agent.id,
    spaceId: agent.spaceId,
    name: agent.name,
    status: agent.status,
    leadAgentId: agent.leadAgentId ?? null,
    depth,
    relation,
  };
}

function invalidAncestor(agent: AgentEligibilityAgent): AgentInvalidCoordinationAncestor {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
  };
}

function buildRepairGuidance(
  agent: AgentEligibilityAgent,
  firstInvalidAncestor: AgentInvalidCoordinationAncestor,
): string {
  if (firstInvalidAncestor.status === "missing") {
    return [
      `${agent.name} references missing coordination lead ${firstInvalidAncestor.id}.`,
      `Assign ${agent.name} or the nearest affected ancestor to an active lead or make it a root agent, or explicitly pause or terminate the invalid subtree before assigning work or starting runs.`,
    ].join(" ");
  }
  if (firstInvalidAncestor.status === "cycle") {
    return [
      `${agent.name} has a cycle in its coordination chain at ${firstInvalidAncestor.name}.`,
      `Break the cycle by assigning one affected agent to an active lead or making it a root agent, or explicitly pause or terminate the invalid subtree before assigning work or starting runs.`,
    ].join(" ");
  }
  return [
    `${agent.name} is coordinated through terminated agent ${firstInvalidAncestor.name}.`,
    `Assign ${agent.name} or the nearest affected ancestor to an active lead or make it a root agent, or explicitly pause or terminate the invalid subtree before assigning work or starting runs.`,
  ].join(" ");
}

export function getAgentCoordinationHealth(input: {
  agent: AgentEligibilityAgent;
  agents: AgentEligibilityAgent[];
}): AgentCoordinationHealth {
  const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
  const fullChain: AgentCoordinationChainEntry[] = [chainEntry(input.agent, 0, "self")];
  const invalidAncestors: AgentInvalidCoordinationAncestor[] = [];
  const pausedAncestors: AgentInvalidCoordinationAncestor[] = [];
  const seen = new Set<string>([input.agent.id]);

  let current = input.agent;
  let depth = 1;
  while (current.leadAgentId) {
    if (seen.has(current.leadAgentId)) {
      const cycleAgent = byId.get(current.leadAgentId);
      const invalid = {
        id: current.leadAgentId,
        name: cycleAgent?.name ?? current.leadAgentId,
        status: "cycle",
      };
      fullChain.push({
        id: invalid.id,
        spaceId: input.agent.spaceId,
        name: invalid.name,
        status: invalid.status,
        leadAgentId: cycleAgent?.leadAgentId ?? null,
        depth,
        relation: "ancestor",
      });
      invalidAncestors.push(invalid);
      break;
    }
    seen.add(current.leadAgentId);

    const parent = byId.get(current.leadAgentId);
    if (!parent || parent.spaceId !== input.agent.spaceId) {
      const invalid = {
        id: current.leadAgentId,
        name: current.leadAgentId,
        status: "missing",
      };
      fullChain.push({
        id: invalid.id,
        spaceId: input.agent.spaceId,
        name: invalid.name,
        status: invalid.status,
        leadAgentId: null,
        depth,
        relation: "ancestor",
      });
      invalidAncestors.push(invalid);
      break;
    }

    fullChain.push(chainEntry(parent, depth, "ancestor"));
    if (parent.status === "terminated") {
      invalidAncestors.push(invalidAncestor(parent));
    }
    if (parent.status === "paused") {
      pausedAncestors.push({ id: parent.id, name: parent.name, status: "paused" });
    }

    current = parent;
    depth += 1;
  }

  const firstInvalidAncestor = invalidAncestors[0] ?? null;
  // Only warn for agents that can themselves receive and run work: a paused,
  // terminated, or unknown-status agent's escalation path is moot until it is
  // invokable again. Allowlist on purpose — a denylist complement would treat
  // unrecognized statuses as workable and warn misleadingly.
  const agentCanWork = isAgentStatusInvokable(input.agent.status);
  const firstPausedAncestor = pausedAncestors[0] ?? null;
  const escalationWarning = agentCanWork && firstPausedAncestor
    ? `Escalations from ${input.agent.name} route to paused agent ${firstPausedAncestor.name}. ` +
      `Work assigned to a paused agent never runs; unpause ${firstPausedAncestor.name} or change this agent's coordination lead.`
    : null;
  return {
    status: firstInvalidAncestor ? "invalid_coordination_chain" : "healthy",
    reason: firstInvalidAncestor
      ? firstInvalidAncestor.status === "missing"
        ? "missing_lead_agent"
        : firstInvalidAncestor.status === "cycle"
          ? "cycle"
          : "terminated_ancestor"
      : "healthy",
    fullChain,
    firstInvalidAncestor,
    invalidAncestors,
    repairGuidance: firstInvalidAncestor
      ? buildRepairGuidance(input.agent, firstInvalidAncestor)
      : null,
    pausedAncestors,
    escalationWarning,
  };
}

export function getAgentWorkEligibility(input: {
  agent: AgentEligibilityAgent;
  agents: AgentEligibilityAgent[];
}): AgentWorkEligibility {
  const coordinationHealth = getAgentCoordinationHealth(input);
  const assignabilityReason: AgentEligibilityLifecycleReason = !isAgentStatusAssignableToWork(input.agent.status)
    ? input.agent.status === "terminated"
      ? "terminated"
      : input.agent.status === "pending_approval"
        ? "pending_approval"
        : "unknown_status"
    : coordinationHealth.status === "invalid_coordination_chain"
      ? "invalid_coordination_chain"
      : "eligible";
  const invokabilityReason: AgentEligibilityLifecycleReason = !isAgentStatusInvokable(input.agent.status)
    ? input.agent.status === "terminated"
      ? "terminated"
      : input.agent.status === "pending_approval"
        ? "pending_approval"
        : input.agent.status === "paused"
          ? "paused"
          : "unknown_status"
    : coordinationHealth.status === "invalid_coordination_chain"
      ? "invalid_coordination_chain"
      : "eligible";

  return {
    assignable: assignabilityReason === "eligible",
    invokable: invokabilityReason === "eligible",
    assignabilityReason,
    invokabilityReason,
    coordinationHealth,
  };
}

export function isAgentAssignableToWork(input: {
  agent: AgentEligibilityAgent;
  agents: AgentEligibilityAgent[];
}): boolean {
  return getAgentWorkEligibility(input).assignable;
}

export function isAgentInvokable(input: {
  agent: AgentEligibilityAgent;
  agents: AgentEligibilityAgent[];
}): boolean {
  return getAgentWorkEligibility(input).invokable;
}
