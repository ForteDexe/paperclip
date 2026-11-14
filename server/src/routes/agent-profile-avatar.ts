import { Router } from "express";
import type { Db } from "@outpost/db";
import { setAgentAvatarSchema } from "@outpost/shared";
import { z } from "zod";
import type { StorageService } from "../storage/types.js";
import { forbidden } from "../errors.js";
import { assertSpaceAccess, getActorInfo } from "./authz.js";
import { accessService } from "../services/access.js";
import { setAgentProfileAvatar } from "../services/agent-profile-avatar.js";

export function agentProfileAvatarRoutes(db: Db, storage: StorageService) {
  const router = Router();
  router.put("/spaces/:spaceId/agents/:agentId/avatar", async (req, res) => {
    const spaceId = z.uuid().parse(req.params.spaceId);
    const agentId = z.uuid().parse(req.params.agentId);
    assertSpaceAccess(req, spaceId);
    if (req.actor.type === "agent") {
      if (req.actor.keyScope?.kind === "task_bridge" || req.actor.keyScope?.kind === "skill_test") {
        throw forbidden("Task-scoped credentials cannot update agent profiles");
      }
      if (req.actor.agentId !== agentId) throw forbidden("Agents can update only their own avatar");
    } else if (req.actor.type !== "operator" || req.actor.memberships?.find(m => m.spaceId === spaceId)?.membershipRole === "viewer") {
      throw forbidden("Operator or agent access required");
    }
    if (req.actor.type === "operator") {
      const decision = await accessService(db).decide({
        actor: req.actor, action: "agent_config:update",
        resource: { type: "agent", spaceId, agentId },
      });
      if (!decision.allowed) throw forbidden(decision.explanation);
    }
    const actor = getActorInfo(req);
    res.json(await setAgentProfileAvatar(db, storage, spaceId, agentId, setAgentAvatarSchema.parse(req.body), actor));
  });
  return router;
}
