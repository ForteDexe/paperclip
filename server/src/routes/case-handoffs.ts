import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@outpost/db";
import { handoffCaseSchema } from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import { notFound } from "../errors.js";
import { caseHandoffService } from "../services/case-handoffs.js";
import { assertSpaceAccess, hasSpaceAccess } from "./authz.js";

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), before: z.iso.datetime().optional(), cursor: z.string().max(400).optional() });

export function caseHandoffRoutes(db: Db) {
  const router = Router();
  const service = caseHandoffService(db);
  router.post("/spaces/:spaceId/case-handoffs", validate(handoffCaseSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await service.handoff(spaceId, req.actor, req.body);
    res.status(result.replayed ? 200 : 202).json(result);
  });
  router.get("/cases/:caseId/handoffs", async (req, res) => {
    const caseId = req.params.caseId as string;
    const row = await service.visible(req.actor, caseId);
    if (!hasSpaceAccess(req, row.spaceId)) throw notFound("Case not found");
    assertSpaceAccess(req, row.spaceId);
    res.json(await service.list(req.actor, caseId, listSchema.parse(req.query)));
  });
  const control = (action: "retry" | "cancel") => async (req: Request, res: Response) => {
      const caseId = req.params.caseId as string;
      const row = await service.visible(req.actor, caseId);
      if (!hasSpaceAccess(req, row.spaceId)) throw notFound("Case not found");
      assertSpaceAccess(req, row.spaceId);
      res.json(await service[action](req.actor, caseId, req.params.handoffId as string));
    };
  router.post("/cases/:caseId/handoffs/:handoffId/retry", control("retry"));
  router.post("/cases/:caseId/handoffs/:handoffId/cancel", control("cancel"));
  return router;
}
