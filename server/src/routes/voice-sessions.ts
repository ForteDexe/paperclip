import { Router, type Request } from "express";
import type { Db } from "@outpost/db";
import { isUuidLike, startVoiceSessionSchema, voiceCallbackPreferenceSchema, voicePhoneConfigurationSchema, voiceInboundDecisionSchema } from "@outpost/shared";
import { badRequest, forbidden, HttpError, tooManyRequests } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { createInviteRateLimiter } from "../services/invite-rate-limit.js";
import { SpekoProtocolError } from "../services/voice/speko-protocol.js";
import type { VoiceSessionService } from "../services/voice/voice-session-service.js";
import type { VoiceCaller } from "../services/voice/voice-session-store.js";
import { assertOperator, assertSpaceAccess } from "./authz.js";

function caller(req: Request): VoiceCaller {
  assertOperator(req);
  if (req.actor.source === "local_implicit") return { id: "local-operator", authority: "local_operator" };
  if (!req.actor.userId || !["session", "cloud_tenant"].includes(req.actor.source ?? "")) throw forbidden("Sign in to start a private voice conversation");
  return { id: req.actor.userId, authority: req.actor.source === "session" && req.actor.isInstanceAdmin ? "instance_admin" : "member" };
}
function space(req: Request, requireAccess = true) {
  const id = req.params.spaceId as string;
  if (!isUuidLike(id)) throw badRequest("Invalid space id");
  assertOperator(req);
  if (requireAccess) assertSpaceAccess(req, id);
  return id;
}
function session(req: Request) {
  const id = req.params.sessionId as string;
  if (!isUuidLike(id)) throw badRequest("Invalid voice session id");
  return id;
}
export function voiceSessionRoutes(db: Db, service: VoiceSessionService) {
  const router = Router(), settings = instanceSettingsService(db);
  const starts = createInviteRateLimiter({ windowMs: 60_000, maxRequests: 10 });
  async function enabled() {
    if (!(await settings.getExperimental()).enableChatConnectors) throw forbidden("Enable experimental chat connectors to use voice");
  }
  router.use("/spaces/:spaceId/voice-sessions", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/spaces/:spaceId/voice-callbacks/:endpointId", async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); await enabled();
    if (!isUuidLike(req.params.endpointId as string)) throw badRequest("Invalid voice endpoint id");
    res.json(await service.callbackPreference(space(req), req.params.endpointId as string, caller(req)));
  });
  router.put("/spaces/:spaceId/voice-callbacks/:endpointId", validate(voiceCallbackPreferenceSchema), async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); await enabled();
    if (!isUuidLike(req.params.endpointId as string)) throw badRequest("Invalid voice endpoint id");
    res.json(await service.saveCallbackPreference(space(req), req.params.endpointId as string, caller(req), req.body));
  });
  router.use("/spaces/:spaceId/voice-phone/:endpointId", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  function endpoint(req: Request) { const id = req.params.endpointId as string; if (!isUuidLike(id)) throw badRequest("Invalid voice endpoint id"); return id; }
  router.get("/spaces/:spaceId/voice-phone/:endpointId", async (req, res) => { res.json(await service.inbound.configuration(space(req), endpoint(req), caller(req))); });
  router.put("/spaces/:spaceId/voice-phone/:endpointId", validate(voicePhoneConfigurationSchema), async (req, res) => { res.json(await service.inbound.saveConfiguration(space(req), endpoint(req), caller(req), req.body)); });
  router.get("/spaces/:spaceId/voice-phone/:endpointId/incoming", async (req, res) => { res.json(await service.inbound.list(space(req), endpoint(req), caller(req))); });
  router.get("/spaces/:spaceId/voice-phone/:endpointId/history", async (req, res) => { res.json(await service.inbound.history(space(req), endpoint(req), caller(req))); });
  router.post("/spaces/:spaceId/voice-phone/:endpointId/incoming/:callId", validate(voiceInboundDecisionSchema), async (req, res) => {
    if (!isUuidLike(req.params.callId as string)) throw badRequest("Invalid incoming call id");
    const spaceId = space(req), actor = caller(req);
    if (!starts.consume(`inbound:${spaceId}:${actor.id}`).allowed) throw tooManyRequests("Too many incoming call approval attempts");
    res.json(await service.inbound.decide(spaceId, endpoint(req), req.params.callId as string, actor, req.body));
  });
  router.get("/spaces/:spaceId/voice-history/:endpointId", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isUuidLike(req.params.endpointId as string)) throw badRequest("Invalid voice endpoint id");
    res.json(await service.history(space(req), req.params.endpointId as string, caller(req)));
  });
  router.get("/spaces/:spaceId/voice-sessions/:sessionId/report", async (req, res) => {
    res.json(await service.callDetail(space(req), session(req), caller(req)));
  });
  router.post("/spaces/:spaceId/voice-sessions", validate(startVoiceSessionSchema), async (req, res) => {
    const spaceId = space(req), actor = caller(req);
    await enabled();
    const limit = starts.consume(`${spaceId}:${actor.id}`);
    if (!limit.allowed) throw tooManyRequests("Too many voice session attempts");
    const result = await service.start({ ...req.body, spaceId, caller: actor });
    res.status(result.media ? 201 : 200).json(result);
  });
  router.get("/spaces/:spaceId/voice-sessions/:sessionId", async (req, res) => {
    res.json(await service.inspect(space(req), session(req), caller(req)));
  });
  router.post("/spaces/:spaceId/voice-sessions/:sessionId/end", async (req, res) => {
    res.json(await service.end(space(req, false), session(req), caller(req)));
  });
  router.get("/spaces/:spaceId/voice-sessions/:sessionId/notification", async (req, res) => {
    const spaceId = space(req), actor = caller(req);
    await enabled();
    res.json(await service.notification(spaceId, session(req), actor.id));
  });
  return router;
}

