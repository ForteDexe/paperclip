import { describe, expect, it } from "vitest";
import {
  getAgentCoordinationHealth,
  getAgentWorkEligibility,
  isAgentAssignableToWork,
  isAgentInvokable,
  type AgentEligibilityAgent,
} from "./agent-eligibility.js";

const spaceId = "space-1";

function agent(overrides: Partial<AgentEligibilityAgent> = {}): AgentEligibilityAgent {
  return {
    id: "agent-1",
    spaceId,
    name: "Coder",
    status: "active",
    leadAgentId: "manager-1",
    ...overrides,
  };
}

describe("agent work eligibility", () => {
  it("allows healthy active agents to accept work and be invoked", () => {
    const agents = [
      agent(),
      agent({ id: "manager-1", name: "Engineering Lead", status: "active", leadAgentId: null }),
    ];

    expect(isAgentAssignableToWork({ agent: agents[0]!, agents })).toBe(true);
    expect(isAgentInvokable({ agent: agents[0]!, agents })).toBe(true);
    expect(getAgentWorkEligibility({ agent: agents[0]!, agents })).toMatchObject({
      assignable: true,
      invokable: true,
      assignabilityReason: "eligible",
      invokabilityReason: "eligible",
      coordinationHealth: { status: "healthy" },
    });
  });

  it("blocks terminated and pending approval agents from assignment and invocation", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", leadAgentId: null });

    for (const status of ["terminated", "pending_approval"]) {
      const target = agent({ status });
      const eligibility = getAgentWorkEligibility({ agent: target, agents: [target, manager] });

      expect(eligibility.assignable).toBe(false);
      expect(eligibility.invokable).toBe(false);
      expect(eligibility.assignabilityReason).toBe(status);
      expect(eligibility.invokabilityReason).toBe(status);
    }
  });

  it("allows paused agents to keep assignments but blocks invocation", () => {
    const target = agent({ status: "paused" });
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", leadAgentId: null });

    expect(getAgentWorkEligibility({ agent: target, agents: [target, manager] })).toMatchObject({
      assignable: true,
      invokable: false,
      assignabilityReason: "eligible",
      invokabilityReason: "paused",
    });
  });

  it("reports unknown lifecycle statuses explicitly", () => {
    const target = agent({ status: "sabbatical" });
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", leadAgentId: null });

    expect(getAgentWorkEligibility({ agent: target, agents: [target, manager] })).toMatchObject({
      assignable: false,
      invokable: false,
      assignabilityReason: "unknown_status",
      invokabilityReason: "unknown_status",
      coordinationHealth: { status: "healthy" },
    });
  });

  it("blocks active descendants of terminated ancestors and reports repair details", () => {
    const target = agent({ id: "qa-2", name: "QA 2", status: "active", leadAgentId: "engineering_lead-2" });
    const terminatedLead = agent({
      id: "engineering_lead-2",
      name: "Engineering Lead 2",
      status: "terminated",
      leadAgentId: "lead-2",
    });
    const terminatedRoot = agent({
      id: "lead-2",
      name: "Default agent 2",
      status: "terminated",
      leadAgentId: null,
    });
    const agents = [target, terminatedLead, terminatedRoot];

    const health = getAgentCoordinationHealth({ agent: target, agents });
    expect(health.status).toBe("invalid_coordination_chain");
    expect(health.reason).toBe("terminated_ancestor");
    expect(health.fullChain).toEqual([
      expect.objectContaining({ id: "qa-2", name: "QA 2", relation: "self", depth: 0 }),
      expect.objectContaining({ id: "engineering_lead-2", name: "Engineering Lead 2", status: "terminated", relation: "ancestor", depth: 1 }),
      expect.objectContaining({ id: "lead-2", name: "Default agent 2", status: "terminated", relation: "ancestor", depth: 2 }),
    ]);
    expect(health.firstInvalidAncestor).toEqual({ id: "engineering_lead-2", name: "Engineering Lead 2", status: "terminated" });
    expect(health.invalidAncestors).toEqual([
      { id: "engineering_lead-2", name: "Engineering Lead 2", status: "terminated" },
      { id: "lead-2", name: "Default agent 2", status: "terminated" },
    ]);
    expect(health.repairGuidance).toContain("QA 2 is coordinated through terminated agent Engineering Lead 2");

    const eligibility = getAgentWorkEligibility({ agent: target, agents });
    expect(eligibility.assignable).toBe(false);
    expect(eligibility.invokable).toBe(false);
    expect(eligibility.assignabilityReason).toBe("invalid_coordination_chain");
    expect(eligibility.invokabilityReason).toBe("invalid_coordination_chain");
  });

  it("blocks agents whose manager is missing from the space org", () => {
    const target = agent({ id: "qa-3", name: "QA 3", status: "active", leadAgentId: "missing-manager" });

    const health = getAgentCoordinationHealth({ agent: target, agents: [target] });
    expect(health.status).toBe("invalid_coordination_chain");
    expect(health.reason).toBe("missing_lead_agent");
    expect(health.fullChain).toEqual([
      expect.objectContaining({ id: "qa-3", relation: "self", depth: 0 }),
      expect.objectContaining({ id: "missing-manager", status: "missing", relation: "ancestor", depth: 1 }),
    ]);
    expect(health.repairGuidance).toContain("QA 3 references missing coordination lead missing-manager");

    const eligibility = getAgentWorkEligibility({ agent: target, agents: [target] });
    expect(eligibility.assignable).toBe(false);
    expect(eligibility.invokable).toBe(false);
    expect(eligibility.assignabilityReason).toBe("invalid_coordination_chain");
    expect(eligibility.invokabilityReason).toBe("invalid_coordination_chain");
  });

  it("blocks agents with reporting cycles", () => {
    const target = agent({ id: "qa-4", name: "QA 4", status: "active", leadAgentId: "engineering_lead-4" });
    const manager = agent({ id: "engineering_lead-4", name: "Engineering Lead 4", status: "active", leadAgentId: "qa-4" });
    const agents = [target, manager];

    const health = getAgentCoordinationHealth({ agent: target, agents });
    expect(health.status).toBe("invalid_coordination_chain");
    expect(health.reason).toBe("cycle");
    expect(health.fullChain).toEqual([
      expect.objectContaining({ id: "qa-4", relation: "self", depth: 0 }),
      expect.objectContaining({ id: "engineering_lead-4", relation: "ancestor", depth: 1 }),
      expect.objectContaining({ id: "qa-4", status: "cycle", relation: "ancestor", depth: 2 }),
    ]);
    expect(health.repairGuidance).toContain("QA 4 has a cycle in its coordination chain");

    const eligibility = getAgentWorkEligibility({ agent: target, agents });
    expect(eligibility.assignable).toBe(false);
    expect(eligibility.invokable).toBe(false);
    expect(eligibility.assignabilityReason).toBe("invalid_coordination_chain");
    expect(eligibility.invokabilityReason).toBe("invalid_coordination_chain");
  });
});

