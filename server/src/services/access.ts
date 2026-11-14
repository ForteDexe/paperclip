import { notifyMuseContactVerification } from "../modules/external-agents/index.js";
import { notifyDeferredExecutionEligibility } from "./deferred-execution-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { notifyNativeStatusReassessment } from "./native-status-reassessment-notifications.js";
import { notifyUnsafeWorkspaceExportRecovery } from "./unsafe-workspace-export-notifications.js";
import { notifyChatSpaceAuthorityChange } from "./chat-run-milestone-notifications.js";
import { notifyVoiceChange } from "./voice/voice-recovery-notifications.js";
import { notifyChatEndpointWork } from "./chat-work-notifications.js";
import { notifyToolConnectionHealth } from "./tool-connection-health-notifications.js";
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  agents,
  spaceMemberships,
  spaceSecretBindings,
  spaceSecrets,
  connectionGrantDelegations,
  connectionGrantMembers,
  connectionGrants,
  instanceUserRoles,
  issues,
  principalPermissionGrants,
  toolAccessAuditEvents,
  toolConnections,
  userSecretDeclarations,
} from "@outpost/db";
import type { PermissionKey, PrincipalType } from "@outpost/shared";
import { conflict } from "../errors.js";
import { assertAssignableAgent } from "./agent-assignability.js";
import { authorizationService, type AuthorizationActor, type AuthorizationResource } from "./authorization.js";
import { ensureHumanRoleDefaultGrants } from "./principal-access-compatibility.js";

type MembershipRow = typeof spaceMemberships.$inferSelect;
type GrantInput = {
  permissionKey: PermissionKey;
  scope?: Record<string, unknown> | null;
};

type MemberArchiveInput = {
  reassignment?: {
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
  } | null;
};

