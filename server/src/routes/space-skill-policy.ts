import { Router, type NextFunction, type Request, type Response } from "express";
import type { Db } from "@outpost/db";
import { evaluateSkillPolicySchema, replaceSkillPolicySchema } from "@outpost/shared";
import { ZodError, type ZodSchema } from "zod";
import { forbidden, HttpError, unprocessable } from "../errors.js";
import { accessService } from "../services/access.js";
import { spaceSkillPolicyService, type SkillPolicyPrincipal } from "../services/space-skill-policy.js";
import { assertSpaceAccess, getActorInfo } from "./authz.js";

export function spaceSkillPolicyRoutes(db: Db) {
  const router = Router();
  const access = accessService(db);
  const policies = spaceSkillPolicyService(db);

  function validatePolicyBody(schema: ZodSchema) {
    return (req: Request, _res: Response, next: NextFunction) => {
      try {
        req.body = schema.parse(req.body);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          next(unprocessable("Invalid skill policy document", {
            code: "skill_policy_validation_failed",
            issues: error.issues,
          }));
          return;
        }
        next(error);
      }
    };
  }

  function assertSkillPolicySpaceAccess(req: Request, spaceId: string) {
    if (req.actor.type === "none") {
      throw new HttpError(401, "Authentication required", { code: "skill_authentication_required" });
    }
    if (req.actor.type === "agent" && req.actor.spaceId !== spaceId) {
      throw forbidden("Agent key cannot access another space", { code: "skill_space_boundary_denied" });
    }
    assertSpaceAccess(req, spaceId);
  }

  async function assertCanAdministerPolicy(req: Request, spaceId: string) {
    assertSkillPolicySpaceAccess(req, spaceId);
    if (req.actor.type === "operator") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      if (await access.canUser(spaceId, req.actor.userId, "users:manage_permissions")) return;
    } else if (
      req.actor.type === "agent"
      && req.actor.agentId
      && await access.hasPermission(spaceId, "agent", req.actor.agentId, "users:manage_permissions")
    ) {
      return;
    }
    throw forbidden("Skill policy administration authority required", {
      code: "skill_policy_admin_required",
      remediation: "Ask a space administrator to manage the skill policy.",
    });
  }

  async function currentPrincipal(req: Request, spaceId: string): Promise<SkillPolicyPrincipal> {
    if (req.actor.type === "agent" && req.actor.agentId) {
      return policies.resolveAgentPrincipal(spaceId, req.actor.agentId);
    }
    if (req.actor.type === "operator") {
      return { type: "operator", id: req.actor.userId ?? "operator", role: "operator" };
    }
    throw forbidden("Authenticated space actor required", { code: "skill_authentication_required" });
  }

  router.get("/spaces/:spaceId/skill-policy", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSkillPolicySpaceAccess(req, spaceId);
    res.json(await policies.get(spaceId));
  });

  router.put(
    "/spaces/:spaceId/skill-policy",
    validatePolicyBody(replaceSkillPolicySchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertCanAdministerPolicy(req, spaceId);
      const actor = getActorInfo(req);
      const { expectedRevision, ...policy } = req.body;
      res.json(await policies.replace({
        spaceId,
        expectedRevision,
        policy,
        activity: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
        },
      }));
    },
  );

  router.delete("/spaces/:spaceId/skill-policy", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertCanAdministerPolicy(req, spaceId);
    const actor = getActorInfo(req);
    res.json(await policies.reset({
      spaceId,
      activity: {
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
      },
    }));
  });

  router.post(
    "/spaces/:spaceId/skill-policy/evaluate",
    validatePolicyBody(evaluateSkillPolicySchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertSkillPolicySpaceAccess(req, spaceId);
      let principal: SkillPolicyPrincipal;
      if (req.body.principal) {
        await assertCanAdministerPolicy(req, spaceId);
        principal = await policies.resolveAgentPrincipal(spaceId, req.body.principal.agentId);
      } else {
        principal = await currentPrincipal(req, spaceId);
      }
      res.json(await policies.evaluate({
        spaceId,
        principal,
        action: req.body.action,
        resource: req.body.resource,
      }));
    },
  );

  return router;
}
