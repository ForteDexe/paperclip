import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { agents, spaceSkillPolicies, principalPermissionGrants } from "@outpost/db";
import {
  normalizeSkillPolicySourceLocator,
  skillPolicyDocumentSchema,
  type EffectiveSkillPolicy,
  type SkillPolicyAction,
  type SkillPolicyDecision,
  type SkillPolicyDocument,
  type SkillPolicyEvaluationResource,
  type SkillPolicyRule,
  type SkillPolicySourceType,
} from "@outpost/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { logActivity, type LogActivityInput } from "./activity-log.js";

export type SkillPolicyPrincipal = {
  type: "agent" | "operator";
  id: string;
  role: string | null;
};

const OPEN_DEFAULT_POLICY: EffectiveSkillPolicy = {
  schemaVersion: 1,
  revision: 0,
  defaultEffect: "allow",
  rules: [],
  materialized: false,
};

function effectivePolicyFromRow(row: typeof spaceSkillPolicies.$inferSelect): EffectiveSkillPolicy {
  const document = skillPolicyDocumentSchema.parse({
    schemaVersion: row.schemaVersion,
    defaultEffect: row.defaultEffect,
    rules: row.rules,
  });
  return { ...document, revision: row.revision, materialized: true };
}

function normalizeRole(role: string | null) {
  return role?.trim().toLowerCase() || null;
}

function subjectMatches(rule: SkillPolicyRule, principal: SkillPolicyPrincipal) {
  if (rule.subject.type === "all_agents") return principal.type === "agent";
  if (rule.subject.type === "agents") {
    return principal.type === "agent" && rule.subject.agentIds.includes(principal.id);
  }
  const role = normalizeRole(principal.role);
  return Boolean(role && rule.subject.roles.some((candidate) => normalizeRole(candidate) === role));
}

function resourceMatches(rule: SkillPolicyRule, resource: SkillPolicyEvaluationResource) {
  const selector = rule.resources;
  if (!selector) return true;
  if (selector.skillIds && (!resource.skillId || !selector.skillIds.includes(resource.skillId))) return false;
  if (selector.skillKeys && (!resource.skillKey || !selector.skillKeys.includes(resource.skillKey))) return false;
  if (selector.sourceTypes && (!resource.sourceType || !selector.sourceTypes.includes(resource.sourceType))) return false;
  if (selector.sourceLocators) {
    // Compare in canonical form on both sides: rules written before locator
    // normalization existed are stored raw, and callers may pass un-normalized
    // resources; strict equality on mixed forms would silently skip deny rules.
    const resourceLocator = resource.sourceLocator ? normalizeSkillPolicySourceLocator(resource.sourceLocator) : null;
    if (!resourceLocator) return false;
    if (!selector.sourceLocators.some((locator) => normalizeSkillPolicySourceLocator(locator) === resourceLocator)) {
      return false;
    }
  }
  return true;
}

function decision(
  allowed: boolean,
  action: SkillPolicyAction,
  reason: SkillPolicyDecision["reason"],
  revision: number,
  matchedRuleId: string | null = null,
): SkillPolicyDecision {
  return {
    allowed,
    action,
    reason,
    policyRevision: revision,
    matchedRuleId,
    remediation: allowed ? null : "Contact a space administrator to change the skill policy.",
  };
}

export function normalizeSkillPolicySourceType(sourceType: string | null | undefined): SkillPolicySourceType {
  switch (sourceType?.trim().toLowerCase()) {
    case "managed":
    case "local_path":
    case "workspace":
    case "project_scan":
      return "workspace";
    case "catalog":
    case "bundled":
    case "optional":
      return "catalog";
    case "git":
    case "github":
      return "git";
    case "skills_sh":
    case "external_package":
    case "npm":
      return "external_package";
    case "generated":
      return "generated";
    default:
      return "unknown";
  }
}

