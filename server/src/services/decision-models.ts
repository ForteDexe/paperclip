import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import {
  agents, authUsers, budgetReservations, spaces, spaceMemberships, spaceDecisionModels, costEvents,
  decisionInvocations, heartbeatRuns, issues, projects, spaceSecrets, type Db,
} from "@outpost/db";
import {
  DECISION_MODELS, decisionProviderForConnection, decisionRequestSchema, updateDecisionModelSchema,
  centsToUnits, unitsToCents, type DecisionAvailability, type DecisionConnectionChoice, type DecisionHistoryEntry,
  type DecisionModelSettings, type DecisionProvider, type DecisionRequest, type DecisionResult, type DecisionUnavailableReason, type UpdateDecisionModel,
} from "@outpost/shared";
import { HttpError, forbidden, unprocessable } from "../errors.js";
import { aiConnectionService } from "./ai-connections.js";
import { accessService } from "./access.js";
import { type AuthorizationActor } from "./authorization.js";
import { withAccountingTransaction, withOperationAccountingTransaction } from "./accounting-transaction.js";
import { withBudgetSpan } from "./budget-tracing.js";
import { budgetServiceInTransaction, type BudgetServiceHooks } from "./budgets.js";
import { createCostEventInTransaction } from "./costs.js";
import { applyCostCorrectionInTransaction } from "./accounting-corrections.js";
import { queueBudgetEvaluation } from "./budget-evaluation-work.js";
import { logActivity } from "./activity-log.js";
import { decisionReceipt, runDecisionProvider, type DecisionProviderOutcome } from "./decision-model-provider.js";

const registeredFeatures = new WeakSet<object>();
/** Register once in a server module. Feature handles cannot be supplied over JSON/API. */
export function defineDecisionFeature(id: string, options: { background?: boolean } = {}) {
  if (!/^[a-z][a-z0-9_.-]{0,99}$/.test(id)) throw new Error("Invalid decision feature identifier");
  const feature = Object.freeze({ id, background: options.background === true });
  registeredFeatures.add(feature);
  return feature;
}
export const settingsDecisionTest = defineDecisionFeature("settings.test");
export interface DecisionContext {
  spaceId: string;
  feature: ReturnType<typeof defineDecisionFeature>;
  actor: AuthorizationActor | { type: "system" };
  issueId?: string;
  projectId?: string;
}
class DecisionUnavailable extends Error {
  constructor(readonly reason: DecisionUnavailableReason) { super(reason); }
}
function unavailableReason(error: unknown): DecisionUnavailableReason | null {
  if (error instanceof DecisionUnavailable) return error.reason;
  if (error instanceof HttpError) {
    if (error.status === 403 || error.status === 404) return "access_denied";
    if (error.status === 422) {
      return (error.details as { code?: string } | undefined)?.code === "incompatible_connection" ? "incompatible_connection" : "connection_unavailable";
    }
  }
  return null;
}

