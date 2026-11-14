import { Router, type Request, type Response } from "express";
import type { Db } from "@outpost/db";
import { upsertSidebarOrderPreferenceSchema } from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import { logActivity, sidebarPreferenceService } from "../services/index.js";
import { assertOperator, assertSpaceAccess, getActorInfo } from "./authz.js";

function requireOperatorUserId(req: Request, res: Response): string | null {
  assertOperator(req);
  if (!req.actor.userId) {
    res.status(403).json({ error: "Operator user context required" });
    return null;
  }
  return req.actor.userId;
}

export function sidebarPreferenceRoutes(db: Db) {
  const router = Router();
  const svc = sidebarPreferenceService(db);

  router.get("/sidebar-preferences/me", async (req, res) => {
    const userId = requireOperatorUserId(req, res);
    if (!userId) return;
    res.json(await svc.getSpaceOrder(userId));
  });

  router.put("/sidebar-preferences/me", validate(upsertSidebarOrderPreferenceSchema), async (req, res) => {
    const userId = requireOperatorUserId(req, res);
    if (!userId) return;
    res.json(await svc.upsertSpaceOrder(userId, req.body.orderedIds));
  });

  router.get("/spaces/:spaceId/sidebar-preferences/me", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const userId = requireOperatorUserId(req, res);
    if (!userId) return;
    res.json(await svc.getProjectOrder(spaceId, userId));
  });

  router.put(
    "/spaces/:spaceId/sidebar-preferences/me",
    validate(upsertSidebarOrderPreferenceSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertSpaceAccess(req, spaceId);
      const userId = requireOperatorUserId(req, res);
      if (!userId) return;

      const result = await svc.upsertProjectOrder(spaceId, userId, req.body.orderedIds);
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "sidebar_preferences.project_order_updated",
        entityType: "space",
        entityId: spaceId,
        details: {
          userId,
          orderedIds: result.orderedIds,
        },
      });
      res.json(result);
    },
  );

  return router;
}
