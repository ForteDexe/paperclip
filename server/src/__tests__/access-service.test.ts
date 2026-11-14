import { startToolHealthWorker } from "./helpers/tool-health-worker.js";
import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  agents,
  spaceSecretBindings,
  spaceSecrets,
  spaces,
  spaceMemberships,
  createDb,
  connectionGrantDelegations,
  connectionGrantMembers,
  connectionGrants,
  instanceUserRoles,
  issues,
  principalPermissionGrants,
  toolAccessAuditEvents,
  toolApplications,
  toolConnections,
  userSecretDeclarations,
  userSecretDefinitions,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { accessService } from "../services/access.js";
import { grantsForHumanRole } from "../services/space-member-roles.js";
import { backfillPrincipalAccessCompatibility } from "../services/principal-access-compatibility.js";

const externalTestDatabaseUrl = resolveExternalTestDatabaseUrl("OUTPOST_ACCESS_TEST_DATABASE_URL");
const embeddedPostgresSupport = externalTestDatabaseUrl ? { supported: true } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createSpaceWithOwner(db: ReturnType<typeof createDb>) {
  const space = await db
    .insert(spaces)
    .values({
      name: `Access Service ${randomUUID()}`,
      issuePrefix: `AS${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);

  const owner = await db
    .insert(spaceMemberships)
    .values({
      spaceId: space.id,
      principalType: "user",
      principalId: `owner-${randomUUID()}`,
      status: "active",
      membershipRole: "owner",
    })
    .returning()
    .then((rows) => rows[0]!);

  return { space, owner };
}

describeEmbeddedPostgres("access service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (!externalTestDatabaseUrl) tempDb = await startEmbeddedPostgresTestDatabase("outpost-access-service-");
    if (externalTestDatabaseUrl) await applyPendingMigrations(externalTestDatabaseUrl);
    db = createDb(externalTestDatabaseUrl ?? tempDb!.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(toolAccessAuditEvents);
    await db.delete(userSecretDeclarations);
    await db.delete(spaceSecretBindings);
    await db.delete(connectionGrantDelegations);
    await db.delete(connectionGrantMembers);
    await db.delete(connectionGrants);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(spaceSecrets);
    await db.delete(userSecretDefinitions);
    await db.delete(issues);
    await db.delete(principalPermissionGrants);
    await db.delete(instanceUserRoles);
    await db.delete(agents);
    await db.delete(spaceMemberships);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  it("rejects combined access updates that would demote the last active owner", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const access = accessService(db);

    await expect(
      access.updateMemberAndPermissions(
        space.id,
        owner.id,
        { membershipRole: "admin", grants: [] },
        "admin-user",
      ),
    ).rejects.toThrow("Cannot remove the last active owner");

    const unchanged = await db
      .select()
      .from(spaceMemberships)
      .where(eq(spaceMemberships.id, owner.id))
      .then((rows) => rows[0]!);
    expect(unchanged.membershipRole).toBe("owner");
  });

  it("rejects role-only updates that would suspend the last active owner", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const access = accessService(db);

    await expect(
      access.updateMember(space.id, owner.id, { status: "suspended" }),
    ).rejects.toThrow("Cannot remove the last active owner");

    const unchanged = await db
      .select()
      .from(spaceMemberships)
      .where(eq(spaceMemberships.id, owner.id))
      .then((rows) => rows[0]!);
    expect(unchanged.status).toBe("active");
  });

  it("archives members, clears grants, and reassigns open issues without deleting history", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const member = await db
      .insert(spaceMemberships)
      .values({
        spaceId: space.id,
        principalType: "user",
        principalId: `member-${randomUUID()}`,
        status: "active",
        membershipRole: "operator",
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(principalPermissionGrants).values({
      spaceId: space.id,
      principalType: "user",
      principalId: member.principalId,
      permissionKey: "tasks:assign",
      grantedByUserId: owner.principalId,
    });
    const openIssue = await db
      .insert(issues)
      .values({
        spaceId: space.id,
        title: "Open assigned issue",
        status: "in_progress",
        assigneeUserId: member.principalId,
      })
      .returning()
      .then((rows) => rows[0]!);
    const doneIssue = await db
      .insert(issues)
      .values({
        spaceId: space.id,
        title: "Historical assigned issue",
        status: "done",
        assigneeUserId: member.principalId,
      })
      .returning()
      .then((rows) => rows[0]!);

    const access = accessService(db);
    const result = await access.archiveMember(space.id, member.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(result?.reassignedIssueCount).toBe(1);
    const archived = await db
      .select()
      .from(spaceMemberships)
      .where(eq(spaceMemberships.id, member.id))
      .then((rows) => rows[0]!);
    expect(archived.status).toBe("archived");

    const remainingGrants = await db
      .select()
      .from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.principalId, member.principalId));
    expect(remainingGrants).toHaveLength(0);

    const reassignedIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, openIssue.id))
      .then((rows) => rows[0]!);
    expect(reassignedIssue.assigneeUserId).toBe(owner.principalId);
    expect(reassignedIssue.status).toBe("todo");

    const historicalIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, doneIssue.id))
      .then((rows) => rows[0]!);
    expect(historicalIssue.assigneeUserId).toBe(member.principalId);
  });

  it("rejects instance-level space access removal for self and protected users", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const access = accessService(db);

    await expect(
      access.setUserSpaceAccess(owner.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("You cannot remove yourself");

    const admin = await db
      .insert(spaceMemberships)
      .values({
        spaceId: space.id,
        principalType: "user",
        principalId: `admin-${randomUUID()}`,
        status: "active",
        membershipRole: "admin",
      })
      .returning()
      .then((rows) => rows[0]!);

    await expect(
      access.setUserSpaceAccess(admin.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("Owners and admins cannot be removed from space access");

    const operator = await db
      .insert(spaceMemberships)
      .values({
        spaceId: space.id,
        principalType: "user",
        principalId: `operator-${randomUUID()}`,
        status: "active",
        membershipRole: "operator",
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(instanceUserRoles).values({
      userId: operator.principalId,
      role: "instance_admin",
    });

    await expect(
      access.setUserSpaceAccess(operator.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("Instance admins cannot be removed from space access");
  });

  it("sweeps personal grants when instance-level space access is removed", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const member = await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      spaceId: space.id,
      name: "Instance access delegated agent",
      role: "worker",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      spaceId: space.id,
      applicationKey: `instance-access-${randomUUID()}`,
      name: "Instance access app",
      type: "mcp_http",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      spaceId: space.id,
      applicationId: application.id,
      name: "Instance access connection",
      uid: `instance-access-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const grant = await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      status: "active",
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantDelegations).values({
      spaceId: space.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });

    await accessService(db).setUserSpaceAccess(member.principalId, [], {
      actorUserId: owner.principalId,
    });

    expect(await db.select().from(spaceMemberships).where(eq(spaceMemberships.id, member.id)))
      .toEqual([expect.objectContaining({ status: "archived" })]);
    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked" })]);
  });

  it("revokes personal connection access and destroys user-scoped secrets when membership is archived", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const member = await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      spaceId: space.id,
      name: "Delegated agent",
      role: "worker",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      spaceId: space.id,
      applicationKey: `app-${randomUUID()}`,
      name: "Personal mail",
      type: "mcp_http",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      spaceId: space.id,
      applicationId: application.id,
      name: "Mail",
      uid: `mail-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
      healthCheckedAt: new Date(),
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      spaceId: space.id,
      key: `oauth-${randomUUID()}`,
      name: "Personal OAuth token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: `OAuth ${randomUUID()}`,
    }).returning().then((rows) => rows[0]!);
    await db.update(toolConnections).set({
      credentialSecretRefs: [{ secretId: secret.id, configPath: "oauth.access_token" }],
    }).where(eq(toolConnections.id, connection.id));
    const grant = await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      credentialSecretRefs: [{ secretId: secret.id, configPath: "oauth.access_token" }],
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantDelegations).values({
      spaceId: space.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });
    const health = await startToolHealthWorker(db, space.id);
    try {
      await health.expectDeadline(connection.healthCheckedAt!.getTime() + 900_000);
      await accessService(db).archiveMember(space.id, member.id, {
        reassignment: { assigneeUserId: owner.principalId },
      });
      await health.expectDeadline(null);
      await health.expectQuiet();
    } finally { await health.stop(); }

    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(connectionGrantMembers)).toHaveLength(0);
    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, secret.id))).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({
        status: "draft",
        enabled: false,
        healthStatus: "missing_secret",
        lastError: "oauth_reauthorization_required",
        credentialSecretRefs: [],
      })]);
    expect(await db.select().from(toolAccessAuditEvents).where(eq(toolAccessAuditEvents.reasonCode, "membership_removed")))
      .toHaveLength(1);
  });

  it("retains a personal credential while another member grant still uses it", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const [departing, surviving] = await db.insert(spaceMemberships).values([
      {
        spaceId: space.id,
        principalType: "user" as const,
        principalId: `departing-${randomUUID()}`,
        status: "active" as const,
        membershipRole: "member" as const,
      },
      {
        spaceId: space.id,
        principalType: "user" as const,
        principalId: `surviving-${randomUUID()}`,
        status: "active" as const,
        membershipRole: "member" as const,
      },
    ]).returning();
    const application = await db.insert(toolApplications).values({
      spaceId: space.id,
      applicationKey: `shared-personal-${randomUUID()}`,
      name: "Shared personal app",
      type: "mcp_http",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      spaceId: space.id,
      applicationId: application.id,
      name: "Shared personal connection",
      uid: `shared-personal-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      spaceId: space.id,
      key: `shared-personal-${randomUUID()}`,
      name: "Shared personal token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "user",
      ownerUserId: departing!.principalId,
      userSecretDefinitionId: definition.id,
      key: `shared-personal-${randomUUID()}`,
      name: "Shared personal token",
    }).returning().then((rows) => rows[0]!);
    const credentialSecretRefs = [{ secretId: secret.id, configPath: "oauth.access_token" }];
    await db.update(toolConnections).set({ credentialSecretRefs }).where(eq(toolConnections.id, connection.id));
    const [departingGrant, survivingGrant] = await db.insert(connectionGrants).values([
      {
        spaceId: space.id,
        connectionId: connection.id,
        kind: "user" as const,
        subjectUserId: departing!.principalId,
        status: "active" as const,
        credentialSecretRefs,
      },
      {
        spaceId: space.id,
        connectionId: connection.id,
        kind: "user" as const,
        subjectUserId: surviving!.principalId,
        status: "active" as const,
        credentialSecretRefs,
      },
    ]).returning();

    await accessService(db).archiveMember(space.id, departing!.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, secret.id)))
      .toHaveLength(1);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, departingGrant!.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, survivingGrant!.id)))
      .toEqual([expect.objectContaining({ status: "active", credentialSecretRefs })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({ status: "active", enabled: true, credentialSecretRefs })]);
  });

  it("keeps a mixed connection active when an unaffected organization credential survives", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const departing = await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: `departing-mixed-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      spaceId: space.id,
      applicationKey: `mixed-${randomUUID()}`,
      name: "Mixed credential app",
      type: "mcp_http",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      spaceId: space.id,
      key: `mixed-personal-${randomUUID()}`,
      name: "Mixed personal token",
    }).returning().then((rows) => rows[0]!);
    const personalSecret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "user",
      ownerUserId: departing.principalId,
      userSecretDefinitionId: definition.id,
      key: `mixed-personal-${randomUUID()}`,
      name: "Mixed personal token",
    }).returning().then((rows) => rows[0]!);
    const organizationSecret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "space",
      key: `mixed-organization-${randomUUID()}`,
      name: "Mixed organization token",
    }).returning().then((rows) => rows[0]!);
    const personalRef = { secretId: personalSecret.id, configPath: "credentials.personal" };
    const organizationRef = { secretId: organizationSecret.id, configPath: "credentials.organization" };
    const connection = await db.insert(toolConnections).values({
      spaceId: space.id,
      applicationId: application.id,
      name: "Mixed credential connection",
      uid: `mixed-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "api_key",
      credentialPolicy: "per_user_with_fallback",
      status: "active",
      enabled: true,
      healthStatus: "healthy",
      credentialSecretRefs: [personalRef, organizationRef],
    }).returning().then((rows) => rows[0]!);
    const personalGrant = await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: departing.principalId,
      credentialSecretRefs: [personalRef],
    }).returning().then((rows) => rows[0]!);
    const organizationGrant = await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "organization",
      status: "active",
      isDefault: true,
      credentialSecretRefs: [organizationRef],
    }).returning().then((rows) => rows[0]!);

    await accessService(db).archiveMember(space.id, departing.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, personalSecret.id)))
      .toHaveLength(0);
    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, organizationSecret.id)))
      .toHaveLength(1);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, personalGrant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, organizationGrant.id)))
      .toEqual([expect.objectContaining({ status: "active", credentialSecretRefs: [organizationRef] })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({
        status: "active",
        enabled: true,
        healthStatus: "healthy",
        lastError: null,
        credentialSecretRefs: [organizationRef],
      })]);
  });

  it("keeps a sole organization audience dormant until its member is reactivated", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const departing = await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: `departing-org-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      spaceId: space.id,
      applicationKey: `shared-org-${randomUUID()}`,
      name: "Shared organization app",
      type: "mcp_http",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      spaceId: space.id,
      applicationId: application.id,
      name: "Shared organization connection",
      uid: `shared-org-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "shared",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      spaceId: space.id,
      key: `shared-org-${randomUUID()}`,
      name: "Shared organization token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "user",
      ownerUserId: departing.principalId,
      userSecretDefinitionId: definition.id,
      key: `shared-org-${randomUUID()}`,
      name: "Shared organization token",
    }).returning().then((rows) => rows[0]!);
    const credentialSecretRefs = [{ secretId: secret.id, configPath: "oauth.access_token" }];
    await db.update(toolConnections).set({ credentialSecretRefs }).where(eq(toolConnections.id, connection.id));
    await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: departing.principalId,
      status: "active",
      credentialSecretRefs,
    });
    const organizationGrant = await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "organization",
      status: "active",
      isDefault: true,
      credentialSecretRefs,
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantMembers).values({
      spaceId: space.id,
      grantId: organizationGrant.id,
      subjectType: "user",
      subjectId: departing.principalId,
    });

    await accessService(db).archiveMember(space.id, departing.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, secret.id)))
      .toHaveLength(1);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, organizationGrant.id)))
      .toEqual([expect.objectContaining({ status: "active", isDefault: true, credentialSecretRefs })]);
    expect(await db.select().from(connectionGrantMembers).where(eq(connectionGrantMembers.grantId, organizationGrant.id)))
      .toEqual([expect.objectContaining({ subjectId: departing.principalId })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({ status: "active", enabled: true, credentialSecretRefs })]);

    await accessService(db).setUserSpaceAccess(departing.principalId, [space.id]);

    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, secret.id)))
      .toHaveLength(1);
    expect(await db.select().from(spaceMemberships).where(eq(spaceMemberships.id, departing.id)))
      .toEqual([expect.objectContaining({ status: "active" })]);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, organizationGrant.id)))
      .toEqual([expect.objectContaining({ status: "active", credentialSecretRefs })]);
  });

  it("revokes delegated personal connection access when membership is suspended", async () => {
    const { space } = await createSpaceWithOwner(db);
    const member = await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      spaceId: space.id,
      name: "Delegated agent",
      role: "worker",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      spaceId: space.id,
      applicationKey: `app-${randomUUID()}`,
      name: "Personal mail",
      type: "mcp_http",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      spaceId: space.id,
      applicationId: application.id,
      name: "Mail",
      uid: `mail-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      spaceId: space.id,
      key: `oauth-${randomUUID()}`,
      name: "Personal OAuth token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: `OAuth ${randomUUID()}`,
    }).returning().then((rows) => rows[0]!);
    const grant = await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      credentialSecretRefs: [{ secretId: secret.id, configPath: "oauth.access_token" }],
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantDelegations).values({
      spaceId: space.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });

    await accessService(db).updateMember(space.id, member.id, { status: "suspended" });

    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, secret.id))).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
  });

  it("preserves personal grant secrets used by surviving declarations and bindings", async () => {
    const { space } = await createSpaceWithOwner(db);
    const member = await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      spaceId: space.id,
      applicationKey: `app-${randomUUID()}`,
      name: "Personal shared credentials",
      type: "mcp_http",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const definitions = await db.insert(userSecretDefinitions).values([
      { spaceId: space.id, key: `agent-declared-${randomUUID()}`, name: "Agent-declared credential" },
      { spaceId: space.id, key: `environment-declared-${randomUUID()}`, name: "Environment-declared credential" },
      { spaceId: space.id, key: `bound-${randomUUID()}`, name: "Bound credential" },
    ]).returning();
    const secrets = await db.insert(spaceSecrets).values(definitions.map((definition, index) => ({
      spaceId: space.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `shared-${index}-${randomUUID()}`,
      name: `Shared credential ${index}`,
    }))).returning();
    const connection = await db.insert(toolConnections).values({
      spaceId: space.id,
      applicationId: application.id,
      name: "Shared personal connection",
      uid: `shared-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "api_key",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
      credentialSecretRefs: secrets.map((secret, index) => ({
        secretId: secret.id,
        configPath: `credentials.shared_${index}`,
      })),
    }).returning().then((rows) => rows[0]!);
    const grant = await db.insert(connectionGrants).values({
      spaceId: space.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      credentialSecretRefs: secrets.map((secret, index) => ({
        secretId: secret.id,
        configPath: `credentials.shared_${index}`,
      })),
    }).returning().then((rows) => rows[0]!);
    await db.insert(userSecretDeclarations).values([
      {
        spaceId: space.id,
        userSecretDefinitionId: definitions[0]!.id,
        targetType: "agent",
        targetId: `surviving-agent-${randomUUID()}`,
        configPath: "env.AGENT_TOKEN",
        envKey: "AGENT_TOKEN",
      },
      {
        spaceId: space.id,
        userSecretDefinitionId: definitions[1]!.id,
        targetType: "environment",
        targetId: `surviving-environment-${randomUUID()}`,
        configPath: "env.ENVIRONMENT_TOKEN",
        envKey: "ENVIRONMENT_TOKEN",
      },
    ]);
    await db.insert(spaceSecretBindings).values([
      ...secrets.map((secret, index) => ({
        spaceId: space.id,
        secretId: secret.id,
        targetType: "tool_connection",
        targetId: connection.id,
        configPath: `credentials.shared_${index}`,
      })),
      {
        spaceId: space.id,
        secretId: secrets[2]!.id,
        targetType: "environment",
        targetId: `surviving-environment-${randomUUID()}`,
        configPath: "env.BOUND_TOKEN",
      },
    ]);

    await accessService(db).updateMember(space.id, member.id, { status: "suspended" });

    expect(await db.select().from(spaceSecrets).where(inArray(spaceSecrets.id, secrets.map((secret) => secret.id))))
      .toHaveLength(3);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({
        status: "draft",
        enabled: false,
        credentialSecretRefs: [],
      })]);
    expect(await db.select().from(spaceSecretBindings)).toEqual([
      expect.objectContaining({
        secretId: secrets[2]!.id,
        targetType: "environment",
      }),
    ]);
    expect(await db.select().from(userSecretDeclarations)).toHaveLength(2);
  });

  it("preserves unrelated user-scoped secrets when membership is suspended", async () => {
    const { space } = await createSpaceWithOwner(db);
    const member = await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      spaceId: space.id,
      key: `oauth-${randomUUID()}`,
      name: "Personal OAuth token",
    }).returning().then((rows) => rows[0]!);
    const unrelatedSecret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: "Environment API key",
    }).returning().then((rows) => rows[0]!);
    const otherUserSecret = await db.insert(spaceSecrets).values({
      spaceId: space.id,
      scope: "user",
      ownerUserId: "another-user",
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: "Another user's credential",
    }).returning().then((rows) => rows[0]!);

    await accessService(db).updateMember(space.id, member.id, { status: "suspended" });

    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, unrelatedSecret.id)))
      .toHaveLength(1);
    expect(await db.select().from(spaceSecrets).where(eq(spaceSecrets.id, otherUserSecret.id)))
      .toHaveLength(1);
  });

  it("allows owner, admin, and operator role-default grants to manage environments", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const access = accessService(db);
    const roles = ["admin", "operator", "viewer"] as const;
    const members = await db
      .insert(spaceMemberships)
      .values(
        roles.map((role) => ({
          spaceId: space.id,
          principalType: "user" as const,
          principalId: `${role}-${randomUUID()}`,
          status: "active" as const,
          membershipRole: role,
        })),
      )
      .returning();

    await access.setPrincipalGrants(
      space.id,
      "user",
      owner.principalId,
      grantsForHumanRole("owner"),
      owner.principalId,
    );
    for (const member of members) {
      await access.setPrincipalGrants(
        space.id,
        "user",
        member.principalId,
        grantsForHumanRole(member.membershipRole as "admin" | "operator" | "viewer"),
        owner.principalId,
      );
    }

    const admin = members.find((member) => member.membershipRole === "admin")!;
    const operator = members.find((member) => member.membershipRole === "operator")!;
    const viewer = members.find((member) => member.membershipRole === "viewer")!;

    await expect(access.canUser(space.id, owner.principalId, "environments:manage")).resolves.toBe(true);
    await expect(access.canUser(space.id, admin.principalId, "environments:manage")).resolves.toBe(true);
    await expect(access.canUser(space.id, operator.principalId, "environments:manage")).resolves.toBe(true);
    await expect(access.canUser(space.id, viewer.principalId, "environments:manage")).resolves.toBe(false);
  });

  it("allows default operators to edit agents and space work without administering membership", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const access = accessService(db);
    const operator = await access.ensureMembership(space.id, "user", `operator-${randomUUID()}`, "operator");
    const agent = await db.insert(agents).values({
      spaceId: space.id,
      name: "Operator-editable agent",
      role: "engineer",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    await access.setPrincipalGrants(
      space.id,
      "user",
      operator.principalId,
      grantsForHumanRole("operator"),
      owner.principalId,
    );

    for (const permissionKey of [
      "agents:create", "agents:configure", "skills:create", "environments:manage",
      "users:invite", "tasks:assign", "tools:manage_connections",
      "tools:manage_profiles", "tools:manage_runtime", "tools:use", "tools:admin",
      "tools:view_audit", "audit:view_agent_actions",
    ] as const) {
      await expect(access.canUser(space.id, operator.principalId, permissionKey)).resolves.toBe(true);
    }
    for (const permissionKey of ["joins:approve", "users:manage_permissions"] as const) {
      await expect(access.canUser(space.id, operator.principalId, permissionKey)).resolves.toBe(false);
    }
    await expect(access.decide({
      actor: { type: "operator", userId: operator.principalId, source: "session" },
      action: "agent_config:update",
      resource: { type: "agent", spaceId: space.id, agentId: agent.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_direct_change" });

    const otherSpace = await createSpaceWithOwner(db);
    await expect(access.canUser(otherSpace.space.id, operator.principalId, "agents:configure")).resolves.toBe(false);
  });

  it("backfills pre-upgrade human memberships with missing role grants without replacing custom grants", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const scopedEnvironmentGrant = { environmentId: "env-1" };
    const humanRows = await db
      .insert(spaceMemberships)
      .values([
        {
          spaceId: space.id,
          principalType: "user",
          principalId: `admin-${randomUUID()}`,
          status: "active",
          membershipRole: "admin",
        },
        {
          spaceId: space.id,
          principalType: "user",
          principalId: `operator-${randomUUID()}`,
          status: "active",
          membershipRole: "operator",
        },
        {
          spaceId: space.id,
          principalType: "user",
          principalId: `viewer-${randomUUID()}`,
          status: "active",
          membershipRole: "viewer",
        },
        {
          spaceId: space.id,
          principalType: "user",
          principalId: `legacy-${randomUUID()}`,
          status: "active",
          membershipRole: null,
        },
      ])
      .returning();
    const admin = humanRows[0]!;
    const operator = humanRows[1]!;
    const viewer = humanRows[2]!;
    const legacyMember = humanRows[3]!;

    await db.insert(principalPermissionGrants).values({
      spaceId: space.id,
      principalType: "user",
      principalId: owner.principalId,
      permissionKey: "environments:manage",
      scope: scopedEnvironmentGrant,
      grantedByUserId: "custom-author",
    });

    const first = await backfillPrincipalAccessCompatibility(db);
    const second = await backfillPrincipalAccessCompatibility(db);

    expect(first.humanGrantsInserted).toBeGreaterThan(0);
    expect(second.humanGrantsInserted).toBe(0);
    await expect(accessService(db).canUser(space.id, admin.principalId, "environments:manage")).resolves.toBe(true);
    await expect(accessService(db).canUser(space.id, operator.principalId, "tasks:assign")).resolves.toBe(true);
    await expect(accessService(db).canUser(space.id, legacyMember.principalId, "tasks:assign")).resolves.toBe(true);
    await expect(accessService(db).canUser(space.id, viewer.principalId, "tasks:assign")).resolves.toBe(false);

    const ownerEnvironmentGrants = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.spaceId, space.id),
          eq(principalPermissionGrants.principalId, owner.principalId),
          eq(principalPermissionGrants.permissionKey, "environments:manage"),
        ),
      );
    expect(ownerEnvironmentGrants).toHaveLength(1);
    expect(ownerEnvironmentGrants[0]?.scope).toEqual(scopedEnvironmentGrant);
    expect(ownerEnvironmentGrants[0]?.grantedByUserId).toBe("custom-author");
  });

  it("backfills non-terminal agents as active space members without reviving pending or terminated agents", async () => {
    const { space } = await createSpaceWithOwner(db);
    const agentRows = await db
      .insert(agents)
      .values([
        {
          spaceId: space.id,
          name: `Idle ${randomUUID()}`,
          role: "engineer",
          status: "idle",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          spaceId: space.id,
          name: `Running ${randomUUID()}`,
          role: "engineer",
          status: "running",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          spaceId: space.id,
          name: `Pending ${randomUUID()}`,
          role: "engineer",
          status: "pending_approval",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          spaceId: space.id,
          name: `Terminated ${randomUUID()}`,
          role: "engineer",
          status: "terminated",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
      ])
      .returning();
    const idleAgent = agentRows[0]!;
    const runningAgent = agentRows[1]!;
    const pendingAgent = agentRows[2]!;
    const terminatedAgent = agentRows[3]!;

    const first = await backfillPrincipalAccessCompatibility(db);
    const second = await backfillPrincipalAccessCompatibility(db);

    expect(first.agentMembershipsInserted).toBe(2);
    expect(second.agentMembershipsInserted).toBe(0);
    const memberships = await db
      .select()
      .from(spaceMemberships)
      .where(eq(spaceMemberships.principalType, "agent"));
    expect(memberships.map((membership) => membership.principalId).sort()).toEqual([
      idleAgent.id,
      runningAgent.id,
    ].sort());
    expect(memberships.every((membership) => membership.status === "active")).toBe(true);
    expect(memberships.every((membership) => membership.membershipRole === "member")).toBe(true);
    expect(memberships.some((membership) => membership.principalId === pendingAgent.id)).toBe(false);
    expect(memberships.some((membership) => membership.principalId === terminatedAgent.id)).toBe(false);
  });

  it("copies active user memberships with role-default grants for safe space imports", async () => {
    const source = await createSpaceWithOwner(db);
    const target = await createSpaceWithOwner(db);
    const admin = await db
      .insert(spaceMemberships)
      .values({
        spaceId: source.space.id,
        principalType: "user",
        principalId: `admin-${randomUUID()}`,
        status: "active",
        membershipRole: "admin",
      })
      .returning()
      .then((rows) => rows[0]!);

    const access = accessService(db);
    await access.copyActiveUserMemberships(source.space.id, target.space.id);

    const copiedOwnerGrants = await access.listPrincipalGrants(
      target.space.id,
      "user",
      source.owner.principalId,
    );
    const copiedAdminGrants = await access.listPrincipalGrants(
      target.space.id,
      "user",
      admin.principalId,
    );
    expect(copiedOwnerGrants.map((grant) => grant.permissionKey)).toEqual(
      grantsForHumanRole("owner").map((grant) => grant.permissionKey).sort(),
    );
    expect(copiedAdminGrants.map((grant) => grant.permissionKey)).toEqual(
      grantsForHumanRole("admin").map((grant) => grant.permissionKey).sort(),
    );
  });

  it("preserves explicit scoped environment grants when backfilling owner and admin defaults", async () => {
    const { space, owner } = await createSpaceWithOwner(db);
    const scopedGrant = { environmentId: "env-1" };
    await db.insert(principalPermissionGrants).values({
      spaceId: space.id,
      principalType: "user",
      principalId: owner.principalId,
      permissionKey: "environments:manage",
      scope: scopedGrant,
      grantedByUserId: "custom-grant-author",
    });

    await db.execute(sql.raw(`
      INSERT INTO "principal_permission_grants" (
        "space_id",
        "principal_type",
        "principal_id",
        "permission_key",
        "scope",
        "granted_by_user_id",
        "created_at",
        "updated_at"
      )
      SELECT
        "space_id",
        'user',
        "principal_id",
        'environments:manage',
        NULL,
        NULL,
        now(),
        now()
      FROM "space_memberships"
      WHERE "principal_type" = 'user'
        AND "status" = 'active'
        AND "membership_role" IN ('owner', 'admin')
      ON CONFLICT (
        "space_id",
        "principal_type",
        "principal_id",
        "permission_key"
      ) DO NOTHING
    `));

    const grants = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.spaceId, space.id),
          eq(principalPermissionGrants.principalId, owner.principalId),
          eq(principalPermissionGrants.permissionKey, "environments:manage"),
        ),
      );
    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope).toEqual(scopedGrant);
    expect(grants[0]?.grantedByUserId).toBe("custom-grant-author");
  });
});
