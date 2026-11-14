import { Router, urlencoded, type Request } from "express";
import type { Db } from "@outpost/db";
import type { DeploymentExposure, DeploymentMode } from "@outpost/shared";
import {
  createSmokeRunSchema,
  recordSmokeRunStepSchema,
  updateSmokeRunSchema,
} from "@outpost/shared";
import { validate } from "../middleware/validate.js";
import { assertOperator, assertOperatorOrAgent, assertSpaceAccess, getActorInfo } from "./authz.js";
import { logActivity, smokeLabService } from "../services/index.js";

function configuredPublicBaseUrl() {
  const raw = (
    process.env.OUTPOST_PUBLIC_URL?.trim()
    || process.env.OUTPOST_AUTH_PUBLIC_BASE_URL?.trim()
    || process.env.BETTER_AUTH_URL?.trim()
    || process.env.BETTER_AUTH_BASE_URL?.trim()
  );
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function requestBaseUrl(req: Request) {
  const configured = configuredPublicBaseUrl();
  if (configured) return configured;
  const host = req.get("host")?.trim() || req.hostname;
  return `${req.protocol}://${host}`;
}

function smokeLabBaseUrl(req: Request, spaceId: string) {
  return `${requestBaseUrl(req)}/api/spaces/${encodeURIComponent(spaceId)}/smoke-lab`;
}

function stringBodyValue(body: unknown, key: string) {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function smokeLabRoutes(db: Db, options: {
  deploymentMode?: DeploymentMode;
  deploymentExposure?: DeploymentExposure;
  nodeEnv?: string;
} = {}) {
  const router = Router();
  const svc = smokeLabService(db, options);
  const formParser = urlencoded({ extended: false });

  async function assertSmokeLabEnabled() {
    await svc.assertEnabled();
  }

  router.get("/spaces/:spaceId/smoke-lab/oauth/authorize", async (req, res) => {
    await assertSmokeLabEnabled();
    const spaceId = req.params.spaceId as string;
    res.type("html").send(svc.oauthAuthorizePage({
      spaceId,
      clientId: String(req.query.client_id ?? "smoke-client"),
      redirectUri: String(req.query.redirect_uri ?? "http://127.0.0.1/callback"),
      state: typeof req.query.state === "string" ? req.query.state : undefined,
      scope: typeof req.query.scope === "string" ? req.query.scope : undefined,
      responseType: typeof req.query.response_type === "string" ? req.query.response_type : undefined,
      requestOrigin: configuredPublicBaseUrl() ?? undefined,
    }));
  });

  router.post("/spaces/:spaceId/smoke-lab/oauth/authorize", formParser, async (req, res) => {
    await assertSmokeLabEnabled();
    const location = svc.completeAuthorize({
      spaceId: req.params.spaceId as string,
      clientId: stringBodyValue(req.body, "client_id") ?? "smoke-client",
      redirectUri: stringBodyValue(req.body, "redirect_uri") ?? "http://127.0.0.1/callback",
      state: stringBodyValue(req.body, "state"),
      scope: stringBodyValue(req.body, "scope"),
      email: stringBodyValue(req.body, "email"),
      password: stringBodyValue(req.body, "password"),
      requestOrigin: configuredPublicBaseUrl() ?? undefined,
    });
    res.redirect(302, location);
  });

  router.post("/spaces/:spaceId/smoke-lab/oauth/token", formParser, async (req, res) => {
    await assertSmokeLabEnabled();
    res.json(svc.issueToken({
      spaceId: req.params.spaceId as string,
      grantType: stringBodyValue(req.body, "grant_type"),
      code: stringBodyValue(req.body, "code"),
      refreshToken: stringBodyValue(req.body, "refresh_token"),
      clientId: stringBodyValue(req.body, "client_id"),
      redirectUri: stringBodyValue(req.body, "redirect_uri"),
    }));
  });

  router.get("/spaces/:spaceId/smoke-lab/oauth/userinfo", async (req, res) => {
    await assertSmokeLabEnabled();
    res.json(svc.userinfo({
      spaceId: req.params.spaceId as string,
      authorization: req.get("authorization"),
    }));
  });

  router.post("/spaces/:spaceId/smoke-lab/oauth/revoke", formParser, async (req, res) => {
    await assertSmokeLabEnabled();
    res.json(svc.revoke({
      spaceId: req.params.spaceId as string,
      token: stringBodyValue(req.body, "token"),
    }));
  });

  router.get("/spaces/:spaceId/smoke-lab/services", async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.listServices(smokeLabBaseUrl(req, spaceId)));
  });

  router.post("/spaces/:spaceId/smoke-lab/services/start", async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.startServices(spaceId, smokeLabBaseUrl(req, spaceId));
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "smoke_lab.services_started",
      entityType: "smoke_lab",
      entityId: spaceId,
      details: { services: result.services.map((service) => service.id) },
    });
    res.json(result);
  });

  router.post("/spaces/:spaceId/smoke-lab/services/stop", async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.stopServices(smokeLabBaseUrl(req, spaceId));
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "smoke_lab.services_stopped",
      entityType: "smoke_lab",
      entityId: spaceId,
      details: { services: result.services.map((service) => service.id) },
    });
    res.json(result);
  });

  router.post("/spaces/:spaceId/smoke-lab/install-fixtures", async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.installFixtures(spaceId, getActorInfo(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "smoke_lab.fixtures_installed",
      entityType: "smoke_lab",
      entityId: spaceId,
      details: {
        created: result.created,
        applicationIds: result.applications.map((application) => application.id),
        connectionIds: result.connections.map((connection) => connection.id),
        catalogEntryCount: result.catalog.length,
        profileId: result.profile.id,
      },
    });
    res.status(result.created ? 201 : 200).json(result);
  });

  router.get("/spaces/:spaceId/smoke-lab/runs", async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.listRuns(spaceId));
  });

  router.post("/spaces/:spaceId/smoke-lab/runs", validate(createSmokeRunSchema), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const run = await svc.createRun(spaceId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "smoke_lab.run_created",
      entityType: "smoke_run",
      entityId: run.id,
      details: { trigger: run.trigger },
    });
    res.status(201).json({ run });
  });

  router.get("/spaces/:spaceId/smoke-lab/runs/:runId", async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.getRun(spaceId, req.params.runId as string));
  });

  router.patch("/spaces/:spaceId/smoke-lab/runs/:runId", validate(updateSmokeRunSchema), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const run = await svc.updateRun(spaceId, req.params.runId as string, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "smoke_lab.run_updated",
      entityType: "smoke_run",
      entityId: run.id,
      details: { status: run.status },
    });
    res.json({ run });
  });

  router.post("/spaces/:spaceId/smoke-lab/runs/:runId/steps", validate(recordSmokeRunStepSchema), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.recordStep(spaceId, req.params.runId as string, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "smoke_lab.step_recorded",
      entityType: "smoke_run_step",
      entityId: result.step.id,
      details: { smokeRunId: req.params.runId, path: result.step.path, status: result.step.status },
    });
    res.status(201).json(result);
  });

  router.post("/spaces/:spaceId/smoke-lab/reset", async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.reset(spaceId);
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "smoke_lab.reset",
      entityType: "smoke_lab",
      entityId: spaceId,
      details: result,
    });
    res.json(result);
  });

  return router;
}