/** Original bytes + provider signature + per-session capability; no operator bypass. */
export function voiceWebhookRoutes(db: Db, service: VoiceSessionService) {
  const router = Router(), settings = instanceSettingsService(db);
  const limiter = createInviteRateLimiter({ windowMs: 60_000, maxRequests: 600 });
  router.post("/api/voice-webhooks/:publicId/events", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!limiter.consume(req.ip ?? req.socket.remoteAddress ?? "unknown").allowed) throw tooManyRequests("Too many voice callbacks");
    const body = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!Buffer.isBuffer(body)) throw badRequest("Original callback body is required");
    try { res.json(await service.inbound.lifecycle(req.params.publicId as string, body, req.headers)); }
    catch (error) {
      if (error instanceof SpekoProtocolError) throw new HttpError(error.code === "body_too_large" ? 413 : error.code === "invalid_signature" ? 401 : 400, "Invalid voice callback");
      if (error instanceof SyntaxError || error instanceof Error && error.name === "ZodError") throw badRequest("Invalid voice callback");
      throw error;
    }
  });
  router.post("/api/voice-webhooks/:publicId/tools", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const limit = limiter.consume(req.ip ?? req.socket.remoteAddress ?? "unknown");
    if (!limit.allowed) throw tooManyRequests("Too many voice callbacks");
    if (!(await settings.getExperimental()).enableChatConnectors) throw forbidden("Voice connections are disabled");
    const body = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!Buffer.isBuffer(body)) throw badRequest("Original callback body is required");
    try { res.json(await service.tool(req.params.publicId as string, body, req.headers)); }
    catch (error) {
      if (error instanceof SpekoProtocolError) throw new HttpError(error.code === "body_too_large" ? 413 : error.code === "invalid_signature" ? 401 : 400, "Invalid voice callback");
      throw error;
    }
  });
  return router;
}