describe("paused escalation path warning", () => {
  it("warns when an active agent's manager is paused", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "paused", leadAgentId: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", leadAgentId: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.invokable).toBe(true);
    expect(result.coordinationHealth.status).toBe("healthy");
    expect(result.coordinationHealth.pausedAncestors).toEqual([
      { id: "manager-1", name: "Engineering Lead", status: "paused" },
    ]);
    expect(result.coordinationHealth.escalationWarning).toContain("route to paused agent Engineering Lead");
    expect(result.coordinationHealth.escalationWarning).toContain("never runs");
  });

  it("warns about a paused grandparent through a healthy manager", () => {
    const leadership = agent({ id: "exec-1", name: "Default agent", status: "paused", leadAgentId: null });
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", leadAgentId: "exec-1" });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", leadAgentId: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager, leadership] });

    expect(result.coordinationHealth.pausedAncestors).toEqual([
      { id: "exec-1", name: "Default agent", status: "paused" },
    ]);
    expect(result.coordinationHealth.escalationWarning).toContain("Default agent");
  });

  it("does not warn when the agent itself is paused", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "paused", leadAgentId: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "paused", leadAgentId: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.coordinationHealth.escalationWarning).toBeNull();
    expect(result.coordinationHealth.pausedAncestors).toEqual([
      { id: "manager-1", name: "Engineering Lead", status: "paused" },
    ]);
  });

  it("does not warn for agents with unknown statuses", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "paused", leadAgentId: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "mystery", leadAgentId: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.invokable).toBe(false);
    expect(result.coordinationHealth.escalationWarning).toBeNull();
  });

  it("does not warn on a fully active chain", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", leadAgentId: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", leadAgentId: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.coordinationHealth.escalationWarning).toBeNull();
    expect(result.coordinationHealth.pausedAncestors).toEqual([]);
  });

  it("keeps invalid-chain classification for terminated ancestors, without duplicating them as paused", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "terminated", leadAgentId: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", leadAgentId: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.coordinationHealth.status).toBe("invalid_coordination_chain");
    expect(result.coordinationHealth.pausedAncestors).toEqual([]);
  });
});
