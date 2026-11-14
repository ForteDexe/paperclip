import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { assertOperatorOrgAccess, assertSpaceAccess, hasOperatorOrgAccess, hasSpaceAccess } from "../routes/authz.js";

function makeReq(input: {
  method?: string;
  actor: Express.Request["actor"];
}) {
  return {
    method: input.method ?? "GET",
    actor: input.actor,
  } as unknown as Request;
}

describe("assertSpaceAccess", () => {
  it("allows viewer memberships to read", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: ["space-1"],
        memberships: [
          { spaceId: "space-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).not.toThrow();
  });

  it("rejects viewer memberships for writes", () => {
    const req = makeReq({
      method: "PATCH",
      actor: {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: ["space-1"],
        memberships: [
          { spaceId: "space-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).toThrow("Viewer access is read-only");
  });

  it("rejects writes when membership details are present but omit the target space", () => {
    const req = makeReq({
      method: "POST",
      actor: {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: ["space-1"],
        memberships: [],
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).toThrow("User does not have active space access");
  });

  it("allows legacy operator actors that only provide space ids", () => {
    const req = makeReq({
      method: "POST",
      actor: {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: ["space-1"],
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).not.toThrow();
  });

  it("rejects signed-in instance admins without explicit space access", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "operator",
        userId: "admin-1",
        source: "session",
        isInstanceAdmin: true,
        spaceIds: [],
        memberships: [],
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).toThrow("User does not have access to this space");
  });

  it("allows local trusted operator access without explicit membership", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "operator",
        userId: "local-operator",
        source: "local_implicit",
        isInstanceAdmin: true,
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).not.toThrow();
  });

  it("fails closed when an on-behalf-of agent lacks a responsible user membership snapshot", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "agent",
        agentId: "agent-1",
        spaceId: "space-1",
        onBehalfOfUserId: "user-1",
        onBehalfOfMemberships: [],
        source: "agent_jwt",
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).toThrow(HttpError);
    try {
      assertSpaceAccess(req, "space-1");
    } catch (err) {
      expect((err as HttpError).details).toMatchObject({ code: "RESPONSIBLE_USER_UNAVAILABLE" });
    }
  });

  it("rejects on-behalf-of agent writes when the responsible user is read-only", () => {
    const req = makeReq({
      method: "PATCH",
      actor: {
        type: "agent",
        agentId: "agent-1",
        spaceId: "space-1",
        onBehalfOfUserId: "user-1",
        onBehalfOfMemberships: [
          { spaceId: "space-1", membershipRole: "viewer", status: "active" },
        ],
        source: "agent_jwt",
      },
    });

    try {
      assertSpaceAccess(req, "space-1");
    } catch (err) {
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).details).toMatchObject({ code: "RESPONSIBLE_USER_UNAUTHORIZED" });
      return;
    }
    throw new Error("Expected responsible-user space access denial");
  });

  it("logs only in shadow mode for responsible-user space access denials", () => {
    const previous = process.env.OUTPOST_RESPONSIBLE_USER_AUTHZ_SHADOW;
    process.env.OUTPOST_RESPONSIBLE_USER_AUTHZ_SHADOW = "true";
    try {
      const req = makeReq({
        method: "PATCH",
        actor: {
          type: "agent",
          agentId: "agent-1",
          spaceId: "space-1",
          onBehalfOfUserId: "user-1",
          onBehalfOfMemberships: [],
          source: "agent_jwt",
        },
      });

      expect(() => assertSpaceAccess(req, "space-1")).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.OUTPOST_RESPONSIBLE_USER_AUTHZ_SHADOW;
      else process.env.OUTPOST_RESPONSIBLE_USER_AUTHZ_SHADOW = previous;
    }
  });

  it("allows on-behalf-of agent writes for active non-viewer responsible users", () => {
    const req = makeReq({
      method: "PATCH",
      actor: {
        type: "agent",
        agentId: "agent-1",
        spaceId: "space-1",
        onBehalfOfUserId: "user-1",
        onBehalfOfMemberships: [
          { spaceId: "space-1", membershipRole: "operator", status: "active" },
        ],
        source: "agent_jwt",
      },
    });

    expect(() => assertSpaceAccess(req, "space-1")).not.toThrow();
  });
});

describe("hasSpaceAccess", () => {
  it("allows members of the space", () => {
    const req = makeReq({
      actor: {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: ["space-1"],
        memberships: [{ spaceId: "space-1", membershipRole: "viewer", status: "active" }],
      },
    });

    expect(hasSpaceAccess(req, "space-1")).toBe(true);
  });

  it("denies users from other spaces", () => {
    const req = makeReq({
      actor: {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: ["space-1"],
        memberships: [{ spaceId: "space-1", membershipRole: "operator", status: "active" }],
      },
    });

    expect(hasSpaceAccess(req, "space-2")).toBe(false);
  });

  it("denies signed-in instance admins without explicit space access, matching assertSpaceAccess", () => {
    const req = makeReq({
      actor: {
        type: "operator",
        userId: "admin-1",
        source: "session",
        isInstanceAdmin: true,
        spaceIds: [],
        memberships: [],
      },
    });

    expect(hasSpaceAccess(req, "space-1")).toBe(false);
    expect(() => assertSpaceAccess(req, "space-1")).toThrow("User does not have access to this space");
  });

  it("allows local trusted operator access without explicit membership", () => {
    const req = makeReq({
      actor: {
        type: "operator",
        userId: "local-operator",
        source: "local_implicit",
        isInstanceAdmin: true,
      },
    });

    expect(hasSpaceAccess(req, "space-1")).toBe(true);
  });

  it("scopes agent actors to their own space", () => {
    const agent = { type: "agent", agentId: "agent-1", spaceId: "space-1" } as const;

    expect(hasSpaceAccess(makeReq({ actor: agent }), "space-1")).toBe(true);
    expect(hasSpaceAccess(makeReq({ actor: agent }), "space-2")).toBe(false);
  });

  it("denies unauthenticated actors", () => {
    const req = makeReq({ actor: { type: "none" } });

    expect(hasSpaceAccess(req, "space-1")).toBe(false);
  });
});

describe("assertOperatorOrgAccess", () => {
  it("allows signed-in operator users with active space access", () => {
    const req = makeReq({
      actor: {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: ["space-1"],
        memberships: [{ spaceId: "space-1", membershipRole: "operator", status: "active" }],
        isInstanceAdmin: false,
      },
    });

    expect(hasOperatorOrgAccess(req)).toBe(true);
    expect(() => assertOperatorOrgAccess(req)).not.toThrow();
  });

  it("allows instance admins without space memberships", () => {
    const req = makeReq({
      actor: {
        type: "operator",
        userId: "admin-1",
        source: "session",
        spaceIds: [],
        memberships: [],
        isInstanceAdmin: true,
      },
    });

    expect(hasOperatorOrgAccess(req)).toBe(true);
    expect(() => assertOperatorOrgAccess(req)).not.toThrow();
  });

  it("rejects signed-in users without space access or instance admin rights", () => {
    const req = makeReq({
      actor: {
        type: "operator",
        userId: "outsider-1",
        source: "session",
        spaceIds: [],
        memberships: [],
        isInstanceAdmin: false,
      },
    });

    expect(hasOperatorOrgAccess(req)).toBe(false);
    expect(() => assertOperatorOrgAccess(req)).toThrow("Space membership or instance admin access required");
  });
});
