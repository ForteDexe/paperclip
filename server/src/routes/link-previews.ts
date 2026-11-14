import { Router } from "express";
import type { Db } from "@outpost/db";
import { badRequest } from "../errors.js";
import { assertOperator, assertSpaceAccess } from "./authz.js";
import { createLinkPreviewService } from "../services/link-previews.js";
import { createGitHubLinkPreviewProvider } from "../services/github-link-preview.js";

export function linkPreviewRoutes(db: Db, service = createLinkPreviewService([createGitHubLinkPreviewProvider(db)])) {
  const router = Router();
  router.get("/spaces/:spaceId/link-preview", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    const href = req.query.url;
    if (typeof href !== "string" || href.length > 2048) throw badRequest("A link URL is required");
    // Personal repository metadata must never be stored by a proxy or shared browser cache.
    res.set("Cache-Control", "private, no-store");
    res.json(await service.get({ spaceId, userId: req.actor.userId ?? null }, href));
  });
  return router;
}