export function decisionModelService(db: Db, options: { provider?: typeof runDecisionProvider; budgetHooks?: BudgetServiceHooks } = {}) {
  const providerCall = options.provider ?? runDecisionProvider;
  async function settings(spaceId: string): Promise<DecisionModelSettings> {
    const [row] = await db.select().from(spaceDecisionModels).where(eq(spaceDecisionModels.spaceId, spaceId));
    return row ? { ...row, provider: row.provider as DecisionProvider | null } : {
      spaceId, enabled: false, allowBackground: true, connectionId: null, grantId: null, provider: null, model: null,
    };
  }
  async function choices(spaceId: string, userId: string): Promise<DecisionConnectionChoice[]> {
    const connections = aiConnectionService(db);
    if (!(await connections.membership(spaceId, userId))) throw forbidden();
    return (await connections.list(spaceId, userId)).flatMap(row => {
      const provider = decisionProviderForConnection(row);
      return provider && row.ownership === "shared" ? [{ ...row, decisionModel: DECISION_MODELS[provider].id }] : [];
    });
  }
  async function configure(spaceId: string, userId: string, input: UpdateDecisionModel) {
    const data = updateDecisionModelSchema.parse(input);
    return withAccountingTransaction(db, spaceId, async (tx, publications) => {
      const [previous] = await tx.select().from(spaceDecisionModels).where(eq(spaceDecisionModels.spaceId, spaceId));
      // Managers can always turn off a broken/revoked connection without acquiring it.
      const disabling = !data.enabled && previous?.connectionId === data.connectionId && previous?.grantId === data.grantId;
      const row = !disabling && data.connectionId && data.grantId ? await aiConnectionService(tx).selectDecision({ spaceId,
        userId, connectionId: data.connectionId, grantId: data.grantId }) : null;
      const provider = (disabling ? previous?.provider : row?.provider) as DecisionProvider | null | undefined;
      const values = { ...data, allowBackground: data.allowBackground ?? previous?.allowBackground ?? true, spaceId, provider: provider ?? null, model: provider ? DECISION_MODELS[provider].id : null, updatedAt: new Date() };
      await tx.insert(spaceDecisionModels).values(values).onConflictDoUpdate({ target: spaceDecisionModels.spaceId, set: values });
      await logActivity(tx, { spaceId, actorType: "user", actorId: userId, action: "decision_model.configured", entityType: "space", entityId: spaceId,
        details: { ...data, provider: values.provider, model: values.model } }, publications);
      return values;
    });
  }
  async function resolve(context: DecisionContext, executor = db, lockAdmission = false) {
    if (!registeredFeatures.has(context.feature)) throw forbidden("A registered decision feature is required");
    const configQuery = executor.select().from(spaceDecisionModels).where(eq(spaceDecisionModels.spaceId, context.spaceId));
    const [config] = await (lockAdmission ? configQuery.for("share") : configQuery);
    if (!config?.connectionId || !config.grantId) throw new DecisionUnavailable("not_configured");
    if (!config.enabled) throw new DecisionUnavailable("disabled");
    let userId: string | null = null, agentId: string | null = null, runId: string | null = null, identityContextId: string | null = null;
    let issueId = context.issueId ?? null;
    let actor = context.actor;
    let admissionAgent: { status: string } | undefined;
    if (actor.type === "system") {
      if (!context.feature.background || !config.allowBackground) throw new DecisionUnavailable("background_disabled");
    } else if (actor.type === "agent") {
      if (!actor.agentId || !actor.runId || actor.spaceId !== context.spaceId) throw forbidden();
      if (lockAdmission) [admissionAgent] = await executor.select({ status: agents.status }).from(agents).where(and(
        eq(agents.id, actor.agentId), eq(agents.spaceId, context.spaceId),
      )).for("share");
      const runQuery = executor.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.spaceId, context.spaceId), eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.agentId, actor.agentId)));
      const [run] = await (lockAdmission ? runQuery.for("share") : runQuery);
      if (!run || run.status !== "running") throw forbidden("An active run is required");
      agentId = run.agentId; runId = run.id; userId = run.responsibleUserId; identityContextId = run.activeIdentityContextId;
      const runIssue = run.nativeIssueId ?? run.contextSnapshot?.issueId ?? run.contextSnapshot?.taskId;
      if (issueId && issueId !== runIssue) throw forbidden("Task does not belong to this run");
      issueId = typeof runIssue === "string" ? runIssue : null;
      const memberships = userId ? await executor.select({ spaceId: spaceMemberships.spaceId, membershipRole: spaceMemberships.membershipRole, status: spaceMemberships.status })
        .from(spaceMemberships).where(and(eq(spaceMemberships.spaceId, context.spaceId), eq(spaceMemberships.principalType, "user"), eq(spaceMemberships.principalId, userId))) : [];
      actor = { ...actor, onBehalfOfUserId: userId, onBehalfOfMemberships: memberships };
    } else if (actor.type === "operator") userId = actor.userId ?? (actor.source === "local_implicit" ? "local-operator" : null);
    else throw forbidden();
    if (actor.type !== "system" && !userId) throw new DecisionUnavailable("responsible_user_missing");
    const [issue] = issueId ? await executor.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.spaceId, context.spaceId))) : [];
    if (issueId && !issue) throw forbidden();
    if (issue && context.projectId && context.projectId !== issue.projectId) throw forbidden("Task project mismatch");
    const projectId = issue?.projectId ?? context.projectId ?? null;
    if (projectId) {
      const [project] = await executor.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.spaceId, context.spaceId)));
      if (!project) throw forbidden();
    }
    if (actor.type !== "system") {
      const access = accessService(executor);
      const accessResult = await access.decide({ actor, action: issue ? "issue:read" : projectId ? "project:read" : "space_scope:read",
        resource: issue ? { type: "issue", spaceId: context.spaceId, issueId: issue.id, projectId: issue.projectId, parentIssueId: issue.parentId,
          assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId, status: issue.status }
          : projectId ? { type: "project", spaceId: context.spaceId, projectId } : { type: "space", spaceId: context.spaceId } });
      if (!accessResult.allowed) throw forbidden();
    }
    const connection = await aiConnectionService(executor).selectDecision({ spaceId: context.spaceId,
      connectionId: config.connectionId, grantId: config.grantId, userId, agentId, sponsoredBackground: actor.type === "system" });
    if (connection.provider !== config.provider || config.model !== DECISION_MODELS[connection.provider].id) throw new DecisionUnavailable("incompatible_connection");
    return { config, connection, userId, agentId, runId, identityContextId, issueId, projectId, admissionAgent,
      actorType: actor.type === "operator" ? "user" as const : actor.type === "agent" ? "agent" as const : "system" as const,
      actorId: actor.type === "system" ? "outpost-decisions" : agentId ?? userId! };
  }
  async function availability(context: DecisionContext): Promise<DecisionAvailability> {
    try { await resolve(context); return { available: true }; }
    catch (error) { const reason = unavailableReason(error); if (reason) return { available: false, reason }; throw error; }
  }
  /** Callers may memoize within their request; dispatch never consumes a cached authorization. */
  function availabilityForRequest() {
    const cache = new Map<DecisionContext, Promise<DecisionAvailability>>();
    return (context: DecisionContext) => { let result = cache.get(context); if (!result) { result = availability(context); cache.set(context, result); } return result; };
  }
  async function settle(invocation: typeof decisionInvocations.$inferSelect, outcome: DecisionProviderOutcome) {
    await withBudgetSpan("budget.accounting.settlement", () => withOperationAccountingTransaction(db, invocation.spaceId, async (tx, publications) => {
      const receipt = outcome.receipt;
      // Keep dispatch identity on the invocation even if its task or agent was
      // deleted while the provider worked. Ledger foreign keys use live rows.
      const links: { agentId: string | null; issueId: string | null; projectId: string | null } = { agentId: null, issueId: null, projectId: null };
      for (const [key, table] of [["agentId", agents], ["issueId", issues], ["projectId", projects]] as const) {
        const id = invocation[key];
        if (!id) continue;
        const [row] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.spaceId, invocation.spaceId))).for("key share");
        if (row) links[key] = row.id;
      }
      const [current] = await tx.select().from(decisionInvocations).where(and(eq(decisionInvocations.spaceId, invocation.spaceId), eq(decisionInvocations.id, invocation.id))).for("update");
      if (!current) return;
      const [existing] = current.costEventId ? await tx.select({ id: costEvents.id, costStatus: costEvents.costStatus,
        inputTokens: costEvents.inputTokens, cachedInputTokens: costEvents.cachedInputTokens, outputTokens: costEvents.outputTokens,
        providerRequestId: costEvents.providerRequestId, pricingProvenance: costEvents.pricingProvenance,
        costCents: sql<string>`${costEvents.costCents}::text` }).from(costEvents).where(and(
        eq(costEvents.spaceId, invocation.spaceId), eq(costEvents.id, current.costEventId),
      )).for("update") : [];
      if (current.status !== "running") {
        if (!existing || outcome.errorCode === "interrupted") return;
        if (current.errorCode !== "interrupted" && (existing.costStatus !== "unpriced" || receipt.costStatus === "unpriced")) return;
      }
      let event: { id: string };
      if (existing) {
        const receiptUsage = { inputTokens: receipt.inputTokens ?? current.inputTokens ?? 0, cachedInputTokens: 0,
          outputTokens: receipt.outputTokens ?? current.outputTokens ?? 0, providerRequestId: receipt.providerRequestId ?? current.providerRequestId };
        // Recovery records uncertainty, not final billing evidence. A late receipt
        // values the same attempt through the existing audited correction ledger.
        if (existing.costStatus === "unpriced" && receipt.costStatus !== "unpriced") await applyCostCorrectionInTransaction(tx, publications, { spaceId: invocation.spaceId, eventId: existing.id,
          idempotencyKey: `decision:${invocation.id}:late-receipt`, expectedCents: existing.costCents,
          correctedCents: receipt.costCents ?? "0", reason: "Provider receipt arrived after interrupted accounting recovery",
          costStatus: receipt.costStatus,
          receiptUsage,
          pricing: { ...receipt.pricingProvenance, evidence: JSON.stringify({ providerRequestId: receipt.providerRequestId,
            inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens, evidence: receipt.pricingProvenance.evidence }) },
          actorId: "cost_accounting" });
        else {
          if (Object.entries(receiptUsage).some(([key, value]) => existing[key as keyof typeof existing] !== value))
            await applyCostCorrectionInTransaction(tx, publications, { spaceId: invocation.spaceId, eventId: existing.id,
              idempotencyKey: `decision:${invocation.id}:late-usage`, expectedCents: existing.costCents, correctedCents: existing.costCents,
              costStatus: existing.costStatus === "unpriced" ? "unpriced" : existing.costStatus === "estimated" ? "estimated" : "reported", receiptUsage,
              reason: "Provider usage arrived after interrupted accounting recovery",
              pricing: existing.pricingProvenance ?? { source: "unknown" }, actorId: "cost_accounting" });
          if (existing.costStatus !== "unpriced") await logActivity(tx, { spaceId: invocation.spaceId,
            actorType: "system", actorId: "cost_accounting", responsibleUserIdOverride: invocation.responsibleUserId,
            action: "accounting.late_receipt_observed", entityType: "cost_event", entityId: existing.id,
            details: { effectiveCostCents: existing.costCents, ...receipt },
          }, publications);
        }
        event = existing;
      } else event = await createCostEventInTransaction(tx, invocation.spaceId, {
        usageKind: "decision", responsibleUserId: invocation.responsibleUserId, ...links,
        // Run attribution lives on the invocation. Run receipt reconciliation must not ingest this independent charge.
        heartbeatRunId: null, idempotencyKey: `decision:${invocation.id}`,
        provider: invocation.provider === "openrouter" ? "typesafe" : "openai", biller: invocation.provider,
        billingType: "metered_api", costStatus: receipt.costStatus, model: invocation.model,
        inputTokens: receipt.inputTokens ?? 0, outputTokens: receipt.outputTokens ?? 0, costCents: receipt.costCents ?? "0",
        providerRequestId: receipt.providerRequestId, pricingProvenance: receipt.pricingProvenance, occurredAt: invocation.startedAt,
      }, publications, { actorType: invocation.actorType as "system" | "user" | "agent", actorId: invocation.actorId, agentId: links.agentId });
      const finishedAt = new Date();
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.accounting, invocation.spaceId);
      await tx.update(decisionInvocations).set({ status: outcome.answers ? "succeeded" : receipt.costStatus === "unpriced" ? "unknown" : "failed",
        errorCode: outcome.errorCode ?? null, costEventId: event.id, providerRequestId: receipt.providerRequestId ?? current.providerRequestId,
        inputTokens: receipt.inputTokens ?? current.inputTokens, outputTokens: receipt.outputTokens ?? current.outputTokens, finishedAt, durationMs: Math.max(0, finishedAt.getTime() - invocation.startedAt.getTime()),
      }).where(and(eq(decisionInvocations.spaceId, invocation.spaceId), eq(decisionInvocations.id, invocation.id)));
      if (receipt.costStatus !== "unpriced") await tx.update(budgetReservations).set({ state: outcome.noProviderWork ? "released" : "settled", settledAt: finishedAt }).where(and(
        eq(budgetReservations.spaceId, invocation.spaceId), eq(budgetReservations.decisionInvocationId, invocation.id), eq(budgetReservations.state, "held"),
      ));
    }), { "budget.accounting.owner": "decision" });
  }
  async function decide(context: DecisionContext, request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResult> {
    const parsed = decisionRequestSchema.safeParse(request);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > 32_000) throw unprocessable("Decisions require 1–20 valid questions and at most 32 KB of text/JSON");
    let selected: Awaited<ReturnType<typeof resolve>>;
    try { selected = await resolve(context); }
    catch (error) { const reason = unavailableReason(error); if (reason) return { status: "unavailable", reason }; throw error; }
    const secretId = selected.connection.grant.credentialSecretRefs.find(ref => ref.configPath === "ai.credential")?.secretId;
    const [credentialSnapshot] = secretId ? await db.select({ id: spaceSecrets.id, status: spaceSecrets.status, version: spaceSecrets.latestVersion })
      .from(spaceSecrets).where(and(eq(spaceSecrets.spaceId, context.spaceId), eq(spaceSecrets.id, secretId))) : [];
    if (!credentialSnapshot || credentialSnapshot.status !== "active") return { status: "unavailable", reason: "connection_unavailable" };
    let credential: string;
    try { credential = await aiConnectionService(db).credential(selected.connection, 0, { responsibleUserId: selected.userId,
      actorType: selected.actorType, actorId: selected.actorId, issueId: selected.issueId, heartbeatRunId: selected.runId }); }
    catch (error) { return { status: "unavailable", reason: unavailableReason(error) ?? "connection_unavailable" }; }
    const admission = await withOperationAccountingTransaction(db, context.spaceId, async (tx, publications) => {
      // Admission readers share these control fences. A manual pause either
      // precedes this admission or sees its committed invocation when it wins.
      const [space] = await tx.select({ status: spaces.status }).from(spaces)
        .where(eq(spaces.id, context.spaceId)).for("share");
      if (!space || space.status !== "active") return { reason: "budget_blocked" as const };
      if (selected.projectId) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(and(
          eq(projects.spaceId, context.spaceId), eq(projects.id, selected.projectId),
        )).for("share");
        if (!project) return { reason: "budget_blocked" as const };
      }
      let current: Awaited<ReturnType<typeof resolve>>;
      try { current = await resolve(context, tx, true); }
      catch (error) { const reason = unavailableReason(error); if (reason) return { reason }; throw error; }
      // A different setting or steering identity requires a fresh credential acquisition.
      if (current.config.updatedAt.getTime() !== selected.config.updatedAt.getTime()
        || current.config.connectionId !== selected.config.connectionId || current.config.grantId !== selected.config.grantId
        || current.config.model !== selected.config.model || current.config.provider !== selected.config.provider
        || current.projectId !== selected.projectId
        || current.connection.grant.credentialSecretRefs.find(ref => ref.configPath === "ai.credential")?.secretId !== credentialSnapshot.id
        || current.userId !== selected.userId || current.identityContextId !== selected.identityContextId
        || current.connection.grant.updatedAt.getTime() !== selected.connection.grant.updatedAt.getTime()
        || current.connection.connection.updatedAt.getTime() !== selected.connection.connection.updatedAt.getTime())
        return { reason: "connection_unavailable" as const };
      // Secret changes do not update the connection revision. Serialize against
      // rotation/revocation through this invocation's admission.
      const [currentSecret] = await tx.select({ status: spaceSecrets.status, version: spaceSecrets.latestVersion }).from(spaceSecrets)
        .where(and(eq(spaceSecrets.spaceId, context.spaceId), eq(spaceSecrets.id, credentialSnapshot.id))).for("share");
      if (!currentSecret || currentSecret.status !== "active" || currentSecret.version !== credentialSnapshot.version)
        return { reason: "connection_unavailable" as const };
      const budgets = budgetServiceInTransaction(tx, publications);
      const { block, policies, observations } = await budgets.evaluateAdmission(context.spaceId, current.agentId, { projectId: current.projectId });
      const agent = current.admissionAgent;
      if (block || space.status !== "active" || (current.agentId && (!agent || agent.status === "paused" || agent.status === "terminated"))) return { reason: "budget_blocked" as const };
      const amount = policies.reduce((max, p) => { const n = centsToUnits(p.reservationCents); return n > max ? n : max; }, 0n);
      for (const [index, policy] of policies.entries()) {
        const committed = centsToUnits(observations[index].ledgerCents) + centsToUnits(observations[index].effectiveHeldCents);
        if (committed >= centsToUnits(policy.amount) || committed + amount > centsToUnits(policy.amount)) return { reason: "budget_blocked" as const };
      }
      signal?.throwIfAborted();
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.accounting, context.spaceId);
      const [invocation] = await tx.insert(decisionInvocations).values({ id: randomUUID(), spaceId: context.spaceId, feature: context.feature.id,
        actorType: current.actorType, actorId: current.actorId, responsibleUserId: current.userId, agentId: current.agentId,
        issueId: current.issueId, projectId: current.projectId, runId: current.runId, identityContextId: current.identityContextId,
        connectionId: current.connection.connection.id, grantId: current.connection.grant.id, provider: current.connection.provider, model: current.config.model!,
        questionTypes: Object.values(parsed.data.questions).map(q => q.type),
      }).returning();
      await tx.insert(budgetReservations).values({ spaceId: context.spaceId, decisionInvocationId: invocation.id, agentId: current.agentId,
        projectId: current.projectId, amountCents: unitsToCents(amount), providerStartedAt: invocation.startedAt });
      await queueBudgetEvaluation(tx, { spaceId: context.spaceId, agentId: current.agentId, projectId: current.projectId });
      return { invocation };
    });
    if (admission.reason) return { status: "unavailable", reason: admission.reason };
    const invocation = admission.invocation!;
    let outcome: DecisionProviderOutcome;
    try { outcome = await providerCall({ provider: selected.connection.provider, model: invocation.model, apiKey: credential,
      request: parsed.data, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }); }
    catch { outcome = { errorCode: "provider_failed", receipt: decisionReceipt(selected.connection.provider, null) }; }
    await settle(invocation, outcome);
    const { inputTokens, outputTokens, costCents, costStatus } = outcome.receipt;
    const usage = { inputTokens, outputTokens, costCents, costStatus };
    return outcome.answers ? { status: "succeeded", invocationId: invocation.id, answers: outcome.answers, usage }
      : { status: "failed", invocationId: invocation.id, errorCode: outcome.errorCode ?? "provider_failed", usage };
  }
  async function recoverInterrupted() {
    const stale = await db.select().from(decisionInvocations).where(and(eq(decisionInvocations.status, "running"), lt(decisionInvocations.startedAt, new Date(Date.now() - 120_000)))).limit(100);
    for (const invocation of stale) await settle(invocation, { errorCode: "interrupted", receipt: decisionReceipt(invocation.provider as DecisionProvider, null) });
    return stale.length;
  }
  async function history(spaceId: string, actor: AuthorizationActor, range: { from?: Date; to?: Date; before?: Date; limit?: number } = {}): Promise<DecisionHistoryEntry[]> {
    const access = accessService(db);
    if (!(await access.decide({ actor, action: "space_scope:read", resource: { type: "space", spaceId } })).allowed) throw forbidden();
    const rows = await db.select({ invocation: decisionInvocations, userName: authUsers.name,
      inputTokens: costEvents.inputTokens, outputTokens: costEvents.outputTokens, costStatus: costEvents.costStatus,
      costCents: sql<string | null>`${costEvents.costCents}::text`, issue: issues,
    }).from(decisionInvocations).leftJoin(costEvents, and(eq(costEvents.id, decisionInvocations.costEventId), eq(costEvents.spaceId, spaceId)))
      .leftJoin(authUsers, eq(authUsers.id, decisionInvocations.responsibleUserId))
      .leftJoin(issues, and(eq(issues.id, decisionInvocations.issueId), eq(issues.spaceId, spaceId)))
      .where(and(eq(decisionInvocations.spaceId, spaceId), range.from ? gte(decisionInvocations.startedAt, range.from) : undefined,
        range.to ? lte(decisionInvocations.startedAt, range.to) : undefined, range.before ? lt(decisionInvocations.startedAt, range.before) : undefined))
      .orderBy(desc(decisionInvocations.startedAt), desc(decisionInvocations.id)).limit(Math.min(range.limit ?? 100, 500));
    return Promise.all(rows.map(async ({ invocation: row, issue, ...cost }) => {
      const visible = issue && (await access.decide({ actor, action: "issue:read", resource: { type: "issue", spaceId, issueId: issue.id,
        projectId: issue.projectId, parentIssueId: issue.parentId, assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId, status: issue.status } })).allowed;
      return { id: row.id, feature: row.feature, actorType: row.actorType, responsibleUserId: row.responsibleUserId, userName: cost.userName,
        issueId: visible ? issue.id : null, issueIdentifier: visible ? issue.identifier : null, agentId: row.agentId, runId: visible ? row.runId : null,
        connectionId: row.connectionId, provider: row.provider, model: row.model, status: row.status, errorCode: row.errorCode,
        startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null, durationMs: row.durationMs,
        inputTokens: row.inputTokens, outputTokens: row.outputTokens,
        costCents: cost.costStatus === "unpriced" ? null : cost.costCents, costStatus: cost.costStatus };
    }));
  }
  return { settings, choices, configure, availability, availabilityForRequest, decide, recoverInterrupted, history };
}
