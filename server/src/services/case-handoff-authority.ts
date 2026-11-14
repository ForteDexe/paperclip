import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { agentApiKeyScopeSchema } from "@outpost/shared";
import { agentApiKeys, authSessions, operatorApiKeys, heartbeatRuns, type caseHandoffs, type issues, type Db } from "@outpost/db";
import { forbidden } from "../errors.js";
import { resolveDeploymentMode } from "../config-file.js";
import { isCloudManagedInstance } from "./cloud-instance.js";
import { operatorAuthService } from "./operator-auth.js";
import { isCurrentCloudOwnerInstanceAdmin, isCurrentCloudTenantAuthority, loadCurrentCloudOwnerAuthority, type CurrentCloudOwnerAuthority } from "./cloud-tenant-authority.js";
import { canActorReceiveCase } from "./case-access.js";
import type { AuthorizationActor } from "./authorization.js";

type Handoff = typeof caseHandoffs.$inferSelect;
type Issue = typeof issues.$inferSelect;

// Server-owned provenance, not a cached permission decision. Never serialize
// this column into case history, events, prompts, or other public responses.
const actorContextSchema = z.object({
  schema: z.literal("outpost.case-handoff-actor.v1"),
  actorType: z.enum(["agent", "user"]),
  actorId: z.string().min(1),
  spaceId: z.string().min(1),
  source: z.enum(["local_implicit", "session", "operator_key", "agent_key", "agent_jwt", "mcp_oauth", "cloud_tenant", "cloud_control"]).nullable(),
  runId: z.string().min(1).nullable(),
  keyId: z.string().min(1).nullable(),
  sessionId: z.string().min(1).nullable(),
  keyScope: agentApiKeyScopeSchema,
  onBehalfOfUserId: z.string().min(1).nullable(),
  authorizingUserId: z.string().min(1).nullable(),
}).strict();

export function caseHandoffActorContext(actor: AuthorizationActor, spaceId: string): Record<string, unknown> {
  return actorContextSchema.parse({
    schema: "outpost.case-handoff-actor.v1",
    actorType: actor.type === "agent" ? "agent" : "user",
    actorId: actor.type === "agent" ? actor.agentId : actor.userId ?? "operator",
    spaceId, source: actor.source === "none" ? null : actor.source ?? null,
    runId: actor.runId ?? null, keyId: actor.keyId ?? null, sessionId: actor.sessionId ?? null,
    keyScope: actor.keyScope ?? { kind: "standard" },
    onBehalfOfUserId: actor.onBehalfOfUserId ?? null,
    authorizingUserId: actor.authorizingUserId ?? null,
  });
}

/** Resolve remote authority outside the task transaction, without trusting stored privileges. */
export async function loadCaseHandoffCloudAuthority(row: Handoff): Promise<CurrentCloudOwnerAuthority | null> {
  const context = actorContextSchema.safeParse(row.actorContext);
  if (row.actorType !== "user" || !context.success || context.data.actorType !== row.actorType ||
    context.data.actorId !== row.actorId || context.data.spaceId !== row.spaceId || context.data.source !== "cloud_tenant") return null;
  return loadCurrentCloudOwnerAuthority(row.actorId);
}

