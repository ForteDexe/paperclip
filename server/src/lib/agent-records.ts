import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { agents, costEvents, type Db } from "@outpost/db";
import {
  agentAppearanceSchema, resolveAgentAppearance, agentAvatarUrl,
  AGENT_DEFAULT_MAX_CONCURRENT_RUNS, agentRuntimeConfigSchema, getAgentWorkEligibility,
  normalizeAgentUrlKey, type AgentEligibilityAgent, type AgentRunnerChoice,
} from "@outpost/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { REDACTED_EVENT_VALUE, sanitizeRecord } from "../redaction.js";
import { normalizeAgentPermissions } from "./agent-permissions.js";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createToken() {
  return `pcp_${randomBytes(24).toString("hex")}`;
}

const CONFIG_REVISION_FIELDS = [
  "name",
  "role",
  "title",
  "icon",
  "appearance",
  "leadAgentId",
  "capabilities",
  "adapterType",
  "adapterConfig",
  "runtimeConfig",
  "defaultEnvironmentId",
  "budgetMonthlyCents",
  "metadata",
] as const;

type ConfigRevisionField = (typeof CONFIG_REVISION_FIELDS)[number];
type AgentConfigSnapshot = Pick<typeof agents.$inferSelect, ConfigRevisionField>;

export interface RevisionMetadata {
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  source?: string;
  rolledBackFromRevisionId?: string | null;
}

/**
 * The Claude login context for an agent write. The route derives the owner user
 * from the authenticated actor, not from the request body, and forwards the
 * non-secret `storedSessionId` claim from a completed Claude login session. A
 * controlled internal override permits a migration or an administrator repair to
 * bind or unbind the fixed OAuth token without a claim.
 *
 * The `applyExistingWithoutClaim` field is the user-actor apply-existing path.
 * The route sets it only for an authenticated user actor and derives the owner
 * from that actor. The path binds the fixed reference to the owner stored value
 * with no login round trip. It is distinct from `allowInternalBindingOverride`,
 * which does no ownership check.
 *
 * The `inheritedFromAgentId` field is the create-inheritance path. The route
 * sets it only for an authenticated agent actor whose create request inherited
 * the fixed reference from that named parent. The service re-reads the parent
 * agent inside the write transaction and binds the fixed reference only when
 * the parent exists, is in the same space, is a `claude_local` agent, and
 * already holds the exact fixed binding.
 */
export interface ClaudeLoginContext {
  storedSessionId?: string | null;
  ownerUserId?: string | null;
  allowInternalBindingOverride?: boolean;
  applyExistingWithoutClaim?: boolean;
  inheritedFromAgentId?: string | null;
}

export interface UpdateAgentOptions {
  expectedConfigurationRevision?: string;
  expectedConfiguration?: Pick<AgentConfigurationRecord, "adapterType" | "adapterConfig" | "runtimeConfig" | "defaultEnvironmentId">;
  recordRevision?: RevisionMetadata;
  allowPendingApprovalConfigUpdate?: boolean;
  claudeLogin?: ClaudeLoginContext;
}

export type CreateAgentData = Omit<typeof agents.$inferInsert, "spaceId" | "lifecycleState" | "lifecycleRequiredPluginIds" | "lifecycleHolds" | "lifecycleVersion" | "lifecycleError" | "lifecycleOperation"> & { runner?: AgentRunnerChoice };
export type AgentConfigurationRecord = typeof agents.$inferSelect;
export const AGENT_CONFIGURATION_FIELDS = [...CONFIG_REVISION_FIELDS, "permissions"] as const;
export type AgentConfigurationPatch = Partial<Pick<typeof agents.$inferInsert, typeof AGENT_CONFIGURATION_FIELDS[number]>>;
export type AgentCreationRecord = Pick<typeof agents.$inferSelect, "id" | "spaceId" | "adapterType" | "adapterConfig" | "permissions" | "metadata" | "status">;

export interface CreateAgentOptions {
  createdByAgentId?: string | null;
  createdByAgentSpaceId?: string;
  interactionTexts?: readonly string[];
  initialBudgetPolicyUserId?: string;
  setupOnly?: boolean;
  setupAgentId?: string;
  runnerResolved?: boolean;
  responsibleUserId?: string | null;
  createdByUserId?: string | null;
  aiConnectionInstall?: { connectionId: string; memberConnectionIds?: string[]; createdByUserId: string | null };
  claudeLogin?: ClaudeLoginContext;
}

type AgentEligibilityRow = Pick<typeof agents.$inferSelect, "id" | "spaceId" | "name" | "status" | "leadAgentId">;

