import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@outpost/db";
import { assertOperator, assertSpaceAccess } from "./authz.js";
import { forbidden, notFound } from "../errors.js";
import { accessService } from "../services/access.js";
import { agentService } from "../services/agents.js";
import { museRunnerBroker } from "../services/muse-runner-broker.js";

const qualificationIdentity = z.object({ bindingId: z.uuid(), qualificationId: z.uuid() }).strict();
const startQualification = qualificationIdentity.extend({ generation: z.number().int().positive(), expectedRevision: z.number().int().positive() }).strict();

/** Operator-only bounded experiment. The broker owns the durable deadline and fencing. */
export function museQualificationRoutes(db: Db) {
  const router = Router();
  const broker = museRunnerBroker(db);
  const path = "/spaces/:spaceId/agents/:agentId/muse-binding/qualification";
  async function operator(req: Request) {
    const spaceId = z.uuid().parse(req.params.spaceId), agentId = z.uuid().parse(req.params.agentId);
    assertOperator(req); assertSpaceAccess(req, spaceId);
    if (!req.actor.userId || !["session", "cloud_tenant", "operator_key"].includes(req.actor.source ?? "")) {
      throw forbidden("Sign in as an operator to manage a Muse qualification.");
    }
    const agent = await agentService(db).getById(agentId);
    if (!agent || agent.spaceId !== spaceId) throw notFound("Agent not found");
    const decision = await accessService(db).decide({ actor: req.actor, action: "agent_config:update",
      resource: { type: "agent", spaceId, agentId }, scope: { requiresChangeGrant: true } });
    if (!decision.allowed) throw forbidden(decision.explanation);
    return { spaceId, agentId, operatorId: req.actor.userId };
  }
  router.post(path, async (req, res) => {
    const scope = await operator(req);
    const body = startQualification.parse(req.body ?? {});
    // The caller cannot extend the deadline on retries. The broker reuses the
    // existing qualification ID and its original deadline atomically.
    res.set("Cache-Control", "no-store").status(201).json(await broker.beginQualification({
      ...scope, ...body, expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    }));
  });
  router.get(path, async (req, res) => {
    const { spaceId, agentId } = await operator(req);
    const { bindingId, qualificationId } = qualificationIdentity.parse(req.query);
    res.set("Cache-Control", "no-store").json(await broker.readQualificationEvidence(spaceId, agentId, bindingId, qualificationId));
  });
  router.delete(path, async (req, res) => {
    const scope = await operator(req);
    const body = qualificationIdentity.parse(req.body ?? {});
    await broker.endQualification({ ...scope, ...body });
    res.set("Cache-Control", "no-store").status(204).end();
  });
  return router;
}
