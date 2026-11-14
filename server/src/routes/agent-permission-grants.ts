import { Router } from "express";
import { agents, spaceMemberships, principalPermissionGrants, type Db } from "@outpost/db";
import { updateAgentPermissionGrantSchema, isUuidLike } from "@outpost/shared";
import { and, eq } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/access.js";
import { logActivity, publishActivity, type ActivityPublication } from "../services/activity-log.js";
import { assertAuthenticated, assertOperator, assertSpaceAccess, hasSpaceAccess } from "./authz.js";

export function agentPermissionGrantRoutes(db: Db) {
  const router = Router();

  router.patch("/agents/:id/permission-grants", validate(updateAgentPermissionGrantSchema), async (req, res) => {
    assertAuthenticated(req);
    assertOperator(req);
    const id = req.params.id as string;
    if (!isUuidLike(id)) throw badRequest("Agent ID must be a UUID");
    const { permissionKey, enabled } = req.body;
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async (tx) => {
      const agent = await tx.select({ id: agents.id, spaceId: agents.spaceId, status: agents.status })
        .from(agents).where(eq(agents.id, id)).for("update").then(rows => rows[0]);
      if (!agent || !hasSpaceAccess(req, agent.spaceId)) throw notFound("Agent not found");
      assertSpaceAccess(req, agent.spaceId);
      const txDb = tx as unknown as Db;
      const access = accessService(txDb);
      if (req.actor.source !== "local_implicit"
        && !await access.canUser(agent.spaceId, req.actor.userId, "users:manage_permissions")) {
        throw forbidden("Missing permission: users:manage_permissions");
      }
      if (enabled) {
        if (agent.status === "pending_approval" || agent.status === "terminated") {
          throw conflict("Cannot grant permissions to an unapproved or terminated agent");
        }
        const membership = await tx.select().from(spaceMemberships).where(and(
          eq(spaceMemberships.spaceId, agent.spaceId),
          eq(spaceMemberships.principalType, "agent"),
          eq(spaceMemberships.principalId, agent.id),
        )).for("update").then(rows => rows[0]);
        if (!membership || membership.status !== "active") {
          throw conflict("Agent space membership is not active");
        }
        await tx.insert(principalPermissionGrants).values({
          spaceId: agent.spaceId, principalType: "agent", principalId: agent.id,
          permissionKey, scope: null, grantedByUserId: req.actor.userId ?? null,
        }).onConflictDoUpdate({
          target: [principalPermissionGrants.spaceId, principalPermissionGrants.principalType,
            principalPermissionGrants.principalId, principalPermissionGrants.permissionKey],
          set: { scope: null, grantedByUserId: req.actor.userId ?? null, updatedAt: new Date() },
        });
      } else {
        await tx.delete(principalPermissionGrants).where(and(
          eq(principalPermissionGrants.spaceId, agent.spaceId),
          eq(principalPermissionGrants.principalType, "agent"),
          eq(principalPermissionGrants.principalId, agent.id),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ));
      }
      await logActivity(txDb, {
        spaceId: agent.spaceId, actorType: "user", actorId: req.actor.userId ?? "operator",
        action: "agent.permission_grant_updated", entityType: "agent", entityId: agent.id,
        details: { permissionKey, enabled },
      }, publications);
      return { agentId: agent.id, spaceId: agent.spaceId, permissionKey, enabled };
    });
    for (const publication of publications) publishActivity(publication);
    res.json(result);
  });

  return router;
}
