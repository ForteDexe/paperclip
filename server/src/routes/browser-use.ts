import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { issues, type Db } from "@outpost/db";
import {
  browserUseControlSchema,
  browserUseSettingsSchema,
  browserUseViewportSchema,
  browserUseViewerSchema,
} from "@outpost/shared";
import {
  assertOperator,
  assertSpaceAccess,
  getActorInfo,
  getAccessibleResource,
} from "./authz.js";
import { browserUseService } from "../services/browser-use.js";

const issueIdSchema = z.string().uuid();

export function browserUseRoutes(db: Db, service = browserUseService(db)) {
  const router = Router();
  router.use("/issues/:issueId/browsers", async (req, res, next) => {
    assertOperator(req);
    if (
      req.params.issueId !== req.params.issueId.trim() ||
      !issueIdSchema.safeParse(req.params.issueId).success
    ) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const [issue] = await db
      .select({ spaceId: issues.spaceId })
      .from(issues)
      .where(eq(issues.id, req.params.issueId))
      .limit(1);
    if (!(await getAccessibleResource(req, res, issue, "Task not found")))
      return;
    res.locals.browserSpaceId = issue.spaceId;
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/issues/:issueId/browsers", async (req, res) => {
    res.json(
      await service.list(
        res.locals.browserSpaceId,
        req.params.issueId,
        getActorInfo(req).actorId,
      ),
    );
  });
  router.get(
    "/issues/:issueId/browsers/:browserId/viewer",
    async (req, res) => {
      res.setHeader("Referrer-Policy", "no-referrer");
      res.json(
        await service.viewer(
          res.locals.browserSpaceId,
          req.params.issueId,
          req.params.browserId,
          getActorInfo(req).actorId,
          req.query.viewerId === undefined
            ? undefined
            : browserUseViewerSchema.parse({ viewerId: req.query.viewerId })
                .viewerId,
        ),
      );
    },
  );
  router.post(
    "/issues/:issueId/browsers/:browserId/presence",
    async (req, res) => {
      res.json(
        await service.presence(
          res.locals.browserSpaceId,
          req.params.issueId,
          req.params.browserId,
          getActorInfo(req).actorId,
        ),
      );
    },
  );
  router.post(
    "/issues/:issueId/browsers/:browserId/viewport",
    async (req, res) => {
      const viewport = browserUseViewportSchema.parse(req.body);
      res.json(
        await service.resize(
          res.locals.browserSpaceId,
          req.params.issueId,
          req.params.browserId,
          getActorInfo(req).actorId,
          viewport,
        ),
      );
    },
  );
  router.post(
    "/issues/:issueId/browsers/:browserId/viewport/release",
    async (req, res) => {
      const { viewerId } = browserUseViewerSchema.parse(req.body);
      res.json(
        await service.releaseViewport(
          res.locals.browserSpaceId,
          req.params.issueId,
          req.params.browserId,
          getActorInfo(req).actorId,
          viewerId,
        ),
      );
    },
  );
  router.post(
    "/issues/:issueId/browsers/:browserId/control",
    async (req, res) => {
      const { action } = browserUseControlSchema.parse(req.body);
      const { s } = await service.humanSession(
        res.locals.browserSpaceId,
        req.params.issueId,
        req.params.browserId,
        getActorInfo(req).actorId,
      );
      await service.control(s, action, getActorInfo(req).actorId);
      res.json({ accepted: true });
    },
  );
  router.get(
    "/spaces/:spaceId/browser-use-cloud/grants/:grantId/profiles",
    async (req, res) => {
      assertOperator(req);
      assertSpaceAccess(req, req.params.spaceId);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await service.availableProfiles(
          req.params.spaceId,
          req.params.grantId,
          getActorInfo(req).actorId,
        ),
      );
    },
  );
  router.get(
    "/spaces/:spaceId/browser-use-cloud/grants/:grantId/settings",
    async (req, res) => {
      assertOperator(req);
      assertSpaceAccess(req, req.params.spaceId);
      await service.humanGrant(
        req.params.spaceId,
        req.params.grantId,
        getActorInfo(req).actorId,
      );
      res.json(
        await service.getSettings(req.params.spaceId, req.params.grantId),
      );
    },
  );
  router.put(
    "/spaces/:spaceId/browser-use-cloud/grants/:grantId/settings",
    async (req, res) => {
      assertOperator(req);
      assertSpaceAccess(req, req.params.spaceId);
      res.json(
        await service.saveSettings(
          req.params.spaceId,
          req.params.grantId,
          getActorInfo(req).actorId,
          browserUseSettingsSchema.parse(req.body),
        ),
      );
    },
  );
  return router;
}
