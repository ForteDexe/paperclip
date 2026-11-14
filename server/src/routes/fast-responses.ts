import { Router } from "express";
import type { Db } from "@outpost/db";
import { updateFastResponseSchema } from "@outpost/shared";
import { assertOperator, assertSpaceAccess, getActorInfo } from "./authz.js";
import { canManageAiConnections } from "./ai-connections.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { fastResponseService } from "../services/fast-responses.js";
import { heartbeatService } from "../services/heartbeat.js";
import { listOpenRouterModels } from "../services/openrouter-models.js";
import { fastResponseCatalogModels } from "../services/fast-response-models.js";
import { parseCostDateRange, parseCostLimit } from "./costs.js";

export function fastResponseRoutes(db: Db) {
  const router = Router();
  const service = fastResponseService(db, {
    budgetHooks: {
      cancelWorkForScope: heartbeatService(db).cancelBudgetScopeWork,
    },
  });
  router.get("/spaces/:spaceId/fast-response", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    const canManage = await canManageAiConnections(db, req, spaceId);
    res.json(
      canManage
        ? {
            canManage,
            settings: await service.settings(spaceId),
            choices: await service.choices(
              spaceId,
              getActorInfo(req).actorId,
            ),
          }
        : { canManage, settings: null, choices: [] },
    );
  });
  router.put("/spaces/:spaceId/fast-response", validate(updateFastResponseSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden();
    res.json(
      await service.configure(spaceId, getActorInfo(req).actorId, req.body),
    );
  });
  router.get("/spaces/:spaceId/fast-response/models", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden();
    const choices = await service.choices(spaceId, getActorInfo(req).actorId);
    const connection = choices.find((c) => c.id === req.query.connectionId);
    if (!connection) throw forbidden();
    const models =
      connection.provider === "openrouter" ||
      connection.routing?.kind === "openrouter"
        ? (await listOpenRouterModels()).map((m) => ({
            ...m,
            id: m.id.replace(/^openrouter\//, ""),
          }))
        : fastResponseCatalogModels(connection);
    res.json(models);
  });
  router.get("/spaces/:spaceId/fast-response/availability", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    res.json(await service.availability(spaceId, getActorInfo(req).actorId));
  });
  router.post("/spaces/:spaceId/fast-response/test", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    if (!(await canManageAiConnections(db, req, spaceId))) throw forbidden();
    res.json(await service.test(spaceId, getActorInfo(req).actorId));
  });
  router.get("/spaces/:spaceId/fast-response/history", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(
      await service.history(spaceId, req.actor, {
        ...parseCostDateRange(req.query),
        limit: parseCostLimit(req.query),
      }),
    );
  });
  return router;
}
