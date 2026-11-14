import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { agents, type Db } from "@outpost/db";
import { isUuidLike, updateAgentInteractionPermissionsSchema } from "@outpost/shared";
import { badRequest, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { readAgentInteractionPermissions, updateAgentInteractionPermissions } from "../services/agent-interaction-permissions.js";
import { assertAuthenticated, assertOperator, assertSpaceAccess, hasSpaceAccess } from "./authz.js";

export function agentInteractionPermissionRoutes(db: Db) {
  const router = Router();
  async function target(req: Request) {
    const id = req.params.id as string;
    if (!isUuidLike(id)) throw badRequest("Agent ID must be a UUID");
    const [agent] = await db.select({ id: agents.id, spaceId: agents.spaceId }).from(agents).where(eq(agents.id, id));
    if (!agent || !hasSpaceAccess(req, agent.spaceId)) throw notFound("Agent not found");
    assertSpaceAccess(req, agent.spaceId);
    return agent;
  }
  router.get("/agents/:id/interaction-permissions", async (req, res) => {
    assertAuthenticated(req);
    const agent = await target(req);
    res.json(await readAgentInteractionPermissions(db, req.actor, agent.spaceId, agent.id));
  });
  router.patch("/agents/:id/interaction-permissions", validate(updateAgentInteractionPermissionsSchema), async (req, res) => {
    assertAuthenticated(req);
    assertOperator(req);
    const agent = await target(req);
    res.json(await updateAgentInteractionPermissions(db, req.actor, agent.spaceId, agent.id, req.body));
  });
  return router;
}
