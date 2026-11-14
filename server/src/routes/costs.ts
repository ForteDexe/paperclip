import { importProviderDailyCosts } from "../services/provider-billing-import.js";
import { subscriptionPriceSchema, mergeSubscriptionsSchema } from "@outpost/shared";
import { subscriptionService } from "../services/subscriptions.js";
import { subscriptionCostReport } from "../services/subscription-report.js";
import { refreshSpaceSubscriptions } from "../services/subscription-refresh.js";
import { canManageAiConnections } from "./ai-connections.js";
import { importProviderCostsSchema } from "@outpost/shared";
import { accountingIntegrityService } from "../services/accounting-integrity.js";
import { costDataQualityReport } from "../services/cost-data-quality.js";
import { billingReconciliationService } from "../services/billing-reconciliation.js";
import { adjustCostSchema, importBillingInvoiceSchema, repairAccountingSchema, retryAccountingSchema } from "@outpost/shared";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@outpost/db";
import {
  createCostEventSchema,
  createFinanceEventSchema,
  normalizeIssueIdentifier,
  resolveBudgetIncidentSchema,
  updateBudgetSchema,
  upsertBudgetPolicySchema,
} from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import {
  budgetService,
  costService,
  financeService,
  spaceService,
  agentService,
  issueService,
  heartbeatService,
  accessService,
} from "../services/index.js";
import { assertOperator, assertSpaceAccess, getAccessibleResource, getActorInfo } from "./authz.js";
import { fetchSpaceQuotaWindows } from "../services/quota-windows.js";
import { badRequest, forbidden } from "../errors.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

const reportDateSchema = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);

export function parseCostDateRange(query: Record<string, unknown>) {
  if (query.period !== undefined && query.period !== "all" && query.period !== "month") throw badRequest("invalid 'period'");
  if (query.period === "all") {
    if (query.from !== undefined || query.to !== undefined) throw badRequest("all-time period cannot have date bounds");
    return { allTime: true };
  }
  if (query.from !== undefined && !reportDateSchema.safeParse(query.from).success) throw badRequest("invalid 'from' date");
  if (query.to !== undefined && !reportDateSchema.safeParse(query.to).success) throw badRequest("invalid 'to' date");
  const fromRaw = query.from as string | undefined;
  const toRaw = query.to as string | undefined;
  const from = fromRaw ? new Date(fromRaw) : undefined;
  const to = toRaw ? new Date(toRaw) : undefined;
  if (from && isNaN(from.getTime())) throw badRequest("invalid 'from' date");
  if (to && isNaN(to.getTime())) throw badRequest("invalid 'to' date");
  if (from && to && from > to) throw badRequest("from must not be after to");
  return (from || to) ? { from, to } : undefined;
}

export function parseCostLimit(query: Record<string, unknown>) {
  const raw = query.limit;
  if (raw == null || raw === "") return 100;
  const limit = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw badRequest("invalid 'limit' value");
  }
  return limit;
}

