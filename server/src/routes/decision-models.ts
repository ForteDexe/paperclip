import { Router } from "express";
import type { Db } from "@outpost/db";
import { DECISION_TEST_REQUEST, updateDecisionModelSchema } from "@outpost/shared";
import { assertOperator, assertSpaceAccess, getActorInfo } from "./authz.js";
import { canManageAiConnections } from "./ai-connections.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { decisionModelService, settingsDecisionTest } from "../services/decision-models.js";
import { heartbeatService } from "../services/heartbeat.js";
import { parseCostDateRange, parseCostLimit } from "./costs.js";

export function decisionModelRoutes(db: Db) {
  const router = Router();
  const service = decisionModelService(db, { budgetHooks: { cancelWorkForScope: heartbeatService(db).cancelBudgetScopeWork } });
  router.get("/spaces/:spaceId/decision-model", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId); assertOperator(req);
    const canManage = await canManageAiConnections(db, req, spaceId);
    if (!canManage) { res.json({ canManage, settings: null, choices: [] }); return; }
    res.json({ canManage, settings: await service.settings(spaceId), choices: await service.choices(spaceId, getActorInfo(req).actorId) });
  });
  router.put("/spaces/:spaceId/decision-model", validate(updateDecisionModelSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId); assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden("Manage connections permission is required");
    res.json(await service.configure(spaceId, getActorInfo(req).actorId, req.body));
  });
  router.get("/spaces/:spaceId/decision-model/availability", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await service.availability({ spaceId, actor: req.actor, feature: settingsDecisionTest }));
  });
  router.post("/spaces/:spaceId/decision-model/test", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId); assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden("Manage connections permission is required");
    // The client cannot supply a prompt, model, identity, or background flag.
    res.json(await service.decide({ spaceId, actor: req.actor, feature: settingsDecisionTest }, DECISION_TEST_REQUEST));
  });
  router.get("/spaces/:spaceId/decision-model/history", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await service.history(spaceId, req.actor, { ...parseCostDateRange(req.query), limit: parseCostLimit(req.query) }));
  });
  return router;
}
