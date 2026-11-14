import { describe, expect, it } from "vitest";
import {
  evaluateAgentInvokability,
  listInvalidCoordinationDescendantIds,
  type AgentCoordinationRow,
} from "../services/agent-invokability.ts";

function agent(partial: Partial<AgentCoordinationRow> & Pick<AgentCoordinationRow, "id">): AgentCoordinationRow {
  return {
    spaceId: "space-1",
    name: partial.id,
    leadAgentId: null,
    status: "active",
    ...partial,
  };
}

describe("agent invokability", () => {
  it("blocks active descendants under a terminated lead agent as invalid-coordination-chain", () => {
    const rows = [
      agent({ id: "lead", status: "terminated" }),
      agent({ id: "engineering_lead", leadAgentId: "lead" }),
      agent({ id: "coder", leadAgentId: "engineering_lead" }),
    ];

    const result = evaluateAgentInvokability(rows[2], rows);

    expect(result).toMatchObject({
      invokable: false,
      reason: "lead_agent_terminated",
      invalidCoordinationChain: true,
      details: {
        leadAgentId: "lead",
        coordinationChainAgentIds: ["engineering_lead", "lead"],
      },
    });
  });

  it("reports missing managers and cycles as invalid-coordination-chain", () => {
    const missingManager = [agent({ id: "coder", leadAgentId: "missing" })];
    expect(evaluateAgentInvokability(missingManager[0], missingManager)).toMatchObject({
      invokable: false,
      reason: "lead_agent_missing",
      invalidCoordinationChain: true,
    });

    const cycle = [
      agent({ id: "a", leadAgentId: "b" }),
      agent({ id: "b", leadAgentId: "a" }),
    ];
    expect(evaluateAgentInvokability(cycle[0], cycle)).toMatchObject({
      invokable: false,
      reason: "coordination_cycle",
      invalidCoordinationChain: true,
    });
  });

  it("lists non-terminated descendants made invalid by a terminated root", () => {
    const rows = [
      agent({ id: "lead", status: "terminated" }),
      agent({ id: "engineering_lead", leadAgentId: "lead" }),
      agent({ id: "coder", leadAgentId: "engineering_lead" }),
      agent({ id: "old-coder", leadAgentId: "engineering_lead", status: "terminated" }),
      agent({ id: "other-root" }),
    ];

    expect(listInvalidCoordinationDescendantIds("lead", rows).sort()).toEqual(["coder", "engineering_lead"]);
  });
});
