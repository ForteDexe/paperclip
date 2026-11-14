import { slackCapabilities } from "../services/connectors/slack-capabilities.js";
import { slackSearchOAuthService } from "../services/connectors/slack-search-oauth.js";
import { accessService } from "../services/access.js";
import { assertOperator } from "./authz.js";
import type { Request } from "express";
import { Router } from "express";
import { spaces, type Db } from "@outpost/db";
import { eq } from "drizzle-orm";
import { instanceSettingsService } from "../services/instance-settings.js";
import { slackToolCallSchema, isUuidLike } from "@outpost/shared";
import { badRequest, forbidden } from "../errors.js";
import { assertSpaceAccess } from "./authz.js";
import { executeConnectorTool } from "../services/connector-runtime.js";

export function slackToolRoutes(db: Db, publicBaseUrl?: string) {
  const router = Router();
  const oauth = slackSearchOAuthService(db, publicBaseUrl);
  router.use(
    ["/slack/search", "/spaces/:spaceId/slack"],
    async (req, _res, next) => {
      if (
        !(await instanceSettingsService(db).getExperimental())
          .enableChatConnectors
      )
        throw forbidden("Chat connectors are disabled");
      next();
    },
  );
  function user(req: Request) {
    assertOperator(req);
    if (!req.actor.userId)
      throw forbidden("Sign in before connecting Slack search");
    return req.actor.userId;
  }
  router.param("endpointId", (_req, _res, next, id) => {
    if (!isUuidLike(id)) throw badRequest("Invalid Slack endpoint");
    next();
  });
  router.param("spaceId", (_req, _res, next, id) => {
    if (!isUuidLike(id)) throw badRequest("Invalid space");
    next();
  });
  router.get("/slack/search/callback", async (req, res) => {
    const userId = user(req);
    if (
      typeof req.query.state !== "string" ||
      typeof req.query.code !== "string"
    )
      throw badRequest("Slack authorization was cancelled or incomplete");
    const result = await oauth.complete(
      req.query.state,
      req.query.code,
      userId,
    );
    const [space] = await db
      .select({ prefix: spaces.issuePrefix })
      .from(spaces)
      .where(eq(spaces.id, result.spaceId));
    res.redirect(
      `/${encodeURIComponent(space.prefix)}/apps/chat/${result.endpointId}/access`,
    );
  });
  router.get(
    "/spaces/:spaceId/slack/endpoints/:endpointId/capabilities",
    async (req, res) => {
      assertOperator(req);
      const spaceId = String(req.params.spaceId);
      assertSpaceAccess(req, spaceId);
      res
        .set("Cache-Control", "no-store")
        .json(
          await slackCapabilities(db, spaceId, String(req.params.endpointId)),
        );
    },
  );
  async function canConfigure(req: Request, spaceId: string, userId: string) {
    return (
      req.actor.source === "local_implicit" ||
      req.actor.isInstanceAdmin === true ||
      (await accessService(db).hasPermission(
        spaceId,
        "user",
        userId,
        "tools:manage_connections",
      ))
    );
  }
  router.get("/spaces/:spaceId/slack/endpoints/:endpointId/search", async (req, res) => {
    const userId = user(req);
    const spaceId = String(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    res.set("Cache-Control", "no-store").json({
      ...(await oauth.status(spaceId, String(req.params.endpointId), userId)),
      canConfigure: await canConfigure(req, spaceId, userId),
    });
  });
  router.put("/spaces/:spaceId/slack/endpoints/:endpointId/search", async (req, res) => {
    const userId = user(req);
    const spaceId = String(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    if (
      req.actor.source !== "local_implicit" &&
      !req.actor.isInstanceAdmin &&
      !(await accessService(db).hasPermission(
        spaceId,
        "user",
        userId,
        "tools:manage_connections",
      ))
    )
      throw forbidden("Missing permission: tools:manage_connections");
    res.json(
      await oauth.configure(
        spaceId,
        String(req.params.endpointId),
        userId,
        req.body,
      ),
    );
  });
  router.post("/spaces/:spaceId/slack/endpoints/:endpointId/search/connect", async (req, res) => {
    const userId = user(req);
    const spaceId = String(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    res
      .set("Cache-Control", "no-store")
      .json(
        await oauth.start(spaceId, String(req.params.endpointId), userId),
      );
  });
  router.delete("/spaces/:spaceId/slack/endpoints/:endpointId/search", async (req, res) => {
    const userId = user(req);
    const spaceId = String(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    res.json(
      await oauth.disconnect(spaceId, String(req.params.endpointId), userId),
    );
  });
  router.post(
    "/spaces/:spaceId/slack/tasks/:issueId/tools",
    async (req, res) => {
      const spaceId = String(req.params.spaceId);
      const issueId = String(req.params.issueId);
      assertSpaceAccess(req, spaceId);
      if (!isUuidLike(spaceId) || !isUuidLike(issueId))
        throw badRequest("Invalid task binding");
      if (req.actor.type !== "agent" || !req.actor.agentId || !req.actor.runId)
        throw forbidden("Slack tools require an authenticated agent run");
      const call = slackToolCallSchema.parse(req.body);
      if (!call.tool.startsWith("slack_"))
        throw forbidden("Expected a Slack tool");
      res.set("Cache-Control", "no-store").json(
        await executeConnectorTool(
          db,
          {
            spaceId,
            issueId,
            runId: req.actor.runId,
            agentId: req.actor.agentId,
            endpointId: call.endpointId,
          },
          call.tool,
          call.arguments,
        ),
      );
    },
  );
  return router;
}
