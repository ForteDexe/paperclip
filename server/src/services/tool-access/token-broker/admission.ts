import type { DbTransaction } from "../types.js";
import { captureRunIdentity, runIdentityBrokerFields } from "../../run-identity.js";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { connectionTokenIssuances, spaceMemberships, heartbeatRuns, toolConnections, toolProfileBindings, toolProfileEntries, toolProfiles } from "@outpost/db";
import type { ConnectionTokenIssuancePath } from "@outpost/shared";
import { forbidden, HttpError } from "../../../errors.js";
import { narrowestScopeBindings, profileIdsInBindingOrder } from "../../tool-profile-binding-precedence.js";

import { CONNECTION_TOKEN_MINT_TOOL_NAME, tokenBrokerConfig } from "./configuration.js";
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return {};
}

const ACTIVE_BROKER_RUN_STATUSES = new Set(["running"]);

export async function lockAuthorizedBrokerResponsibleMembership(
  input: {
    spaceId: string;
    responsibleUserId: string;
  },
  tx: DbTransaction,
) {
  const membership = await tx
    .select({
      id: spaceMemberships.id,
      status: spaceMemberships.status,
      membershipRole: spaceMemberships.membershipRole,
    })
    .from(spaceMemberships)
    .where(
      and(
        eq(spaceMemberships.spaceId, input.spaceId),
        eq(spaceMemberships.principalType, "user"),
        eq(spaceMemberships.principalId, input.responsibleUserId),
      ),
    )
    .limit(1)
    .for("update")
    .then((rows) => rows[0] ?? null);
  if (
    !membership ||
    membership.status !== "active" ||
    !membership.membershipRole ||
    membership.membershipRole === "viewer"
  ) {
    throw new HttpError(
      403,
      "Responsible user is no longer authorized for space write access",
      {
        code: "responsible_user_unauthorized",
      },
    );
  }
  return membership;
}