/** Restore identity only; the caller must run canonical authorization afresh. */
export async function restoreCaseHandoffActor(db: Db, row: Handoff, issue: Issue, sourceAuthorizer?: string, cloudAuthority?: CurrentCloudOwnerAuthority | null): Promise<AuthorizationActor> {
  const parsed = actorContextSchema.safeParse(row.actorContext);
  if (!parsed.success || parsed.data.actorType !== row.actorType || parsed.data.actorId !== row.actorId ||
    parsed.data.spaceId !== row.spaceId || !parsed.data.source) throw forbidden("Handoff original actor context is unavailable");
  const context = parsed.data;
  const source = context.source;
  if (!source) throw forbidden("Handoff original actor context is unavailable");
  if (row.actorType === "user") {
    if (source === "local_implicit") {
      if (isCloudManagedInstance() || resolveDeploymentMode() !== "local_trusted") throw forbidden("Handoff local operator authority is unavailable");
      return { type: "operator", userId: row.actorId, source: "local_implicit" };
    }
    if (!["session", "operator_key", "mcp_oauth", "cloud_tenant"].includes(source)) throw forbidden("Handoff operator authority is unavailable");
    if (source === "cloud_tenant") {
      if (!isCurrentCloudTenantAuthority(row.actorId, cloudAuthority)) throw forbidden("Current Cloud tenant authority is unavailable");
      if (cloudAuthority.role === "viewer") throw forbidden("Current Cloud tenant membership does not allow task assignment");
    }
    const access = await operatorAuthService(db).resolveOperatorAccess(row.actorId);
    if (!access.user) throw forbidden("Handoff original user is unavailable");
    if (source === "cloud_tenant" && !access.spaceIds.includes(row.spaceId)) throw forbidden("Handoff original user is not a current space member");
    if (source === "operator_key") {
      if (!context.keyId) throw forbidden("Handoff operator key context is unavailable");
      const [key] = await db.select().from(operatorApiKeys).where(and(eq(operatorApiKeys.id, context.keyId), eq(operatorApiKeys.userId, row.actorId), isNull(operatorApiKeys.revokedAt)));
      if (!key || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) throw forbidden("Handoff operator key was revoked or expired");
    }
    if (source === "session") {
      if (!context.sessionId) throw forbidden("Handoff operator session context is unavailable");
      const [session] = await db.select().from(authSessions).where(and(eq(authSessions.id, context.sessionId), eq(authSessions.userId, row.actorId)));
      if (!session || session.expiresAt.getTime() <= Date.now()) throw forbidden("Handoff operator session was revoked or expired");
    }
    // Cloud/MCP authority cannot be elevated by a local instance-admin row.
    const isInstanceAdmin = source === "cloud_tenant" ? await isCurrentCloudOwnerInstanceAdmin(db, row.actorId, cloudAuthority)
      : source !== "mcp_oauth" && access.isInstanceAdmin;
    if (source === "cloud_tenant" && !isCurrentCloudTenantAuthority(row.actorId, cloudAuthority)) throw forbidden("Current Cloud tenant authority is unavailable");
    return { type: "operator", userId: row.actorId, source, spaceIds: access.spaceIds, isInstanceAdmin };
  }
  if (!["agent_key", "agent_jwt", "mcp_oauth"].includes(source)) throw forbidden("Handoff agent authority is unavailable");
  if ((source === "agent_jwt" && context.runId !== row.sourceRunId) ||
    (context.runId && context.runId !== sourceRunId(row, issue))) throw forbidden("Handoff actor execution identity changed");
  if (source === "agent_key" && !context.keyId) throw forbidden("Handoff agent key context is unavailable");
  if (context.keyId) {
    const [key] = await db.select().from(agentApiKeys).where(and(eq(agentApiKeys.id, context.keyId), eq(agentApiKeys.spaceId, row.spaceId),
      eq(agentApiKeys.agentId, row.actorId), isNull(agentApiKeys.revokedAt)));
    const currentScope = key && agentApiKeyScopeSchema.safeParse(key.scopeConfig ?? { kind: "standard" });
    // A changed scope needs a fresh intent; never silently widen a scoped key.
    if (!key || (key.responsibleUserId?.trim() || null) !== context.onBehalfOfUserId || !currentScope || !currentScope.success || JSON.stringify(currentScope.data) !== JSON.stringify(context.keyScope)) throw forbidden("Handoff agent key was revoked or its scope changed");
  }
  if (sourceAuthorizer && context.authorizingUserId && sourceAuthorizer !== context.authorizingUserId) throw forbidden("Handoff source authorizer changed");
  return { type: "agent", agentId: row.actorId, spaceId: row.spaceId, source,
    runId: context.runId, keyId: context.keyId, keyScope: context.keyScope,
    onBehalfOfUserId: context.onBehalfOfUserId, authorizingUserId: sourceAuthorizer ?? context.authorizingUserId };
}

function sourceRunId(row: Handoff, issue: Issue) {
  // A new task's origin retains its creator run without yielding the separate
  // intake/chat task. Later phases always use the actual outgoing task run.
  return row.sourceRunId ?? (row.destinationKind === "agent" && row.version === 1 && row.actorType === "agent" && issue.createdByAgentId === row.actorId ? issue.originRunId : null);
}

/** Call after the task lock, before case/handoff locks (the release writer locks run then handoff). */
export async function lockCaseHandoffAuthorityRun(db: Db, row: Handoff, issue: Issue) {
  const id = sourceRunId(row, issue);
  if (id) await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, id), eq(heartbeatRuns.spaceId, row.spaceId))).for("share");
}

/** Recheck the persisted origin without requiring a live outgoing execution. */
export async function assertCaseHandoffSourceAuthority(db: Db, row: Handoff, issue: Issue): Promise<string | undefined> {
  const id = sourceRunId(row, issue);
  const [run] = id ? await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, id), eq(heartbeatRuns.spaceId, row.spaceId))) : [];
  if (id && (!run || (row.actorType === "agent" && run.agentId !== row.actorId) || (row.sourceRunId && run.agentId !== row.fromAgentId))) throw forbidden("Handoff source authority is unavailable");
  return undefined;
}

/** Recheck persistent connection authority after source execution has settled. */
export async function assertCaseHandoffDispatchAuthority(db: Db, row: Handoff, issue: Issue, caseRow: { id: string; spaceId: string }) {
  if (row.destinationKind !== "agent" || !row.toAgentId) throw forbidden("Agent handoff requires a recipient");
  const sourceAuthorizer = await assertCaseHandoffSourceAuthority(db, row, issue);
  const actor: AuthorizationActor = { type: "agent", agentId: row.toAgentId, spaceId: row.spaceId,
    onBehalfOfUserId: row.responsibleUserId };
  if (!(await canActorReceiveCase(db, actor, caseRow, issue.id, row.toAgentId))) throw forbidden("Recipient cannot access the case");
  return sourceAuthorizer;
}
