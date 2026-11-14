import { describe, expect, it } from "vitest";
import {
  effectiveToolProfileBindings,
  narrowestScopeBindings,
} from "./tool-profile-binding-precedence.js";

const createdAt = new Date("2026-08-11T00:00:00.000Z");

describe("tool profile binding precedence", () => {
  it("adds an agent connection grant without dropping broader access to other apps", () => {
    const space = { profileId: "space", targetType: "space" as const, targetId: "space-1", priority: 100, createdAt };
    const grant = { profileId: "grant", targetType: "agent" as const, targetId: "agent-1", priority: 100, createdAt };
    const profiles = [
      { id: "space", profileKey: "default", metadata: {} },
      { id: "grant", profileKey: "connection-intent:connection-1:agent-1", metadata: { source: "connection_intent", connectionId: "connection-1", agentId: "agent-1" } },
    ];
    expect(effectiveToolProfileBindings([space, grant], profiles, "connection-1")).toEqual([space, grant]);
    expect(effectiveToolProfileBindings([space, grant], profiles, "connection-2")).toEqual([space]);
  });
  it("keeps ordinary profiles at the narrowest matching scope", () => {
    const spaceBinding = {
      profileId: "space-profile",
      targetType: "space" as const,
      targetId: "space-1",
      priority: 100,
      createdAt,
    };
    const agentBinding = {
      profileId: "agent-profile",
      targetType: "agent" as const,
      targetId: "agent-1",
      priority: 100,
      createdAt,
    };

    expect(narrowestScopeBindings([spaceBinding, agentBinding])).toEqual([agentBinding]);
    expect(effectiveToolProfileBindings(
      [spaceBinding, agentBinding],
      [
        { id: "space-profile", profileKey: "space-default", metadata: {} },
        { id: "agent-profile", profileKey: "agent-default", metadata: {} },
      ],
      "connection-1",
    )).toEqual([agentBinding]);
  });

  it("carries the wizard-managed app assignment alongside a narrower profile", () => {
    const appBinding = {
      profileId: "app-profile",
      targetType: "space" as const,
      targetId: "space-1",
      priority: 100,
      createdAt,
    };
    const agentBinding = {
      profileId: "agent-profile",
      targetType: "agent" as const,
      targetId: "agent-1",
      priority: 100,
      createdAt,
    };

    expect(effectiveToolProfileBindings(
      [appBinding, agentBinding],
      [
        {
          id: "app-profile",
          profileKey: "app:connection-1",
          metadata: { source: "app_gallery_finish", connectionId: "connection-1" },
        },
        { id: "agent-profile", profileKey: "agent-default", metadata: {} },
      ],
      "connection-1",
    )).toEqual([agentBinding, appBinding]);
  });

  it("does not carry wizard-managed app assignments into a gateway-only profile", () => {
    const appBinding = {
      profileId: "app-profile",
      targetType: "space" as const,
      targetId: "space-1",
      priority: 100,
      createdAt,
    };
    const gatewayBinding = {
      profileId: "gateway-profile",
      targetType: "gateway" as const,
      targetId: "gateway-1",
      priority: 10,
      createdAt,
    };

    expect(effectiveToolProfileBindings(
      [appBinding, gatewayBinding],
      [
        {
          id: "app-profile",
          profileKey: "app:connection-1",
          metadata: { source: "app_gallery_finish", connectionId: "connection-1" },
        },
        { id: "gateway-profile", profileKey: "runtime-gateway", metadata: {} },
      ],
      "connection-1",
      { includeAdditiveAppProfiles: false },
    )).toEqual([gatewayBinding]);
  });

  it("does not overlay a wizard profile onto another connection", () => {
    const appBinding = {
      profileId: "app-profile",
      targetType: "space" as const,
      targetId: "space-1",
      priority: 100,
      createdAt,
    };
    const agentBinding = {
      profileId: "agent-profile",
      targetType: "agent" as const,
      targetId: "agent-1",
      priority: 100,
      createdAt,
    };

    expect(effectiveToolProfileBindings(
      [appBinding, agentBinding],
      [{
        id: "app-profile",
        profileKey: "app:connection-1",
        metadata: { source: "app_gallery_finish", connectionId: "connection-1" },
      }],
      "connection-2",
    )).toEqual([agentBinding]);
  });
});