export function createTokenBrokerAdmission(db: Db, now: () => Date) {
  function runSnapshotString(
    snapshot: Record<string, unknown>,
    ...keys: string[]
  ): string | null {
    for (const key of keys) {
      const value = snapshot[key];
      if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return null;
  }

  async function loadBrokerRunContext(input: {
    spaceId: string;
    agentId: string;
    runId: string;
  }) {
    const [initialRun] = await db
      .select(runIdentityBrokerFields)
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, input.runId));
    const run = initialRun?.activeIdentityContextId
      ? (await captureRunIdentity(db, input, { readScope: "token_broker" })).run
      : initialRun;
    if (
      !run ||
      run.spaceId !== input.spaceId ||
      run.agentId !== input.agentId
    ) {
      throw forbidden(
        "Agent run context does not match the authenticated actor",
      );
    }
    if (!ACTIVE_BROKER_RUN_STATUSES.has(run.status)) {
      throw forbidden("Agent run is not active");
    }
    const snapshot = asRecord(run.contextSnapshot);
    const outpostIssue = asRecord(snapshot.outpostIssue);
    const responsibleUserId = run.activeIdentityContextId
      ? run.responsibleUserId
      : (runSnapshotString(
          snapshot,
          "responsibleUserId",
          "responsible_user_id",
        ) ??
        runSnapshotString(
          outpostIssue,
          "responsibleUserId",
          "responsible_user_id",
        ) ??
        run.responsibleUserId);
    if (!responsibleUserId) {
      throw forbidden(
        "Agent run has no responsible user for delegated connection access",
      );
    }
    const responsibleMembership = await db
      .select({
        status: spaceMemberships.status,
        membershipRole: spaceMemberships.membershipRole,
      })
      .from(spaceMemberships)
      .where(
        and(
          eq(spaceMemberships.spaceId, run.spaceId),
          eq(spaceMemberships.principalType, "user"),
          eq(spaceMemberships.principalId, responsibleUserId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (
      !responsibleMembership ||
      responsibleMembership.status !== "active" ||
      !responsibleMembership.membershipRole ||
      responsibleMembership.membershipRole === "viewer"
    ) {
      throw forbidden(
        "Responsible user is no longer authorized for space write access",
      );
    }
    return {
      run,
      issueId:
        runSnapshotString(snapshot, "issueId") ??
        runSnapshotString(outpostIssue, "id"),
      projectId:
        runSnapshotString(snapshot, "projectId") ??
        runSnapshotString(outpostIssue, "projectId"),
      routineId: runSnapshotString(snapshot, "routineId"),
      responsibleUserId,
    };
  }

  async function enforceDefaultConnectionTokenRateLimit(input: {
    connection: typeof toolConnections.$inferSelect;
    agentId: string;
    path: ConnectionTokenIssuancePath;
  }) {
    const broker = tokenBrokerConfig(input.connection);
    const configured = Number(broker.rateLimitPerHour ?? 30);
    const limit =
      Number.isFinite(configured) && configured > 0
        ? Math.trunc(configured)
        : 30;
    const since = new Date(now().getTime() - 60 * 60 * 1000);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(connectionTokenIssuances)
      .where(
        and(
          eq(connectionTokenIssuances.spaceId, input.connection.spaceId),
          eq(connectionTokenIssuances.connectionId, input.connection.id),
          eq(connectionTokenIssuances.agentId, input.agentId),
          eq(connectionTokenIssuances.outcome, "success"),
          gte(connectionTokenIssuances.createdAt, since),
        ),
      );
    const count = Number(row?.count ?? 0);
    if (count >= limit) {
      throw new HttpError(429, "Connection token mint rate limit exceeded", {
        code: "rate_limited",
        path: input.path,
        limit,
        windowSeconds: 3600,
      });
    }
  }

  async function hasExplicitConnectionTokenMintProfileGrant(input: {
    spaceId: string;
    agentId: string;
    issueId: string | null;
    projectId: string | null;
    routineId: string | null;
  }) {
    const bindings = await db
      .select()
      .from(toolProfileBindings)
      .where(eq(toolProfileBindings.spaceId, input.spaceId));
    const matchingBindings = bindings.filter((binding) => {
      if (binding.targetType === "space")
        return binding.targetId === input.spaceId;
      if (binding.targetType === "agent")
        return binding.targetId === input.agentId;
      if (binding.targetType === "issue")
        return Boolean(input.issueId && binding.targetId === input.issueId);
      if (binding.targetType === "project")
        return Boolean(input.projectId && binding.targetId === input.projectId);
      if (binding.targetType === "routine")
        return Boolean(input.routineId && binding.targetId === input.routineId);
      return false;
    });
    const profileIds = profileIdsInBindingOrder(
      narrowestScopeBindings(matchingBindings),
    );
    if (profileIds.length === 0) return false;
    const profiles = await db
      .select()
      .from(toolProfiles)
      .where(
        and(
          eq(toolProfiles.spaceId, input.spaceId),
          inArray(toolProfiles.id, profileIds),
        ),
      );
    const activeProfileIds = profiles
      .filter((profile) => profile.status === "active")
      .map((profile) => profile.id);
    if (activeProfileIds.length === 0) return false;
    const entries = await db
      .select()
      .from(toolProfileEntries)
      .where(
        and(
          eq(toolProfileEntries.spaceId, input.spaceId),
          inArray(toolProfileEntries.profileId, activeProfileIds),
        ),
      );
    return activeProfileIds.some((profileId) => {
      const profileEntries = entries.filter(
        (entry) => entry.profileId === profileId,
      );
      const exactBrokerEntries = profileEntries.filter(
        (entry) =>
          entry.selectorType === "tool_name" &&
          entry.toolName === CONNECTION_TOKEN_MINT_TOOL_NAME &&
          Object.keys(asRecord(entry.conditions)).length === 0,
      );
      if (exactBrokerEntries.some((entry) => entry.effect === "exclude"))
        return false;
      return exactBrokerEntries.some((entry) => entry.effect === "include");
    });
  }
  return { loadBrokerRunContext, enforceDefaultConnectionTokenRateLimit, hasExplicitConnectionTokenMintProfileGrant };
}
