import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { spaceMemberships, toolApplications, toolConnections, toolCatalogEntries, connectionGrants, principalPermissionGrants } from "@outpost/db";
import { startRunnerApiTestServer } from "./helpers/runner-api-server.js";
import { accessService } from "../services/access.js";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";

describe("review-counts through assembled authenticated HTTP routes", () => {
  let server: Awaited<ReturnType<typeof startRunnerApiTestServer>>;
  beforeAll(async () => {
    vi.stubEnv("OUTPOST_AGENT_JWT_SECRET", randomUUID());
    vi.stubEnv("OUTPOST_RESPONSIBLE_USER_AUTHZ_MODE", "shadow");
    vi.stubEnv("OUTPOST_AUTH_RATE_LIMIT_ENABLED", "false");
    server = await startRunnerApiTestServer({ authPublicBaseUrl: "https://outpost.fixture.invalid", humanSessions: true });
  }, 90_000);
  afterAll(async () => { await server?.close(); vi.unstubAllEnvs(); });
  it("uses current space, personal and private authority for operator and actual agent identities", async () => {
    const f = await server.fixture({ connectionScenario: "fresh" });
    const access = accessService(server.db);
    await access.ensureMembership(f.spaceId, "agent", f.agentId, "member", "active");
    await access.ensureMembership(f.spaceId, "user", f.responsibleUserId!, "operator", "active");
    await access.ensureRoleDefaultGrants(f.spaceId, f.responsibleUserId!, "operator", f.responsibleUserId!);
    await server.db.insert(principalPermissionGrants).values({ spaceId: f.spaceId, principalType: "agent", principalId: f.agentId, permissionKey: "tools:manage_connections", scope: null });
    const cookie = await server.humanSession(f.responsibleUserId!);
    const token = createLocalAgentJwt(f.agentId, f.spaceId, "outpost_runner", f.runId, f.responsibleUserId!);
    const [application] = await server.db.insert(toolApplications).values({ spaceId: f.spaceId, name: "Scoped counts", type: "mcp_http" }).returning();
    const [connection] = await server.db.insert(toolConnections).values({ spaceId: f.spaceId, applicationId: application.id, name: "Scoped counts", uid: `counts-${randomUUID()}`, transport: "mcp_remote", status: "active", createdByUserId: f.responsibleUserId }).returning();
    await server.db.insert(toolCatalogEntries).values({ spaceId: f.spaceId, connectionId: connection.id, name: "Review", toolName: "review", versionHash: "v1", status: "quarantined" });
    const read = async (id: string, actor: "operator" | "agent" = "agent") => {
      const response = await fetch(`${server.apiUrl}/api/tool-connections/${id}/review-counts`, { headers: actor === "operator" ? { cookie } : { Authorization: `Bearer ${token}` } });
      return { status: response.status, body: await response.json() };
    };
    for (const actor of ["operator", "agent"] as const) {
      expect(await read(connection.id, actor)).toEqual({ status: 200, body: { pendingActionRequestCount: 0, quarantinedCatalogEntryCount: 1 } });
      expect(await read(connection.uid, actor)).toEqual(await read(connection.id, actor));
      expect((await read(randomUUID(), actor)).status).toBe(404);
    }
    await server.db.update(toolConnections).set({ status: "archived" }).where(eq(toolConnections.id, connection.id));
    expect(await read(connection.id)).toEqual({ status: 200, body: { pendingActionRequestCount: 0, quarantinedCatalogEntryCount: 0 } });
    await server.db.update(toolConnections).set({ status: "active", credentialPolicy: "per_user", createdByUserId: "another-user" }).where(eq(toolConnections.id, connection.id));
    expect((await read(connection.id)).status).toBe(403);
    const [grant] = await server.db.insert(connectionGrants).values({ spaceId: f.spaceId, connectionId: connection.id, kind: "user", subjectUserId: f.responsibleUserId!, status: "active" }).returning();
    expect((await read(connection.id)).status).toBe(200);
    await server.db.update(connectionGrants).set({ status: "revoked" }).where(eq(connectionGrants.id, grant.id));
    expect((await read(connection.id)).status).toBe(403);
    await server.db.update(toolConnections).set({ credentialPolicy: "shared", createdByUserId: f.responsibleUserId }).where(eq(toolConnections.id, connection.id));
    const [foreignApplication] = await server.db.insert(toolApplications).values({ spaceId: f.foreignSpaceId, name: "Foreign", type: "mcp_http" }).returning();
    const [foreign] = await server.db.insert(toolConnections).values({ applicationId: foreignApplication.id, spaceId: f.foreignSpaceId, name: "Foreign", uid: randomUUID(), transport: "mcp_remote" }).returning();
    expect([403, 404]).toContain((await read(foreign.id)).status);
    await server.db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, f.responsibleUserId!));
    await server.db.update(spaceMemberships).set({ status: "suspended" }).where(eq(spaceMemberships.principalId, f.responsibleUserId!));
    expect([403, 404]).toContain((await read(connection.id)).status);
    expect([403, 404]).toContain((await read(connection.id, "operator")).status);
  }, 30_000);
});
