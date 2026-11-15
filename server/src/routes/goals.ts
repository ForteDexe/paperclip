import { Router } from "express";
import type { Db } from "@outpost/db";
import { createGoalSchema, updateGoalSchema } from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import { goalService, logActivity } from "../services/index.js";
import { assertSpaceAccess, getAccessibleResource, getActorInfo } from "./authz.js";

export function goalRoutes(db: Db) {
  const router = Router();
  const svc = goalService(db);

  router.get("/spaces/:spaceId/goals", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.list(spaceId);
    res.json(result);
  });

  router.get("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const goal = await getAccessibleResource(req, res, svc.getById(id), "North Star not found");
    if (!goal) return;
    res.json(goal);
  });

  router.post("/spaces/:spaceId/goals", validate(createGoalSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const goal = await svc.create(spaceId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.created",
      entityType: "goal",
      entityId: goal.id,
      details: { title: goal.title },
    });
    res.status(201).json(goal);
  });

  router.patch("/goals/:id", validate(updateGoalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await getAccessibleResource(req, res, svc.getById(id), "North Star not found");
    if (!existing) return;
    const goal = await svc.update(id, req.body);
    if (!goal) {
      res.status(404).json({ error: "North Star not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId: goal.spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.updated",
      entityType: "goal",
      entityId: goal.id,
      details: req.body,
    });

    res.json(goal);
  });

  router.delete("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await getAccessibleResource(req, res, svc.getById(id), "North Star not found");
    if (!existing) return;
    const goal = await svc.remove(id);
    if (!goal) {
      res.status(404).json({ error: "North Star not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId: goal.spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.deleted",
      entityType: "goal",
      entityId: goal.id,
    });

    res.json(goal);
  });

  return router;
}
