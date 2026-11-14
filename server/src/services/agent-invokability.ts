import type { Db } from "@outpost/db";
import { agents } from "@outpost/db";
import { getAgentWorkEligibility, type AgentEligibilityAgent, type AgentCoordinationHealth } from "@outpost/shared";
import { eq } from "drizzle-orm";

type AgentStatus = (typeof agents.$inferSelect)["status"];

export type AgentCoordinationRow = Pick<
  typeof agents.$inferSelect,
  "id" | "spaceId" | "name" | "leadAgentId" | "status"
>;

export type AgentInvokabilityBlockReason =
  | "missing"
  | "paused"
  | "terminated"
  | "pending_approval"
  | "unknown_status"
  | "lead_agent_missing"
  | "lead_agent_space_mismatch"
  | "lead_agent_terminated"
  | "coordination_cycle"
  | "coordination_chain_too_deep";

export type AgentInvokability =
  | { invokable: true }
  | {
      invokable: false;
      reason: AgentInvokabilityBlockReason;
      message: string;
      details: Record<string, unknown>;
      invalidCoordinationChain: boolean;
    };

export const DIRECT_NON_INVOKABLE_STATUSES = new Set<AgentStatus>([
  "paused",
  "terminated",
  "pending_approval",
]);

function blocked(
  reason: AgentInvokabilityBlockReason,
  message: string,
  details: Record<string, unknown>,
  invalidCoordinationChain = false,
): AgentInvokability {
  return { invokable: false, reason, message, details, invalidCoordinationChain };
}

function statusBlockReason(status: AgentStatus): AgentInvokabilityBlockReason | null {
  if (status === "paused") return "paused";
  if (status === "terminated") return "terminated";
  if (status === "pending_approval") return "pending_approval";
  return null;
}

function toEligibilityAgent(row: AgentCoordinationRow): AgentEligibilityAgent {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    status: row.status,
    leadAgentId: row.leadAgentId,
  };
}

function invalidChainReason(health: AgentCoordinationHealth): AgentInvokabilityBlockReason {
  if (health.reason === "terminated_ancestor") return "lead_agent_terminated";
  if (health.reason === "cycle") return "coordination_cycle";
  return "lead_agent_missing";
}

export function evaluateAgentInvokability(
  agent: AgentCoordinationRow | null | undefined,
  spaceAgents: AgentCoordinationRow[],
): AgentInvokability {
  if (!agent) {
    return blocked("missing", "Agent no longer exists", {}, false);
  }

  const eligibility = getAgentWorkEligibility({
    agent: toEligibilityAgent(agent),
    agents: spaceAgents.map(toEligibilityAgent),
  });

  if (eligibility.invokable) return { invokable: true };

  const directStatusReason = eligibility.invokabilityReason === "unknown_status"
    ? "unknown_status"
    : statusBlockReason(agent.status);
  if (directStatusReason) {
    return blocked(
      directStatusReason,
      "Agent is not invokable in its current state",
      { agentId: agent.id, agentStatus: agent.status },
      false,
    );
  }

  const health = eligibility.coordinationHealth;
  const firstInvalidAncestor = health.firstInvalidAncestor;
  return blocked(
    invalidChainReason(health),
    "Agent is not invokable because its coordination chain is invalid",
    {
      agentId: agent.id,
      leadAgentId: firstInvalidAncestor?.id ?? null,
      leadAgentStatus: firstInvalidAncestor?.status ?? null,
      coordinationChainAgentIds: health.fullChain
        .filter((entry) => entry.relation === "ancestor")
        .map((entry) => entry.id),
      coordinationHealth: health,
    },
    true,
  );
}

export async function evaluateAgentInvokabilityFromDb(
  db: Db,
  agent: AgentCoordinationRow | null | undefined,
): Promise<AgentInvokability> {
  if (!agent) return evaluateAgentInvokability(agent, []);
  const spaceAgents = await db
    .select({
      id: agents.id,
      spaceId: agents.spaceId,
      name: agents.name,
      leadAgentId: agents.leadAgentId,
      status: agents.status,
    })
    .from(agents)
    .where(eq(agents.spaceId, agent.spaceId));
  return evaluateAgentInvokability(agent, spaceAgents);
}

export function listInvalidCoordinationDescendantIds(
  terminatedAgentId: string,
  spaceAgents: AgentCoordinationRow[],
): string[] {
  const byLead = new Map<string | null, AgentCoordinationRow[]>();
  for (const row of spaceAgents) {
    const siblings = byLead.get(row.leadAgentId ?? null) ?? [];
    siblings.push(row);
    byLead.set(row.leadAgentId ?? null, siblings);
  }

  const invalidDescendantIds: string[] = [];
  const stack = [...(byLead.get(terminatedAgentId) ?? [])];
  const seen = new Set<string>([terminatedAgentId]);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    if (current.status !== "terminated") {
      invalidDescendantIds.push(current.id);
    }
    stack.push(...(byLead.get(current.id) ?? []));
  }
  return invalidDescendantIds;
}

export function shouldCancelRunsForNonInvokableAgent(result: AgentInvokability) {
  return !result.invokable && (result.reason === "terminated" || result.invalidCoordinationChain);
}
