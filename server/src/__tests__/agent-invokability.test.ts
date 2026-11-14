import { describe, expect, it } from "vitest";
import {
  evaluateAgentInvokability,
  listInvalidOrgChainDescendantIds,
  type AgentOrgRow,
} from "../services/agent-invokability.ts";

function agent(partial: Partial<AgentOrgRow> & Pick<AgentOrgRow, "id">): AgentOrgRow {
  return {
    spaceId: "space-1",
    name: partial.id,
    reportsTo: null,
    status: "active",
    ...partial,
  };
}

describe("agent invokability", () => {
  it("blocks active descendants under a terminated manager as invalid-org-chain", () => {
    const rows = [
      agent({ id: "lead", status: "terminated" }),
      agent({ id: "engineering_lead", reportsTo: "lead" }),
      agent({ id: "coder", reportsTo: "engineering_lead" }),
    ];

    const result = evaluateAgentInvokability(rows[2], rows);

    expect(result).toMatchObject({
      invokable: false,
      reason: "manager_terminated",
      invalidOrgChain: true,
      details: {
        managerId: "lead",
        reportingChainAgentIds: ["engineering_lead", "lead"],
      },
    });
  });

  it("reports missing managers and cycles as invalid-org-chain", () => {
    const missingManager = [agent({ id: "coder", reportsTo: "missing" })];
    expect(evaluateAgentInvokability(missingManager[0], missingManager)).toMatchObject({
      invokable: false,
      reason: "manager_missing",
      invalidOrgChain: true,
    });

    const cycle = [
      agent({ id: "a", reportsTo: "b" }),
      agent({ id: "b", reportsTo: "a" }),
    ];
    expect(evaluateAgentInvokability(cycle[0], cycle)).toMatchObject({
      invokable: false,
      reason: "reporting_cycle",
      invalidOrgChain: true,
    });
  });

  it("lists non-terminated descendants made invalid by a terminated root", () => {
    const rows = [
      agent({ id: "lead", status: "terminated" }),
      agent({ id: "engineering_lead", reportsTo: "lead" }),
      agent({ id: "coder", reportsTo: "engineering_lead" }),
      agent({ id: "old-coder", reportsTo: "engineering_lead", status: "terminated" }),
      agent({ id: "other-root" }),
    ];

    expect(listInvalidOrgChainDescendantIds("lead", rows).sort()).toEqual(["coder", "engineering_lead"]);
  });
});
