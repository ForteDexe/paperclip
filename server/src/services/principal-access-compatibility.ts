import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { agents, spaceMemberships, principalPermissionGrants } from "@outpost/db";
import type { PermissionKey, PrincipalType } from "@outpost/shared";
import { grantsForHumanRole, normalizeHumanRole } from "./space-member-roles.js";

type GrantInput = {
  permissionKey: PermissionKey;
  scope?: Record<string, unknown> | null;
};

export type PrincipalAccessCompatibilityBackfillStats = {
  agentMembershipsInserted: number;
  humanGrantsInserted: number;
};

export async function insertMissingPrincipalGrants(
  db: Db,
  input: {
    spaceId: string;
    principalType: PrincipalType;
    principalId: string;
    grants: GrantInput[];
    grantedByUserId: string | null;
  },
): Promise<number> {
  if (input.grants.length === 0) return 0;

  // Read before writing. Cloud tenant authentication re-seeds role defaults
  // on every sync, and the grants almost always exist already. An INSERT ...
  // ON CONFLICT still waits on another transaction that is deleting or
  // re-inserting a conflicting row, which stalled authentication until the
  // statement timeout. A plain read never waits on row locks.
  const existing = await db
    .select({ permissionKey: principalPermissionGrants.permissionKey })
    .from(principalPermissionGrants)
    .where(
      and(
        eq(principalPermissionGrants.spaceId, input.spaceId),
        eq(principalPermissionGrants.principalType, input.principalType),
        eq(principalPermissionGrants.principalId, input.principalId),
        inArray(
          principalPermissionGrants.permissionKey,
          input.grants.map((grant) => grant.permissionKey),
        ),
      ),
    );
  const existingKeys = new Set(existing.map((row) => row.permissionKey));
  const missing = input.grants.filter((grant) => !existingKeys.has(grant.permissionKey));
  if (missing.length === 0) return 0;

  const now = new Date();
  const inserted = await db
    .insert(principalPermissionGrants)
    .values(
      missing.map((grant) => ({
        spaceId: input.spaceId,
        principalType: input.principalType,
        principalId: input.principalId,
        permissionKey: grant.permissionKey,
        scope: grant.scope ?? null,
        grantedByUserId: input.grantedByUserId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [
        principalPermissionGrants.spaceId,
        principalPermissionGrants.principalType,
        principalPermissionGrants.principalId,
        principalPermissionGrants.permissionKey,
      ],
    })
    .returning({ id: principalPermissionGrants.id });

  return inserted.length;
}

export async function ensureHumanRoleDefaultGrants(
  db: Db,
  input: {
    spaceId: string;
    principalId: string;
    membershipRole: string | null | undefined;
    grantedByUserId: string | null;
  },
): Promise<number> {
  const role = normalizeHumanRole(input.membershipRole, "operator");
  return insertMissingPrincipalGrants(db, {
    spaceId: input.spaceId,
    principalType: "user",
    principalId: input.principalId,
    grants: grantsForHumanRole(role),
    grantedByUserId: input.grantedByUserId,
  });
}

export async function backfillPrincipalAccessCompatibility(
  db: Db,
): Promise<PrincipalAccessCompatibilityBackfillStats> {
  const now = new Date();
  const nonTerminalAgents = await db
    .select({
      spaceId: agents.spaceId,
      principalId: agents.id,
    })
    .from(agents)
    .where(notInArray(agents.status, ["pending_approval", "terminated"]));

  const agentMembershipsInserted = nonTerminalAgents.length > 0
    ? await db
      .insert(spaceMemberships)
      .values(
        nonTerminalAgents.map((agent) => ({
          spaceId: agent.spaceId,
          principalType: "agent",
          principalId: agent.principalId,
          status: "active",
          membershipRole: "member",
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [
          spaceMemberships.spaceId,
          spaceMemberships.principalType,
          spaceMemberships.principalId,
        ],
      })
      .returning({ id: spaceMemberships.id })
      .then((rows) => rows.length)
    : 0;

  const activeHumanMemberships = await db
    .select({
      spaceId: spaceMemberships.spaceId,
      principalId: spaceMemberships.principalId,
      membershipRole: spaceMemberships.membershipRole,
    })
    .from(spaceMemberships)
    .where(
      and(
        eq(spaceMemberships.principalType, "user"),
        eq(spaceMemberships.status, "active"),
      ),
    );

  let humanGrantsInserted = 0;
  for (const membership of activeHumanMemberships) {
    humanGrantsInserted += await ensureHumanRoleDefaultGrants(db, {
      spaceId: membership.spaceId,
      principalId: membership.principalId,
      membershipRole: membership.membershipRole,
      grantedByUserId: null,
    });
  }

  return {
    agentMembershipsInserted,
    humanGrantsInserted,
  };
}
