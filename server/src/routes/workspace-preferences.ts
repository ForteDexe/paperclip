import { Router } from "express";
import { spaces, type Db } from "@outpost/db";
import { eq } from "drizzle-orm";
import { updateWorkspacePreferenceSchema } from "@outpost/shared";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { workspacePreferenceService } from "../services/workspace-preferences.js";
import { assertOperator, hasSpaceAccess } from "./authz.js";

export function workspacePreferenceRoutes(db: Db) {
  const router = Router();
  const svc = workspacePreferenceService(db);
  const paths = ["/workspace-preferences/me", "/spaces/:spaceId/workspace-preferences/me"];
  router.use(paths, (req, res, next) => {
    assertOperator(req);
    if (!req.actor.userId) throw forbidden("Operator user access required");
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.get("/workspace-preferences/me", async (req, res) => {
    res.json(await svc.get(req.actor.userId!));
  });
  router.put("/spaces/:spaceId/workspace-preferences/me", validate(updateWorkspacePreferenceSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    // The space supplies authorized audit context, not ownership of this
    // personal setting. Viewers may change their own interface too.
    if (!hasSpaceAccess(req, spaceId)) throw forbidden("User does not have access to this space");
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin
      && !req.actor.memberships?.some(member => member.spaceId === spaceId && member.status === "active")) {
      throw forbidden("User does not have active space access");
    }
    if (!await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) })) throw notFound("Outpost not found");
    res.json(await svc.set(spaceId, req.actor.userId!, {
      coordinatorWorkspaceEnabled: req.body.coordinatorWorkspaceEnabled,
      timeZone: req.body.timeZone,
    }));
  });
  return router;
}
