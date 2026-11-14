import { Router } from "express";
import type { Db } from "@outpost/db";
import {
  createFolderSchema,
  ensureMySkillFolderSchema,
  folderKindSchema,
  moveFolderItemSchema,
  moveFolderSchema,
  updateFolderSchema,
} from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden } from "../errors.js";
import { folderService, logActivity } from "../services/index.js";
import { assertSpaceAccess, getActorInfo } from "./authz.js";

export function folderRoutes(db: Db) {
  const router = Router();
  const svc = folderService(db);

  function parseKind(value: unknown) {
    const result = folderKindSchema.safeParse(value);
    if (!result.success) throw badRequest("Folder kind query parameter is required");
    return result.data;
  }

  router.get("/spaces/:spaceId/folders", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.list(spaceId, parseKind(req.query.kind)));
  });

  router.post("/spaces/:spaceId/folders", validate(createFolderSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const created = await svc.create(spaceId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "folder.created",
      entityType: "folder",
      entityId: created.id,
      details: { kind: created.kind, name: created.name, path: created.path, parentId: created.parentId, position: created.position },
    });
    res.status(201).json(created);
  });

  router.post(
    "/spaces/:spaceId/folders/ensure-my",
    validate(ensureMySkillFolderSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertSpaceAccess(req, spaceId);
      if (req.actor.type !== "operator" || !req.actor.userId) {
        throw forbidden("A signed-in operator user is required to create a personal skill folder");
      }
      const folder = await svc.ensureMyFolder(spaceId, req.actor.userId, req.actor.userName ?? null, req.body.slug);
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "folder.personal_ensured",
        entityType: "folder",
        entityId: folder.id,
        details: { path: folder.path, systemKey: folder.systemKey },
      });
      res.json(folder);
    },
  );

  router.patch("/spaces/:spaceId/folders/:folderId", validate(updateFolderSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const folderId = req.params.folderId as string;
    assertSpaceAccess(req, spaceId);
    const updated = await svc.update(spaceId, folderId, req.body);
    if (!updated) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "folder.updated",
      entityType: "folder",
      entityId: updated.id,
      details: { kind: updated.kind, name: updated.name, path: updated.path, position: updated.position },
    });
    res.json(updated);
  });

  router.post("/spaces/:spaceId/folders/items/move", validate(moveFolderItemSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const moved = await svc.moveItem(spaceId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "folder.item_moved",
      entityType: req.body.kind === "routine" ? "routine" : "space_skill",
      entityId: moved.itemId,
      details: { kind: moved.kind, folderId: moved.folderId },
    });
    res.json(moved);
  });

  router.post("/spaces/:spaceId/folders/:folderId/move", validate(moveFolderSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const folderId = req.params.folderId as string;
    assertSpaceAccess(req, spaceId);
    const updated = await svc.moveFolder(spaceId, folderId, req.body);
    if (!updated) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "folder.moved",
      entityType: "folder",
      entityId: updated.id,
      details: { kind: updated.kind, parentId: updated.parentId, path: updated.path, position: updated.position },
    });
    res.json(updated);
  });

  router.delete("/spaces/:spaceId/folders/:folderId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const folderId = req.params.folderId as string;
    assertSpaceAccess(req, spaceId);
    const deleted = await svc.deleteFolder(spaceId, folderId);
    if (!deleted) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "folder.deleted",
      entityType: "folder",
      entityId: deleted.id,
      details: { kind: deleted.kind, name: deleted.name },
    });
    res.json({ deleted });
  });

  return router;
}