interface AgentShortnameRow {
  id: string;
  name: string;
  status: string;
}

interface AgentShortnameCollisionOptions {
  excludeAgentId?: string | null;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildConfigSnapshot(
  row: Pick<typeof agents.$inferSelect, ConfigRevisionField>,
): AgentConfigSnapshot {
  const adapterConfig =
    typeof row.adapterConfig === "object" && row.adapterConfig !== null && !Array.isArray(row.adapterConfig)
      ? sanitizeRecord(row.adapterConfig as Record<string, unknown>)
      : {};
  const runtimeConfig =
    typeof row.runtimeConfig === "object" && row.runtimeConfig !== null && !Array.isArray(row.runtimeConfig)
      ? sanitizeRecord(row.runtimeConfig as Record<string, unknown>)
      : {};
  const metadata =
    typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
      ? sanitizeRecord(row.metadata as Record<string, unknown>)
      : row.metadata ?? null;
  return {
    name: row.name,
    role: row.role,
    title: row.title,
    icon: row.icon,
    appearance: row.appearance,
    leadAgentId: row.leadAgentId,
    capabilities: row.capabilities,
    adapterType: row.adapterType,
    adapterConfig,
    runtimeConfig,
    defaultEnvironmentId: row.defaultEnvironmentId,
    budgetMonthlyCents: row.budgetMonthlyCents,
    metadata,
  };
}

export function containsRedactedMarker(value: unknown): boolean {
  if (value === REDACTED_EVENT_VALUE) return true;
  if (Array.isArray(value)) return value.some((item) => containsRedactedMarker(item));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).some((entry) => containsRedactedMarker(entry));
}

export function hasConfigPatchFields(data: Partial<typeof agents.$inferInsert>) {
  return CONFIG_REVISION_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field));
}

export function changedPendingApprovalConfigFields(
  existing: Omit<typeof agents.$inferSelect, "lifecycleOperation" | "lifecycleRequiredPluginIds" | "harnessVerifiedDigest" | "harnessVerifiedAt">,
  data: Partial<typeof agents.$inferInsert>,
) {
  return CONFIG_REVISION_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(data, field) && !jsonEqual(data[field], existing[field]),
  );
}

export function configPatchFromApprovalPayload(payload: Record<string, unknown>) {
  const patch: Partial<typeof agents.$inferInsert> = {};
  if (typeof payload.name === "string") patch.name = payload.name;
  if (typeof payload.role === "string") patch.role = payload.role;
  if (payload.appearance != null) patch.appearance = agentAppearanceSchema.parse(payload.appearance);
  if (Object.prototype.hasOwnProperty.call(payload, "title")) {
    patch.title = typeof payload.title === "string" ? payload.title : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "icon")) {
    patch.icon = typeof payload.icon === "string" ? payload.icon : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "leadAgentId")) {
    patch.leadAgentId = typeof payload.leadAgentId === "string" ? payload.leadAgentId : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "capabilities")) {
    patch.capabilities = typeof payload.capabilities === "string" ? payload.capabilities : null;
  }
  if (typeof payload.adapterType === "string") patch.adapterType = payload.adapterType;
  if (isPlainRecord(payload.adapterConfig)) patch.adapterConfig = payload.adapterConfig;
  if (isPlainRecord(payload.runtimeConfig)) patch.runtimeConfig = payload.runtimeConfig;
  if (Object.prototype.hasOwnProperty.call(payload, "defaultEnvironmentId")) {
    patch.defaultEnvironmentId =
      typeof payload.defaultEnvironmentId === "string" ? payload.defaultEnvironmentId : null;
  }
  if (typeof payload.budgetMonthlyCents === "number") {
    patch.budgetMonthlyCents = payload.budgetMonthlyCents;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "metadata")) {
    patch.metadata = isPlainRecord(payload.metadata) ? payload.metadata : null;
  }
  if (isPlainRecord(payload.permissions)) {
    patch.permissions = payload.permissions;
  }
  return patch;
}

function parseFiniteNumberLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeRuntimeConfigForNewAgent(runtimeConfig: unknown): Record<string, unknown> {
  const normalizedRuntimeConfig = isPlainRecord(runtimeConfig) ? { ...runtimeConfig } : {};
  const heartbeat = isPlainRecord(normalizedRuntimeConfig.heartbeat)
    ? { ...normalizedRuntimeConfig.heartbeat }
    : {};
  if (parseFiniteNumberLike(heartbeat.maxConcurrentRuns) == null) {
    heartbeat.maxConcurrentRuns = AGENT_DEFAULT_MAX_CONCURRENT_RUNS;
  }
  normalizedRuntimeConfig.heartbeat = heartbeat;
  return normalizedRuntimeConfig;
}

