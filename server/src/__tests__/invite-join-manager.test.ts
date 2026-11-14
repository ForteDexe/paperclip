import { describe, expect, it } from "vitest";
import { resolveJoinRequestLeadAgentId } from "../routes/access.js";

describe("resolveJoinRequestLeadAgentId", () => {
  it("selects a root peer when no default agent is set", () => {
    const leadAgentId = resolveJoinRequestLeadAgentId([
      { id: "a1", role: "engineering_lead", leadAgentId: null },
      { id: "a2", role: "engineer", leadAgentId: "a1" },
    ]);

    expect(leadAgentId).toBe("a1");
  });

  it("prefers the explicit default agent", () => {
    const leadAgentId = resolveJoinRequestLeadAgentId([
      { id: "root", role: "general", leadAgentId: null },
      { id: "primary", role: "general", leadAgentId: "root" },
    ], "primary");

    expect(leadAgentId).toBe("primary");
  });

  it("does not prioritize a Default agent title over the first root peer", () => {
    const leadAgentId = resolveJoinRequestLeadAgentId([
      { id: "lead-child", role: "lead", leadAgentId: "manager-1" },
      { id: "manager-1", role: "engineering_lead", leadAgentId: null },
      { id: "lead-root", role: "lead", leadAgentId: null },
    ]);

    expect(leadAgentId).toBe("manager-1");
  });

  it("prefers an available root peer over nested agents", () => {
    const leadAgentId = resolveJoinRequestLeadAgentId([
      { id: "lead-1", role: "lead", leadAgentId: "mgr" },
      { id: "lead-2", role: "lead", leadAgentId: "mgr" },
      { id: "mgr", role: "engineering_lead", leadAgentId: null },
    ]);

    expect(leadAgentId).toBe("mgr");
  });

  it("returns null for an empty Space", () => {
    expect(resolveJoinRequestLeadAgentId([])).toBeNull();
  });
});
