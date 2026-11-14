import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  spaces,
  spaceMemberships,
  spaceSecretBindings,
  spaceSecretProviderConfigs,
  spaceSecretVersions,
  spaceSecrets,
  createDb,
  environments,
  approvals,
  principalPermissionGrants,
  userSecretDeclarations,
  userSecretDefinitions,
} from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";
import { secretService } from "../services/secrets.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping agent-create credential inheritance route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;

// The fixed Claude Code OAuth binding. It is a user-secret reference to the
// fixed key. Any other shape is a replacement or a weaker binding.
const FIXED_CLAUDE_OAUTH_BINDING = { type: "user_secret_ref", key: "CLAUDE_CODE_OAUTH_TOKEN" } as const;

function agentActor(spaceId: string, agentId: string): Express.Request["actor"] {
  return { type: "agent", agentId, spaceId, source: "agent_jwt" };
}

// The local implicit operator actor always passes authorization, so it stands in
// for a user actor without needing a seeded space membership.
function userActor(): Express.Request["actor"] {
  return { type: "operator", userId: "local-operator", source: "local_implicit" };
}

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("created agent provider credential inheritance", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousKeyFile = process.env.OUTPOST_SECRETS_MASTER_KEY_FILE;
  const secretsTmpDir = path.join(os.tmpdir(), `outpost-agent-create-auth-inheritance-${randomUUID()}`);

  beforeAll(async () => {
    mkdirSync(secretsTmpDir, { recursive: true });
    process.env.OUTPOST_SECRETS_MASTER_KEY_FILE = path.join(secretsTmpDir, "master.key");
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-agent-create-auth-inheritance-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(approvals);
    await db.delete(activityLog);
    await db.delete(userSecretDeclarations);
    await db.delete(userSecretDefinitions);
    await db.delete(spaceSecretBindings);
    await db.delete(spaceSecretVersions);
    await db.delete(spaceSecrets);
    await db.delete(spaceSecretProviderConfigs);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(agents);
    await db.delete(environments);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    if (previousKeyFile === undefined) {
      delete process.env.OUTPOST_SECRETS_MASTER_KEY_FILE;
    } else {
      process.env.OUTPOST_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    }
    rmSync(secretsTmpDir, { recursive: true, force: true });
  });

  async function seedSpace() {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: `Auth Inheritance Co ${spaceId.slice(0, 8)}`,
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    return spaceId;
  }

  async function seedParentAgent(spaceId: string, adapterType: string, env: Record<string, unknown>) {
    const [row] = await db
      .insert(agents)
      .values({
        spaceId,
        name: `Parent ${randomUUID().slice(0, 8)}`,
        role: "engineer",
        adapterType,
        adapterConfig: { env },
        runtimeConfig: {},
        permissions: { canCreateAgents: true },
      })
      .returning();
    return row!;
  }

  async function createSpaceSecret(spaceId: string, value: string) {
    return secretService(db).create(spaceId, {
      name: `cred-${randomUUID()}`,
      provider: "local_encrypted",
      value,
    });
  }

  function secretRef(secretId: string, extra: Record<string, unknown> = {}) {
    return { type: "secret_ref" as const, secretId, ...extra };
  }

  function create(actor: Express.Request["actor"], spaceId: string, payload: Record<string, unknown>) {
    const app = createApp(db, actor);
    return request(app).post(`/api/spaces/${spaceId}/agent-creations`).send(payload);
  }

  function childEnvOf(res: request.Response): Record<string, unknown> {
    return ((res.body.agent?.adapterConfig as { env?: Record<string, unknown> } | undefined)?.env) ?? {};
  }

  it("inherits the parent secret_ref for a codex_local create with no env, and derives the child binding", async () => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "sk-openai-parent");
    const parent = await seedParentAgent(spaceId, "codex_local", {
      OPENAI_API_KEY: secretRef(secret.id),
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Codex Child",
      role: "engineer",
      adapterType: "codex_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(childEnvOf(res).OPENAI_API_KEY).toMatchObject({ type: "secret_ref", secretId: secret.id });

    const bindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(
        and(
          eq(spaceSecretBindings.spaceId, spaceId),
          eq(spaceSecretBindings.targetType, "agent"),
          eq(spaceSecretBindings.targetId, res.body.agent.id),
        ),
      );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      configPath: "env.OPENAI_API_KEY",
      secretId: secret.id,
      versionSelector: "latest",
    });
  });

  it("keeps a pinned version selector on the copied reference and its derived binding", async () => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "sk-openai-pinned");
    const parent = await seedParentAgent(spaceId, "codex_local", {
      OPENAI_API_KEY: secretRef(secret.id, { version: 3 }),
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Codex Pinned Child",
      role: "engineer",
      adapterType: "codex_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(childEnvOf(res).OPENAI_API_KEY).toMatchObject({ type: "secret_ref", secretId: secret.id, version: 3 });

    const bindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(
        and(
          eq(spaceSecretBindings.spaceId, spaceId),
          eq(spaceSecretBindings.targetId, res.body.agent.id),
        ),
      );
    expect(bindings[0]?.versionSelector).toBe("3");
  });

  it("retains version, required, and allowMissingOverride on a copied user_secret_ref", async () => {
    const spaceId = await seedSpace();
    await secretService(db).createUserSecretDefinition(spaceId, {
      key: "openai_shared_key",
      name: "Shared OpenAI key",
      provider: "local_encrypted",
    });
    const parent = await seedParentAgent(spaceId, "codex_local", {
      OPENAI_API_KEY: {
        type: "user_secret_ref",
        key: "openai_shared_key",
        version: 2,
        required: false,
        allowMissingOverride: true,
      },
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Codex User Secret Child",
      role: "engineer",
      adapterType: "codex_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(childEnvOf(res).OPENAI_API_KEY).toMatchObject({
      type: "user_secret_ref",
      key: "openai_shared_key",
      version: 2,
      required: false,
      allowMissingOverride: true,
    });
  });

  it("inherits a grok_local parent's XAI_API_KEY reference", async () => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "xai-parent-key");
    const parent = await seedParentAgent(spaceId, "grok_local", {
      XAI_API_KEY: secretRef(secret.id),
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Grok Child",
      role: "engineer",
      adapterType: "grok_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(childEnvOf(res).XAI_API_KEY).toMatchObject({ type: "secret_ref", secretId: secret.id });
  });

  it("inherits a native OpenCode parent's OPENROUTER_API_KEY reference when the create inherits the caller runtime", async () => {
    const spaceId = await seedSpace();
    await db.update(spaces).set({ requireOperatorApprovalForNewAgents: true }).where(eq(spaces.id, spaceId));
    const secret = await createSpaceSecret(spaceId, "openrouter-parent-key");
    const parent = await seedParentAgent(spaceId, "outpost_runner", {});
    await db.update(agents).set({ adapterConfig: {
      provider: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash-1017", opencodePermissionMode: "allow",
      env: { OPENROUTER_API_KEY: secretRef(secret.id, { version: "latest" }), OPENCODE_CONFIG_CONTENT: "{\"provider\":{}}" },
    } }).where(eq(agents.id, parent.id));

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "OpenCode Child", role: "qa", adapterType: "outpost_runner", inheritRuntimeFrom: "caller",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.agent.status).toBe("pending_approval");
    const [child] = await db.select().from(agents).where(eq(agents.id, res.body.agent.id));
    const env = (child!.adapterConfig as { env?: Record<string, unknown> }).env ?? {};
    expect(env.OPENROUTER_API_KEY).toMatchObject({ type: "secret_ref", secretId: secret.id, version: "latest" });
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });

  it.each(["create", "create"] as const)("blocks native Claude credential redirection before %s inheritance", async mode => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "fixture-parent-credential");
    const parent = await seedParentAgent(spaceId, "outpost_runner", { ANTHROPIC_API_KEY: secretRef(secret.id) });
    await db.update(agents).set({ adapterConfig: { provider: "acpx", acpxAgent: "claude", env: { ANTHROPIC_API_KEY: secretRef(secret.id) } } }).where(eq(agents.id, parent.id));
    const app = createApp(db, agentActor(spaceId, parent.id));
    const res = await request(app).post(`/api/spaces/${spaceId}/${mode === "create" ? "agent-creations" : "agents"}`).send({
      name: "Redirected child", role: "engineer", adapterType: "outpost_runner",
      adapterConfig: { provider: "acpx", acpxAgent: "claude", env: { ANTHROPIC_BASE_URL: "https://untrusted.example.test" } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("host-executed local adapter settings");
    expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(1);
  });

  it("still inherits Claude credential references for an ordinary native create", async () => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "fixture-parent-credential");
    const parent = await seedParentAgent(spaceId, "claude_local", { ANTHROPIC_API_KEY: secretRef(secret.id) });
    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Native child", role: "engineer", adapterType: "outpost_runner",
      adapterConfig: { provider: "acpx", acpxAgent: "claude" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.agent.adapterType).toBe("outpost_runner");
    expect(childEnvOf(res).ANTHROPIC_API_KEY).toMatchObject({ type: "secret_ref", secretId: secret.id });
  });

  it("inherits a claude_local parent's ANTHROPIC_API_KEY reference", async () => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "ant-parent-key");
    const parent = await seedParentAgent(spaceId, "claude_local", {
      ANTHROPIC_API_KEY: secretRef(secret.id),
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Claude Child",
      role: "engineer",
      adapterType: "claude_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(childEnvOf(res).ANTHROPIC_API_KEY).toMatchObject({ type: "secret_ref", secretId: secret.id });
  });

  it("keeps the child-supplied ANTHROPIC_API_KEY and inherits no Claude credential at all", async () => {
    const spaceId = await seedSpace();
    const childSecret = await createSpaceSecret(spaceId, "ant-child-key");
    // The parent holds the fixed Claude OAuth binding, which is normally
    // inheritable, but the child already supplies its own Claude credential.
    const parent = await seedParentAgent(spaceId, "claude_local", {
      CLAUDE_CODE_OAUTH_TOKEN: { ...FIXED_CLAUDE_OAUTH_BINDING },
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Claude Child With Own Key",
      role: "engineer",
      adapterType: "claude_local",
      adapterConfig: { env: { ANTHROPIC_API_KEY: secretRef(childSecret.id) } },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const childEnv = childEnvOf(res);
    expect(childEnv.ANTHROPIC_API_KEY).toMatchObject({ type: "secret_ref", secretId: childSecret.id });
    expect(childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("does not inherit a plain environment value", async () => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "grok_local", {
      XAI_API_KEY: "xai-plain-value",
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Grok Plain Value Child",
      role: "engineer",
      adapterType: "grok_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(childEnvOf(res).XAI_API_KEY).toBeUndefined();
  });

  it("does not inherit across a mismatched adapter type", async () => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "sk-openai-mismatch");
    const parent = await seedParentAgent(spaceId, "codex_local", {
      OPENAI_API_KEY: secretRef(secret.id),
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Claude Child From Codex Parent",
      role: "engineer",
      adapterType: "claude_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(childEnvOf(res))).toHaveLength(0);
  });

  it("does not inherit a codex_local credential from a creation agent in another space", async () => {
    const parentSpaceId = await seedSpace();
    const targetSpaceId = await seedSpace();
    const secret = await createSpaceSecret(parentSpaceId, "sk-openai-other-space");
    const parent = await seedParentAgent(parentSpaceId, "codex_local", {
      OPENAI_API_KEY: secretRef(secret.id),
    });

    // The actor claims the target space, but the named creation agent belongs
    // to a different space. The route must reject the request and must
    // never copy the other space's credential reference.
    const res = await create(agentActor(targetSpaceId, parent.id), targetSpaceId, {
      name: "Codex Cross-Space Child",
      role: "engineer",
      adapterType: "codex_local",
    });

    expect(res.status).toBe(403);
    const children = await db.select().from(agents).where(eq(agents.spaceId, targetSpaceId));
    expect(children).toHaveLength(0);
  });

  it("does not inherit a grok_local credential from a creation agent in another space", async () => {
    const parentSpaceId = await seedSpace();
    const targetSpaceId = await seedSpace();
    const secret = await createSpaceSecret(parentSpaceId, "xai-other-space");
    const parent = await seedParentAgent(parentSpaceId, "grok_local", {
      XAI_API_KEY: secretRef(secret.id),
    });

    const res = await create(agentActor(targetSpaceId, parent.id), targetSpaceId, {
      name: "Grok Cross-Space Child",
      role: "engineer",
      adapterType: "grok_local",
    });

    expect(res.status).toBe(403);
    const children = await db.select().from(agents).where(eq(agents.spaceId, targetSpaceId));
    expect(children).toHaveLength(0);
  });

  it("does not inherit a claude_local credential, including the fixed OAuth binding, from a creation agent in another space", async () => {
    const parentSpaceId = await seedSpace();
    const targetSpaceId = await seedSpace();
    const parent = await seedParentAgent(parentSpaceId, "claude_local", {
      ANTHROPIC_API_KEY: secretRef((await createSpaceSecret(parentSpaceId, "ant-other-space")).id),
      CLAUDE_CODE_OAUTH_TOKEN: { ...FIXED_CLAUDE_OAUTH_BINDING, version: 1 },
    });

    const res = await create(agentActor(targetSpaceId, parent.id), targetSpaceId, {
      name: "Claude Cross-Space Child",
      role: "engineer",
      adapterType: "claude_local",
    });

    expect(res.status).toBe(403);
    const children = await db.select().from(agents).where(eq(agents.spaceId, targetSpaceId));
    expect(children).toHaveLength(0);
  });

  it("carves out a per-agent CODEX_HOME when the child inherits OPENAI_API_KEY", async () => {
    const spaceId = await seedSpace();
    const secret = await createSpaceSecret(spaceId, "sk-openai-isolated");
    const parent = await seedParentAgent(spaceId, "codex_local", {
      OPENAI_API_KEY: secretRef(secret.id),
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Codex Isolated Child",
      role: "engineer",
      adapterType: "codex_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const childEnv = childEnvOf(res);
    // A bare environment string persists as a `plain` binding.
    const codexHome = childEnv.CODEX_HOME as { type: string; value: string } | undefined;
    expect(codexHome?.type).toBe("plain");
    expect(codexHome?.value.length ?? 0).toBeGreaterThan(0);
  });

  it("keeps the shared space Codex home when the child inherits no key", async () => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "codex_local", {});

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Codex Shared Home Child",
      role: "engineer",
      adapterType: "codex_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(childEnvOf(res).CODEX_HOME).toBeUndefined();
  });

  it("adds no home override for a grok_local child with no inherited key", async () => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "grok_local", {});

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Grok No Key Child",
      role: "engineer",
      adapterType: "grok_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const childEnv = childEnvOf(res);
    expect(childEnv.GROK_HOME).toBeUndefined();
    expect(childEnv.XAI_API_KEY).toBeUndefined();
  });

  it("inherits nothing for a user actor create", async () => {
    const spaceId = await seedSpace();
    // No creation-agent context exists for a user actor. The merge must not run
    // at all, so an otherwise-inheritable key is simply never considered.
    const res = await create(userActor(), spaceId, {
      name: "User Created Child",
      role: "engineer",
      adapterType: "claude_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(childEnvOf(res))).toHaveLength(0);
  });

  it("rejects native runtime inheritance for a operator actor", async () => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "outpost_runner", {});
    const res = await create(userActor(), spaceId, {
      name: "Operator Inheritance Attempt", role: "engineer", adapterType: "outpost_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status).toBe(403);
    expect(parent.adapterType).toBe("outpost_runner");
  });

  it("rejects inheritance from a legacy caller", async () => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "codex_local", {});
    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Legacy Inheritance Attempt", role: "engineer", adapterType: "outpost_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("outpost_runner adapter");
  });

  it("rejects native runtime inheritance across spaces", async () => {
    const parentSpaceId = await seedSpace();
    const targetSpaceId = await seedSpace();
    const parent = await seedParentAgent(parentSpaceId, "outpost_runner", { provider: "codex", model: "gpt-5.6-sol" });
    const res = await create(agentActor(targetSpaceId, parent.id), targetSpaceId, {
      name: "Cross Space Inheritance Attempt", role: "engineer", adapterType: "outpost_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status).toBe(403);
    expect(await db.select().from(agents).where(eq(agents.spaceId, targetSpaceId))).toHaveLength(0);
  });

  it("records only inherited safe settings in an approval snapshot", async () => {
    const spaceId = await seedSpace();
    await db.update(spaces).set({ requireOperatorApprovalForNewAgents: true }).where(eq(spaces.id, spaceId));
    const parent = await seedParentAgent(spaceId, "outpost_runner", {});
    await db.update(agents).set({ adapterConfig: {
      provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-5", acpxPermissionMode: "approve-all",
      env: { PRIVATE_PARENT_TOKEN: secretRef("parent-secret") }, cwd: "/private/parent",
      invocationLimits: { maxIterations: 3, credentials: "never-copy" },
    } }).where(eq(agents.id, parent.id));
    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Approval Snapshot Child", role: "engineer", adapterType: "outpost_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.agent.status).toBe("pending_approval");
    expect(res.body.approval.payload.inheritRuntimeFrom).toBeUndefined();
    expect(res.body.approval.payload.adapterConfig).toMatchObject({ provider: "acpx", acpxAgent: "claude", acpxPermissionMode: "approve-all" });
    expect(res.body.approval.payload.adapterConfig.env).toBeUndefined();
    expect(res.body.approval.payload.adapterConfig.cwd).toBeUndefined();
    expect(res.body.approval.payload.adapterConfig.invocationLimits).toEqual({ maxIterations: 3 });
  });

  it.each([
    ["claude_managed", "managedProfileId", "managedAgentsRetentionAcknowledged", "Managed Agent"],
    ["aws_agentcore", "agentCoreProfileId", "agentCoreRetentionAcknowledged", "Remote Agent"],
  ])("revalidates the inherited %s space profile before creating a create", async (provider, profileKey, retentionKey, label) => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "outpost_runner", {});
    await db.update(agents).set({ adapterConfig: {
      provider, [profileKey]: randomUUID(), [retentionKey]: true,
    } }).where(eq(agents.id, parent.id));
    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Missing Profile Child", role: "engineer", adapterType: "outpost_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe(`${label} profile not found`);
    expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(1);
  });

  it("validates and preserves an inherited caller default environment", async () => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "outpost_runner", {});
    const environmentId = randomUUID();
    await db.insert(environments).values({ id: environmentId, name: `Local ${environmentId}`, driver: "local" });
    await db.update(agents).set({ defaultEnvironmentId: environmentId }).where(eq(agents.id, parent.id));
    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Invalid Environment Child", role: "engineer", adapterType: "outpost_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.agent.defaultEnvironmentId).toBe(environmentId);
  });

  it("inherits the fixed Claude OAuth binding, keeps its version, and leaks no token value", async () => {
    const spaceId = await seedSpace();
    const parent = await seedParentAgent(spaceId, "claude_local", {
      CLAUDE_CODE_OAUTH_TOKEN: { ...FIXED_CLAUDE_OAUTH_BINDING, version: 3 },
    });

    const res = await create(agentActor(spaceId, parent.id), spaceId, {
      name: "Claude OAuth Child",
      role: "engineer",
      adapterType: "claude_local",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const childAgentId = res.body.agent.id as string;
    expect(childEnvOf(res).CLAUDE_CODE_OAUTH_TOKEN).toMatchObject({
      type: "user_secret_ref",
      key: "CLAUDE_CODE_OAUTH_TOKEN",
      version: 3,
    });
    // The response body carries the reference only, never a token value.
    expect(JSON.stringify(res.body)).not.toContain("sk-");

    const declarations = await db
      .select()
      .from(userSecretDeclarations)
      .where(eq(userSecretDeclarations.targetId, childAgentId));
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      envKey: "CLAUDE_CODE_OAUTH_TOKEN",
      configPath: "env.CLAUDE_CODE_OAUTH_TOKEN",
      versionSelector: "3",
    });

    const createActivity = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.spaceId, spaceId), eq(activityLog.action, "agent.create_created")));
    expect(createActivity).toHaveLength(1);
    const detailsText = JSON.stringify(createActivity[0]!.details);
    expect(detailsText).not.toContain("adapterConfig");
    expect(detailsText).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
});