export function diffConfigSnapshot(
  before: AgentConfigSnapshot,
  after: AgentConfigSnapshot,
): string[] {
  return CONFIG_REVISION_FIELDS.filter((field) => !jsonEqual(before[field], after[field]));
}

export function configPatchFromSnapshot(snapshot: unknown): Partial<typeof agents.$inferInsert> {
  if (!isPlainRecord(snapshot)) throw unprocessable("Invalid revision snapshot");

  if (typeof snapshot.name !== "string" || snapshot.name.length === 0) {
    throw unprocessable("Invalid revision snapshot: name");
  }
  if (typeof snapshot.role !== "string" || snapshot.role.length === 0) {
    throw unprocessable("Invalid revision snapshot: role");
  }
  if (typeof snapshot.adapterType !== "string" || snapshot.adapterType.length === 0) {
    throw unprocessable("Invalid revision snapshot: adapterType");
  }
  if (typeof snapshot.budgetMonthlyCents !== "number" || !Number.isFinite(snapshot.budgetMonthlyCents)) {
    throw unprocessable("Invalid revision snapshot: budgetMonthlyCents");
  }
  const runtimeConfig = agentRuntimeConfigSchema.safeParse(
    isPlainRecord(snapshot.runtimeConfig) ? snapshot.runtimeConfig : {},
  );
  if (!runtimeConfig.success) {
    throw unprocessable("Invalid revision snapshot: runtimeConfig");
  }

  return {
    name: snapshot.name,
    role: snapshot.role,
    title: typeof snapshot.title === "string" || snapshot.title === null ? snapshot.title : null,
    leadAgentId:
      typeof snapshot.leadAgentId === "string" || snapshot.leadAgentId === null ? snapshot.leadAgentId : null,
    capabilities:
      typeof snapshot.capabilities === "string" || snapshot.capabilities === null
        ? snapshot.capabilities
        : null,
    adapterType: snapshot.adapterType,
    adapterConfig: isPlainRecord(snapshot.adapterConfig) ? snapshot.adapterConfig : {},
    runtimeConfig: runtimeConfig.data,
    defaultEnvironmentId:
      typeof snapshot.defaultEnvironmentId === "string" || snapshot.defaultEnvironmentId === null
        ? snapshot.defaultEnvironmentId
        : null,
    budgetMonthlyCents: Math.max(0, Math.floor(snapshot.budgetMonthlyCents)),
    metadata: isPlainRecord(snapshot.metadata) || snapshot.metadata === null ? snapshot.metadata : null,
  };
}

export function hasAgentShortnameCollision(
  candidateName: string,
  existingAgents: AgentShortnameRow[],
  options?: AgentShortnameCollisionOptions,
): boolean {
  const candidateShortname = normalizeAgentUrlKey(candidateName);
  if (!candidateShortname) return false;

  return existingAgents.some((agent) => {
    if (agent.status === "terminated") return false;
    if (options?.excludeAgentId && agent.id === options.excludeAgentId) return false;
    return normalizeAgentUrlKey(agent.name) === candidateShortname;
  });
}

export function deduplicateAgentName(
  candidateName: string,
  existingAgents: AgentShortnameRow[],
): string {
  if (!hasAgentShortnameCollision(candidateName, existingAgents)) {
    return candidateName;
  }
  for (let i = 2; i <= 100; i++) {
    const suffixed = `${candidateName} ${i}`;
    if (!hasAgentShortnameCollision(suffixed, existingAgents)) {
      return suffixed;
    }
  }
  return `${candidateName} ${Date.now()}`;
}