export function costRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const heartbeat = heartbeatService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const budgetHooks = {
    cancelWorkForScope: heartbeat.cancelBudgetScopeWork,
  };
  const costs = costService(db, budgetHooks);
  const finance = financeService(db);
  const budgets = budgetService(db, budgetHooks);
  const spaces = spaceService(db);
  const agents = agentService(db);
  const issues = issueService(db);
  const access = accessService(db);

  function costReaderActor(req: Parameters<typeof assertSpaceAccess>[0], spaceId: string) {
    assertOperator(req);
    assertSpaceAccess(req, spaceId);
    return { userId: getActorInfo(req).actorId,
      readOnly: req.actor.memberships?.some(member => member.spaceId === spaceId && member.membershipRole === "viewer") ?? false };
  }

  async function subscriptionActor(req: Parameters<typeof assertSpaceAccess>[0], spaceId: string) {
    return { ...costReaderActor(req, spaceId), canManage: await canManageAiConnections(db, req, spaceId) };
  }

  router.get("/spaces/:spaceId/costs/data-quality", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const actor = costReaderActor(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    res.json(await costDataQualityReport(db, spaceId, !actor.readOnly, parseCostDateRange(req.query)));
  });
  router.post("/spaces/:spaceId/costs/retry-accounting", validate(retryAccountingSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const actor = costReaderActor(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    if (actor.readOnly) throw forbidden("Viewers cannot retry cost recording");
    res.json(await accountingIntegrityService(db, budgetHooks).retry(spaceId, req.body.runId, actor.userId));
  });

  router.get("/spaces/:spaceId/costs/subscriptions", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const actor = await subscriptionActor(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    res.json(await subscriptionCostReport(db, spaceId, actor, parseCostDateRange(req.query)));
  });
  router.post("/spaces/:spaceId/costs/subscriptions/refresh", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const actor = await subscriptionActor(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    if (actor.readOnly) throw forbidden("Viewers cannot refresh subscription accounts");
    void refreshSpaceSubscriptions(db, spaceId, actor.userId);
    res.status(202).json({ status: "accepted" });
  });
  router.patch("/spaces/:spaceId/costs/subscriptions/:subscriptionId", validate(subscriptionPriceSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const actor = await subscriptionActor(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const id = z.string().uuid().safeParse(req.params.subscriptionId);
    if (!id.success) throw badRequest("Invalid subscription ID");
    res.json(await subscriptionService(db).updatePrice(spaceId, id.data, req.body, actor));
  });
  router.post("/spaces/:spaceId/costs/subscriptions/:subscriptionId/link", validate(mergeSubscriptionsSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const actor = await subscriptionActor(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const id = z.string().uuid().safeParse(req.params.subscriptionId);
    if (!id.success) throw badRequest("Invalid subscription ID");
    res.json(await subscriptionService(db).merge(spaceId, id.data, req.body.targetId, req.body.expectedRevision, req.body.targetRevision, actor));
  });

  async function resolveIssueByRef(rawId: string) {
    const identifier = normalizeIssueIdentifier(rawId);
    if (identifier) {
      return issues.getByIdentifier(identifier);
    }
    return issues.getById(rawId);
  }

  async function assertSpaceCostReadAllowed(req: Parameters<typeof assertSpaceAccess>[0], res: any, spaceId: string) {
    const decision = await access.decide({
      actor: req.actor,
      action: "space_scope:read",
      resource: { type: "space", spaceId },
    });
    if (decision.allowed) return true;
    res.status(403).json({ error: "Costs are outside this actor's authorization boundary" });
    return false;
  }

  async function assertIssueCostReadAllowed(req: Parameters<typeof assertSpaceAccess>[0], res: any, issue: {
    id: string;
    spaceId: string;
    projectId: string | null;
    parentId: string | null;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
    status: string;
  }) {
    const decision = await access.decide({
      actor: req.actor,
      action: "issue:read",
      resource: {
        type: "issue",
        spaceId: issue.spaceId,
        issueId: issue.id,
        projectId: issue.projectId,
        parentIssueId: issue.parentId,
        assigneeAgentId: issue.assigneeAgentId,
        assigneeUserId: issue.assigneeUserId,
        status: issue.status,
      },
    });
    if (decision.allowed) return true;
    res.status(403).json({ error: "Issue costs are outside this actor's authorization boundary" });
    return false;
  }

  router.post("/spaces/:spaceId/cost-events", validate(createCostEventSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);

    if (req.actor.type === "agent" && req.actor.agentId !== req.body.agentId) {
      res.status(403).json({ error: "Agent can only report its own costs" });
      return;
    }

    const actor = getActorInfo(req);
    const event = await costs.createEvent(spaceId, {
      ...req.body,
      occurredAt: new Date(req.body.occurredAt),
    }, { actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId });

    res.status(201).json(event);
  });

  router.post("/spaces/:spaceId/finance-events", validate(createFinanceEventSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);

    const actor = getActorInfo(req);
    const event = await finance.createEvent(spaceId, {
      ...req.body,
      occurredAt: new Date(req.body.occurredAt),
    }, { actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId });

    res.status(201).json(event);
  });

  router.get("/spaces/:spaceId/costs/summary", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const summary = await costs.summary(spaceId, range);
    res.json(summary);
  });

  router.get("/issues/:id/cost-summary", async (req, res) => {
    const rawId = req.params.id as string;
    const issue = await getAccessibleResource(req, res, resolveIssueByRef(rawId), "Issue not found");
    if (!issue) return;
    if (!(await assertIssueCostReadAllowed(req, res, issue))) return;
    const excludeRoot = req.query.excludeRoot === "true" || req.query.excludeRoot === "1";
    const summary = await costs.issueTreeSummary(issue.spaceId, issue.id, { excludeRoot });
    res.json(summary);
  });

  router.get("/spaces/:spaceId/costs/by-user", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    res.json(await costs.byUser(spaceId, range));
  });

  router.get("/spaces/:spaceId/costs/by-agent", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const rows = await costs.byAgent(spaceId, range);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/by-agent-model", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const rows = await costs.byAgentModel(spaceId, range);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/by-provider", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const rows = await costs.byProvider(spaceId, range);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/by-biller", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const rows = await costs.byBiller(spaceId, range);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/finance-summary", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const summary = await finance.summary(spaceId, range);
    res.json(summary);
  });

  router.get("/spaces/:spaceId/costs/finance-by-biller", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const rows = await finance.byBiller(spaceId, range);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/finance-by-kind", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const rows = await finance.byKind(spaceId, range);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/finance-events", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const limit = parseCostLimit(req.query);
    const rows = await finance.list(spaceId, range, limit);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/window-spend", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const rows = await costs.windowSpend(spaceId);
    res.json(rows);
  });

  router.get("/spaces/:spaceId/costs/quota-windows", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    // validate spaceId resolves to a real space so the "__none__" sentinel
    // and any forged ids are rejected before we touch provider credentials
    const space = await spaces.getById(spaceId);
    if (!space) {
      res.status(404).json({ error: "Outpost not found" });
      return;
    }
    const results = await fetchSpaceQuotaWindows(db, spaceId, getActorInfo(req).actorId);
    res.json(results);
  });

  router.get("/spaces/:spaceId/budgets/overview", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const overview = await budgets.overview(spaceId);
    res.json(overview);
  });

  router.post(
    "/spaces/:spaceId/budgets/policies",
    validate(upsertBudgetPolicySchema),
    async (req, res) => {
      assertOperator(req);
      const spaceId = req.params.spaceId as string;
      assertSpaceAccess(req, spaceId);
      const summary = await budgets.upsertPolicy(spaceId, req.body, req.actor.userId ?? "operator");
      res.json(summary);
    },
  );

  router.post(
    "/spaces/:spaceId/budget-incidents/:incidentId/resolve",
    validate(resolveBudgetIncidentSchema),
    async (req, res) => {
      assertOperator(req);
      const spaceId = req.params.spaceId as string;
      const incidentId = req.params.incidentId as string;
      assertSpaceAccess(req, spaceId);
      const incident = await budgets.resolveIncident(spaceId, incidentId, req.body, req.actor.userId ?? "operator",
        req.actor.source ?? null);
      res.json(incident);
    },
  );

  router.get("/spaces/:spaceId/costs/by-project", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    if (!(await assertSpaceCostReadAllowed(req, res, spaceId))) return;
    const range = parseCostDateRange(req.query);
    const rows = await costs.byProject(spaceId, range);
    res.json(rows);
  });

  router.patch("/spaces/:spaceId/budgets", validate(updateBudgetSchema), async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    await budgets.upsertPolicy(
      spaceId,
      {
        scopeType: "space",
        scopeId: spaceId,
        amount: req.body.budgetMonthlyCents,
        isActive: req.body.budgetMonthlyCents > 0,
        windowKind: "calendar_month_utc",
      },
      req.actor.userId ?? "operator",
    );

    res.json(await spaces.getById(spaceId));
  });

  router.patch("/agents/:agentId/budgets", validate(updateBudgetSchema), async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await getAccessibleResource(req, res, agents.getById(agentId), "Agent not found");
    if (!agent) return;

    assertOperator(req);

    await budgets.upsertPolicy(
      agent.spaceId,
      {
        scopeType: "agent",
        scopeId: agent.id,
        amount: req.body.budgetMonthlyCents,
        isActive: req.body.budgetMonthlyCents > 0,
        windowKind: "calendar_month_utc",
      },
      req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
    );

    res.json(await agents.getById(agentId));
  });

  const integrity = accountingIntegrityService(db, budgetHooks);
  const billing = billingReconciliationService(db, budgetHooks);
  // Operational accounting evidence and repairs are operator-only. These payloads
  // can contain space-wide billing identifiers even for an agent's own run.
  router.use("/spaces/:spaceId/accounting", (req, _res, next) => {
    assertSpaceAccess(req, req.params.spaceId as string); assertOperator(req); next();
  });
  router.post("/spaces/:spaceId/accounting/provider-costs/import", (req, _res, next) => {
    // Unlike ledger inspection, this operation discloses a stored credential
    // to a provider. Ordinary space membership does not authorize that use.
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    const membership = req.actor.memberships?.find((item) => item.spaceId === spaceId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin
      && !(membership?.status === "active" && ["owner", "admin"].includes(String(membership.membershipRole)))) {
      throw forbidden("Outpost admin access required to import provider billing.");
    }
    next();
  }, validate(importProviderCostsSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    const result = await importProviderDailyCosts(db, spaceId, req.body, getActorInfo(req).actorId);
    res.json(result);
  });

  router.get("/spaces/:spaceId/accounting/health", async (req, res) => res.json(await integrity.health(req.params.spaceId as string)));
  router.get("/spaces/:spaceId/accounting/inspect", async (req, res) => res.json(await integrity.inspect(req.params.spaceId as string)));
  router.post("/spaces/:spaceId/accounting/repair", validate(repairAccountingSchema), async (req, res) =>
    res.json(await integrity.repair(req.params.spaceId as string, req.body.fingerprint, req.body.reason, getActorInfo(req).actorId)));
  router.post("/spaces/:spaceId/accounting/retry", validate(retryAccountingSchema), async (req, res) =>
    res.json(await integrity.retry(req.params.spaceId as string, req.body.runId, getActorInfo(req).actorId)));
  router.get("/spaces/:spaceId/accounting/invoices", async (req, res) => res.json(await billing.list(req.params.spaceId as string)));
  router.post("/spaces/:spaceId/accounting/invoices", validate(importBillingInvoiceSchema), async (req, res) =>
    res.status(201).json(await billing.importInvoice(req.params.spaceId as string, req.body, getActorInfo(req).actorId)));
  router.get("/spaces/:spaceId/accounting/invoices/:invoiceId", async (req, res) =>
    res.json(await billing.reconcile(req.params.spaceId as string, req.params.invoiceId as string)));
  router.get("/spaces/:spaceId/accounting/events/:eventId/adjustments", async (req, res) =>
    res.json(await billing.adjustments(req.params.spaceId as string, req.params.eventId as string)));
  router.post("/spaces/:spaceId/accounting/events/:eventId/adjustments", validate(adjustCostSchema), async (req, res) =>
    res.status(201).json(await billing.adjust(req.params.spaceId as string, req.params.eventId as string, req.body, getActorInfo(req).actorId)));

  return router;
}
