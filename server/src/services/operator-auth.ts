import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  activityLog,
  authUsers,
  operatorApiKeys,
  cliAuthChallenges,
  spaces,
  spaceMemberships,
  instanceUserRoles,
} from "@outpost/db";
import { conflict, forbidden, notFound } from "../errors.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
import { logger } from "../middleware/logger.js";

export const OPERATOR_API_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CLI_AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const OPERATOR_API_KEY_TOUCH_DEBOUNCE_MS = 60_000;
const OPERATOR_API_KEY_TOUCH_CACHE_MAX = 1_000;

export type CliAuthChallengeStatus = "pending" | "approved" | "cancelled" | "expired";

export function hashBearerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenHashesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createOperatorApiToken() {
  return `outpost_operator_${randomBytes(24).toString("hex")}`;
}

export function createCliAuthSecret() {
  return `pcp_cli_auth_${randomBytes(24).toString("hex")}`;
}

export function operatorApiKeyExpiresAt(nowMs: number = Date.now()) {
  return new Date(nowMs + OPERATOR_API_KEY_TTL_MS);
}

export function cliAuthChallengeExpiresAt(nowMs: number = Date.now()) {
  return new Date(nowMs + CLI_AUTH_CHALLENGE_TTL_MS);
}

function challengeStatusForRow(row: typeof cliAuthChallenges.$inferSelect): CliAuthChallengeStatus {
  if (row.cancelledAt) return "cancelled";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  if (row.approvedAt && row.operatorApiKeyId) return "approved";
  return "pending";
}

