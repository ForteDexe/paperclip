import { describe, expect, it } from "vitest";
import { AGENT_ROLE_LABELS } from "@outpost/shared";
import { DEFAULT_AGENT_NAME, nextAgentNameForRole } from "./onboarding-agent-role";

describe("nextAgentNameForRole", () => {
  it("fills the name from the role when the field is empty", () => {
    expect(nextAgentNameForRole({ currentName: "", nextRole: "engineering_lead" })).toBe(
      AGENT_ROLE_LABELS.engineering_lead,
    );
  });

  it("replaces the default name the wizard supplied", () => {
    expect(nextAgentNameForRole({ currentName: DEFAULT_AGENT_NAME, nextRole: "designer" })).toBe(
      AGENT_ROLE_LABELS.designer,
    );
  });

  it("replaces a label left by a previous role", () => {
    // Picking Engineering Lead then Product Lead should leave "Product Lead", not "Engineering Lead".
    expect(nextAgentNameForRole({ currentName: AGENT_ROLE_LABELS.engineering_lead, nextRole: "product" })).toBe(
      AGENT_ROLE_LABELS.product,
    );
  });

  it("keeps a name the customer typed", () => {
    // The failure this prevents is silent: the field still holds a plausible
    // name afterwards, so the loss is invisible until the agent is created.
    expect(nextAgentNameForRole({ currentName: "Ada", nextRole: "engineer" })).toBe("Ada");
  });

  it("keeps a typed name that only differs by surrounding space", () => {
    expect(nextAgentNameForRole({ currentName: "  Ada  ", nextRole: "engineer" })).toBe("  Ada  ");
  });

  it("treats a whitespace-only field as empty", () => {
    expect(nextAgentNameForRole({ currentName: "   ", nextRole: "qa" })).toBe(AGENT_ROLE_LABELS.qa);
  });
});
