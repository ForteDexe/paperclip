import { describe, expect, it } from "vitest";
import {
  getAgentOrgChainHealth,
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
    reportsTo: "manager-1",
    ...overrides,
  };
}

describe("agent work eligibility", () => {
  it("allows healthy active agents to accept work and be invoked", () => {
    const agents = [
      agent(),
      agent({ id: "manager-1", name: "Engineering Lead", status: "active", reportsTo: null }),
    ];

    expect(isAgentAssignableToWork({ agent: agents[0]!, agents })).toBe(true);
    expect(isAgentInvokable({ agent: agents[0]!, agents })).toBe(true);
    expect(getAgentWorkEligibility({ agent: agents[0]!, agents })).toMatchObject({
      assignable: true,
      invokable: true,
      assignabilityReason: "eligible",
      invokabilityReason: "eligible",
      orgChainHealth: { status: "healthy" },
    });
  });

  it("blocks terminated and pending approval agents from assignment and invocation", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", reportsTo: null });

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
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", reportsTo: null });

    expect(getAgentWorkEligibility({ agent: target, agents: [target, manager] })).toMatchObject({
      assignable: true,
      invokable: false,
      assignabilityReason: "eligible",
      invokabilityReason: "paused",
    });
  });

  it("reports unknown lifecycle statuses explicitly", () => {
    const target = agent({ status: "sabbatical" });
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", reportsTo: null });

    expect(getAgentWorkEligibility({ agent: target, agents: [target, manager] })).toMatchObject({
      assignable: false,
      invokable: false,
      assignabilityReason: "unknown_status",
      invokabilityReason: "unknown_status",
      orgChainHealth: { status: "healthy" },
    });
  });

  it("blocks active descendants of terminated ancestors and reports repair details", () => {
    const target = agent({ id: "qa-2", name: "QA 2", status: "active", reportsTo: "engineering_lead-2" });
    const terminatedManager = agent({
      id: "engineering_lead-2",
      name: "Engineering Lead 2",
      status: "terminated",
      reportsTo: "lead-2",
    });
    const terminatedRoot = agent({
      id: "lead-2",
      name: "Default agent 2",
      status: "terminated",
      reportsTo: null,
    });
    const agents = [target, terminatedManager, terminatedRoot];

    const health = getAgentOrgChainHealth({ agent: target, agents });
    expect(health.status).toBe("invalid_org_chain");
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
    expect(health.repairGuidance).toContain("QA 2 reports through terminated ancestor Engineering Lead 2");

    const eligibility = getAgentWorkEligibility({ agent: target, agents });
    expect(eligibility.assignable).toBe(false);
    expect(eligibility.invokable).toBe(false);
    expect(eligibility.assignabilityReason).toBe("invalid_org_chain");
    expect(eligibility.invokabilityReason).toBe("invalid_org_chain");
  });

  it("blocks agents whose manager is missing from the space org", () => {
    const target = agent({ id: "qa-3", name: "QA 3", status: "active", reportsTo: "missing-manager" });

    const health = getAgentOrgChainHealth({ agent: target, agents: [target] });
    expect(health.status).toBe("invalid_org_chain");
    expect(health.reason).toBe("missing_manager");
    expect(health.fullChain).toEqual([
      expect.objectContaining({ id: "qa-3", relation: "self", depth: 0 }),
      expect.objectContaining({ id: "missing-manager", status: "missing", relation: "ancestor", depth: 1 }),
    ]);
    expect(health.repairGuidance).toContain("QA 3 reports to missing manager missing-manager");

    const eligibility = getAgentWorkEligibility({ agent: target, agents: [target] });
    expect(eligibility.assignable).toBe(false);
    expect(eligibility.invokable).toBe(false);
    expect(eligibility.assignabilityReason).toBe("invalid_org_chain");
    expect(eligibility.invokabilityReason).toBe("invalid_org_chain");
  });

  it("blocks agents with reporting cycles", () => {
    const target = agent({ id: "qa-4", name: "QA 4", status: "active", reportsTo: "engineering_lead-4" });
    const manager = agent({ id: "engineering_lead-4", name: "Engineering Lead 4", status: "active", reportsTo: "qa-4" });
    const agents = [target, manager];

    const health = getAgentOrgChainHealth({ agent: target, agents });
    expect(health.status).toBe("invalid_org_chain");
    expect(health.reason).toBe("cycle");
    expect(health.fullChain).toEqual([
      expect.objectContaining({ id: "qa-4", relation: "self", depth: 0 }),
      expect.objectContaining({ id: "engineering_lead-4", relation: "ancestor", depth: 1 }),
      expect.objectContaining({ id: "qa-4", status: "cycle", relation: "ancestor", depth: 2 }),
    ]);
    expect(health.repairGuidance).toContain("QA 4 has a cycle in its reporting chain");

    const eligibility = getAgentWorkEligibility({ agent: target, agents });
    expect(eligibility.assignable).toBe(false);
    expect(eligibility.invokable).toBe(false);
    expect(eligibility.assignabilityReason).toBe("invalid_org_chain");
    expect(eligibility.invokabilityReason).toBe("invalid_org_chain");
  });
});

describe("paused escalation path warning", () => {
  it("warns when an active agent's manager is paused", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "paused", reportsTo: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", reportsTo: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.invokable).toBe(true);
    expect(result.orgChainHealth.status).toBe("healthy");
    expect(result.orgChainHealth.pausedAncestors).toEqual([
      { id: "manager-1", name: "Engineering Lead", status: "paused" },
    ]);
    expect(result.orgChainHealth.escalationWarning).toContain("route to paused agent Engineering Lead");
    expect(result.orgChainHealth.escalationWarning).toContain("never runs");
  });

  it("warns about a paused grandparent through a healthy manager", () => {
    const leadership = agent({ id: "exec-1", name: "Default agent", status: "paused", reportsTo: null });
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", reportsTo: "exec-1" });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", reportsTo: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager, leadership] });

    expect(result.orgChainHealth.pausedAncestors).toEqual([
      { id: "exec-1", name: "Default agent", status: "paused" },
    ]);
    expect(result.orgChainHealth.escalationWarning).toContain("Default agent");
  });

  it("does not warn when the agent itself is paused", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "paused", reportsTo: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "paused", reportsTo: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.orgChainHealth.escalationWarning).toBeNull();
    expect(result.orgChainHealth.pausedAncestors).toEqual([
      { id: "manager-1", name: "Engineering Lead", status: "paused" },
    ]);
  });

  it("does not warn for agents with unknown statuses", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "paused", reportsTo: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "mystery", reportsTo: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.invokable).toBe(false);
    expect(result.orgChainHealth.escalationWarning).toBeNull();
  });

  it("does not warn on a fully active chain", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "active", reportsTo: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", reportsTo: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.orgChainHealth.escalationWarning).toBeNull();
    expect(result.orgChainHealth.pausedAncestors).toEqual([]);
  });

  it("keeps invalid-chain classification for terminated ancestors, without duplicating them as paused", () => {
    const manager = agent({ id: "manager-1", name: "Engineering Lead", status: "terminated", reportsTo: null });
    const coder = agent({ id: "agent-1", name: "Coder", status: "active", reportsTo: "manager-1" });
    const result = getAgentWorkEligibility({ agent: coder, agents: [coder, manager] });

    expect(result.orgChainHealth.status).toBe("invalid_org_chain");
    expect(result.orgChainHealth.pausedAncestors).toEqual([]);
  });
});
