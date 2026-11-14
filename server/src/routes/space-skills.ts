import { logger } from "../middleware/logger.js";
import { managedSkillContent } from "../services/managed-skill-content.js";
import type { SkillContentPublication } from "../services/managed-skill-content.js";
import { projectSkillSetupIdentity } from "../services/project-skill-source-bindings.js";
import { adoptProjectSkillRepository, projectSkillRepositories, skillSourceSyncService } from "../services/skill-source-sync.js";
import { skillAccessRequestContext, skillAccessService } from "../services/skill-access.js";
import { skillSourceService, type SkillSourceContext } from "../services/skill-sources.js";
import { skillSourceGitHubReader } from "../services/skill-source-github-access.js";
import { diffGitHubSkillUpdate } from "../services/skill-update-diff.js";
import { toolAccessService } from "../services/tool-access.js";
import { skillSourceCreateSchema, skillSourceDiscoverySchema, skillSourcePreviewSchema, skillSourceSelectionSchema, skillSourceSettingsSchema, skillSourceBranchesQuerySchema, projectSkillSourceAdoptSchema, skillSourceDisconnectSchema } from "@outpost/shared";
import type { ActivityPublication } from "../services/activity-log.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import { once } from "node:events";
import type { SkillSourceDiscoveryEvent, SkillSourceUpdateDiff } from "@outpost/shared";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, spaceSkills, spaceSkillMutationReceipts } from "@outpost/db";
import { persistActivity, publishActivity } from "../services/activity-log.js";
import { projectToolContext } from "../services/project-tool-context.js";
import { Router, type Request } from "express";
import type { Db } from "@outpost/db";
import {
  spaceSkillCommentCreateSchema,
  spaceSkillCommentUpdateSchema,
  spaceSkillCreateSchema,
  spaceSkillFileDeleteSchema,
  spaceSkillFileUpdateSchema,
  spaceSkillForkSchema,
  spaceSkillImportSchema,
  spaceSkillInstallUpdateSchema,
  spaceSkillListQuerySchema,
  spaceSkillProjectBrowseRequestSchema,
  spaceSkillProjectScanRequestSchema,
  spaceSkillRenameSchema,
  spaceSkillTestInputCreateSchema,
  spaceSkillTestInputUpdateSchema,
  spaceSkillTestRunTemplateCreateSchema,
  spaceSkillTestRunTemplateUpdateSchema,
  spaceSkillTestRunCreateSchema,
  spaceSkillTestRunListQuerySchema,
  spaceSkillUpdateSchema,
  spaceSkillVersionCreateSchema,
} from "@outpost/shared";
import { trackSkillImported } from "@outpost/shared/telemetry";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  spaceSkillService,
  heartbeatService,
  issueService,
  logActivity,
} from "../services/index.js";
import { isGitRepoSkillImportSource, parseSkillImportSourceInput } from "../services/space-skills.js";
import { badRequest, conflict, forbidden, unauthorized, notFound, HttpError } from "../errors.js";
import { assertAuthenticated, assertSpaceAccess, getActorInfo } from "./authz.js";
import { getTelemetryClient } from "../telemetry.js";
import {
  spaceSkillPolicyService,
  normalizeSkillPolicySourceType,
  type SkillPolicyPrincipal,
} from "../services/space-skill-policy.js";
import { authorizationDeniedDetails, type AuthorizationActor } from "../services/authorization.js";
import {
  normalizeSkillPolicySourceLocator,
  type SkillPolicyAction,
  type SkillPolicyDecision,
  type SkillPolicyEvaluationResource,
} from "@outpost/shared";

type SkillTelemetryInput = {
  key: string;
  slug: string;
  sourceType: string;
  sourceLocator: string | null;
  metadata: Record<string, unknown> | null;
};

type SkillPolicyDenialResponse = {
  code: "skill_policy_denied";
  reason: SkillPolicyDecision["reason"];
  remediation?: string;
};

type SkillTestRunAssignmentAuthorizationScope = {
  issueId?: string | null;
  projectId?: string | null;
  parentIssueId?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
};

type SkillPolicyResourceInput =
  | SkillPolicyEvaluationResource
  | Promise<SkillPolicyEvaluationResource>
  | (() => SkillPolicyEvaluationResource | Promise<SkillPolicyEvaluationResource>);

