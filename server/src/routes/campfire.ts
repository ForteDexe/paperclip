import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@outpost/db";
import { badRequest, notFound } from "../errors.js";
import { campfireService } from "../services/campfire.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { logActivity } from "../services/activity-log.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import { assertOperator, assertSpaceAccess, getActorInfo } from "./authz.js";

const idSchema = z.string().guid();
const createRoomSchema = z.object({ name: z.string().min(1).max(80) }).strict();
const addMemberSchema = z.object({
  agentId: z.string().guid(),
  handle: z.string().min(1).max(33).optional(),
}).strict();
const sendMessageSchema = z.object({ body: z.string().min(1).max(100_000) }).strict();

async function requireCampfireEnabled(db: Db) {
  if (!(await instanceSettingsService(db).getExperimental()).enableCampfire) {
    throw notFound("Campfire is disabled");
  }
}

function routeActor(req: Request) {
  const actor = getActorInfo(req);
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    agentApiKeyId: actor.agentApiKeyId,
  };
}

function asBadRequest(error: unknown): never {
  if (error instanceof Error) throw badRequest(error.message);
  throw error;
}

export function campfireRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const service = campfireService(db, options);

  router.use("/spaces/:spaceId/campfire", async (req, _res, next) => {
    await requireCampfireEnabled(db);
    const spaceId = idSchema.parse(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    assertOperator(req);
    next();
  });

  router.get("/spaces/:spaceId/campfire", async (req, res) => {
    const spaceId = idSchema.parse(req.params.spaceId);
    const roomId = typeof req.query.roomId === "string" ? idSchema.parse(req.query.roomId) : undefined;
    try {
      res.json(await service.state(spaceId, roomId));
    } catch (error) {
      asBadRequest(error);
    }
  });

  router.post("/spaces/:spaceId/campfire/rooms", async (req, res) => {
    const spaceId = idSchema.parse(req.params.spaceId);
    const input = createRoomSchema.parse(req.body);
    try {
      const room = await service.createRoom(spaceId, input.name);
      await logActivity(db, {
        spaceId,
        ...routeActor(req),
        action: "campfire.room.created",
        entityType: "campfire_room",
        entityId: room.id,
        details: { name: room.name },
      });
      res.status(201).json(room);
    } catch (error) {
      asBadRequest(error);
    }
  });

  router.post("/spaces/:spaceId/campfire/rooms/:roomId/members", async (req, res) => {
    const spaceId = idSchema.parse(req.params.spaceId);
    const roomId = idSchema.parse(req.params.roomId);
    const input = addMemberSchema.parse(req.body);
    try {
      const member = await service.addMember(spaceId, roomId, input.agentId, input.handle);
      await logActivity(db, {
        spaceId,
        ...routeActor(req),
        action: "campfire.member.added",
        entityType: "campfire_room",
        entityId: roomId,
        agentId: input.agentId,
        details: { handle: member.handle },
      });
      res.status(201).json(member);
    } catch (error) {
      asBadRequest(error);
    }
  });

  router.delete("/spaces/:spaceId/campfire/rooms/:roomId/members/:agentId", async (req, res) => {
    const spaceId = idSchema.parse(req.params.spaceId);
    const roomId = idSchema.parse(req.params.roomId);
    const agentId = idSchema.parse(req.params.agentId);
    try {
      const result = await service.removeMember(spaceId, roomId, agentId);
      await logActivity(db, {
        spaceId,
        ...routeActor(req),
        action: "campfire.member.removed",
        entityType: "campfire_room",
        entityId: roomId,
        agentId,
      });
      res.json(result);
    } catch (error) {
      asBadRequest(error);
    }
  });

  router.post("/spaces/:spaceId/campfire/rooms/:roomId/messages", async (req, res) => {
    const spaceId = idSchema.parse(req.params.spaceId);
    const roomId = idSchema.parse(req.params.roomId);
    const input = sendMessageSchema.parse(req.body);
    try {
      const result = await service.sendMessage(spaceId, roomId, input.body);
      await logActivity(db, {
        spaceId,
        ...routeActor(req),
        action: "campfire.message.created",
        entityType: "campfire_message",
        entityId: result.messageId,
        details: { roomId, recipientCount: result.recipients.length },
      });
      res.status(201).json(result);
    } catch (error) {
      asBadRequest(error);
    }
  });

  return router;
}