export function agentRecordQueries(db: Db) {
  function currentUtcMonthWindow(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
    };
  }

  function withUrlKey<T extends { id: string; name: string }>(row: T) {
    return {
      ...row,
      urlKey: normalizeAgentUrlKey(row.name) ?? row.id,
    };
  }

  function normalizeAgentBaseRow(row: typeof agents.$inferSelect) {
    // The harness verification digest is server-only reuse state, never an API field.
    const { lifecycleOperation, lifecycleRequiredPluginIds, harnessVerifiedDigest, harnessVerifiedAt, ...publicRow } = row;
    return withUrlKey({
      ...publicRow,
      permissions: normalizeAgentPermissions(row.permissions),
    });
  }

  function toEligibilityAgent(row: Pick<typeof agents.$inferSelect, "id" | "spaceId" | "name" | "status" | "leadAgentId">): AgentEligibilityAgent {
    return {
      id: row.id,
      spaceId: row.spaceId,
      name: row.name,
      status: row.status,
      leadAgentId: row.leadAgentId,
    };
  }

  function normalizeAgentRows(rows: (typeof agents.$inferSelect)[], allSpaceRows: AgentEligibilityRow[] = rows) {
    const eligibilityAgents = allSpaceRows.map(toEligibilityAgent);
    return rows.map((row) => {
      const base = normalizeAgentBaseRow(row);
      const appearance = resolveAgentAppearance(row.appearance, row.id);
      return {
        ...base,
        appearance,
        avatarUrl: agentAvatarUrl(appearance),
        coordinationHealth: getAgentWorkEligibility({
          agent: toEligibilityAgent(row),
          agents: eligibilityAgents,
        }).coordinationHealth,
      };
    });
  }

  function normalizeAgentRow(row: typeof agents.$inferSelect, allSpaceRows?: AgentEligibilityRow[]) {
    return normalizeAgentRows([row], allSpaceRows)[0]!;
  }

  async function listSpaceAgentRows(spaceId: string) {
    return db.select().from(agents).where(eq(agents.spaceId, spaceId));
  }

  async function listSpaceAgentEligibilityRows(spaceId: string): Promise<AgentEligibilityRow[]> {
    return db.select({ id: agents.id, spaceId: agents.spaceId, name: agents.name,
      status: agents.status, leadAgentId: agents.leadAgentId }).from(agents).where(eq(agents.spaceId, spaceId));
  }

  async function getMonthlySpendByAgentIds(spaceId: string, agentIds: string[]) {
    if (agentIds.length === 0) return new Map<string, number>();
    const { start, end } = currentUtcMonthWindow();
    const rows = await db
      .select({
        agentId: costEvents.agentId,
        spentMonthlyCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
      })
      .from(costEvents)
      .where(
        and(
          eq(costEvents.spaceId, spaceId),
          inArray(costEvents.agentId, agentIds),
          gte(costEvents.occurredAt, start),
          lt(costEvents.occurredAt, end),
        ),
      )
      .groupBy(costEvents.agentId);
    return new Map(rows.map((row) => [row.agentId, Number(row.spentMonthlyCents ?? 0)]));
  }

  async function hydrateAgentSpend<T extends { id: string; spaceId: string; spentMonthlyCents: number }>(rows: T[]) {
    const agentIds = rows.map((row) => row.id);
    const spaceId = rows[0]?.spaceId;
    if (!spaceId || agentIds.length === 0) return rows;
    const spendByAgentId = await getMonthlySpendByAgentIds(spaceId, agentIds);
    return rows.map((row) => ({
      ...row,
      spentMonthlyCents: spendByAgentId.get(row.id) ?? 0,
    }));
  }

  async function getById(id: string) {
    const row = await db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .then((rows) => rows[0] ?? null);
    if (!row) return null;
    const [spaceRows, hydrated] = await Promise.all([
      listSpaceAgentEligibilityRows(row.spaceId),
      hydrateAgentSpend([row]).then((rows) => rows[0]!),
    ]);
    return normalizeAgentRow(hydrated, spaceRows);
  }

  async function ensureLeadAgent(spaceId: string, leadAgentId: string) {
    const lead = await getById(leadAgentId);
    if (!lead) throw notFound("Coordination lead not found");
    if (lead.spaceId !== spaceId) {
      throw unprocessable("Coordination lead must belong to the same space");
    }
    return lead;
  }

  async function assertNoCycle(agentId: string, leadAgentId: string | null | undefined) {
    if (!leadAgentId) return;
    if (leadAgentId === agentId) throw unprocessable("Agent cannot coordinate itself");

    let cursor: string | null = leadAgentId;
    while (cursor) {
      if (cursor === agentId) throw unprocessable("Coordination relationship would create a cycle");
      const next = await getById(cursor);
      cursor = next?.leadAgentId ?? null;
    }
  }

  async function assertSpaceShortnameAvailable(
    spaceId: string,
    candidateName: string,
    options?: AgentShortnameCollisionOptions,
  ) {
    const candidateShortname = normalizeAgentUrlKey(candidateName);
    if (!candidateShortname) return;

    const existingAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
      })
      .from(agents)
      .where(eq(agents.spaceId, spaceId));

    const hasCollision = hasAgentShortnameCollision(candidateName, existingAgents, options);
    if (hasCollision) {
      throw conflict(
        `Agent shortname '${candidateShortname}' is already in use in this space`,
      );
    }
  }

  return { normalizeAgentRows, normalizeAgentRow, listSpaceAgentRows, listSpaceAgentEligibilityRows, hydrateAgentSpend,
    getById, ensureLeadAgent, assertNoCycle, assertSpaceShortnameAvailable };
}
