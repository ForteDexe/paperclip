import { Router } from "express";
import { z } from "zod";
import type { Db } from "@outpost/db";
import { updatePromptInjectionPreventionSchema } from "@outpost/shared";
import { assertOperator, assertSpaceAccess, getActorInfo } from "./authz.js";
import { canManageAiConnections } from "./ai-connections.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { promptInjectionPreventionService } from "../services/prompt-injection-prevention.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { heartbeatService } from "../services/heartbeat.js";
import { listOpenRouterModels } from "../services/openrouter-models.js";

export function promptInjectionPreventionRoutes(db: Db) {
  const router = Router();
  const service = promptInjectionPreventionService(db, { budgetHooks: { cancelWorkForScope: heartbeatService(db).cancelBudgetScopeWork } });
  router.get("/spaces/:spaceId/prompt-injection-prevention", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId); assertOperator(req);
    const canManage = await canManageAiConnections(db, req, spaceId);
    res.json(canManage ? { canManage, settings: await service.settings(spaceId), choices: await service.choices(spaceId, getActorInfo(req).actorId) }
      : { canManage, settings: null, choices: [] });
  });
  router.put("/spaces/:spaceId/prompt-injection-prevention", validate(updatePromptInjectionPreventionSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId); assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden();
    res.json(await service.configure(spaceId, getActorInfo(req).actorId, req.body));
  });
  router.get("/spaces/:spaceId/prompt-injection-prevention/models", async (req, res) => {
    const spaceId = req.params.spaceId as string, userId = getActorInfo(req).actorId;
    assertSpaceAccess(req, spaceId); assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden();
    const choice = (await service.choices(spaceId, userId)).find(c => c.id === req.query.connectionId);
    if (!choice) throw forbidden();
    await aiConnectionService(db).selectPromptInjectionPrevention({ spaceId, userId, connectionId: choice.id, grantId: choice.grantId });
    res.json((await listOpenRouterModels()).map(m => ({ ...m, id: m.id.replace(/^openrouter\//, "") })));
  });
  router.post("/spaces/:spaceId/prompt-injection-prevention/test", validate(z.object({}).strict()), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId); assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden();
    res.json(await service.test(spaceId, getActorInfo(req).actorId));
  });
  return router;
}
