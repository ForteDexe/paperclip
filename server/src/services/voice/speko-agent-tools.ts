import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { forbidden, HttpError } from "../../errors.js";
import { authorizationService } from "../authorization.js";
import { captureRunIdentity } from "../run-identity.js";
import { boundRunIssueId } from "../run-task-binding.js";
import { chatVoiceCallbacks, instanceUserRoles, spaceMemberships } from "@outpost/db";
import type { VoiceCaller } from "./voice-session-store.js";
import { z } from "zod";
import { instanceSettingsService } from "../instance-settings.js";
const SPEKO_TOOLS = [{ name: "call_my_phone", description: "Call the responsible person's saved phone number to discuss this task with the assigned Outpost agent. Requires that person's callback opt-in. Never chooses another recipient, cancels work or grants approvals. Do not redial an uncertain attempt.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, risk: "write", scopes: [] }] as const;
type SpekoTaskSession = Pick<ToolGatewaySession, "spaceId" | "agentId" | "runId" | "issueId" | "identityContextId">;
interface Binding { spaceId: string; endpointId: string; issueId: string; caller: VoiceCaller }
const runtimes = new WeakMap<Db, (binding: Binding, invocationId: string) => Promise<unknown>>();
export function registerSpekoVoiceRuntime(db: Db, start: (binding: Binding, invocationId: string) => Promise<unknown>) {
  runtimes.set(db, start);
  return () => { if (runtimes.get(db) === start) runtimes.delete(db); };
}
async function resolveAuthority(db: Db, session: SpekoTaskSession, endpointId: string) {
  if (!(await instanceSettingsService(db).getExperimental()).enableChatConnectors) throw forbidden("Voice connections are disabled");
  if (!runtimes.has(db) || !session.agentId || !session.runId || !session.issueId) throw forbidden("Speko tools require an active task run");
  const { run, context } = await captureRunIdentity(db, { spaceId: session.spaceId, agentId: session.agentId, runId: session.runId }, { readScope: "task_authorization" });
  if (boundRunIssueId(run) !== session.issueId || !run.responsibleUserId || session.identityContextId && session.identityContextId !== context?.id) throw forbidden("The accepted requester or task changed");
  const [endpoint] = await db.select().from(chatEndpoints).where(and(eq(chatEndpoints.spaceId, session.spaceId), eq(chatEndpoints.id, endpointId), eq(chatEndpoints.provider, "speko"), eq(chatEndpoints.assignedAgentId, session.agentId), eq(chatEndpoints.status, "active")));
  if (!endpoint) throw forbidden("This agent has no active Speko connection");
  const userId = run.responsibleUserId;
  const [preference] = await db.select().from(chatVoiceCallbacks).where(and(eq(chatVoiceCallbacks.spaceId, session.spaceId), eq(chatVoiceCallbacks.endpointId, endpointId), eq(chatVoiceCallbacks.userId, userId), eq(chatVoiceCallbacks.enabled, true)));
  if (!preference) throw forbidden("The responsible person has not enabled phone callbacks");
  const [admin] = await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")));
  const [member] = await db.select({ id: spaceMemberships.id }).from(spaceMemberships).where(and(eq(spaceMemberships.spaceId, session.spaceId), eq(spaceMemberships.principalId, userId), eq(spaceMemberships.principalType, "user"), eq(spaceMemberships.status, "active")));
  // Local authority is rechecked by the live service, never supplied by model arguments.
  if (!admin && !member && userId !== "local-operator") throw forbidden("The responsible person no longer has space access");
  const caller: VoiceCaller = { id: userId, authority: admin ? "instance_admin" : userId === "local-operator" ? "local_board" : "member" };
  return { endpoint, caller };
}
export async function executeSpekoVoiceTool(db: Db, session: SpekoTaskSession, endpointId: string, parameters: unknown, invocationId?: string) {
  z.object({}).strict().parse(parameters);
  if (!invocationId || !z.string().uuid().safeParse(invocationId).success) throw forbidden("A durable invocation is required for phone calls");
  const authority = await resolveAuthority(db, session, endpointId);
  return runtimes.get(db)!({ spaceId: session.spaceId, endpointId, issueId: session.issueId!, caller: authority.caller }, invocationId);
}
import {
  chatEndpoints,
  toolConnections,
  toolCatalogEntries,
  toolConnectionInstalls,
  toolProfiles,
  toolProfileEntries,
  toolProfileBindings,
  type Db,
} from "@outpost/db";
import type {
  ToolGatewayDescriptor,
  ToolGatewaySession,
} from "../tool-gateway.js";
export async function syncSpekoVoiceTools(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  endpoint: typeof chatEndpoints.$inferSelect,
  userId: string,
  enabled = true,
  allowLocalBoard = false,
) {
  const [admin] = await tx.select({id: instanceUserRoles.id}).from(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")));
  const decision = await authorizationService(tx).decide({
    actor: {type: "operator", userId, source: allowLocalBoard && userId === "local-operator" ? "local_implicit" : "session", isInstanceAdmin: Boolean(admin)},
    action: "agent_config:update", resource: {type: "agent", spaceId: endpoint.spaceId, agentId: endpoint.assignedAgentId},
  });
  if (!decision.allowed) throw forbidden("Editing this agent is required to install Speko phone tools");
  const [connection] = await tx
    .select()
    .from(toolConnections)
    .where(
      and(
        eq(toolConnections.spaceId, endpoint.spaceId),
        eq(toolConnections.id, endpoint.connectionId),
      ),
    );
  if (!connection) return;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`speko-catalog:${endpoint.id}`}, 0))`,
  );
  const existingEntries = await tx
    .select()
    .from(toolCatalogEntries)
    .where(eq(toolCatalogEntries.connectionId, connection.id));
  const entriesByName = new Map(
    existingEntries.map((entry) => [entry.name, entry]),
  );
  for (const tool of SPEKO_TOOLS) {
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          name: tool.name,
          inputSchema: tool.inputSchema,
          risk: tool.risk,
          scopes: tool.scopes,
        }),
      )
      .digest("hex");
    const values = {
      spaceId: endpoint.spaceId,
      applicationId: connection.applicationId,
      connectionId: connection.id,
      entryKind: "tool" as const,
      name: `speko_voice:${tool.name}`,
      toolName: tool.name,
      title: tool.description.split(".")[0],
      description: tool.description,
      inputSchema: tool.inputSchema,
      riskLevel: "write" as const,
      isReadOnly: false,
      isWrite: true,
      versionHash: hash,
      schemaHash: hash,
      status: enabled ? ("active" as const) : ("removed" as const),
      reviewedByUserId: userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    };
    const existing = entriesByName.get(values.name);
    if (existing?.versionHash === hash) continue;
    await tx
      .insert(toolCatalogEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [toolCatalogEntries.connectionId, toolCatalogEntries.name],
        set: {
          ...values,
          ...(existing
            ? {
                status: existing.status,
                reviewedByUserId: existing.reviewedByUserId,
                reviewedAt: existing.reviewedAt,
              }
            : {}),
        },
      });
  }
  const profileKey = `speko-voice:${endpoint.id}`;
  const [priorProfile] = await tx
    .select()
    .from(toolProfiles)
    .where(
      and(
        eq(toolProfiles.spaceId, endpoint.spaceId),
        eq(toolProfiles.profileKey, profileKey),
      ),
    );
  if (priorProfile) return;
  const [profile] = await tx
    .insert(toolProfiles)
    .values({
      spaceId: endpoint.spaceId,
      profileKey,
      name: `Speko voice ${endpoint.id}`,
      description: "Task-scoped tools using this bot's App connection",
      defaultAction: "deny",
      status: enabled ? "active" : "disabled",
      metadata: { spekoVoiceEndpointId: endpoint.id },
    })
    .onConflictDoUpdate({
      target: [toolProfiles.spaceId, toolProfiles.profileKey],
      set: {
        description:
          "Task-scoped Speko tools; existing action policies remain in effect.",
      },
    })
    .returning();
  // Provision defaults once. Removing a binding/entry is an operator decision;
  // resolving a retained run must never restore revoked grants.
  if (enabled)
    await tx
      .insert(toolConnectionInstalls)
      .values({
        spaceId: endpoint.spaceId,
        connectionId: connection.id,
        targetType: "agent",
        targetId: endpoint.assignedAgentId,
        createdByUserId: userId,
      })
      .onConflictDoNothing();

  const [existingEntry] = await tx
    .select({ id: toolProfileEntries.id })
    .from(toolProfileEntries)
    .where(
      and(
        eq(toolProfileEntries.profileId, profile!.id),
        eq(toolProfileEntries.connectionId, connection.id),
      ),
    );
  if (!existingEntry)
    await tx
      .insert(toolProfileEntries)
      .values({
        spaceId: endpoint.spaceId,
        profileId: profile!.id,
        selectorType: "connection",
        connectionId: connection.id,
        effect: "include",
      })
      .onConflictDoNothing();
  await tx
    .insert(toolProfileBindings)
    .values({
      spaceId: endpoint.spaceId,
      profileId: profile!.id,
      targetType: "agent",
      targetId: endpoint.assignedAgentId,
      createdByUserId: userId,
      metadata: { spekoVoiceEndpointId: endpoint.id },
    })
    .onConflictDoNothing();
}

async function spekoToolsForEndpoint(db: Db, session: SpekoTaskSession, endpointId: string): Promise<ToolGatewayDescriptor[]> {
  let authority;
  try { authority = await resolveAuthority(db, session, endpointId); }
  catch (error) { if (error instanceof HttpError && [403, 404, 409].includes(error.status)) return []; throw error; }
  const entries = await db.select({ entry: toolCatalogEntries, applicationId: toolConnections.applicationId }).from(toolCatalogEntries)
    .innerJoin(toolConnections, eq(toolConnections.id, toolCatalogEntries.connectionId))
    .where(and(eq(toolCatalogEntries.spaceId, session.spaceId), eq(toolCatalogEntries.connectionId, authority.endpoint.connectionId), eq(toolCatalogEntries.status, "active"), isNull(toolCatalogEntries.quarantinedAt), eq(toolConnections.enabled, true), eq(toolConnections.status, "active")));
  return entries.filter(({entry}) => entry.toolName === "call_my_phone").map(({entry, applicationId}) => ({
    name: `speko-voice.${endpointId}:call_my_phone`, displayName: "Call my phone", description: entry.description ?? "", parametersSchema: entry.inputSchema,
    pluginId: `speko-voice:${endpointId}`, providerType: "outpost_speko_voice", risk: "write", applicationId, applicationKey: "speko-voice",
    applicationDisplayName: "Speko voice", connectionId: authority.endpoint.connectionId, catalogEntryId: entry.id,
    upstreamToolName: "call_my_phone", providerMetadata: { endpointId },
  }));
}
export async function spekoToolsForSession(db: Db, session: SpekoTaskSession): Promise<ToolGatewayDescriptor[]> {
  if (!session.agentId || !session.runId || !session.issueId || !runtimes.has(db)) return [];
  const endpoints = await db.select({ id: chatEndpoints.id }).from(chatEndpoints).where(and(eq(chatEndpoints.spaceId, session.spaceId), eq(chatEndpoints.assignedAgentId, session.agentId), eq(chatEndpoints.provider, "speko"), eq(chatEndpoints.status, "active")));
  const tools: ToolGatewayDescriptor[] = [];
  for (const endpoint of endpoints) tools.push(...await spekoToolsForEndpoint(db, session, endpoint.id));
  return tools;
}

/** Instructions are assigned for browser voice as well as phone callbacks.
 * No caller phone number, provider identity, or credential enters the bundle. */
export async function spekoAssignedResources(db: Db, binding: { spaceId: string; agentId: string }) {
  if (!(await instanceSettingsService(db).getExperimental()).enableChatConnectors) return [];
  return db.select({ id: chatEndpoints.id, connectionId: chatEndpoints.connectionId })
    .from(chatEndpoints)
    .innerJoin(toolConnections, and(eq(toolConnections.id, chatEndpoints.connectionId), eq(toolConnections.spaceId, binding.spaceId), eq(toolConnections.enabled, true), eq(toolConnections.status, "active")))
    .innerJoin(toolProfiles, and(eq(toolProfiles.spaceId, binding.spaceId), eq(toolProfiles.profileKey, sql`'speko-voice:' || ${chatEndpoints.id}::text`), eq(toolProfiles.status, "active")))
    .innerJoin(toolProfileBindings, and(eq(toolProfileBindings.spaceId, binding.spaceId), eq(toolProfileBindings.profileId, toolProfiles.id), eq(toolProfileBindings.targetType, "agent"), eq(toolProfileBindings.targetId, binding.agentId)))
    .innerJoin(toolProfileEntries, and(eq(toolProfileEntries.profileId, toolProfiles.id), eq(toolProfileEntries.connectionId, chatEndpoints.connectionId), eq(toolProfileEntries.effect, "include")))
    .where(and(eq(chatEndpoints.spaceId, binding.spaceId), eq(chatEndpoints.assignedAgentId, binding.agentId), eq(chatEndpoints.provider, "speko"), eq(chatEndpoints.status, "active")))
    .then(rows => rows.map(row => ({ ...row, label: "Speko voice" })));
}
