import { Router, type Request, type Response } from "express";
import type { Db } from "@outpost/db";
import {
  updateDocumentResourceMembershipSchema,
  updateResourceMembershipSchema,
} from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import { getActorInfo } from "./authz.js";
import { logActivity, resourceMembershipService } from "../services/index.js";

function requireOperatorUserId(req: Request, res: Response): string | null {
  if (req.actor.type !== "operator" || !req.actor.userId) {
    res.status(403).json({ error: "Operator user access required" });
    return null;
  }
  return req.actor.userId;
}

async function logMembershipChange(
  db: Db,
  req: Request,
  input: {
    spaceId: string;
    userId: string;
    resourceType: "project" | "agent" | "document";
    resourceId: string;
    state: "joined" | "left";
    starredAt: Date | null;
    changeKind: "joined" | "left" | "starred" | "unstarred";
    policySource: string;
  },
) {
  const actor = getActorInfo(req);
  await logActivity(db, {
    spaceId: input.spaceId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    agentApiKeyId: actor.agentApiKeyId,
    action: `resource_membership.${input.changeKind}`,
    entityType: input.resourceType,
    entityId: input.resourceId,
    details: {
      userId: input.userId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      state: input.state,
      starredAt: input.starredAt,
      starred: input.starredAt !== null,
      policySource: input.policySource,
    },
  });
}

export function resourceMembershipRoutes(db: Db) {
  const router = Router();
  const svc = resourceMembershipService(db);

  router.get("/spaces/:spaceId/resource-memberships/me", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const userId = requireOperatorUserId(req, res);
    if (!userId) return;
    res.json(await svc.listForUser(spaceId, userId, req.actor));
  });

  router.put(
    "/spaces/:spaceId/resource-memberships/me/projects/:projectId",
    validate(updateResourceMembershipSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const projectId = req.params.projectId as string;
      const userId = requireOperatorUserId(req, res);
      if (!userId) return;
      const result = await svc.updateProject({
        spaceId,
        projectId,
        userId,
        state: req.body.state,
        starred: req.body.starred,
        actor: req.actor,
      });
      if (result.changed && result.changeKind) {
        await logMembershipChange(db, req, {
          spaceId,
          userId,
          resourceType: "project",
          resourceId: projectId,
          state: result.state,
          starredAt: result.starredAt,
          changeKind: result.changeKind,
          policySource: result.policySource,
        });
      }
      const { changed: _changed, changeKind: _changeKind, policySource: _policySource, ...response } = result;
      res.json(response);
    },
  );

  router.put(
    "/spaces/:spaceId/resource-memberships/me/agents/:agentId",
    validate(updateResourceMembershipSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const agentId = req.params.agentId as string;
      const userId = requireOperatorUserId(req, res);
      if (!userId) return;
      const result = await svc.updateAgent({
        spaceId,
        agentId,
        userId,
        state: req.body.state,
        starred: req.body.starred,
        actor: req.actor,
      });
      if (result.changed && result.changeKind) {
        await logMembershipChange(db, req, {
          spaceId,
          userId,
          resourceType: "agent",
          resourceId: agentId,
          state: result.state,
          starredAt: result.starredAt,
          changeKind: result.changeKind,
          policySource: result.policySource,
        });
      }
      const { changed: _changed, changeKind: _changeKind, policySource: _policySource, ...response } = result;
      res.json(response);
    },
  );

  router.put(
    "/spaces/:spaceId/resource-memberships/me/documents/:documentId",
    validate(updateDocumentResourceMembershipSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const documentId = req.params.documentId as string;
      const userId = requireOperatorUserId(req, res);
      if (!userId) return;
      const result = await svc.updateDocument({
        spaceId,
        documentId,
        userId,
        starred: req.body.starred,
        actor: req.actor,
      });
      if (result.changed && result.changeKind) {
        await logMembershipChange(db, req, {
          spaceId,
          userId,
          resourceType: "document",
          resourceId: documentId,
          state: result.state,
          starredAt: result.starredAt,
          changeKind: result.changeKind,
          policySource: result.policySource,
        });
      }
      const { changed: _changed, changeKind: _changeKind, policySource: _policySource, ...response } = result;
      res.json(response);
    },
  );

  return router;
}
