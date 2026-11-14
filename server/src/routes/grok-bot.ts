import { Router, type Request } from "express";
import { z } from "zod";
import { heartbeatRuns, issues, type Db } from "@outpost/db";
import { and, eq, sql } from "drizzle-orm";
import { createGrokInvitationSchema, configureGrokRoutineSchema, verifyGrokRoutineSchema, recoverGrokRoutineSchema, pairGrokBindingSchema, stopGrokWorkSchema, retryGrokDeliverySchema } from "@outpost/shared";
import { assertOperator, assertSpaceAccess } from "./authz.js";
import { forbidden, HttpError, notFound } from "../errors.js";
import { issueReadSqlCondition } from "../services/authorization.js";
import { agentService } from "../services/agents.js";
import { authorizeExternalBotOperator } from "../services/external-bot-authority.js";
import { dotRunnerBroker } from "../services/dot-runner-broker.js";
import { dotInvitationService } from "../services/dot-invitations.js";
import { grokRoutineService } from "../services/grok-bot/routine.js";
import { McpOAuthError } from "../services/public-mcp/oauth.js";
import { canConfigureAgentConnection } from "../modules/agent-lifecycle/index.js";

export function grokBotRoutes(db: Db, resourceUrl: string) {
  const router = Router(), broker = dotRunnerBroker(db), routines = grokRoutineService(db);
  const invitations = dotInvitationService(db, "grok_bot");
  const path = "/spaces/:spaceId/agents/:agentId/grok-binding";
  async function spaceScope(req: Request, write = false) {
    const spaceId = z.uuid().parse(req.params.spaceId);
    assertOperator(req); assertSpaceAccess(req, spaceId);
    const operatorId = req.actor.userId;
    if (!operatorId || write && !["session", "cloud_tenant"].includes(req.actor.source ?? "")) throw forbidden("Sign in to manage this Grok agent.");
    if (write) await authorizeExternalBotOperator(db, spaceId, operatorId);
    return { spaceId, operatorId };
  }
  async function scope(req: Request, write = false) {
    const input = { ...await spaceScope(req, write), agentId: z.uuid().parse(req.params.agentId) };
    const agent = await agentService(db).getById(input.agentId);
    if (!agent || agent.spaceId !== input.spaceId || agent.adapterType !== "outpost_runner" || agent.adapterConfig.provider !== "grok_bot") throw notFound("Grok agent not found");
    return { ...input, agent };
  }
  router.get("/spaces/:spaceId/grok-invitations", async (req, res) => {
    const { spaceId, operatorId } = await spaceScope(req, true);
    res.set("Cache-Control", "no-store").json(await invitations.resume(spaceId, operatorId));
  });
  router.post("/spaces/:spaceId/grok-invitations", async (req, res) => {
    const { spaceId, operatorId } = await spaceScope(req, true);
    const details = createGrokInvitationSchema.parse(req.body);
    if (details.leadAgentId) { const lead = await agentService(db).getById(details.leadAgentId); if (!lead || lead.spaceId !== spaceId || lead.status === "terminated") throw notFound("Coordination lead not found"); }
    res.set("Cache-Control", "no-store").status(201).json(await invitations.create(spaceId, operatorId, details));
  });
  router.get(path, async (req, res) => {
    const { spaceId, agentId, agent } = await scope(req);
    const binding = await broker.bindingForAgent(spaceId, agentId);
    const readable = await issueReadSqlCondition(db, req.actor);
    const [queued] = await db.select({ count: sql<number>`count(*)::int` }).from(issues).where(and(eq(issues.spaceId, spaceId), eq(issues.assigneeAgentId, agentId), eq(issues.status, "todo"), readable));
    const [currentTask] = binding?.assignment ? await db.select({ id: issues.id, identifier: issues.identifier, title: issues.title }).from(heartbeatRuns)
      .innerJoin(issues, and(eq(issues.id, heartbeatRuns.nativeIssueId), eq(issues.spaceId, spaceId)))
      .where(and(eq(heartbeatRuns.id, binding.assignment.runId), eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.spaceId, spaceId), readable)) : [];
    res.set("Cache-Control", "no-store").json({ queuedTaskCount: queued?.count ?? 0, currentTask: currentTask ?? null, enabled: resourceUrl.startsWith("https://") && await broker.enabled("grok_bot"), resourceUrl,
      agentStatus: agent.status, agentLifecycleState: agent.lifecycleState, recoveryNeeded: await routines.recoveryNeeded(spaceId, agentId), canConfigureConnection: canConfigureAgentConnection(agent),
      binding });
  });
  router.post(path, async (req, res) => {
    const { spaceId, agentId, operatorId } = await scope(req, true);
    if (!resourceUrl.startsWith("https://")) throw forbidden("Grok Bot requires an authenticated public HTTPS instance.");
    const body = pairGrokBindingSchema.parse(req.body ?? {});
    res.set("Cache-Control", "no-store").status(201).json(await broker.createPairing({ spaceId, agentId, operatorId, provider: "grok_bot", ...body }));
  });
  router.put(path + "/routine", async (req, res) => {
    const { spaceId, agentId, operatorId } = await scope(req, true);
    const body = configureGrokRoutineSchema.parse(req.body);
    res.set("Cache-Control", "no-store").json(await routines.configure({ spaceId, agentId, operatorId, ...body }));
  });
  router.post(path + "/verify", async (req, res) => {
    const { spaceId, agentId } = await scope(req, true);
    const { bindingId, requestId } = verifyGrokRoutineSchema.parse(req.body);
    const intent = await routines.reserve({ spaceId, agentId, bindingId, sourceEventId: `verify:${requestId}`, kind: "verify" });
    res.set("Cache-Control", "no-store").json(await routines.send(spaceId, agentId, intent.id));
  });
  router.post(path + "/retry", async (req, res) => {
    const { spaceId, agentId, operatorId } = await scope(req, true);
    const { correlationId } = retryGrokDeliverySchema.parse(req.body);
    res.set("Cache-Control", "no-store").json(await routines.retryRejected(spaceId, agentId, operatorId, correlationId));
  });
  router.post(path + "/stop", async (req, res) => {
    const { spaceId, agentId, operatorId } = await scope(req, true);
    const { expectedRunId } = stopGrokWorkSchema.parse(req.body ?? {});
    res.set("Cache-Control", "no-store").json(await broker.stopGrokWork(spaceId, agentId, operatorId, expectedRunId));
  });
  router.post(path + "/recover", async (req, res) => {
    const { spaceId, agentId, operatorId } = await scope(req, true);
    recoverGrokRoutineSchema.parse(req.body);
    res.set("Cache-Control", "no-store").json(await routines.recover(spaceId, agentId, operatorId));
  });
  router.delete(path, async (req, res) => {
    const { spaceId, agentId, operatorId } = await scope(req, true);
    await broker.revoke(spaceId, agentId, operatorId); res.status(204).end();
  });
  router.use((error: unknown, _req: Request, _res: unknown, next: (error: unknown) => void) => next(error instanceof McpOAuthError ? new HttpError(error.status, error.message) : error));
  return router;
}
