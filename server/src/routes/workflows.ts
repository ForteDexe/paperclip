import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { workflows, type Db } from "@outpost/db";
import { createWorkflowSchema, updateWorkflowSchema, listWorkflowsSchema, readWorkflowQuerySchema } from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import { notFound } from "../errors.js";
import { assertSpaceAccess, hasSpaceAccess } from "./authz.js";
import { requireCasesEnabled, workflowService } from "../services/workflows.js";

export function workflowRoutes(db: Db) {
  const router = Router();
  const service = workflowService(db);
  router.get("/spaces/:spaceId/workflows", async (req, res) => {
    await requireCasesEnabled(db);
    const spaceId = z.string().guid().parse(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    res.json(await service.list(spaceId, listWorkflowsSchema.parse(req.query)));
  });
  router.post("/spaces/:spaceId/workflows", validate(createWorkflowSchema), async (req, res) => {
    await requireCasesEnabled(db);
    const spaceId = z.string().guid().parse(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    const { prompt: _prompt, ...metadata } = await service.write(spaceId, req.actor, req.body);
    res.status(201).json(metadata);
  });
  router.all("/workflows/:id", async (req, res, next) => {
    await requireCasesEnabled(db);
    const id = z.string().guid().parse(req.params.id);
    const [row] = await db.select({ spaceId: workflows.spaceId }).from(workflows).where(eq(workflows.id, id));
    if (!row || !hasSpaceAccess(req, row.spaceId)) throw notFound("Workflow not found");
    assertSpaceAccess(req, row.spaceId);
    res.locals.workflowSpaceId = row.spaceId;
    next();
  });
  router.get("/workflows/:id", async (req, res) => {
    const query = readWorkflowQuerySchema.parse(req.query);
    const { workflow, snapshot } = await service.read(res.locals.workflowSpaceId, req.params.id as string, query.snapshot);
    res.set("ETag", `"${snapshot}"`).json(workflow);
  });
  router.patch("/workflows/:id", validate(updateWorkflowSchema), async (req, res) => {
    const { prompt: _prompt, ...metadata } = await service.write(res.locals.workflowSpaceId, req.actor, req.body, req.params.id as string);
    res.json(metadata);
  });
  return router;
}