export function operatorAuthService(db: Db) {
  const touchedOperatorApiKeys = new Map<string, { completedAt: number | null; inFlight: Promise<void> | null }>();

  function pruneTouchedOperatorApiKeys(nowMs: number) {
    for (const [id, entry] of touchedOperatorApiKeys) {
      if (!entry.inFlight && entry.completedAt !== null && entry.completedAt <= nowMs - OPERATOR_API_KEY_TOUCH_DEBOUNCE_MS) {
        touchedOperatorApiKeys.delete(id);
      }
    }
    while (touchedOperatorApiKeys.size > OPERATOR_API_KEY_TOUCH_CACHE_MAX) {
      const oldestId = touchedOperatorApiKeys.keys().next().value;
      if (!oldestId) break;
      touchedOperatorApiKeys.delete(oldestId);
    }
  }
  async function resolveOperatorAccess(userId: string, authorityDb: Pick<Db, "select"> = db) {
    const [user, memberships, adminRole] = await Promise.all([
      authorityDb
        .select({
          id: authUsers.id,
          name: authUsers.name,
          email: authUsers.email,
        })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .then((rows) => rows[0] ?? null),
      authorityDb
        .select({
          spaceId: spaceMemberships.spaceId,
          membershipRole: spaceMemberships.membershipRole,
          status: spaceMemberships.status,
        })
        .from(spaceMemberships)
        .where(
          and(
            eq(spaceMemberships.principalType, "user"),
            eq(spaceMemberships.principalId, userId),
            eq(spaceMemberships.status, "active"),
          ),
        )
        .then((rows) => rows),
      authorityDb
        .select({ id: instanceUserRoles.id })
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
        .then((rows) => rows[0] ?? null),
    ]);

    return {
      user,
      spaceIds: memberships.map((row) => row.spaceId),
      memberships,
      isInstanceAdmin: Boolean(adminRole),
    };
  }

  async function activitySpaceIdsForAccess(
    access: Awaited<ReturnType<typeof resolveOperatorAccess>>,
    requestedSpaceId: string | null | undefined,
    authorityDb: Pick<Db, "select"> = db,
  ) {
    const spaceIds = new Set(access.spaceIds);
    const requested = requestedSpaceId?.trim();
    if (requested && (access.isInstanceAdmin || access.spaceIds.includes(requested))) spaceIds.add(requested);
    if (spaceIds.size === 0 && access.isInstanceAdmin) {
      const allSpaceIds = await authorityDb.select({ id: spaces.id }).from(spaces);
      for (const space of allSpaceIds) spaceIds.add(space.id);
    }
    return Array.from(spaceIds);
  }

  async function resolveOperatorActivitySpaceIds(input: {
    userId: string;
    requestedSpaceId?: string | null;
    operatorApiKeyId?: string | null;
  }) {
    return activitySpaceIdsForAccess(await resolveOperatorAccess(input.userId), input.requestedSpaceId);
  }

  async function findOperatorApiKeyByToken(token: string) {
    const tokenHash = hashBearerToken(token);
    const now = new Date();
    return db
      .select()
      .from(operatorApiKeys)
      .where(
        and(
          eq(operatorApiKeys.keyHash, tokenHash),
          isNull(operatorApiKeys.revokedAt),
        ),
      )
      .then((rows) => rows.find((row) => !row.expiresAt || row.expiresAt.getTime() > now.getTime()) ?? null);
  }

  async function touchOperatorApiKey(id: string) {
    const nowMs = Date.now();
    pruneTouchedOperatorApiKeys(nowMs);
    const cached = touchedOperatorApiKeys.get(id);
    if (cached?.inFlight) return cached.inFlight;
    if (cached?.completedAt !== null && cached?.completedAt !== undefined
      && cached.completedAt > nowMs - OPERATOR_API_KEY_TOUCH_DEBOUNCE_MS) return;

    const inFlight = db
      .update(operatorApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(operatorApiKeys.id, id))
      .then(() => {
        touchedOperatorApiKeys.delete(id);
        touchedOperatorApiKeys.set(id, { completedAt: Date.now(), inFlight: null });
        pruneTouchedOperatorApiKeys(Date.now());
      })
      .catch((error) => {
        if (touchedOperatorApiKeys.get(id)?.inFlight === inFlight) touchedOperatorApiKeys.delete(id);
        throw error;
      });
    touchedOperatorApiKeys.set(id, { completedAt: null, inFlight });
    return inFlight;
  }

  async function revokeOperatorApiKey(id: string, input: {
    userId: string;
    revokedVia: "cli_auth_logout" | "operator_api_key_lifecycle";
  }) {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select ${operatorApiKeys.id} from ${operatorApiKeys}
        where ${operatorApiKeys.id} = ${id} and ${operatorApiKeys.userId} = ${input.userId} for update`);
      const [key] = await tx.select().from(operatorApiKeys).where(and(eq(operatorApiKeys.id, id), eq(operatorApiKeys.userId, input.userId)));
      if (!key || key.revokedAt) return null;
      const access = await resolveOperatorAccess(key.userId, tx);
      const spaceIds = new Set(await activitySpaceIdsForAccess(access, null, tx));
      const created = await tx.select({ spaceId: activityLog.spaceId }).from(activityLog)
        .innerJoin(spaces, eq(spaces.id, activityLog.spaceId))
        .where(and(eq(activityLog.actorType, "user"), eq(activityLog.actorId, key.userId),
          eq(activityLog.responsibleUserId, key.userId), eq(activityLog.entityType, "user"), eq(activityLog.entityId, key.userId),
          eq(activityLog.action, "operator_api_key.created"), sql`${activityLog.details}->>'operatorApiKeyId' = ${key.id}`));
      for (const row of created) spaceIds.add(row.spaceId);
      const approved = await tx.select({ spaceId: cliAuthChallenges.requestedSpaceId }).from(cliAuthChallenges)
        .innerJoin(spaces, eq(spaces.id, cliAuthChallenges.requestedSpaceId))
        .where(and(eq(cliAuthChallenges.operatorApiKeyId, key.id), eq(cliAuthChallenges.approvedByUserId, key.userId),
          sql`${cliAuthChallenges.approvedAt} is not null`));
      for (const row of approved) if (row.spaceId) spaceIds.add(row.spaceId);
      const now = new Date();
      const [revoked] = await tx.update(operatorApiKeys).set({ revokedAt: now, lastUsedAt: now })
        .where(and(eq(operatorApiKeys.id, key.id), eq(operatorApiKeys.userId, input.userId), isNull(operatorApiKeys.revokedAt))).returning();
      if (!revoked) return null;
      for (const spaceId of spaceIds) {
        await logActivity(tx as unknown as Db, {
          spaceId, actorType: "user", actorId: key.userId, action: "operator_api_key.revoked", entityType: "user", entityId: key.userId,
          details: { operatorApiKeyId: key.id, revokedVia: input.revokedVia,
            ...(input.revokedVia === "operator_api_key_lifecycle" ? { name: key.name } : {}) },
        }, publications);
      }
      return revoked;
    });
    for (const publication of publications) {
      try { publishActivity(publication); }
      catch (err) { logger.warn({ err }, "Failed to publish committed Operator key revocation activity"); }
    }
    return result;
  }

  async function createNamedOperatorApiKey(input: {
    userId: string;
    name: string;
    expiresAt?: Date | null;
  }) {
    const token = createOperatorApiToken();
    const created = await db
      .insert(operatorApiKeys)
      .values({
        userId: input.userId,
        name: input.name.trim(),
        keyHash: hashBearerToken(token),
        expiresAt: input.expiresAt === undefined ? operatorApiKeyExpiresAt() : input.expiresAt,
      })
      .returning()
      .then((rows) => rows[0]);

    return {
      id: created.id,
      name: created.name,
      token,
      createdAt: created.createdAt,
      lastUsedAt: created.lastUsedAt,
      revokedAt: created.revokedAt,
      expiresAt: created.expiresAt,
    };
  }

  async function listOperatorApiKeys(
    userId: string,
    opts: { includeInactive?: boolean } = {},
  ) {
    const conditions = [eq(operatorApiKeys.userId, userId)];
    if (!opts.includeInactive) {
      const activeExpirationCondition = or(
        isNull(operatorApiKeys.expiresAt),
        gt(operatorApiKeys.expiresAt, new Date()),
      );
      conditions.push(
        isNull(operatorApiKeys.revokedAt),
      );
      if (activeExpirationCondition) conditions.push(activeExpirationCondition);
    }
    return db
      .select({
        id: operatorApiKeys.id,
        name: operatorApiKeys.name,
        createdAt: operatorApiKeys.createdAt,
        lastUsedAt: operatorApiKeys.lastUsedAt,
        revokedAt: operatorApiKeys.revokedAt,
        expiresAt: operatorApiKeys.expiresAt,
      })
      .from(operatorApiKeys)
      .where(and(...conditions))
      .orderBy(sql`${operatorApiKeys.createdAt} desc`);
  }

  async function getOperatorApiKeyForUser(keyId: string, userId: string) {
    return db
      .select({
        id: operatorApiKeys.id,
        userId: operatorApiKeys.userId,
        name: operatorApiKeys.name,
        createdAt: operatorApiKeys.createdAt,
        lastUsedAt: operatorApiKeys.lastUsedAt,
        revokedAt: operatorApiKeys.revokedAt,
        expiresAt: operatorApiKeys.expiresAt,
      })
      .from(operatorApiKeys)
      .where(and(eq(operatorApiKeys.id, keyId), eq(operatorApiKeys.userId, userId)))
      .then((rows) => rows[0] ?? null);
  }

  async function createCliAuthChallenge(input: {
    command: string;
    clientName?: string | null;
    requestedAccess: "operator" | "instance_admin_required";
    requestedSpaceId?: string | null;
  }) {
    const challengeSecret = createCliAuthSecret();
    const pendingOperatorToken = createOperatorApiToken();
    const expiresAt = cliAuthChallengeExpiresAt();
    const labelBase = input.clientName?.trim() || "outpost cli";
    const pendingKeyName =
      input.requestedAccess === "instance_admin_required"
        ? `${labelBase} (instance admin)`
        : `${labelBase} (operator)`;

    const created = await db
      .insert(cliAuthChallenges)
      .values({
        secretHash: hashBearerToken(challengeSecret),
        command: input.command.trim(),
        clientName: input.clientName?.trim() || null,
        requestedAccess: input.requestedAccess,
        requestedSpaceId: input.requestedSpaceId?.trim() || null,
        pendingKeyHash: hashBearerToken(pendingOperatorToken),
        pendingKeyName,
        expiresAt,
      })
      .returning()
      .then((rows) => rows[0]);

    return {
      challenge: created,
      challengeSecret,
      pendingOperatorToken,
    };
  }

  async function getCliAuthChallenge(id: string) {
    return db
      .select()
      .from(cliAuthChallenges)
      .where(eq(cliAuthChallenges.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getCliAuthChallengeBySecret(id: string, token: string) {
    const challenge = await getCliAuthChallenge(id);
    if (!challenge) return null;
    if (!tokenHashesMatch(challenge.secretHash, hashBearerToken(token))) return null;
    return challenge;
  }

  async function describeCliAuthChallenge(id: string, token: string, options: { viewerUserId?: string } = {}) {
    const challenge = await getCliAuthChallengeBySecret(id, token);
    if (!challenge) return null;

    const access = options.viewerUserId ? await resolveOperatorAccess(options.viewerUserId) : null;
    const canReadSpace = challenge.requestedSpaceId && access
      && (access.isInstanceAdmin || access.spaceIds.includes(challenge.requestedSpaceId));
    const space = canReadSpace
      ? await db.select({ name: spaces.name }).from(spaces)
          .where(eq(spaces.id, challenge.requestedSpaceId!)).then(rows => rows[0] ?? null)
      : null;

    return {
      id: challenge.id,
      status: challengeStatusForRow(challenge),
      command: challenge.command,
      clientName: challenge.clientName ?? null,
      requestedAccess: challenge.requestedAccess as "operator" | "instance_admin_required",
      requestedSpaceId: challenge.requestedSpaceId ?? null,
      requestedSpaceName: space?.name ?? null,
      approvedAt: challenge.approvedAt?.toISOString() ?? null,
      cancelledAt: challenge.cancelledAt?.toISOString() ?? null,
      expiresAt: challenge.expiresAt.toISOString(),
      approvedByUser: null,
    };
  }

  async function approveCliAuthChallenge(id: string, token: string, userId: string) {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${cliAuthChallenges.id} from ${cliAuthChallenges} where ${cliAuthChallenges.id} = ${id} for update`,
      );

      const challenge = await tx
        .select()
        .from(cliAuthChallenges)
        .where(eq(cliAuthChallenges.id, id))
        .then((rows) => rows[0] ?? null);
      if (!challenge || !tokenHashesMatch(challenge.secretHash, hashBearerToken(token))) {
        throw notFound("CLI auth challenge not found");
      }

      const status = challengeStatusForRow(challenge);
      if (status === "expired") return { status, challenge };
      if (status === "cancelled") return { status, challenge };

      if (status === "approved") {
        if (challenge.approvedByUserId !== userId) {
          throw conflict("CLI auth challenge was approved by another user");
        }
        return { status, challenge, created: false };
      }

      const access = await resolveOperatorAccess(userId, tx);
      if (!access.user) throw forbidden("Operator user required");
      if (challenge.requestedSpaceId && !access.isInstanceAdmin
        && !access.spaceIds.includes(challenge.requestedSpaceId)) {
        throw forbidden("Access to the requested organization is required");
      }

      if (challenge.requestedAccess === "instance_admin_required" && !access.isInstanceAdmin) {
        throw forbidden("Instance admin required");
      }

      let operatorKeyId = challenge.operatorApiKeyId;
      if (!operatorKeyId) {
        const createdKey = await tx
          .insert(operatorApiKeys)
          .values({
            userId,
            name: challenge.pendingKeyName,
            keyHash: challenge.pendingKeyHash,
            expiresAt: operatorApiKeyExpiresAt(),
          })
          .returning()
          .then((rows) => rows[0]);
        operatorKeyId = createdKey.id;
      }

      const approvedAt = challenge.approvedAt ?? new Date();
      const updated = await tx
        .update(cliAuthChallenges)
        .set({
          approvedByUserId: userId,
          operatorApiKeyId: operatorKeyId,
          approvedAt,
          updatedAt: new Date(),
        })
        .where(eq(cliAuthChallenges.id, challenge.id))
        .returning()
        .then((rows) => rows[0] ?? challenge);

      const spaceIds = await activitySpaceIdsForAccess(access, challenge.requestedSpaceId, tx);
      for (const spaceId of spaceIds) {
        await logActivity(tx as unknown as Db, {
          spaceId, actorType: "user", actorId: userId,
          action: "operator_api_key.created", entityType: "user", entityId: userId,
          details: {
            operatorApiKeyId: updated.operatorApiKeyId,
            requestedAccess: updated.requestedAccess,
            requestedSpaceId: updated.requestedSpaceId,
            challengeId: updated.id,
          },
        }, publications);
      }
      return { status: "approved" as const, challenge: updated, created: true };
    });
    for (const publication of publications) {
      try { publishActivity(publication); }
      catch (err) { logger.warn({ err }, "Failed to publish committed CLI approval activity"); }
    }
    return result;
  }

  async function cancelCliAuthChallenge(id: string, token: string) {
    return db.transaction(async tx => {
      await tx.execute(sql`select ${cliAuthChallenges.id} from ${cliAuthChallenges} where ${cliAuthChallenges.id} = ${id} for update`);
      const challenge = await tx.select().from(cliAuthChallenges)
        .where(eq(cliAuthChallenges.id, id)).then(rows => rows[0] ?? null);
      if (!challenge || !tokenHashesMatch(challenge.secretHash, hashBearerToken(token))) {
        throw notFound("CLI auth challenge not found");
      }
      const status = challengeStatusForRow(challenge);
      if (status !== "pending") return { status, challenge };
      const updated = await tx.update(cliAuthChallenges)
        .set({ cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(cliAuthChallenges.id, challenge.id)).returning()
        .then(rows => rows[0] ?? challenge);
      return { status: "cancelled" as const, challenge: updated };
    });
  }

  async function assertCurrentOperatorKey(keyId: string | undefined, userId: string | undefined) {
    if (!keyId || !userId) throw conflict("Operator API key context is required");
    const key = await db
      .select()
      .from(operatorApiKeys)
      .where(and(eq(operatorApiKeys.id, keyId), eq(operatorApiKeys.userId, userId)))
      .then((rows) => rows[0] ?? null);
    if (!key || key.revokedAt) throw notFound("Operator API key not found");
    return key;
  }

  return {
    resolveOperatorAccess,
    findOperatorApiKeyByToken,
    touchOperatorApiKey,
    revokeOperatorApiKey,
    createNamedOperatorApiKey,
    listOperatorApiKeys,
    getOperatorApiKeyForUser,
    createCliAuthChallenge,
    getCliAuthChallengeBySecret,
    describeCliAuthChallenge,
    approveCliAuthChallenge,
    cancelCliAuthChallenge,
    assertCurrentOperatorKey,
    resolveOperatorActivitySpaceIds,
  };
}