export function accessService(db: Db) {
  const authorization = authorizationService(db);

  async function memberAccessTransaction<T>(operation: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction(operation); }
      catch (error) {
        const failure = error as { code?: string; cause?: { code?: string } };
        if ((failure?.cause?.code ?? failure?.code) !== "55P03") throw error;
        if (attempt >= 2) throw conflict("Member access changed during cleanup. Try again.", { retryable: true });
      }
    }
  }

  async function sweepMemberConnectionAccess(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    spaceId: string,
    userId: string,
    now: Date,
  ) {
    const departingAudienceRows = await tx.select({
      grantId: connectionGrantMembers.grantId,
    }).from(connectionGrantMembers).where(and(
      eq(connectionGrantMembers.spaceId, spaceId),
      eq(connectionGrantMembers.subjectType, "user"),
      eq(connectionGrantMembers.subjectId, userId),
    ));
    const departingAudienceGrantIds = [...new Set(departingAudienceRows.map((row) => row.grantId))];
    const affectedAudienceRows = departingAudienceGrantIds.length === 0 ? [] : await tx.select({
      grantId: connectionGrantMembers.grantId,
      subjectId: connectionGrantMembers.subjectId,
    }).from(connectionGrantMembers).where(and(
      eq(connectionGrantMembers.spaceId, spaceId),
      eq(connectionGrantMembers.subjectType, "user"),
      inArray(connectionGrantMembers.grantId, departingAudienceGrantIds),
    ));
    const activeOrganizationAudienceGrants = departingAudienceGrantIds.length === 0 ? [] : await tx.select({
      id: connectionGrants.id,
    }).from(connectionGrants).where(and(
      eq(connectionGrants.spaceId, spaceId),
      eq(connectionGrants.kind, "organization"),
      eq(connectionGrants.status, "active"),
      inArray(connectionGrants.id, departingAudienceGrantIds),
    ));
    const activeOrganizationAudienceGrantIds = new Set(activeOrganizationAudienceGrants.map((grant) => grant.id));
    const soleAudienceGrantIds = new Set(departingAudienceGrantIds.filter((grantId) =>
      activeOrganizationAudienceGrantIds.has(grantId)
      && affectedAudienceRows.filter((row) => row.grantId === grantId).length === 1,
    ));

    const ownedGrants = await tx.select({
      id: connectionGrants.id,
      connectionId: connectionGrants.connectionId,
      credentialSecretRefs: connectionGrants.credentialSecretRefs,
    }).from(connectionGrants).where(and(
      eq(connectionGrants.spaceId, spaceId),
      eq(connectionGrants.kind, "user"),
      eq(connectionGrants.subjectUserId, userId),
    ));
    const grantIds = ownedGrants.map((grant) => grant.id);
    const ownedGrantIds = new Set(grantIds);
    const affectedConnectionIds = [...new Set(ownedGrants.map((grant) => grant.connectionId))];
    const affectedConnections = new Set(affectedConnectionIds);
    // Membership removal revokes personal connection identities. It must not
    // erase unrelated user-scoped values used by agent or environment secret
    // declarations or bindings. Start with only secrets the departing user's
    // grants explicitly reference, then fail toward retention whenever another
    // consumer still names the secret or its user-secret definition.
    const referencedSecretIds = [...new Set(ownedGrants.flatMap((grant) =>
      grant.credentialSecretRefs.map((ref) => ref.secretId),
    ))];
    const ownedSecrets = referencedSecretIds.length === 0 ? [] : await tx.select({
      id: spaceSecrets.id,
      userSecretDefinitionId: spaceSecrets.userSecretDefinitionId,
    }).from(spaceSecrets).where(and(
      eq(spaceSecrets.spaceId, spaceId),
      eq(spaceSecrets.scope, "user"),
      eq(spaceSecrets.ownerUserId, userId),
      inArray(spaceSecrets.id, referencedSecretIds),
    ));
    const ownedSecretIds = ownedSecrets.map((secret) => secret.id);
    const ownedSecretSet = new Set(ownedSecretIds);
    const retainedSecretIds = new Set<string>();
    const sharedConnectionSecretIds = new Set<string>();
    let grantMemberRefs: Array<{ grantId: string; subjectId: string }> = [];
    let existingMemberUserIds = new Set<string>();
    let grantRefs: Array<{
      id: string;
      connectionId: string;
      kind: typeof connectionGrants.$inferSelect.kind;
      status: typeof connectionGrants.$inferSelect.status;
      credentialSecretRefs: typeof connectionGrants.$inferSelect.credentialSecretRefs;
    }> = [];
    let connectionRefs: Array<{
      id: string;
      transport: typeof toolConnections.$inferSelect.transport;
      credentialRefs: typeof toolConnections.$inferSelect.credentialRefs;
      credentialSecretRefs: typeof toolConnections.$inferSelect.credentialSecretRefs;
    }> = [];
    if (ownedSecretIds.length > 0) {
      const definitionIds = ownedSecrets.flatMap((secret) =>
        secret.userSecretDefinitionId ? [secret.userSecretDefinitionId] : [],
      );
      const [
        bindingRefs,
        declarationRefs,
        allGrantRefs,
        allConnectionRefs,
        allGrantMemberRefs,
        membershipRefs,
      ] = await Promise.all([
        tx.select({
          secretId: spaceSecretBindings.secretId,
          targetType: spaceSecretBindings.targetType,
          targetId: spaceSecretBindings.targetId,
        }).from(spaceSecretBindings).where(and(
          eq(spaceSecretBindings.spaceId, spaceId),
          inArray(spaceSecretBindings.secretId, ownedSecretIds),
        )),
        definitionIds.length === 0 ? Promise.resolve([]) : tx.select({
          userSecretDefinitionId: userSecretDeclarations.userSecretDefinitionId,
        }).from(userSecretDeclarations).where(and(
          eq(userSecretDeclarations.spaceId, spaceId),
          inArray(userSecretDeclarations.userSecretDefinitionId, definitionIds),
        )),
        tx.select({
          id: connectionGrants.id,
          connectionId: connectionGrants.connectionId,
          kind: connectionGrants.kind,
          status: connectionGrants.status,
          credentialSecretRefs: connectionGrants.credentialSecretRefs,
        }).from(connectionGrants).where(eq(connectionGrants.spaceId, spaceId)),
        tx.select({
          id: toolConnections.id,
          transport: toolConnections.transport,
          credentialRefs: toolConnections.credentialRefs,
          credentialSecretRefs: toolConnections.credentialSecretRefs,
        }).from(toolConnections).where(eq(toolConnections.spaceId, spaceId)),
        tx.select({
          grantId: connectionGrantMembers.grantId,
          subjectId: connectionGrantMembers.subjectId,
        }).from(connectionGrantMembers).where(and(
          eq(connectionGrantMembers.spaceId, spaceId),
          eq(connectionGrantMembers.subjectType, "user"),
        )),
        tx.select({ userId: spaceMemberships.principalId }).from(spaceMemberships).where(and(
          eq(spaceMemberships.spaceId, spaceId),
          eq(spaceMemberships.principalType, "user"),
          ne(spaceMemberships.principalId, userId),
        )),
      ]);
      grantRefs = allGrantRefs;
      connectionRefs = allConnectionRefs;
      grantMemberRefs = allGrantMemberRefs;
      existingMemberUserIds = new Set(membershipRefs.map((row) => row.userId));

      for (const binding of bindingRefs) {
        if (binding.targetType !== "tool_connection" || !affectedConnections.has(binding.targetId)) {
          retainedSecretIds.add(binding.secretId);
        }
      }
      const declaredDefinitions = new Set(declarationRefs.map((row) => row.userSecretDefinitionId));
      for (const secret of ownedSecrets) {
        if (secret.userSecretDefinitionId && declaredDefinitions.has(secret.userSecretDefinitionId)) {
          retainedSecretIds.add(secret.id);
        }
      }
      for (const grant of grantRefs) {
        if (ownedGrantIds.has(grant.id)) continue;
        const grantAudience = grantMemberRefs.filter((member) => member.grantId === grant.id);
        const remainingGrantAudience = grantAudience.filter((member) => member.subjectId !== userId);
        const hasSurvivingOrganizationAudience = grant.kind === "organization"
          && grant.status === "active"
          && (
            soleAudienceGrantIds.has(grant.id)
              ? true
              : remainingGrantAudience.length === 0
              ? existingMemberUserIds.size > 0
              : remainingGrantAudience.some((member) => existingMemberUserIds.has(member.subjectId))
          );
        for (const ref of grant.credentialSecretRefs) {
          if (!ownedSecretSet.has(ref.secretId)) continue;
          if (!affectedConnections.has(grant.connectionId)) {
            retainedSecretIds.add(ref.secretId);
          } else if (grant.kind === "user" || hasSurvivingOrganizationAudience) {
            // A connection may temporarily carry separate user grants that
            // reference the same credential, or an organization grant may
            // still have another persisted audience member. A sole named
            // audience row stays persisted instead of being widened to space
            // scope; both resolvers require current active membership, so the
            // row remains dormant until space access is restored. Pending,
            // suspended, and archived memberships are intentionally included
            // because space access can reactivate each of them later.
            retainedSecretIds.add(ref.secretId);
            sharedConnectionSecretIds.add(ref.secretId);
          }
        }
      }
      for (const connection of connectionRefs) {
        if (affectedConnections.has(connection.id)) continue;
        for (const ref of [...connection.credentialRefs, ...connection.credentialSecretRefs]) {
          if (ownedSecretSet.has(ref.secretId)) retainedSecretIds.add(ref.secretId);
        }
      }
    }
    const secretIdsToDelete = ownedSecretIds.filter((secretId) => !retainedSecretIds.has(secretId));
    const connectionSecretIdsToRemove = new Set(
      ownedSecretIds.filter((secretId) => !sharedConnectionSecretIds.has(secretId)),
    );
    const affectedGrantIds = [...new Set([...grantIds, ...grantRefs
      .filter(grant => affectedConnections.has(grant.connectionId))
      .map(grant => grant.id)])];
    if (affectedGrantIds.length > 0) {
      await tx.select({ id: connectionGrants.id }).from(connectionGrants)
        .where(and(eq(connectionGrants.spaceId, spaceId), inArray(connectionGrants.id, affectedGrantIds)))
        .orderBy(connectionGrants.id).for("update");
    }
    if (affectedConnectionIds.length > 0) {
      await tx.select({ id: toolConnections.id }).from(toolConnections)
        .where(and(eq(toolConnections.spaceId, spaceId), inArray(toolConnections.id, affectedConnectionIds)))
        .orderBy(toolConnections.id).for("update");
    }
    if (secretIdsToDelete.length > 0) {
      await tx.select({ id: spaceSecrets.id }).from(spaceSecrets)
        .where(and(eq(spaceSecrets.spaceId, spaceId), inArray(spaceSecrets.id, secretIdsToDelete)))
        .orderBy(spaceSecrets.id).for("update", { noWait: true });
    }
    await tx.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.spaceId, spaceId), notInArray(agents.status, ["pending_approval", "terminated"])))
      .orderBy(agents.id).for("no key update");
    const removedDelegations = grantIds.length === 0 ? [] : await tx
      .delete(connectionGrantDelegations)
      .where(and(
        eq(connectionGrantDelegations.spaceId, spaceId),
        inArray(connectionGrantDelegations.grantId, grantIds),
      ))
      .returning();
    if (grantIds.length > 0) {
      await tx.update(connectionGrants).set({
        status: "revoked",
        isDefault: false,
        revokedAt: now,
        revokedByUserId: null,
        revokedByAgentId: null,
        updatedAt: now,
      }).where(and(
        eq(connectionGrants.spaceId, spaceId),
        inArray(connectionGrants.id, grantIds),
      ));
    }
    if (ownedSecretIds.length > 0) {
      for (const grant of grantRefs) {
        if (!ownedGrantIds.has(grant.id) && !affectedConnections.has(grant.connectionId)) continue;
        const refsToRemove = ownedGrantIds.has(grant.id) ? ownedSecretSet : connectionSecretIdsToRemove;
        const credentialSecretRefs = grant.credentialSecretRefs.filter(
          (ref) => !refsToRemove.has(ref.secretId),
        );
        if (credentialSecretRefs.length !== grant.credentialSecretRefs.length) {
          await tx.update(connectionGrants).set({
            credentialSecretRefs,
            ...(ownedGrantIds.has(grant.id) || grant.status === "revoked" ? {
              status: "revoked" as const,
              isDefault: false,
            } : {
              status: "needs_reauthorization" as const,
              isDefault: false,
            }),
            updatedAt: now,
          })
            .where(eq(connectionGrants.id, grant.id));
        }
      }
      for (const connection of connectionRefs) {
        if (!affectedConnections.has(connection.id)) continue;
        const credentialRefs = connection.credentialRefs.filter(
          (ref) => !connectionSecretIdsToRemove.has(ref.secretId),
        );
        const credentialSecretRefs = connection.credentialSecretRefs.filter(
          (ref) => !connectionSecretIdsToRemove.has(ref.secretId),
        );
        if (
          credentialRefs.length !== connection.credentialRefs.length ||
          credentialSecretRefs.length !== connection.credentialSecretRefs.length
        ) {
          const hasUnaffectedActiveGrant = grantRefs.some((grant) =>
            grant.connectionId === connection.id
            && !ownedGrantIds.has(grant.id)
            && grant.status === "active"
            && grant.credentialSecretRefs.length > 0
            && grant.credentialSecretRefs.every((ref) => !connectionSecretIdsToRemove.has(ref.secretId)),
          );
          if (connection.transport === "chat_sdk") await notifyChatEndpointWork(tx, connection.id, spaceId);
          if (connection.transport === "voice") await notifyVoiceChange(tx, { kind: "connection", id: connection.id });
          if (!hasUnaffectedActiveGrant) await notifyToolConnectionHealth(tx, { spaceId, id: connection.id });
          await tx.update(toolConnections).set({
            credentialRefs,
            credentialSecretRefs,
            ...(!hasUnaffectedActiveGrant ? {
              status: "draft" as const,
              enabled: false,
              healthStatus: "missing_secret" as const,
              healthMessage: "Personal credential owner no longer has space access. Reauthorize this connection.",
              lastError: "oauth_reauthorization_required",
            } : {}),
            updatedAt: now,
          })
            .where(eq(toolConnections.id, connection.id));
        }
      }
      if (affectedConnectionIds.length > 0 && connectionSecretIdsToRemove.size > 0) {
        await tx.delete(spaceSecretBindings).where(and(
          eq(spaceSecretBindings.spaceId, spaceId),
          eq(spaceSecretBindings.targetType, "tool_connection"),
          inArray(spaceSecretBindings.targetId, affectedConnectionIds),
          inArray(spaceSecretBindings.secretId, [...connectionSecretIdsToRemove]),
        ));
      }
      if (secretIdsToDelete.length > 0) {
        await tx.delete(spaceSecrets).where(and(
          eq(spaceSecrets.spaceId, spaceId),
          inArray(spaceSecrets.id, secretIdsToDelete),
        ));
      }
    }
    await tx.delete(connectionGrantMembers).where(and(
      eq(connectionGrantMembers.spaceId, spaceId),
      eq(connectionGrantMembers.subjectType, "user"),
      eq(connectionGrantMembers.subjectId, userId),
      soleAudienceGrantIds.size > 0
        ? notInArray(connectionGrantMembers.grantId, [...soleAudienceGrantIds])
        : undefined,
    ));
    if (removedDelegations.length > 0) {
      const connectionByGrant = new Map(ownedGrants.map((grant) => [grant.id, grant.connectionId]));
      await tx.insert(toolAccessAuditEvents).values(removedDelegations.map((delegation) => ({
        spaceId,
        connectionId: connectionByGrant.get(delegation.grantId) ?? null,
        actorType: "system",
        actorId: null,
        action: "connection_grant.delegation_revoked",
        outcome: "success",
        reasonCode: "membership_removed",
        details: {
          grantId: delegation.grantId,
          delegationId: delegation.id,
          agentId: delegation.agentId,
          ownerUserId: userId,
        },
      })));
    }
  }

  async function isInstanceAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const row = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function getMembership(
    spaceId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<MembershipRow | null> {
    return db
      .select()
      .from(spaceMemberships)
      .where(
        and(
          eq(spaceMemberships.spaceId, spaceId),
          eq(spaceMemberships.principalType, principalType),
          eq(spaceMemberships.principalId, principalId),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function hasPermission(
    spaceId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    return authorization.decidePrincipalGrant({
      spaceId,
      principalType,
      principalId,
      permissionKey,
      action: permissionKey,
    }).then((decision) => decision.allowed);
  }

  async function canUser(
    spaceId: string,
    userId: string | null | undefined,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    return authorization.decide({
      actor: { type: "operator", userId },
      action: permissionKey,
      resource: { type: "space", spaceId },
    }).then((decision) => decision.allowed);
  }

  async function decide(input: {
    actor: AuthorizationActor;
    action: Parameters<typeof authorization.decide>[0]["action"];
    resource: AuthorizationResource;
    scope?: Record<string, unknown> | null;
  }) {
    return authorization.decide(input);
  }

  async function listMembers(spaceId: string) {
    return db
      .select()
      .from(spaceMemberships)
      .where(eq(spaceMemberships.spaceId, spaceId))
      .orderBy(sql`${spaceMemberships.createdAt} desc`);
  }

  async function getMemberById(spaceId: string, memberId: string) {
    return db
      .select()
      .from(spaceMemberships)
      .where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.id, memberId)))
      .then((rows) => rows[0] ?? null);
  }

  async function listActiveUserMemberships(spaceId: string) {
    return db
      .select()
      .from(spaceMemberships)
      .where(
        and(
          eq(spaceMemberships.spaceId, spaceId),
          eq(spaceMemberships.principalType, "user"),
          eq(spaceMemberships.status, "active"),
        ),
      )
      .orderBy(sql`${spaceMemberships.createdAt} asc`);
  }

  async function setMemberPermissions(
    spaceId: string,
    memberId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    return db.transaction(async (tx) => {
      const member = await tx.select().from(spaceMemberships)
        .where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.id, memberId)))
        .for("update").then(rows => rows[0] ?? null);
      if (!member) return null;
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.spaceId, spaceId),
            eq(principalPermissionGrants.principalType, member.principalType),
            eq(principalPermissionGrants.principalId, member.principalId),
          ),
        );
      if (grants.length > 0) {
        await tx.insert(principalPermissionGrants).values(
          grants.map((grant) => ({
            spaceId,
            principalType: member.principalType,
            principalId: member.principalId,
            permissionKey: grant.permissionKey,
            scope: grant.scope ?? null,
            grantedByUserId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
      }
      return member;
    });
  }

  async function updateMemberAndPermissions(
    spaceId: string,
    memberId: string,
    data: {
      membershipRole?: string | null;
      status?: "pending" | "active" | "suspended";
      grants: GrantInput[];
    },
    grantedByUserId: string | null,
  ) {
    return memberAccessTransaction(async (tx) => {
      await tx.execute(sql`
        select ${spaceMemberships.id}
        from ${spaceMemberships}
        where ${spaceMemberships.spaceId} = ${spaceId}
          and ${spaceMemberships.principalType} = 'user'
          and ${spaceMemberships.status} = 'active'
          and ${spaceMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(spaceMemberships)
        .where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.id, memberId)))
        .for("update")
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextMembershipRole =
        data.membershipRole !== undefined ? data.membershipRole : existing.membershipRole;
      const nextStatus = data.status ?? existing.status;

      if(nextStatus==="active"&&(existing.principalType==="agent"||nextMembershipRole!=="viewer")
        &&(existing.status!=="active"||existing.principalType==="user"&&existing.membershipRole==="viewer"))
        await notifyMuseContactVerification(tx,{spaceId,...(existing.principalType==="user"?{operatorId:existing.principalId}:{agentId:existing.principalId})});

      if (existing.principalType === "user" && nextStatus === "active" && nextMembershipRole !== "viewer"
        && (existing.status !== "active" || existing.membershipRole === "viewer")) {
        await notifyChatSpaceAuthorityChange(tx, { spaceId });
      }

      if (
        existing.principalType === "user" &&
        existing.status === "active" &&
        existing.membershipRole === "owner" &&
        (nextStatus !== "active" || nextMembershipRole !== "owner")
      ) {
        const activeOwnerCount = await tx
          .select({ id: spaceMemberships.id })
          .from(spaceMemberships)
          .where(
            and(
              eq(spaceMemberships.spaceId, spaceId),
              eq(spaceMemberships.principalType, "user"),
              eq(spaceMemberships.status, "active"),
              eq(spaceMemberships.membershipRole, "owner"),
            ),
          )
          .then((rows) => rows.length);
        if (activeOwnerCount <= 1) {
          throw conflict("Cannot remove the last active owner");
        }
      }

      const now = new Date();
      if (existing.status === "active" && nextStatus !== "active" && existing.principalType === "user") {
        await sweepMemberConnectionAccess(tx, spaceId, existing.principalId, now);
      }
      const updated = await tx
        .update(spaceMemberships)
        .set({
          membershipRole: nextMembershipRole,
          status: nextStatus,
          updatedAt: now,
        })
        .where(eq(spaceMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);

      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.spaceId, spaceId),
            eq(principalPermissionGrants.principalType, existing.principalType),
            eq(principalPermissionGrants.principalId, existing.principalId),
          ),
        );
      if (data.grants.length > 0) {
        await tx.insert(principalPermissionGrants).values(
          data.grants.map((grant) => ({
            spaceId,
            principalType: existing.principalType,
            principalId: existing.principalId,
            permissionKey: grant.permissionKey,
            scope: grant.scope ?? null,
            grantedByUserId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return updated;
    });
  }

  async function assertCanRemoveActiveOwner(
    spaceId: string,
    principalType: PrincipalType,
    status: string,
    membershipRole: string | null,
    tx: Pick<Db, "select">,
  ) {
    if (
      principalType !== "user" ||
      status !== "active" ||
      membershipRole !== "owner"
    ) {
      return;
    }

    const activeOwnerCount = await tx
      .select({ id: spaceMemberships.id })
      .from(spaceMemberships)
      .where(
        and(
          eq(spaceMemberships.spaceId, spaceId),
          eq(spaceMemberships.principalType, "user"),
          eq(spaceMemberships.status, "active"),
          eq(spaceMemberships.membershipRole, "owner"),
        ),
      )
      .then((rows) => rows.length);
    if (activeOwnerCount <= 1) {
      throw conflict("Cannot remove the last active owner");
    }
  }

  async function assertAssignableArchiveTarget(
    spaceId: string,
    input: MemberArchiveInput["reassignment"],
    tx: Pick<Db, "select">,
  ) {
    if (!input?.assigneeAgentId && !input?.assigneeUserId) return;
    if (input.assigneeAgentId && input.assigneeUserId) {
      throw conflict("Choose either an agent or user reassignment target");
    }
    if (input.assigneeUserId) {
      const membership = await tx
        .select({ id: spaceMemberships.id })
        .from(spaceMemberships)
        .where(
          and(
            eq(spaceMemberships.spaceId, spaceId),
            eq(spaceMemberships.principalType, "user"),
            eq(spaceMemberships.principalId, input.assigneeUserId),
            eq(spaceMemberships.status, "active"),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!membership) {
        throw conflict("Replacement user must be an active space member");
      }
      return;
    }

    await assertAssignableAgent(tx as Db, spaceId, input.assigneeAgentId, { kind: "work" });
  }

  async function archiveMember(spaceId: string, memberId: string, input: MemberArchiveInput = {}) {
    return memberAccessTransaction(async (tx) => {
      await tx.execute(sql`
        select ${spaceMemberships.id}
        from ${spaceMemberships}
        where ${spaceMemberships.spaceId} = ${spaceId}
          and ${spaceMemberships.principalType} = 'user'
          and ${spaceMemberships.status} = 'active'
          and ${spaceMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(spaceMemberships)
        .where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.id, memberId)))
        .for("update")
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;
      if (existing.principalType !== "user") {
        throw conflict("Only human space members can be archived");
      }
      if (existing.status === "archived") {
        return { member: existing, reassignedIssueCount: 0 };
      }
      if (input.reassignment?.assigneeUserId === existing.principalId) {
        throw conflict("Replacement user cannot be the archived member");
      }

      await assertCanRemoveActiveOwner(
        spaceId,
        existing.principalType,
        existing.status,
        existing.membershipRole,
        tx,
      );
      await assertAssignableArchiveTarget(spaceId, input.reassignment, tx);

      const now = new Date();
      await sweepMemberConnectionAccess(tx, spaceId, existing.principalId, now);
      const assignmentPatch = {
        assigneeAgentId: input.reassignment?.assigneeAgentId ?? null,
        assigneeUserId: input.reassignment?.assigneeUserId ?? null,
        updatedAt: now,
      };
      const assignedOpenIssueWhere = and(
        eq(issues.spaceId, spaceId),
        eq(issues.assigneeUserId, existing.principalId),
        sql`${issues.status} not in ('done', 'cancelled')`,
      );
      await notifyNativeStatusReassessment(tx, { spaceId });
      await notifyDeferredExecutionEligibility(tx, { spaceId });
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.issueMonitors);
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
      const resetInProgress = await tx
        .update(issues)
        .set({
          ...assignmentPatch,
          status: "todo",
          startedAt: null,
          checkoutRunId: null,
          executionRunId: null,
          executionLockedAt: null,
        })
        .where(and(assignedOpenIssueWhere, eq(issues.status, "in_progress")))
        .returning({ id: issues.id });
      if (assignmentPatch.assigneeAgentId) await notifyUnsafeWorkspaceExportRecovery(tx, { spaceId });
      const reassigned = await tx
        .update(issues)
        .set(assignmentPatch)
        .where(and(assignedOpenIssueWhere, ne(issues.status, "in_progress")))
        .returning({ id: issues.id });

      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.spaceId, spaceId),
            eq(principalPermissionGrants.principalType, existing.principalType),
            eq(principalPermissionGrants.principalId, existing.principalId),
          ),
        );

      const archived = await tx
        .update(spaceMemberships)
        .set({
          status: "archived",
          updatedAt: now,
        })
        .where(eq(spaceMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);

      return {
        member: archived,
        reassignedIssueCount: resetInProgress.length + reassigned.length,
      };
    });
  }

  async function promoteInstanceAdmin(userId: string) {
    const existing = await db
      .select()
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;
    return db
      .insert(instanceUserRoles)
      .values({
        userId,
        role: "instance_admin",
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function demoteInstanceAdmin(userId: string) {
    return db
      .delete(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function listUserSpaceAccess(userId: string) {
    return db
      .select()
      .from(spaceMemberships)
      .where(and(eq(spaceMemberships.principalType, "user"), eq(spaceMemberships.principalId, userId)))
      .orderBy(sql`${spaceMemberships.createdAt} desc`);
  }

  async function setUserSpaceAccess(
    userId: string,
    spaceIds: string[],
    options: { actorUserId?: string | null } = {},
  ) {
    const target = new Set(spaceIds);

    await memberAccessTransaction(async (tx) => {
      // Serialize every space-access removal/reactivation with personal OAuth
      // completion, which locks the same membership row before writing secrets.
      const existing = await tx
        .select()
        .from(spaceMemberships)
        .where(and(eq(spaceMemberships.principalType, "user"), eq(spaceMemberships.principalId, userId)))
        .orderBy(spaceMemberships.spaceId, spaceMemberships.id)
        .for("update");
      const existingBySpace = new Map(existing.map((row) => [row.spaceId, row]));
      const toArchive = existing.filter((row) => !target.has(row.spaceId) && row.status !== "archived");
      if (toArchive.length > 0 && options.actorUserId && options.actorUserId === userId) {
        throw conflict("You cannot remove yourself");
      }
      if (toArchive.length > 0 && (await isInstanceAdmin(userId))) {
        throw conflict("Instance admins cannot be removed from space access");
      }
      const protectedArchives = toArchive.filter((row) => row.membershipRole === "owner" || row.membershipRole === "admin");
      if (protectedArchives.length > 0) {
        throw conflict("Owners and admins cannot be removed from space access");
      }
      const activeOwnerArchives = toArchive.filter(
        (row) => row.status === "active" && row.membershipRole === "owner",
      );
      if (activeOwnerArchives.length > 0) {
        const activeOwnerRows = await tx
          .select({ spaceId: spaceMemberships.spaceId, id: spaceMemberships.id })
          .from(spaceMemberships)
          .where(
            and(
              eq(spaceMemberships.principalType, "user"),
              eq(spaceMemberships.status, "active"),
              eq(spaceMemberships.membershipRole, "owner"),
              inArray(spaceMemberships.spaceId, activeOwnerArchives.map((row) => row.spaceId)),
            ),
          );
        for (const row of activeOwnerArchives) {
          const remainingOwners =
            activeOwnerRows.filter((owner) => owner.spaceId === row.spaceId).length - 1;
          if (remainingOwners <= 0) {
            throw conflict("Cannot remove the last active owner");
          }
        }
      }
      if (toArchive.length > 0) {
        const now = new Date();
        for (const membership of toArchive) {
          await sweepMemberConnectionAccess(tx, membership.spaceId, membership.principalId, now);
        }
        await tx
          .update(spaceMemberships)
          .set({ status: "archived", updatedAt: now })
          .where(inArray(spaceMemberships.id, toArchive.map((row) => row.id)));
        await tx
          .delete(principalPermissionGrants)
          .where(
            and(
              eq(principalPermissionGrants.principalType, "user"),
              eq(principalPermissionGrants.principalId, userId),
              inArray(principalPermissionGrants.spaceId, toArchive.map((row) => row.spaceId)),
            ),
          );
      }

      for (const spaceId of target) {
        const existingMembership = existingBySpace.get(spaceId);
        if (existingMembership) {
          if (existingMembership.status !== "active") {
            if (existingMembership.membershipRole !== "viewer") {
              await notifyChatSpaceAuthorityChange(tx, { spaceId });
              await notifyMuseContactVerification(tx,{spaceId,operatorId:userId});
            }
            await tx
              .update(spaceMemberships)
              .set({
                status: "active",
                membershipRole: existingMembership.membershipRole ?? "operator",
                updatedAt: new Date(),
              })
              .where(eq(spaceMemberships.id, existingMembership.id));
          }
          continue;
        }
        await notifyChatSpaceAuthorityChange(tx, { spaceId });
        await notifyMuseContactVerification(tx,{spaceId,operatorId:userId});
        await tx.insert(spaceMemberships).values({
          spaceId,
          principalType: "user",
          principalId: userId,
          status: "active",
          membershipRole: "operator",
        });
      }
    });

    return listUserSpaceAccess(userId);
  }

  async function ensureMembership(
    spaceId: string,
    principalType: PrincipalType,
    principalId: string,
    membershipRole: string | null = "member",
    status: "pending" | "active" | "suspended" = "active",
  ) {
    return db.transaction(async tx => {
      const existing = await tx.select().from(spaceMemberships).where(and(
        eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.principalType, principalType),
        eq(spaceMemberships.principalId, principalId),
      )).for("update").then(rows => rows[0] ?? null);
      if (existing) {
        if (existing.status !== status || existing.membershipRole !== membershipRole) {
          if(status==="active"&&(principalType==="agent"||membershipRole!=="viewer")
            &&(existing.status!=="active"||principalType==="user"&&existing.membershipRole==="viewer"))
            await notifyMuseContactVerification(tx,{spaceId,...(principalType==="user"?{operatorId:principalId}:{agentId:principalId})});
          if (principalType === "user" && status === "active" && membershipRole !== "viewer"
            && (existing.status !== "active" || existing.membershipRole === "viewer")) {
            await notifyChatSpaceAuthorityChange(tx, { spaceId });
          }
          const updated = await tx
            .update(spaceMemberships)
            .set({ status, membershipRole, updatedAt: new Date() })
            .where(eq(spaceMemberships.id, existing.id))
            .returning()
            .then((rows) => rows[0] ?? null);
          return updated ?? existing;
        }
        return existing;
      }

      if(status==="active"&&(principalType==="agent"||membershipRole!=="viewer"))await notifyMuseContactVerification(tx,{spaceId,...(principalType==="user"?{operatorId:principalId}:{agentId:principalId})});
      if (principalType === "user" && status === "active" && membershipRole !== "viewer") {
        await notifyChatSpaceAuthorityChange(tx, { spaceId });
      }
      return tx
        .insert(spaceMemberships)
        .values({
          spaceId,
          principalType,
          principalId,
          status,
          membershipRole,
        })
        .returning()
        .then((rows) => rows[0]);
    });
  }

  async function setPrincipalGrants(
    spaceId: string,
    principalType: PrincipalType,
    principalId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    await db.transaction(async (tx) => {
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.spaceId, spaceId),
            eq(principalPermissionGrants.principalType, principalType),
            eq(principalPermissionGrants.principalId, principalId),
          ),
        );
      if (grants.length === 0) return;
      await tx.insert(principalPermissionGrants).values(
        grants.map((grant) => ({
          spaceId,
          principalType,
          principalId,
          permissionKey: grant.permissionKey,
          scope: grant.scope ?? null,
          grantedByUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    });
  }

  async function copyActiveUserMemberships(sourceSpaceId: string, targetSpaceId: string) {
    const sourceMemberships = await listActiveUserMemberships(sourceSpaceId);
    for (const membership of sourceMemberships) {
      await ensureMembership(
        targetSpaceId,
        "user",
        membership.principalId,
        membership.membershipRole,
        "active",
      );
      await ensureHumanRoleDefaultGrants(db, {
        spaceId: targetSpaceId,
        principalId: membership.principalId,
        membershipRole: membership.membershipRole,
        grantedByUserId: null,
      });
    }
    return sourceMemberships;
  }

  async function ensureRoleDefaultGrants(
    spaceId: string,
    principalId: string,
    membershipRole: string | null | undefined,
    grantedByUserId: string | null,
  ) {
    return ensureHumanRoleDefaultGrants(db, {
      spaceId,
      principalId,
      membershipRole,
      grantedByUserId,
    });
  }

  async function listPrincipalGrants(
    spaceId: string,
    principalType: PrincipalType,
    principalId: string,
  ) {
    return db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.spaceId, spaceId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
        ),
      )
      .orderBy(principalPermissionGrants.permissionKey);
  }

  async function setPrincipalPermission(
    spaceId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
    enabled: boolean,
    grantedByUserId: string | null,
    scope: Record<string, unknown> | null = null,
  ) {
    if (!enabled) {
      await db
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.spaceId, spaceId),
            eq(principalPermissionGrants.principalType, principalType),
            eq(principalPermissionGrants.principalId, principalId),
            eq(principalPermissionGrants.permissionKey, permissionKey),
          ),
        );
      return;
    }

    await ensureMembership(spaceId, principalType, principalId, "member", "active");

    const existing = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.spaceId, spaceId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (existing) {
      await db
        .update(principalPermissionGrants)
        .set({
          scope,
          grantedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(principalPermissionGrants.id, existing.id));
      return;
    }

    await db.insert(principalPermissionGrants).values({
      spaceId,
      principalType,
      principalId,
      permissionKey,
      scope,
      grantedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function updateMember(
    spaceId: string,
    memberId: string,
    data: {
      membershipRole?: string | null;
      status?: "pending" | "active" | "suspended";
    },
  ) {
    return memberAccessTransaction(async (tx) => {
      await tx.execute(sql`
        select ${spaceMemberships.id}
        from ${spaceMemberships}
        where ${spaceMemberships.spaceId} = ${spaceId}
          and ${spaceMemberships.principalType} = 'user'
          and ${spaceMemberships.status} = 'active'
          and ${spaceMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(spaceMemberships)
        .where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.id, memberId)))
        .for("update")
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextMembershipRole =
        data.membershipRole !== undefined ? data.membershipRole : existing.membershipRole;
      const nextStatus = data.status ?? existing.status;

      if(nextStatus==="active"&&(existing.principalType==="agent"||nextMembershipRole!=="viewer")
        &&(existing.status!=="active"||existing.principalType==="user"&&existing.membershipRole==="viewer"))
        await notifyMuseContactVerification(tx,{spaceId,...(existing.principalType==="user"?{operatorId:existing.principalId}:{agentId:existing.principalId})});

      if (existing.principalType === "user" && nextStatus === "active" && nextMembershipRole !== "viewer"
        && (existing.status !== "active" || existing.membershipRole === "viewer")) {
        await notifyChatSpaceAuthorityChange(tx, { spaceId });
      }

      if (
        existing.principalType === "user" &&
        existing.status === "active" &&
        existing.membershipRole === "owner" &&
        (nextStatus !== "active" || nextMembershipRole !== "owner")
      ) {
        const activeOwnerCount = await tx
          .select({ id: spaceMemberships.id })
          .from(spaceMemberships)
          .where(
            and(
              eq(spaceMemberships.spaceId, spaceId),
              eq(spaceMemberships.principalType, "user"),
              eq(spaceMemberships.status, "active"),
              eq(spaceMemberships.membershipRole, "owner"),
            ),
          )
          .then((rows) => rows.length);
        if (activeOwnerCount <= 1) {
          throw conflict("Cannot remove the last active owner");
        }
      }

      const now = new Date();
      if (
        existing.principalType === "user" &&
        existing.status !== "suspended" &&
        nextStatus === "suspended"
      ) {
        await sweepMemberConnectionAccess(tx, spaceId, existing.principalId, now);
      }

      return tx
        .update(spaceMemberships)
        .set({
          membershipRole: nextMembershipRole,
          status: nextStatus,
          updatedAt: now,
        })
        .where(eq(spaceMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);
    });
  }

  return {
    isInstanceAdmin,
    decide,
    decideReads: authorization.decideReads,
    projectDiscoveryCandidateIds: authorization.projectDiscoveryCandidateIds,
    canUser,
    hasPermission,
    getMembership,
    getMemberById,
    ensureMembership,
    listMembers,
    listActiveUserMemberships,
    copyActiveUserMemberships,
    ensureRoleDefaultGrants,
    archiveMember,
    setMemberPermissions,
    updateMemberAndPermissions,
    promoteInstanceAdmin,
    demoteInstanceAdmin,
    listUserSpaceAccess,
    setUserSpaceAccess,
    setPrincipalGrants,
    listPrincipalGrants,
    setPrincipalPermission,
    updateMember,
  };
}
