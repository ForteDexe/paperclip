import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { spaces, spaceMemberships, instanceUserRoles } from "@outpost/db";
import type { DeploymentMode } from "@outpost/shared";
import { ensureHumanRoleDefaultGrants } from "./services/principal-access-compatibility.js";
import { notifyChatSpaceAuthorityChange } from "./services/chat-run-milestone-notifications.js";

const LOCAL_OPERATOR_USER_ID = "local-operator";
const CLAIM_TTL_MS = 1000 * 60 * 60 * 24;

type ChallengeStatus = "available" | "claimed" | "expired" | "invalid";

type ClaimChallenge = {
  token: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  claimedByUserId: string | null;
};

let activeChallenge: ClaimChallenge | null = null;

function createChallenge(now = new Date()): ClaimChallenge {
  return {
    token: randomBytes(24).toString("hex"),
    code: randomBytes(12).toString("hex"),
    createdAt: now,
    expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
    claimedAt: null,
    claimedByUserId: null,
  };
}

function getChallengeStatus(token: string, code: string | undefined): ChallengeStatus {
  if (!activeChallenge) return "invalid";
  if (activeChallenge.token !== token) return "invalid";
  if (activeChallenge.code !== (code ?? "")) return "invalid";
  if (activeChallenge.claimedAt) return "claimed";
  if (activeChallenge.expiresAt.getTime() <= Date.now()) return "expired";
  return "available";
}

export async function initializeOperatorClaimChallenge(
  db: Db,
  opts: { deploymentMode: DeploymentMode },
): Promise<void> {
  if (opts.deploymentMode !== "authenticated") {
    activeChallenge = null;
    return;
  }

  const admins = await db
    .select({ userId: instanceUserRoles.userId })
    .from(instanceUserRoles)
    .where(eq(instanceUserRoles.role, "instance_admin"));

  const onlyLocalOperatorAdmin = admins.length === 1 && admins[0]?.userId === LOCAL_OPERATOR_USER_ID;
  if (!onlyLocalOperatorAdmin) {
    activeChallenge = null;
    return;
  }

  if (!activeChallenge || activeChallenge.expiresAt.getTime() <= Date.now() || activeChallenge.claimedAt) {
    activeChallenge = createChallenge();
  }
}

export function getOperatorClaimWarningUrl(host: string, port: number): string | null {
  if (!activeChallenge) return null;
  if (activeChallenge.claimedAt || activeChallenge.expiresAt.getTime() <= Date.now()) return null;
  const visibleHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${visibleHost}:${port}/operator-claim/${activeChallenge.token}?code=${activeChallenge.code}`;
}

export function inspectOperatorClaimChallenge(token: string, code: string | undefined) {
  const status = getChallengeStatus(token, code);
  return {
    status,
    requiresSignIn: true,
    expiresAt: activeChallenge?.expiresAt?.toISOString() ?? null,
    claimedByUserId: activeChallenge?.claimedByUserId ?? null,
  };
}

export async function claimOperatorOwnership(
  db: Db,
  opts: { token: string; code: string | undefined; userId: string },
): Promise<{ status: ChallengeStatus; claimedByUserId?: string }> {
  const status = getChallengeStatus(opts.token, opts.code);
  if (status !== "available") return { status };

  const claimedSpaceIds: string[] = [];
  await db.transaction(async (tx) => {
    const existingTargetAdmin = await tx
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, opts.userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    if (!existingTargetAdmin) {
      await tx.insert(instanceUserRoles).values({
        userId: opts.userId,
        role: "instance_admin",
      });
    }

    await tx
      .delete(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, LOCAL_OPERATOR_USER_ID), eq(instanceUserRoles.role, "instance_admin")));

    const allSpaces = await tx.select({ id: spaces.id }).from(spaces);
    for (const space of allSpaces) {
      claimedSpaceIds.push(space.id);
      const existing = await tx
        .select({ id: spaceMemberships.id, status: spaceMemberships.status })
        .from(spaceMemberships)
        .where(
          and(
            eq(spaceMemberships.spaceId, space.id),
            eq(spaceMemberships.principalType, "user"),
            eq(spaceMemberships.principalId, opts.userId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!existing) {
        await notifyChatSpaceAuthorityChange(tx, { spaceId: space.id });
        await tx.insert(spaceMemberships).values({
          spaceId: space.id,
          principalType: "user",
          principalId: opts.userId,
          status: "active",
          membershipRole: "owner",
        });
        continue;
      }

      if (existing.status !== "active") {
        await notifyChatSpaceAuthorityChange(tx, { spaceId: space.id });
        await tx
          .update(spaceMemberships)
          .set({ status: "active", membershipRole: "owner", updatedAt: new Date() })
          .where(eq(spaceMemberships.id, existing.id));
      }
    }
  });

  for (const spaceId of claimedSpaceIds) {
    await ensureHumanRoleDefaultGrants(db, {
      spaceId,
      principalId: opts.userId,
      membershipRole: "owner",
      grantedByUserId: opts.userId,
    });
  }

  if (activeChallenge && activeChallenge.token === opts.token) {
    activeChallenge.claimedAt = new Date();
    activeChallenge.claimedByUserId = opts.userId;
  }

  return { status: "claimed", claimedByUserId: opts.userId };
}