export function spaceSkillPolicyService(db: Db) {
  async function get(spaceId: string): Promise<EffectiveSkillPolicy> {
    const row = await db
      .select()
      .from(spaceSkillPolicies)
      .where(eq(spaceSkillPolicies.spaceId, spaceId))
      .then((rows) => rows[0] ?? null);
    return row ? effectivePolicyFromRow(row) : { ...OPEN_DEFAULT_POLICY };
  }

  async function resolveAgentPrincipal(spaceId: string, agentId: string): Promise<SkillPolicyPrincipal> {
    const agent = await db
      .select({ id: agents.id, spaceId: agents.spaceId, role: agents.role })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    if (agent.spaceId !== spaceId) {
      throw forbidden("Agent cannot be evaluated for another space", {
        code: "skill_space_boundary_denied",
      });
    }
    return { type: "agent", id: agent.id, role: agent.role };
  }

  async function hasLegacyBroadMutationGrant(spaceId: string, principal: SkillPolicyPrincipal) {
    const principalType = principal.type === "agent" ? "agent" : "user";
    const row = await db
      .select({ permissionKey: principalPermissionGrants.permissionKey })
      .from(principalPermissionGrants)
      .where(and(
        eq(principalPermissionGrants.spaceId, spaceId),
        eq(principalPermissionGrants.principalType, principalType),
        eq(principalPermissionGrants.principalId, principal.id),
        inArray(principalPermissionGrants.permissionKey, ["skills:create", "skills:suggest-changes"]),
      ))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function evaluate(input: {
    spaceId: string;
    principal: SkillPolicyPrincipal;
    action: SkillPolicyAction;
    resource?: SkillPolicyEvaluationResource;
  }): Promise<SkillPolicyDecision> {
    const policy = await get(input.spaceId);
    if (!policy.materialized) {
      return decision(true, input.action, "no_policy_default", policy.revision);
    }
    const resource = input.resource ?? {};
    const matchingRule = [...policy.rules]
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
      .find((rule) => rule.actions.includes(input.action)
        && subjectMatches(rule, input.principal)
        && resourceMatches(rule, resource));
    if (matchingRule) {
      return decision(
        matchingRule.effect === "allow",
        input.action,
        "explicit_rule",
        policy.revision,
        matchingRule.id,
      );
    }
    // These grants historically authorized the full space-skill mutation surface.
    // Preserve that broad scope only as a default-deny compatibility fallback;
    // explicit policy rules and platform invariants still take precedence.
    if (policy.defaultEffect === "deny" && await hasLegacyBroadMutationGrant(input.spaceId, input.principal)) {
      return decision(true, input.action, "legacy_compatibility", policy.revision);
    }
    return decision(policy.defaultEffect === "allow", input.action, "policy_default", policy.revision);
  }

  async function replace(input: {
    spaceId: string;
    expectedRevision: number;
    policy: SkillPolicyDocument;
    activity: Omit<LogActivityInput, "spaceId" | "action" | "entityType" | "entityId" | "details">;
  }) {
    return db.transaction(async (tx) => {
      const transactionDb = tx as unknown as Db;
      const policy = skillPolicyDocumentSchema.parse(input.policy);
      const existing = await tx
        .select()
        .from(spaceSkillPolicies)
        .where(eq(spaceSkillPolicies.spaceId, input.spaceId))
        .then((rows) => rows[0] ?? null);
      const currentRevision = existing?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw conflict("Skill policy revision is stale", {
          code: "skill_policy_revision_conflict",
          expectedRevision: input.expectedRevision,
          currentRevision,
        });
      }
      const nextRevision = currentRevision + 1;
      const values = {
        schemaVersion: policy.schemaVersion,
        revision: nextRevision,
        defaultEffect: policy.defaultEffect,
        rules: policy.rules,
        updatedAt: new Date(),
      };
      if (existing) {
        const updated = await tx
          .update(spaceSkillPolicies)
          .set(values)
          .where(and(
            eq(spaceSkillPolicies.spaceId, input.spaceId),
            eq(spaceSkillPolicies.revision, currentRevision),
          ))
          .returning({ revision: spaceSkillPolicies.revision })
          .then((rows) => rows[0] ?? null);
        if (!updated) {
          throw conflict("Skill policy revision is stale", {
            code: "skill_policy_revision_conflict",
            expectedRevision: input.expectedRevision,
          });
        }
      } else {
        const inserted = await tx
          .insert(spaceSkillPolicies)
          .values({ spaceId: input.spaceId, ...values })
          .onConflictDoNothing()
          .returning({ revision: spaceSkillPolicies.revision })
          .then((rows) => rows[0] ?? null);
        if (!inserted) {
          throw conflict("Skill policy revision is stale", {
            code: "skill_policy_revision_conflict",
            expectedRevision: input.expectedRevision,
          });
        }
      }
      await logActivity(transactionDb, {
        ...input.activity,
        spaceId: input.spaceId,
        action: "space.skill_policy_replaced",
        entityType: "space_skill_policy",
        entityId: input.spaceId,
        details: {
          previousRevision: currentRevision,
          newRevision: nextRevision,
          defaultEffect: policy.defaultEffect,
          ruleCount: policy.rules.length,
        },
      });
      return { ...policy, revision: nextRevision, materialized: true } satisfies EffectiveSkillPolicy;
    });
  }

  async function reset(input: {
    spaceId: string;
    activity: Omit<LogActivityInput, "spaceId" | "action" | "entityType" | "entityId" | "details">;
  }) {
    return db.transaction(async (tx) => {
      const transactionDb = tx as unknown as Db;
      const existing = await tx
        .delete(spaceSkillPolicies)
        .where(eq(spaceSkillPolicies.spaceId, input.spaceId))
        .returning({ revision: spaceSkillPolicies.revision })
        .then((rows) => rows[0] ?? null);
      if (existing) {
        await logActivity(transactionDb, {
          ...input.activity,
          spaceId: input.spaceId,
          action: "space.skill_policy_reset",
          entityType: "space_skill_policy",
          entityId: input.spaceId,
          details: { previousRevision: existing.revision, newRevision: 0 },
        });
      }
      return { ...OPEN_DEFAULT_POLICY, rules: [] };
    });
  }

  return { get, resolveAgentPrincipal, evaluate, replace, reset };
}
