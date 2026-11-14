import { Router } from "express";
import { agents, spaces, type Db } from "@outpost/db";
import { and, eq } from "drizzle-orm";
import { updatePrimaryAgentSchema } from "@outpost/shared";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/access.js";
import { primaryAgentService } from "../services/primary-agent.js";
import { assertOperator, hasSpaceAccess } from "./authz.js";

export function primaryAgentRoutes(db: Db) {
  const router = Router();
  const svc = primaryAgentService(db);
  const access = accessService(db);
  router.use("/spaces/:spaceId/primary-agent/me", async (req, _res, next) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    if (!hasSpaceAccess(req, spaceId)) throw forbidden("User does not have access to this space");
    if (!req.actor.userId) throw forbidden("Operator user access required");
    // Keep the legacy /me path for client compatibility. The selected agent
    // is now Space-wide, so only active members may read it and mutation is
    // separately authorized through agents:configure below.
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin
      && !req.actor.memberships?.some(membership => membership.spaceId === spaceId && membership.status === "active")) {
      throw forbidden("User does not have active space access");
    }
    if (!await db.query.spaces.findFirst({ where: eq(spaces.id, req.params.spaceId as string) })) {
      throw notFound("Outpost not found");
    }
    next();
  });
  router.get("/spaces/:spaceId/primary-agent/me", async (req, res) => {
    const preference = await svc.get(req.params.spaceId as string, req.actor.userId!);
    if (preference.primaryAgentId) {
      const decision = await access.decide({ actor: req.actor, action: "agent:read",
        resource: { type: "agent", spaceId: preference.spaceId, agentId: preference.primaryAgentId } });
      if (!decision.allowed) preference.primaryAgentId = null;
    }
    res.json(preference);
  });
  router.put("/spaces/:spaceId/primary-agent/me", validate(updatePrimaryAgentSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const agentId = req.body.primaryAgentId as string;
    const agent = await db.query.agents.findFirst({ where: and(eq(agents.spaceId, spaceId), eq(agents.id, agentId)) });
    if (!agent) throw notFound("Agent not found");
    const decision = await access.decide({ actor: req.actor, action: "agent_config:update",
      resource: { type: "agent", spaceId, agentId }, scope: { targetAgentId: agentId } });
    if (!decision.allowed) throw forbidden("Missing agents:configure permission for this agent");
    res.json(await svc.set(spaceId, req.actor.userId!, agentId, req.actor));
  });
  return router;
}
