import { describe, expect, it } from "vitest";
import type { SpaceUserDirectoryEntry } from "../api/access";
import { humanAgentCreatorUserId, resolveAgentCreatorLabel } from "./agent-creator";

function member(principalId: string, name: string | null, email: string | null = null): SpaceUserDirectoryEntry {
  return { principalId, status: "active", membershipRole: null, user: { id: principalId, name, email, image: null } };
}

describe("agent creator label", () => {
  const alice = member("user-alice", "Alice");
  const bob = member("user-bob", null, "bob@example.com");
  const operator = member("local-operator", "Operator");

  it("names the creator once more than one human shares the space", () => {
    expect(resolveAgentCreatorLabel("user-alice", [alice, bob])).toBe("Alice");
    expect(resolveAgentCreatorLabel("user-bob", [alice, bob])).toBe("bob@example.com");
  });

  it("stays hidden for a single human, even alongside the local Operator principal", () => {
    expect(resolveAgentCreatorLabel("user-alice", [alice])).toBeNull();
    expect(resolveAgentCreatorLabel("user-alice", [alice, operator])).toBeNull();
  });

  it("never shows the local Operator principal or a missing creator", () => {
    expect(humanAgentCreatorUserId("local-operator")).toBeNull();
    expect(resolveAgentCreatorLabel("local-operator", [alice, bob, operator])).toBeNull();
    expect(resolveAgentCreatorLabel(null, [alice, bob])).toBeNull();
    expect(resolveAgentCreatorLabel("user-alice", undefined)).toBeNull();
  });

  it("labels a creator who is no longer an active member", () => {
    expect(resolveAgentCreatorLabel("user-carol", [alice, bob])).toBe("Former member");
  });
});
