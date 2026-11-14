import type { Router } from "express";
import { agents, type Db } from "@outpost/db";
import { eq } from "drizzle-orm";
import { addAgentProjectAccessSchema } from "@outpost/shared";
import { notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { addAgentProjectAccess, readAgentProjectAccess } from "../services/agent-project-access.js";
import { assertOperator, assertSpaceAccess, hasSpaceAccess } from "./authz.js";

export function registerAgentProjectAccessRoutes(router: Router, db: Db) {
  router.get("/agents/:id/project-access", async (req, res) => {
    assertOperator(req);
    const [agent] = await db.select({ id: agents.id, spaceId: agents.spaceId }).from(agents).where(eq(agents.id, req.params.id as string));
    if (!agent || !hasSpaceAccess(req, agent.spaceId)) throw notFound("Agent not found");
    assertSpaceAccess(req, agent.spaceId);
    res.json(await readAgentProjectAccess(db, req.actor, agent.spaceId, agent.id));
  });
  router.post("/agents/:id/project-access", validate(addAgentProjectAccessSchema), async (req, res) => {
    assertOperator(req);
    const [agent] = await db.select({ id: agents.id, spaceId: agents.spaceId }).from(agents).where(eq(agents.id, req.params.id as string));
    if (!agent || !hasSpaceAccess(req, agent.spaceId)) throw notFound("Agent not found");
    assertSpaceAccess(req, agent.spaceId);
    res.json(await addAgentProjectAccess(db, req.actor, agent.spaceId, agent.id, req.body.projectIds));
  });
}
