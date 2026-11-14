import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  spaces,
  spaceSkillPolicies,
  createDb,
  principalPermissionGrants,
} from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { spaceSkillPolicyService, normalizeSkillPolicySourceType } from "../services/space-skill-policy.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("spaceSkillPolicyService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-skill-policy-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceSkillPolicies);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgent(role = "engineer") {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Policy Co",
      issuePrefix: `P${spaceId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Policy Agent",
      role,
      adapterType: "process",
      adapterConfig: {},
      status: "idle",
    });
    return { spaceId, agentId, principal: { type: "agent" as const, id: agentId, role } };
  }

  it("allows every canonical action when no explicit policy exists", async () => {
    const seeded = await seedAgent();
    const service = spaceSkillPolicyService(db);
    for (const action of [
      "skills.create",
      "skills.import",
      "skills.install",
      "skills.edit",
      "skills.update",
      "skills.test",
      "skills.reset",
      "skills.remove",
    ] as const) {
      await expect(service.evaluate({
        spaceId: seeded.spaceId,
        principal: seeded.principal,
        action,
      })).resolves.toMatchObject({ allowed: true, action, reason: "no_policy_default", policyRevision: 0 });
    }
  });

  it("evaluates protected resources, role overrides, and agent overrides deterministically", async () => {
    const seeded = await seedAgent("security");
    const service = spaceSkillPolicyService(db);
    const protectedSkillId = randomUUID();
    await service.replace({
      spaceId: seeded.spaceId,
      expectedRevision: 0,
      policy: {
        schemaVersion: 1,
        defaultEffect: "allow",
        rules: [
          {
            id: "agent-override",
            priority: 1,
            effect: "allow",
            subject: { type: "agents", agentIds: [seeded.agentId] },
            actions: ["skills.install"],
            resources: { sourceTypes: ["external_package"] },
          },
          {
            id: "security-override",
            priority: 5,
            effect: "allow",
            subject: { type: "roles", roles: ["security"] },
            actions: ["skills.edit"],
            resources: { skillIds: [protectedSkillId] },
          },
          {
            id: "protected-skill",
            priority: 10,
            effect: "deny",
            subject: { type: "all_agents" },
            actions: ["skills.edit", "skills.remove"],
            resources: { skillIds: [protectedSkillId] },
          },
          {
            id: "deny-external",
            priority: 20,
            effect: "deny",
            subject: { type: "all_agents" },
            actions: ["skills.install"],
            resources: { sourceTypes: ["external_package"] },
          },
        ],
      },
      activity: { actorType: "agent", actorId: seeded.agentId, agentId: seeded.agentId },
    });

    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.edit",
      resource: { skillId: protectedSkillId },
    })).resolves.toMatchObject({ allowed: true, matchedRuleId: "security-override" });
    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.remove",
      resource: { skillId: protectedSkillId },
    })).resolves.toMatchObject({ allowed: false, reason: "explicit_rule", matchedRuleId: "protected-skill" });
    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.install",
      resource: { sourceType: "external_package" },
    })).resolves.toMatchObject({ allowed: true, matchedRuleId: "agent-override" });
  });

  it("preserves workspace restrictions when a managed skill changes its source label", async () => {
    const seeded = await seedAgent();
    const service = spaceSkillPolicyService(db);
    await service.replace({ spaceId: seeded.spaceId, expectedRevision: 0,
      policy: { schemaVersion: 1, defaultEffect: "allow", rules: [{ id: "deny-workspace-edit", priority: 1,
        effect: "deny", subject: { type: "all_agents" }, actions: ["skills.edit"], resources: { sourceTypes: ["workspace"] } }] },
      activity: { actorType: "agent", actorId: seeded.agentId, agentId: seeded.agentId } });
    for (const sourceType of ["local_path", "managed"]) {
      await expect(service.evaluate({ spaceId: seeded.spaceId, principal: seeded.principal,
        action: "skills.edit", resource: { sourceType: normalizeSkillPolicySourceType(sourceType) } }))
        .resolves.toMatchObject({ allowed: false, matchedRuleId: "deny-workspace-edit" });
    }
  });

  it("uses retained legacy grants only after explicit rules fail to match", async () => {
    const seeded = await seedAgent();
    const service = spaceSkillPolicyService(db);
    await db.insert(spaceSkillPolicies).values({
      spaceId: seeded.spaceId,
      schemaVersion: 1,
      revision: 3,
      defaultEffect: "deny",
      rules: [{
        id: "deny-removal",
        priority: 1,
        effect: "deny",
        subject: { type: "all_agents" },
        actions: ["skills.remove"],
      }],
    });
    await db.insert(principalPermissionGrants).values({
      spaceId: seeded.spaceId,
      principalType: "agent",
      principalId: seeded.agentId,
      permissionKey: "skills:create",
      scope: null,
    });

    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.edit",
    })).resolves.toMatchObject({ allowed: true, reason: "legacy_compatibility" });
    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.remove",
    })).resolves.toMatchObject({ allowed: false, reason: "explicit_rule" });
  });

  it("matches sourceLocator deny rules regardless of GitHub URL casing or .git suffix", async () => {
    const seeded = await seedAgent();
    const service = spaceSkillPolicyService(db);
    await service.replace({
      spaceId: seeded.spaceId,
      expectedRevision: 0,
      policy: {
        schemaVersion: 1,
        defaultEffect: "allow",
        rules: [{
          id: "deny-repo",
          priority: 1,
          effect: "deny",
          subject: { type: "all_agents" },
          actions: ["skills.import"],
          resources: { sourceLocators: ["https://WWW.GitHub.com/Owner/Repo.git"] },
        }],
      },
      activity: { actorType: "agent", actorId: seeded.agentId, agentId: seeded.agentId },
    });

    const stored = await service.get(seeded.spaceId);
    expect(stored.rules[0]!.resources!.sourceLocators).toEqual(["https://github.com/owner/repo"]);
    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.import",
      resource: { sourceType: "git", sourceLocator: "https://github.com/owner/repo" },
    })).resolves.toMatchObject({ allowed: false, reason: "explicit_rule", matchedRuleId: "deny-repo" });
    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.import",
      resource: { sourceType: "git", sourceLocator: "https://github.com/Owner/Repo.git" },
    })).resolves.toMatchObject({ allowed: false, reason: "explicit_rule", matchedRuleId: "deny-repo" });
    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.import",
      resource: { sourceType: "git", sourceLocator: "https://github.com/owner/other-repo" },
    })).resolves.toMatchObject({ allowed: true, reason: "policy_default" });
  });

  it("matches deny rules persisted before locator normalization existed", async () => {
    const seeded = await seedAgent();
    const service = spaceSkillPolicyService(db);
    await db.insert(spaceSkillPolicies).values({
      spaceId: seeded.spaceId,
      schemaVersion: 1,
      revision: 2,
      defaultEffect: "allow",
      rules: [{
        id: "legacy-deny-repo",
        priority: 1,
        effect: "deny",
        subject: { type: "all_agents" },
        actions: ["skills.import"],
        resources: { sourceLocators: ["https://github.com/Owner/Repo.git"] },
      }],
    });

    await expect(service.evaluate({
      spaceId: seeded.spaceId,
      principal: seeded.principal,
      action: "skills.import",
      resource: { sourceType: "git", sourceLocator: "https://github.com/owner/repo" },
    })).resolves.toMatchObject({ allowed: false, reason: "explicit_rule", matchedRuleId: "legacy-deny-repo" });
  });

  it("rejects cross-space simulation principals", async () => {
    const first = await seedAgent();
    const second = await seedAgent();
    const service = spaceSkillPolicyService(db);
    await expect(service.resolveAgentPrincipal(first.spaceId, second.agentId)).rejects.toMatchObject({
      status: 403,
      details: { code: "skill_space_boundary_denied" },
    });
  });

  it("rolls back policy replacement when the required activity record cannot persist", async () => {
    const seeded = await seedAgent();
    const service = spaceSkillPolicyService(db);
    await expect(service.replace({
      spaceId: seeded.spaceId,
      expectedRevision: 0,
      policy: { schemaVersion: 1, defaultEffect: "deny", rules: [] },
      activity: {
        actorType: "agent",
        actorId: seeded.agentId,
        agentId: randomUUID(),
      },
    })).rejects.toBeDefined();
    await expect(service.get(seeded.spaceId)).resolves.toMatchObject({
      revision: 0,
      materialized: false,
      defaultEffect: "allow",
    });
  });
});