export function spaceSkillRoutes(db: Db, options: { pluginWorkerManager?: PluginWorkerManager } = {}) {
  const router = Router();
  router.use(skillAccessRequestContext);
  router.param("skillId", async (req, _res, next, id) => {
    try {
      if (req.actor.type === "none") throw unauthorized("Authentication required");
      assertSpaceAccess(req, String(req.params.spaceId));
      const skill = await svc.getByRouteRef(String(req.params.spaceId), id);
      if (!skill) throw notFound("Skill not found");
      req.params.skillId = skill.id;
      next();
    } catch (error) { next(error); }
  });
  router.param("sourceId", async (req, _res, next, id) => {
    try { assertSpaceAccess(req, String(req.params.spaceId)); await skillAccessService(db).assertSource(String(req.params.spaceId), id); next(); }
    catch (error) { next(error); }
  });
  const access = accessService(db);
  const svc = spaceSkillService(db);
  const sourceSvc = skillSourceService(db);
  const sourceSync = skillSourceSyncService(db);
  const issues = issueService(db);
  const heartbeat = heartbeatService(db, { pluginWorkerManager: options.pluginWorkerManager });
  const skillPolicies = spaceSkillPolicyService(db);

  function asString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function deriveTrackedSkillRef(skill: SkillTelemetryInput): string | null {
    if (skill.metadata?.skillSourceId) return null;
    if (skill.sourceType === "skills_sh") {
      return skill.key;
    }
    if (skill.sourceType !== "github") {
      return null;
    }
    const hostname = asString(skill.metadata?.hostname);
    if (hostname !== "github.com") {
      return null;
    }
    return skill.key;
  }

  function firstQueryString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return undefined;
  }

  function optionalQueryBoolean(value: unknown) {
    const parsed = firstQueryString(value);
    if (parsed === undefined) return undefined;
    if (parsed === "true") return true;
    if (parsed === "false") return false;
    throw badRequest("Boolean query parameters must be true or false");
  }

  function queryStringArray(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
    return [];
  }

  function toSkillPolicyDenialResponse(
    decision: Pick<SkillPolicyDecision, "reason" | "remediation">,
  ): SkillPolicyDenialResponse {
    return {
      code: "skill_policy_denied",
      reason: decision.reason,
      ...(typeof decision.remediation === "string" ? { remediation: decision.remediation } : {}),
    };
  }

  function skillActor(req: Request) {
    if (req.actor.type === "agent") {
      return { type: "agent" as const, agentId: req.actor.agentId ?? null };
    }
    if (req.actor.type === "operator") {
      return { type: "user" as const, userId: req.actor.userId ?? null };
    }
    return { type: "system" as const };
  }

  async function skillPolicyPrincipal(req: Request, spaceId: string, database: Db = db): Promise<SkillPolicyPrincipal> {
    if (req.actor.type === "agent" && req.actor.agentId) {
      return spaceSkillPolicyService(database).resolveAgentPrincipal(spaceId, req.actor.agentId);
    }
    if (req.actor.type === "operator") {
      return { type: "operator", id: req.actor.userId ?? "operator", role: "operator" };
    }
    throw unauthorized("Authentication required");
  }

  async function skillPolicyResource(input: {
    spaceId: string;
    skillId?: string | null;
    skillKey?: unknown;
    sourceType?: string | null;
    sourceLocator?: unknown;
  }, database: Db = db): Promise<SkillPolicyEvaluationResource> {
    const stored = input.skillId ? await spaceSkillService(database).getById(input.spaceId, input.skillId) : null;
    const sourceLocator = asString(input.sourceLocator) ?? stored?.sourceLocator ?? undefined;
    return {
      ...(input.skillId ? { skillId: input.skillId } : {}),
      ...(asString(input.skillKey) || stored?.key ? { skillKey: asString(input.skillKey) ?? stored?.key } : {}),
      ...((input.sourceType || stored?.sourceType) ? {
        sourceType: normalizeSkillPolicySourceType(input.sourceType ?? stored?.sourceType),
      } : {}),
      ...(sourceLocator ? { sourceLocator: normalizeSkillPolicySourceLocator(sourceLocator) } : {}),
    };
  }

  function skillImportPolicyResource(source: string): SkillPolicyEvaluationResource {
    const parsed = parseSkillImportSourceInput(source);
    const resolvedSource = parsed.resolvedSource;
    return {
      sourceType: normalizeSkillPolicySourceType(
        isGitRepoSkillImportSource(resolvedSource) ? "git" : /^https?:\/\//i.test(resolvedSource) ? "external_package" : "workspace",
      ),
      sourceLocator: normalizeSkillPolicySourceLocator(resolvedSource),
    };
  }

  async function assertCanMutateSpaceSkills(
    req: Request,
    spaceId: string,
    action: SkillPolicyAction,
    resource: SkillPolicyResourceInput = {},
    database: Db = db,
  ) {
    if (req.actor.type === "none") {
      throw unauthorized("Authentication required");
    }
    if (req.actor.type === "agent" && req.actor.spaceId !== spaceId) {
      throw forbidden("Agent key cannot access another space", { code: "skill_space_boundary_denied" });
    }
    assertSpaceAccess(req, spaceId);
    const platformDecision = await accessService(database).decide({
      actor: req.actor,
      action: "skill_config:update",
      resource: { type: "space", spaceId },
    });
    // Legacy missing-grant and suggest-change-consent denials are not platform
    // invariants for skills. The space skill policy is the policy layer;
    // authentication, space boundaries, and safety checks still fail closed.
    if (
      !platformDecision.allowed
      && !["deny_no_grant", "deny_missing_consent", "deny_missing_grant"].includes(platformDecision.reason)
    ) {
      throw forbidden(platformDecision.explanation, {
        code: platformDecision.reason === "deny_space_boundary"
          ? "skill_space_boundary_denied"
          : "skill_actor_restricted",
        reason: "platform_invariant",
      });
    }
    const resolvedResource = typeof resource === "function" ? await resource() : await resource;
    const policyDecision = await spaceSkillPolicyService(database).evaluate({
      spaceId,
      principal: await skillPolicyPrincipal(req, spaceId, database),
      action,
      resource: resolvedResource,
    });
    if (!policyDecision.allowed) {
      throw forbidden("Skill action denied by space policy", toSkillPolicyDenialResponse(policyDecision));
    }
  }

  function publishCommittedActivity(publication: ActivityPublication) {
    try { publishActivity(publication); }
    catch { logger.warn({ spaceId: publication.spaceId }, "Committed skill activity notification failed"); }
  }

  function contentPublication(req: Request, spaceId: string, skillId: string, action: SkillPolicyAction,
    event: (skill: Parameters<NonNullable<SkillContentPublication["afterPublish"]>>[1],
      version: Parameters<NonNullable<SkillContentPublication["afterPublish"]>>[2]) => {
        action: string; entityType?: string; entityId?: string; details: Record<string, unknown>;
      }) {
    let publication: ActivityPublication | null = null;
    const hooks: SkillContentPublication = {
      validate: async tx => {
        const database = tx as unknown as Db;
        await assertCanMutateSpaceSkills(req, spaceId, action,
          () => skillPolicyResource({ spaceId, skillId }, database), database);
      },
      afterPublish: async (tx, skill, version) => {
        const actor = getActorInfo(req);
        const activity = event(skill, version);
        publication = (await persistActivity(tx as unknown as Db, {
          spaceId, ...actor, entityType: "space_skill", entityId: skill.id, ...activity,
        })).publication;
      },
    };
    return { hooks, publish() {
      if (!publication) return false;
      publishCommittedActivity(publication);
      return true;
    } };
  }

  async function assertCanOrchestrateSkillTestHarness(
    req: Request,
    spaceId: string,
    assignmentScope: SkillTestRunAssignmentAuthorizationScope = {},
  ) {
    assertSpaceAccess(req, spaceId);
    const decision = await access.decide({
      actor: req.actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        spaceId,
        issueId: assignmentScope.issueId ?? null,
        projectId: assignmentScope.projectId ?? null,
        parentIssueId: assignmentScope.parentIssueId ?? null,
        assigneeAgentId: assignmentScope.assigneeAgentId ?? null,
        assigneeUserId: assignmentScope.assigneeUserId ?? null,
      },
      scope: assignmentScope,
    });
    if (decision.allowed) return;
    throw forbidden(decision.explanation, authorizationDeniedDetails(decision));
  }

  async function loadSkillTestRunAssignmentScope(
    spaceId: string,
    skillId: string,
    runId: string,
  ): Promise<SkillTestRunAssignmentAuthorizationScope> {
    const run = await svc.getTestRunDetail(spaceId, skillId, runId);
    if (!run?.issueId) return {};
    const issue = await issues.getById(run.issueId);
    if (!issue || issue.spaceId !== spaceId) {
      return {
        issueId: run.issueId,
        assigneeAgentId: run.agentId ?? null,
      };
    }
    return {
      issueId: issue.id,
      projectId: issue.projectId ?? null,
      parentIssueId: issue.parentId ?? null,
      assigneeAgentId: issue.assigneeAgentId ?? run.agentId ?? null,
      assigneeUserId: issue.assigneeUserId ?? null,
    };
  }

  async function sourceOperation<T>(req: Request, spaceId: string, operation: (context: SkillSourceContext) => Promise<T>) {
    assertSpaceAccess(req, spaceId);
    const actor = getActorInfo(req);
    const publications: ActivityPublication[] = [];
    const setup = await projectSkillSetupIdentity(db, spaceId, req.actor);
    const result = await operation({
      actor: skillActor(req),
      setup: { userId: setup.refreshUserId, agentId: setup.refreshAgentId, localTrusted: setup.refreshLocalTrusted },
      read: connectionId => skillSourceGitHubReader(db, spaceId, req.actor, connectionId),
      authorize: (action, resource) => assertCanMutateSpaceSkills(req, spaceId, action, resource),
      audit: async (tx, sourceId, action, details) => {
        const { publication } = await persistActivity(tx as unknown as Db, { ...actor, spaceId, action, entityType: "space_skill_source", entityId: sourceId, details });
        publications.push(publication);
      },
    });
    publications.forEach(publishActivity);
    return result;
  }

  router.get("/spaces/:spaceId/skill-sources/project-repositories", async (req, res) => {
    const spaceId = String(req.params.spaceId);
    assertSpaceAccess(req, spaceId);
    res.json(await projectSkillRepositories(db, spaceId, req.actor));
  });
  router.post("/spaces/:spaceId/skill-sources/adopt-project", validate(projectSkillSourceAdoptSchema), async (req, res) => {
    const spaceId = String(req.params.spaceId);
    const result = await sourceOperation(req, spaceId, context => adoptProjectSkillRepository(db, spaceId, req.body.workspaceId, context.authorize));
    publishActivity(result.publication);
    res.status(202).json({ bindingId: result.bindingId });
  });
  router.patch("/spaces/:spaceId/skill-sources/:sourceId/settings", validate(skillSourceSettingsSchema), async (req, res) => {
    const spaceId = String(req.params.spaceId);
    res.json(await sourceOperation(req, spaceId, context => sourceSvc.settings(spaceId, String(req.params.sourceId), req.body, context)));
  });
  router.get("/spaces/:spaceId/skill-sources/:sourceId/branches", async (req, res) => {
    const spaceId = String(req.params.spaceId);
    const input = skillSourceBranchesQuerySchema.parse({ connectionId: firstQueryString(req.query.connectionId) });
    const controller = new AbortController();
    const stop = () => controller.abort();
    res.once("close", stop);
    try { res.json(await sourceOperation(req, spaceId, context => sourceSvc.branches(spaceId, String(req.params.sourceId), input, context, controller.signal))); }
    finally { res.off("close", stop); }
  });
  router.get("/spaces/:spaceId/skill-sources/repositories", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const viewer = req.actor.type === "operator"
      ? { userId: req.actor.userId ?? null, localTrusted: req.actor.source === "local_implicit" }
      : await projectToolContext(db, req.actor);
    res.json(await toolAccessService(db).listGitHubRepositories(spaceId, viewer.userId, viewer.localTrusted));
  });
  router.get("/spaces/:spaceId/skill-sources", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await sourceSvc.list(spaceId));
  });
  router.post("/spaces/:spaceId/skill-sources/discover", validate(skillSourceDiscoverySchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    res.vary("Accept");
    if (!req.get("Accept")?.includes("application/x-ndjson")) {
      res.json(await sourceOperation(req, spaceId, context => sourceSvc.discover(req.body, context)));
      return;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    res.on("close", stop);
    const send = async (event: SkillSourceDiscoveryEvent) => {
      controller.signal.throwIfAborted();
      if (!res.headersSent) {
        res.set({ "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
        res.flushHeaders();
      }
      if (!res.write(`${JSON.stringify(event)}\n`)) {
        const stalled = setTimeout(() => {
          controller.abort();
          res.destroy();
        }, 30_000);
        stalled.unref();
        try {
          await once(res, "drain", { signal: controller.signal });
        } finally {
          clearTimeout(stalled);
        }
      }
    };
    try {
      const discovery = await sourceOperation(req, spaceId, context => sourceSvc.discover(req.body, context, { signal: controller.signal, onProgress: send }));
      await send({ type: "complete", discovery });
    } catch (error) {
      if (controller.signal.aborted) return;
      // Preserve normal HTTP errors (including session recovery) before streaming starts.
      if (!res.headersSent) throw error;
      await send({ type: "error", status: error instanceof HttpError ? error.status : 500,
        error: error instanceof HttpError ? error.message : "Repository scan interrupted. Try again." });
    } finally {
      res.off("close", stop);
      if (res.headersSent && !res.destroyed) res.end();
    }
  });
  router.post("/spaces/:spaceId/skill-sources/preview", validate(skillSourcePreviewSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    res.json(await sourceOperation(req, spaceId, context => sourceSvc.preview(req.body, context)));
  });
  router.post("/spaces/:spaceId/skill-sources", validate(skillSourceCreateSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    res.status(201).json(await sourceOperation(req, spaceId, context => sourceSvc.create(spaceId, req.body, context)));
  });
  router.get("/spaces/:spaceId/skill-sources/:sourceId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await sourceSvc.detail(spaceId, req.params.sourceId as string));
  });
  router.patch("/spaces/:spaceId/skill-sources/:sourceId", validate(skillSourceSelectionSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    res.json(await sourceOperation(req, spaceId, context => sourceSvc.refresh(spaceId, req.params.sourceId as string, context, req.body)));
  });
  router.post("/spaces/:spaceId/skill-sources/:sourceId/refresh", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    res.json(await sourceOperation(req, spaceId, context => sourceSync.refreshSource(spaceId, req.params.sourceId as string, context)));
  });
  router.delete("/spaces/:spaceId/skill-sources/:sourceId", (req, _res, next) => {
    assertSpaceAccess(req, req.params.spaceId as string);
    next();
  }, validate(skillSourceDisconnectSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    res.json(await sourceOperation(req, spaceId, context => sourceSvc.disconnect(spaceId, req.params.sourceId as string, context, req.body)));
  });

  router.get("/spaces/:spaceId/skills", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.list(spaceId, spaceSkillListQuerySchema.parse({
      q: firstQueryString(req.query.q),
      sort: firstQueryString(req.query.sort),
      categories: [
        ...queryStringArray(req.query.category),
        ...queryStringArray(req.query.categories),
        ...queryStringArray(req.query["categories[]"]),
        ...queryStringArray(req.query.tag),
        ...queryStringArray(req.query.tags),
        ...queryStringArray(req.query["tags[]"]),
      ],
      scope: firstQueryString(req.query.scope),
      include: [
        ...queryStringArray(req.query.include),
        ...queryStringArray(req.query["include[]"]),
      ],
      folderId: firstQueryString(req.query.folderId),
      includeSubtree: optionalQueryBoolean(req.query.includeSubtree),
    }));
    res.json(result);
  });

  router.get("/spaces/:spaceId/skills/categories", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.categoryCounts(spaceId));
  });

  router.get("/spaces/:spaceId/skills/:skillId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.detail(spaceId, skillId, skillActor(req));
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.get("/spaces/:spaceId/skills/:skillId/fork-precheck", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.forkPrecheck(spaceId, skillId, skillActor(req));
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.get("/spaces/:spaceId/skills/:skillId/versions", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.listVersions(spaceId, skillId));
  });

  router.get("/spaces/:spaceId/skills/:skillId/versions/:versionId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    const versionId = req.params.versionId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.getVersion(spaceId, skillId, versionId);
    if (!result) {
      res.status(404).json({ error: "Skill version not found" });
      return;
    }
    res.json(result);
  });

  router.get("/spaces/:spaceId/skills/:skillId/test-inputs", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.listTestInputs(spaceId, skillId));
  });

  router.post(
    "/spaces/:spaceId/skills/:skillId/test-inputs",
    validate(spaceSkillTestInputCreateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.edit", () => skillPolicyResource({ spaceId, skillId }));
      const result = await svc.createTestInput(spaceId, skillId, req.body, skillActor(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_test_input_created",
        entityType: "space_skill_test_input",
        entityId: result.id,
        details: { skillId, name: result.name },
      });
      res.status(201).json(result);
    },
  );

  router.patch(
    "/spaces/:spaceId/skills/:skillId/test-inputs/:inputId",
    validate(spaceSkillTestInputUpdateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      const inputId = req.params.inputId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.edit", () => skillPolicyResource({ spaceId, skillId }));
      const result = await svc.updateTestInput(spaceId, skillId, inputId, req.body);
      if (!result) {
        res.status(404).json({ error: "Test input not found" });
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
        action: "space.skill_test_input_updated",
        entityType: "space_skill_test_input",
        entityId: result.id,
        details: { skillId, changedKeys: Object.keys(req.body).sort() },
      });
      res.json(result);
    },
  );

  router.delete("/spaces/:spaceId/skills/:skillId/test-inputs/:inputId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    const inputId = req.params.inputId as string;
    await assertCanMutateSpaceSkills(req, spaceId, "skills.edit", () => skillPolicyResource({ spaceId, skillId }));
    const result = await svc.deleteTestInput(spaceId, skillId, inputId);
    if (!result) {
      res.status(404).json({ error: "Test input not found" });
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
      action: "space.skill_test_input_deleted",
      entityType: "space_skill_test_input",
      entityId: result.id,
      details: { skillId, name: result.name },
    });
    res.json(result);
  });

  router.get("/spaces/:spaceId/skill-test-run-templates", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.listTestRunTemplates(spaceId));
  });

  router.post(
    "/spaces/:spaceId/skill-test-run-templates",
    validate(spaceSkillTestRunTemplateCreateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.edit");
      const result = await svc.createTestRunTemplate(spaceId, req.body, skillActor(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_test_run_template_created",
        entityType: "space_skill_test_run_template",
        entityId: result.id,
        details: { name: result.name },
      });
      res.status(201).json(result);
    },
  );

  router.patch(
    "/spaces/:spaceId/skill-test-run-templates/:templateId",
    validate(spaceSkillTestRunTemplateUpdateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const templateId = req.params.templateId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.edit");
      const result = await svc.updateTestRunTemplate(spaceId, templateId, req.body, skillActor(req));
      if (!result) {
        res.status(404).json({ error: "Test run template not found" });
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
        action: "space.skill_test_run_template_updated",
        entityType: "space_skill_test_run_template",
        entityId: result.id,
        details: { changedKeys: Object.keys(req.body).sort() },
      });
      res.json(result);
    },
  );

  router.delete("/spaces/:spaceId/skill-test-run-templates/:templateId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const templateId = req.params.templateId as string;
    await assertCanMutateSpaceSkills(req, spaceId, "skills.edit");
    const result = await svc.deleteTestRunTemplate(spaceId, templateId);
    if (!result) {
      res.status(404).json({ error: "Test run template not found" });
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
      action: "space.skill_test_run_template_deleted",
      entityType: "space_skill_test_run_template",
      entityId: result.id,
      details: { name: result.name },
    });
    res.json(result);
  });

  router.get("/spaces/:spaceId/skills/:skillId/test-runs", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    const query = spaceSkillTestRunListQuerySchema.parse({
      inputId: firstQueryString(req.query.inputId),
    });
    res.json(await svc.listTestRuns(spaceId, skillId, query));
  });

  router.get("/spaces/:spaceId/skills/:skillId/test-runs/:runId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    const runId = req.params.runId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.getTestRunDetail(spaceId, skillId, runId);
    if (!result) {
      res.status(404).json({ error: "Test run not found" });
      return;
    }
    res.json(result);
  });

  router.post(
    "/spaces/:spaceId/skills/:skillId/test-runs",
    validate(spaceSkillTestRunCreateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.test", () => skillPolicyResource({ spaceId, skillId }));
      await assertCanOrchestrateSkillTestHarness(req, spaceId, {
        assigneeAgentId: req.body.agentId,
      });
      const actor = getActorInfo(req);
      const skill = await svc.getById(spaceId, skillId);
      let skillProjectId: string | undefined;
      if (skill?.accessSourceId) {
        const bindings = await skillAccessService(db).projectIds(spaceId, skill.accessSourceId);
        const testActor: AuthorizationActor = { type: "agent", agentId: req.body.agentId, spaceId, source: "agent_key",
          onBehalfOfUserId: req.actor.source === "local_implicit" ? null : req.actor.userId ?? req.actor.onBehalfOfUserId };
        for (const binding of bindings) {
          if ((await access.decide({ actor: testActor, action: "project:read", resource: { type: "project", spaceId, projectId: binding.projectId } })).allowed) { skillProjectId = binding.projectId; break; }
        }
        if (!skillProjectId) throw forbidden("Choose an agent with access to this skill's project.");
      }
      const result = await svc.createTestRun(spaceId, skillId, req.body, skillActor(req), {
        createHarnessIssue: async (harnessIssue) => {
          const created = await issues.create(spaceId, {
            ...harnessIssue,
            ...(skillProjectId ? { projectId: skillProjectId, visibility: "private" as const } : {}),
            priority: "medium",
            createdByAgentId: actor.agentId,
            createdByUserId: actor.actorType === "user" ? actor.actorId : null,
            actorRunId: actor.runId,
          });
          await logActivity(db, {
            spaceId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "issue.created",
            entityType: "issue",
            entityId: created.id,
            details: {
              title: created.title,
              identifier: created.identifier,
              harnessKind: "skill_test",
              source: "space_skill_test_run",
              skillId,
            },
          });
          return { id: created.id };
        },
        wakeHarnessIssue: async (issueId, agentId) => heartbeat.wakeup(agentId, {
          source: "assignment",
          triggerDetail: "system",
          reason: "skill_test_run_created",
          payload: { issueId, skillId },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: { issueId, source: "space.skill_test_run" },
        }),
        cleanupHarnessIssue: async (issueId) => {
          const issue = await issues.getById(issueId);
          if (!issue || issue.spaceId !== spaceId) return;
          await issues.update(issueId, {
            status: "cancelled",
            hiddenAt: new Date(),
            actorAgentId: actor.agentId ?? null,
            actorUserId: actor.actorType === "user" ? actor.actorId : null,
          });
          await logActivity(db, {
            spaceId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "space.skill_test_harness_issue_cleaned_up",
            entityType: "issue",
            entityId: issueId,
            details: { skillId },
          });
        },
      });
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_test_run_created",
        entityType: "space_skill_test_run",
        entityId: result.id,
        issueId: result.issueId,
        details: {
          skillId,
          inputId: result.inputId,
          skillVersionId: result.skillVersionId,
          agentId: result.agentId,
          issueId: result.issueId,
        },
      });
      res.status(201).json(result);
    },
  );

  router.post("/spaces/:spaceId/skills/:skillId/test-runs/:runId/cancel", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    const runId = req.params.runId as string;
    await assertCanMutateSpaceSkills(req, spaceId, "skills.test", () => skillPolicyResource({ spaceId, skillId }));
    await assertCanOrchestrateSkillTestHarness(req, spaceId, await loadSkillTestRunAssignmentScope(spaceId, skillId, runId));
    const actor = getActorInfo(req);
    const result = await svc.cancelTestRun(spaceId, skillId, runId, {
      cancelHarnessIssue: async (issueId) => {
        const issue = await issues.getById(issueId);
        if (!issue || issue.spaceId !== spaceId) return;
        if (issue.executionRunId) {
          await heartbeat.cancelRun(issue.executionRunId, "Cancelled by skill test run request");
        }
        if (issue.status !== "done" && issue.status !== "cancelled") {
          await issues.update(issueId, {
            status: "cancelled",
            actorAgentId: actor.agentId ?? null,
            actorUserId: actor.actorType === "user" ? actor.actorId : null,
          });
        }
      },
    });
    if (!result) {
      res.status(404).json({ error: "Test run not found" });
      return;
    }
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "space.skill_test_run_cancelled",
      entityType: "space_skill_test_run",
      entityId: result.id,
      issueId: result.issueId,
      details: { skillId, issueId: result.issueId },
    });
    res.json(result);
  });

  router.delete("/spaces/:spaceId/skills/:skillId/test-runs/:runId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    const runId = req.params.runId as string;
    await assertCanMutateSpaceSkills(req, spaceId, "skills.test", () => skillPolicyResource({ spaceId, skillId }));
    await assertCanOrchestrateSkillTestHarness(req, spaceId, await loadSkillTestRunAssignmentScope(spaceId, skillId, runId));
    const actor = getActorInfo(req);
    const result = await svc.deleteTestRun(spaceId, skillId, runId, {
      hideHarnessIssue: async (issueId) => {
        const issue = await issues.getById(issueId);
        if (!issue || issue.spaceId !== spaceId) return;
        await issues.update(issueId, {
          hiddenAt: new Date(),
          actorAgentId: actor.agentId ?? null,
          actorUserId: actor.actorType === "user" ? actor.actorId : null,
        });
      },
    });
    if (!result) {
      res.status(404).json({ error: "Test run not found" });
      return;
    }
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "space.skill_test_run_deleted",
      entityType: "space_skill_test_run",
      entityId: result.id,
      issueId: result.issueId,
      details: { skillId, issueId: result.issueId },
    });
    res.json(result);
  });

  router.post(
    "/spaces/:spaceId/skills/:skillId/versions",
    validate(spaceSkillVersionCreateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.create", () => skillPolicyResource({ spaceId, skillId }));
      const publication = contentPublication(req, spaceId, skillId, "skills.create", (_skill, version) => ({
        action: "space.skill_version_created", entityType: "space_skill_version", entityId: version.id,
        details: { skillId, revisionNumber: version.revisionNumber, label: version.label },
      }));
      const result = await svc.createVersion(spaceId, skillId, req.body, skillActor(req), { publication: publication.hooks });
      const actor = getActorInfo(req);
      if (!publication.publish()) await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_version_created",
        entityType: "space_skill_version",
        entityId: result.id,
        details: {
          skillId,
          revisionNumber: result.revisionNumber,
          label: result.label,
        },
      });
      res.status(201).json(result);
    },
  );

  router.post("/spaces/:spaceId/skills/:skillId/star", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.starSkill(spaceId, skillId, skillActor(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "space.skill_starred",
      entityType: "space_skill",
      entityId: skillId,
      details: { starCount: result.starCount },
    });
    res.json(result);
  });

  router.delete("/spaces/:spaceId/skills/:skillId/star", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.unstarSkill(spaceId, skillId, skillActor(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "space.skill_unstarred",
      entityType: "space_skill",
      entityId: skillId,
      details: { starCount: result.starCount },
    });
    res.json(result);
  });

  router.post(
    "/spaces/:spaceId/skills/:skillId/fork",
    validate(spaceSkillForkSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(
        req,
        spaceId,
        "skills.create",
        () => skillPolicyResource({ spaceId, skillId }),
      );
      const publication = contentPublication(req, spaceId, skillId, "skills.create", skill => ({
        action: "space.skill_forked", details: { sourceSkillId: skillId, slug: skill.slug, name: skill.name,
          reassignedAgentIds: req.body.reassignAgentIds ?? [] },
      }));
      const result = await svc.forkSkill(spaceId, skillId, req.body, skillActor(req), publication.hooks);
      const actor = getActorInfo(req);
      if (!publication.publish()) await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_forked",
        entityType: "space_skill",
        entityId: result.skill.id,
        details: {
          sourceSkillId: skillId,
          slug: result.skill.slug,
          name: result.skill.name,
          reassignedAgentIds: result.reassignments.map((entry: { agentId: string }) => entry.agentId),
        },
      });
      res.status(201).json(result);
    },
  );

  router.post(
    "/spaces/:spaceId/skills/:skillId/rename",
    validate(spaceSkillRenameSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(
        req,
        spaceId,
        "skills.edit",
        () => skillPolicyResource({ spaceId, skillId }),
      );
      const before = (await svc.getById(spaceId, skillId))!;
      const publication = contentPublication(req, spaceId, skillId, "skills.edit", skill => ({
        action: "space.skill_renamed", details: { previousName: before.name, previousSlug: before.slug,
          previousKey: before.key, name: skill.name, slug: skill.slug, key: skill.key },
      }));
      const result = await svc.renameSkill(spaceId, skillId, req.body, publication.hooks);
      const published = publication.publish();
      const changed = result.previousName !== result.skill.name
        || result.previousSlug !== result.skill.slug
        || result.previousKey !== result.skill.key;
      if (changed && !published) {
        const actor = getActorInfo(req);
        await logActivity(db, {
          spaceId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          agentApiKeyId: actor.agentApiKeyId,
          action: "space.skill_renamed",
          entityType: "space_skill",
          entityId: result.skill.id,
          details: {
            previousName: result.previousName,
            previousSlug: result.previousSlug,
            previousKey: result.previousKey,
            name: result.skill.name,
            slug: result.skill.slug,
            key: result.skill.key,
            reassignedAgentIds: result.reassignments.map((entry: { agentId: string }) => entry.agentId),
          },
        });
      }
      res.json(result);
    },
  );

  router.get("/spaces/:spaceId/skills/:skillId/comments", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.listComments(spaceId, skillId));
  });

  router.post(
    "/spaces/:spaceId/skills/:skillId/comments",
    validate(spaceSkillCommentCreateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      assertSpaceAccess(req, spaceId);
      const result = await svc.createComment(spaceId, skillId, req.body, skillActor(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_comment_created",
        entityType: "space_skill_comment",
        entityId: result.id,
        details: { skillId, parentCommentId: result.parentCommentId },
      });
      res.status(201).json(result);
    },
  );

  router.patch(
    "/spaces/:spaceId/skills/:skillId/comments/:commentId",
    validate(spaceSkillCommentUpdateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      const commentId = req.params.commentId as string;
      assertSpaceAccess(req, spaceId);
      const result = await svc.updateComment(spaceId, skillId, commentId, req.body, skillActor(req));
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_comment_updated",
        entityType: "space_skill_comment",
        entityId: result.id,
        details: { skillId },
      });
      res.json(result);
    },
  );

  router.delete("/spaces/:spaceId/skills/:skillId/comments/:commentId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    const commentId = req.params.commentId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.deleteComment(spaceId, skillId, commentId, skillActor(req));
    const actor = getActorInfo(req);
    await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "space.skill_comment_deleted",
      entityType: "space_skill_comment",
      entityId: result.id,
      details: { skillId },
    });
    res.json(result);
  });

  router.get("/spaces/:spaceId/skills/:skillId/update-status", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    assertSpaceAccess(req, spaceId);
    const managed = await sourceSvc.sourceForSkill(spaceId, skillId);
    if (managed) {
      const skill = await svc.getById(spaceId, skillId);
      if (!managed.enabled || managed.entries.find(entry => entry.skillId === skillId)?.selection !== "selected") { res.json({ supported: false, reason: "Source is disconnected. Reconnect it in Skills → Sources.", trackingRef: managed.trackingRef, currentRef: skill?.sourceRef, latestRef: null, hasUpdate: false }); return; }
      const read = skillSourceGitHubReader(db, spaceId, req.actor, managed.connectionId);
      const latest = await read(`/repos/${managed.fullName}/commits/${encodeURIComponent(managed.trackingRef)}`) as { sha: string };
      res.json({ supported: true, reason: null, trackingRef: managed.trackingRef, currentRef: skill?.sourceRef, latestRef: latest.sha, hasUpdate: latest.sha !== managed.lastScanCommit });
      return;
    }
    const result = await svc.updateStatus(spaceId, skillId);
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  // Shows exactly what a pending tracked-source update would change, so a
  // reviewer never has to compare two full snapshots by eye.
  router.get("/spaces/:spaceId/skills/:skillId/update-diff", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    // The skillId parameter handler has already checked space access and that this actor can read the skill.
    assertSpaceAccess(req, spaceId);
    const unsupported = (reason: string, currentRef: string | null = null, latestRef: string | null = null): SkillSourceUpdateDiff =>
      ({ supported: false, reason, currentRef, latestRef, hasUpdate: false, files: [], truncated: false });
    const skill = await svc.getById(spaceId, skillId);
    if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }
    const managed = await sourceSvc.sourceForSkill(spaceId, skillId);
    const entry = managed?.entries.find(row => row.skillId === skillId);
    if (!managed || !entry) { res.json(unsupported("Only skills installed from a tracked GitHub source have an update diff.", skill.sourceRef ?? null)); return; }
    if (!managed.enabled || entry.selection !== "selected") { res.json(unsupported("Source is disconnected. Reconnect it in Skills → Sources.", skill.sourceRef ?? null)); return; }
    const currentRef = skill.sourceRef ?? null;
    if (!currentRef || !/^[a-f0-9]{40}$/i.test(currentRef)) { res.json(unsupported("The installed source revision is unknown.", currentRef)); return; }
    // Stop the GitHub reads and both scans when the caller goes away; they hold shared scan and download slots.
    const controller = new AbortController();
    const stop = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", stop);
    try {
      const read = skillSourceGitHubReader(db, spaceId, req.actor, managed.connectionId);
      const latest = await read(`/repos/${managed.fullName}/commits/${encodeURIComponent(managed.trackingRef)}`, controller.signal) as { sha: string };
      if (latest.sha.toLowerCase() === currentRef.toLowerCase()) {
        res.json({ supported: true, reason: null, currentRef, latestRef: latest.sha, hasUpdate: false, files: [], truncated: false } satisfies SkillSourceUpdateDiff);
        return;
      }
      const diff = await diffGitHubSkillUpdate({
        repositoryUrl: managed.repositoryUrl, packageMode: managed.packageMode, skillPath: entry.path, installedCommitSha: currentRef, latestCommitSha: latest.sha,
      }, read, controller.signal);
      const result: SkillSourceUpdateDiff = diff.supported
        ? { supported: true, reason: null, currentRef, latestRef: latest.sha, hasUpdate: true, files: diff.files, truncated: diff.truncated }
        : { ...unsupported(diff.reason, currentRef, latest.sha), hasUpdate: true };
      res.json(result);
    } finally { res.off("close", stop); }
  });

  router.get("/spaces/:spaceId/skills/:skillId/files", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    const relativePath = String(req.query.path ?? "SKILL.md");
    assertSpaceAccess(req, spaceId);
    const result = await svc.readFile(spaceId, skillId, relativePath);
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.post(
    "/spaces/:spaceId/skills",
    validate(spaceSkillCreateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.create", {
        sourceType: "generated",
      });
      const { idempotencyKey, ...input } = req.body;
      const actor = getActorInfo(req);
      const runContext = req.actor.type === "agent" && req.actor.source === "agent_jwt" && req.actor.runId
        ? await projectToolContext(db, req.actor, true, "Skill") : null;
      const event = (skill: Awaited<ReturnType<typeof svc.createLocalSkill>>) => ({
        spaceId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId,
        runId: actor.runId, agentApiKeyId: actor.agentApiKeyId, issueId: runContext?.issue.id,
        action: "space.skill_created", entityType: "space_skill", entityId: skill.id,
        details: { slug: skill.slug, name: skill.name, description: skill.description,
          sourceIssueId: runContext?.issue.id ?? null, versionId: skill.currentVersionId },
      });
      const receiptKey = idempotencyKey
        ? `skill:${spaceId}:${actor.actorId}:${runContext?.issue.id ?? "operator"}:${idempotencyKey}` : null;
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      let publication: ActivityPublication | null = null;
      const replay = async (database: Db) => {
        if (!receiptKey) return null;
        const [receipt] = await database.select().from(spaceSkillMutationReceipts).where(and(
          eq(spaceSkillMutationReceipts.spaceId, spaceId), eq(spaceSkillMutationReceipts.key, receiptKey)));
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw conflict("Skill idempotency key was used with different inputs");
          if (!await spaceSkillService(database).getById(spaceId, receipt.skillId)) {
            throw conflict("Previously created skill is no longer available");
          }
          const { files } = await managedSkillContent(database).read(spaceId, receipt.skillId, receipt.versionId);
          return { ...receipt.response, markdown: files.find(file => file.path === "SKILL.md")!.content };
        }
        const [prior] = await database.select().from(activityLog).where(and(
          eq(activityLog.spaceId, spaceId), eq(activityLog.action, "space.skill_created"),
          sql`${activityLog.details}->>'idempotencyKey' = ${receiptKey}`,
        ));
        if (!prior) return null;
        if (prior.details?.fingerprint !== fingerprint) throw conflict("Skill idempotency key was used with different inputs");
        const service = spaceSkillService(database);
        const skill = await service.getById(spaceId, prior.entityId);
        if (!skill) throw conflict("Previously created skill is no longer available");
        return skill;
      };
      const prior = await replay(db);
      if (prior) { res.status(200).json(prior); return; }
      const replayed = new Error("Skill publication already committed");
      const hooks: SkillContentPublication = {
        beforeLock: async tx => {
          if (!receiptKey) return;
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${receiptKey}, 0))`);
          const [receipt] = await tx.select({ key: spaceSkillMutationReceipts.key }).from(spaceSkillMutationReceipts)
            .where(and(eq(spaceSkillMutationReceipts.spaceId, spaceId), eq(spaceSkillMutationReceipts.key, receiptKey)));
          if (receipt) throw replayed;
        },
        validate: async tx => {
          await assertCanMutateSpaceSkills(req, spaceId, "skills.create", { sourceType: "generated" }, tx as unknown as Db);
          if (runContext) await projectToolContext(tx as unknown as Db, req.actor, true, "Skill");
        },
        afterPublish: async (tx, row) => {
          const skill = (await spaceSkillService(tx as unknown as Db).getById(spaceId, row.id))!;
          if (receiptKey) {
            const { markdown: _markdown, folderPath: _folderPath, ...response } = skill;
            await tx.insert(spaceSkillMutationReceipts).values({ spaceId, key: receiptKey, fingerprint,
              skillId: skill.id, versionId: skill.currentVersionId!, response });
          }
          const activity = await persistActivity(tx as unknown as Db, {
            ...event(skill), details: { ...event(skill).details,
              ...(receiptKey ? { idempotencyKey: receiptKey, fingerprint } : {}) },
          });
          publication = activity.publication;
        },
      };
      try {
        const skill = await svc.createLocalSkill(spaceId, input, skillActor(req), hooks);
        if (publication) publishCommittedActivity(publication);
        res.status(201).json(skill);
      } catch (error) {
        if (error !== replayed) throw error;
        res.status(200).json(await replay(db));
      }
    },
  );

  router.patch(
    "/spaces/:spaceId/skills/:skillId",
    validate(spaceSkillUpdateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.edit", () => skillPolicyResource({ spaceId, skillId }));
      const result = await svc.updateSkill(spaceId, skillId, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_updated",
        entityType: "space_skill",
        entityId: result.id,
        details: {
          slug: result.slug,
          categories: result.categories,
          sharingScope: result.sharingScope,
        },
      });

      res.json(result);
    },
  );

  router.patch(
    "/spaces/:spaceId/skills/:skillId/files",
    validate(spaceSkillFileUpdateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.edit", () => skillPolicyResource({ spaceId, skillId }));
      const { idempotencyKey, expectedVersionId, ...input } = req.body;
      const installed = await svc.getById(spaceId, skillId);
      if (installed?.sourceType === "managed") {
        const actor = getActorInfo(req);
        const runContext = req.actor.type === "agent" && req.actor.source === "agent_jwt" && req.actor.runId
          ? await projectToolContext(db, req.actor, true, "Skill") : null;
        const receiptKey = idempotencyKey
          ? `skill-file:${spaceId}:${actor.actorId}:${runContext?.issue.id ?? "operator"}:${skillId}:${idempotencyKey}` : null;
        const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, expectedVersionId })).digest("hex");
        const replay = async (database: Db) => {
          if (!receiptKey) return null;
          const [prior] = await database.select({ details: activityLog.details }).from(activityLog).where(and(
            eq(activityLog.spaceId, spaceId), eq(activityLog.action, "space.skill_file_updated"),
            sql`${activityLog.details}->>'idempotencyKey' = ${receiptKey}`,
          ));
          if (!prior) return null;
          if (prior.details?.fingerprint !== fingerprint) throw conflict("Skill file idempotency key was used with different inputs");
          return prior.details?.receipt;
        };
        const prior = await replay(db);
        if (prior) { res.json(prior); return; }
        let receipt: unknown;
        let publication: ActivityPublication | null = null;
        const replayed = new Error("Skill publication already committed");
        try {
          const result = await svc.updateFile(spaceId, skillId, input.path, input.content, skillActor(req), {
            encoding: input.encoding, executable: input.executable, expectedVersionId,
            publication: {
              beforeLock: async tx => {
                if (!receiptKey) return;
                await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${receiptKey}, 0))`);
                receipt = await replay(tx as unknown as Db);
                if (receipt) throw replayed;
              },
              validate: async tx => {
                await assertCanMutateSpaceSkills(req, spaceId, "skills.edit", () => skillPolicyResource({ spaceId, skillId }, tx as unknown as Db), tx as unknown as Db);
                if (runContext) await projectToolContext(tx as unknown as Db, req.actor, true, "Skill");
              },
              afterPublish: async (tx, _skill, version) => {
                receipt = { skillId, path: input.path, versionId: version.id, studioPath: `/skills/studio/${encodeURIComponent(skillId)}` };
                const activity = await persistActivity(tx as unknown as Db, {
                  spaceId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId,
                  runId: actor.runId, agentApiKeyId: actor.agentApiKeyId, issueId: runContext?.issue.id,
                  action: "space.skill_file_updated", entityType: "space_skill", entityId: skillId,
                  details: { path: input.path, markdown: input.path === "SKILL.md", versionId: version.id,
                    sourceIssueId: runContext?.issue.id ?? null,
                    ...(receiptKey ? { idempotencyKey: receiptKey, fingerprint, receipt } : {}) },
                });
                publication = activity.publication;
              },
            },
          });
          if (publication) publishCommittedActivity(publication);
          res.json(idempotencyKey ? receipt : result);
        } catch (error) {
          if (error !== replayed) {
            if (!receiptKey) throw error;
            receipt = await db.transaction(async tx => {
              await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${receiptKey}, 0))`);
              return replay(tx as unknown as Db);
            });
            if (!receipt) throw error;
          }
          res.json(receipt);
        }
        return;
      }
      if (idempotencyKey) {
        const actor = getActorInfo(req);
        const runContext = req.actor.type === "agent" && req.actor.source === "agent_jwt" && req.actor.runId
          ? await projectToolContext(db, req.actor, true, "Skill") : null;
        const receiptKey = `skill-file:${spaceId}:${actor.actorId}:${runContext?.issue.id ?? "operator"}:${skillId}:${idempotencyKey}`;
        const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, expectedVersionId })).digest("hex");
        const rollbackState: { current: { restore: () => Promise<void>; versionId: string | null } | null } = { current: null };
        const outcome = await db.transaction(async tx => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${receiptKey}, 0))`);
          if (runContext) await projectToolContext(tx as unknown as Db, req.actor, true, "Skill");
          const [prior] = await tx.select().from(activityLog).where(and(
            eq(activityLog.spaceId, spaceId), eq(activityLog.action, "space.skill_file_updated"),
            sql`${activityLog.details}->>'idempotencyKey' = ${receiptKey}`,
          ));
          if (prior) {
            if (prior.details?.fingerprint !== fingerprint) throw conflict("Skill file idempotency key was used with different inputs");
            return { receipt: prior.details?.receipt, publication: null };
          }
          let publication: ActivityPublication | null = null;
          let receipt: { skillId: string; path: string; versionId: string | null; studioPath: string } | null = null;
          await spaceSkillService(tx as unknown as Db, { packageDb: db }).updateFile(spaceId, skillId, input.path, input.content, skillActor(req), {
            encoding: input.encoding, executable: input.executable, expectedVersionId,
            onRollback: (restore, versionId) => { rollbackState.current = { restore, versionId }; },
            afterUpdate: async (versionId) => {
              receipt = { skillId, path: input.path, versionId, studioPath: `/skills/studio/${encodeURIComponent(skillId)}` };
              const activity = await persistActivity(tx as unknown as Db, {
                spaceId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId,
                runId: actor.runId, agentApiKeyId: actor.agentApiKeyId, issueId: runContext?.issue.id,
                action: "space.skill_file_updated", entityType: "space_skill", entityId: skillId,
                details: { path: input.path, markdown: input.path === "SKILL.md", versionId,
                  sourceIssueId: runContext?.issue.id ?? null, idempotencyKey: receiptKey, fingerprint, receipt },
              });
              publication = activity.publication;
            },
          });
          return { receipt, publication };
        }).catch(async (error) => {
          if (rollbackState.current) {
            const { restore, versionId } = rollbackState.current;
            await db.transaction(async tx => {
              await tx.execute(sql`select ${spaceSkills.id} from ${spaceSkills} where ${spaceSkills.id} = ${skillId} and ${spaceSkills.spaceId} = ${spaceId} for update`);
              const [current] = await tx.select({ versionId: spaceSkills.currentVersionId }).from(spaceSkills)
                .where(and(eq(spaceSkills.id, skillId), eq(spaceSkills.spaceId, spaceId)));
              if (current && current.versionId === versionId) await restore();
            });
          }
          throw error;
        });
        if (outcome.publication) publishActivity(outcome.publication);
        res.json(outcome.receipt);
        return;
      }
      const result = await svc.updateFile(
        spaceId,
        skillId,
        String(req.body.path ?? ""),
        String(req.body.content ?? ""),
        skillActor(req),
        { encoding: req.body.encoding, executable: req.body.executable, expectedVersionId },
      );

      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_file_updated",
        entityType: "space_skill",
        entityId: skillId,
        details: {
          path: result.path,
          markdown: result.markdown,
        },
      });

      res.json(result);
    },
  );

  router.delete(
    "/spaces/:spaceId/skills/:skillId/files",
    validate(spaceSkillFileDeleteSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.edit", () => skillPolicyResource({ spaceId, skillId }));
      const before = (await svc.getById(spaceId, skillId))!;
      const publication = contentPublication(req, spaceId, skillId, "skills.edit", (_skill, version) => ({
        action: "space.skill_file_deleted", details: { path: req.body.path, target: req.body.target,
          deletedPaths: before.fileInventory.map(file => file.path).filter(file => req.body.target === "folder"
            ? file.startsWith(`${req.body.path}/`) : file === req.body.path), versionId: version.id },
      }));
      const result = await svc.deleteFile(spaceId, skillId, req.body, skillActor(req), publication.hooks);

      const actor = getActorInfo(req);
      if (!publication.publish()) await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_file_deleted",
        entityType: "space_skill",
        entityId: skillId,
        details: {
          path: result.path,
          target: result.target,
          deletedPaths: result.deletedPaths,
        },
      });

      res.json(result);
    },
  );

  router.post(
    "/spaces/:spaceId/skills/import",
    validate(spaceSkillImportSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const source = String(req.body.source ?? "");
      await assertCanMutateSpaceSkills(req, spaceId, "skills.import", () => skillImportPolicyResource(source));
      const parsed = parseSkillImportSourceInput(source);
      const managedGitHub = !parsed.originalSkillsShUrl && /^https:\/\/github\.com\//.test(parsed.resolvedSource);
      const result = managedGitHub
        ? await sourceOperation(req, spaceId, context => sourceSvc.importFromUrl(spaceId, source, context))
        : await svc.importFromSource(spaceId, source);

      const actor = getActorInfo(req);
      if (!managedGitHub) await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skills_imported",
        entityType: "space",
        entityId: spaceId,
        details: {
          source,
          importedCount: result.imported.length,
          importedSlugs: result.imported.map((skill) => skill.slug),
          warningCount: result.warnings.length,
        },
      });
      const telemetryClient = getTelemetryClient();
      if (telemetryClient) {
        for (const skill of result.imported) {
          trackSkillImported(telemetryClient, {
            sourceType: skill.sourceType,
            skillRef: deriveTrackedSkillRef(skill),
          });
        }
      }

      res.status(201).json(result);
    },
  );

  router.post(
    "/spaces/:spaceId/skills/browse-project",
    validate(spaceSkillProjectBrowseRequestSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.import", { sourceType: "workspace" });
      const result = await svc.browseProjectWorkspace(spaceId, req.body);
      res.json(result);
    },
  );

  router.post(
    "/spaces/:spaceId/skills/scan-projects",
    validate(spaceSkillProjectScanRequestSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.import", { sourceType: "workspace" });
      const result = await svc.scanProjectWorkspaces(spaceId, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skills_scanned",
        entityType: "space",
        entityId: spaceId,
        details: {
          mode: req.body.mode ?? "import",
          scannedProjects: result.scannedProjects,
          scannedWorkspaces: result.scannedWorkspaces,
          discovered: result.discovered,
          candidateCount: result.candidates.length,
          importedCount: result.imported.length,
          updatedCount: result.updated.length,
          conflictCount: result.conflicts.length,
          warningCount: result.warnings.length,
        },
      });

      res.json(result);
    },
  );

  router.delete("/spaces/:spaceId/skills/:skillId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const skillId = req.params.skillId as string;
    await assertCanMutateSpaceSkills(req, spaceId, "skills.remove", () => skillPolicyResource({ spaceId, skillId }));
    let committed: ActivityPublication | null = null;
    const result = await svc.deleteSkill(spaceId, skillId, async (tx, deleted) => {
      for (const skill of deleted) committed = (await persistActivity(tx as unknown as Db, {
        spaceId, ...getActorInfo(req), action: "space.skill_deleted", entityType: "space_skill",
        entityId: skill.id, details: { slug: skill.slug, name: skill.name },
      })).publication;
    }, async tx => {
      const database = tx as unknown as Db;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.remove",
        () => skillPolicyResource({ spaceId, skillId }, database), database);
    });
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }

    const actor = getActorInfo(req);
    if (committed) publishCommittedActivity(committed);
    else await logActivity(db, {
      spaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "space.skill_deleted",
      entityType: "space_skill",
      entityId: result.id,
      details: {
        slug: result.slug,
        name: result.name,
      },
    });

    res.json(result);
  });

  router.post(
    "/spaces/:spaceId/skills/:skillId/audit",
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.test", () => skillPolicyResource({ spaceId, skillId }));
      const result = await svc.auditSkill(spaceId, skillId);
      if (!result) {
        res.status(404).json({ error: "Skill not found" });
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
        action: "space.skill_audited",
        entityType: "space_skill",
        entityId: skillId,
        details: {
          verdict: result.verdict,
          codes: result.codes,
          installedHash: result.installedHash,
          originHash: result.originHash,
          scanVersion: result.scanVersion,
        },
      });

      res.json(result);
    },
  );

  router.post(
    "/spaces/:spaceId/skills/:skillId/install-update",
    validate(spaceSkillInstallUpdateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSpaceSkills(req, spaceId, "skills.update", () => skillPolicyResource({ spaceId, skillId }));
      const before = await svc.getById(spaceId, skillId);
      const managed = await sourceSvc.sourceForSkill(spaceId, skillId);
      if (managed) {
        if (managed.entries.find(entry => entry.skillId === skillId)?.selection !== "selected") throw conflict("This skill is no longer selected. Manage its source to resume syncing.");
        const result = await sourceOperation(req, spaceId, context => sourceSvc.refresh(spaceId, managed.id, context));
        const entry = result.source.entries.find(entry => entry.skillId === skillId);
        if (entry?.error || !entry?.present) throw conflict(entry?.error ?? "This skill was removed from its source. Its installed copy was kept.");
        res.json(await svc.getById(spaceId, skillId));
        return;
      }
      const publication = contentPublication(req, spaceId, skillId, "skills.update", skill => ({
        action: "space.skill_update_installed", details: {
          slug: skill.slug, previousOriginHash: before?.metadata?.originHash ?? before?.sourceRef ?? null,
          previousOriginVersion: before?.metadata?.originVersion ?? null,
          newOriginHash: skill.metadata?.originHash ?? skill.sourceRef,
          newOriginVersion: skill.metadata?.originVersion ?? null,
          driftDetected: Boolean(before?.metadata?.userModifiedAt), force: Boolean(req.body.force),
          auditVerdict: skill.metadata?.auditVerdict ?? null,
        },
      }));
      const result = await svc.installUpdate(spaceId, skillId, req.body, publication.hooks);
      if (!result) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      const actor = getActorInfo(req);
      if (!publication.publish()) await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "space.skill_update_installed",
        entityType: "space_skill",
        entityId: result.id,
        details: {
          slug: result.slug,
          previousOriginHash: before?.metadata?.originHash ?? before?.sourceRef ?? null,
          previousOriginVersion: before?.metadata?.originVersion ?? null,
          newOriginHash: result.metadata?.originHash ?? result.sourceRef,
          newOriginVersion: result.metadata?.originVersion ?? null,
          driftDetected: Boolean(before?.metadata?.userModifiedAt),
          force: Boolean(req.body.force),
          auditVerdict: result.metadata?.auditVerdict ?? null,
        },
      });

      res.json(result);
    },
  );

  return router;
}
