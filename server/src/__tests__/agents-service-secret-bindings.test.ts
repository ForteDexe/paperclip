import { createAgentLifecycle } from "../services/agent-lifecycle.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  spaces,
  spaceSecretBindings,
  spaceSecretProviderConfigs,
  spaceSecretVersions,
  spaceSecrets,
  createDb,
  principalPermissionGrants,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.ts";
import { secretService } from "../services/secrets.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent secret binding tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("agent service secret binding sync", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  const previousKeyFile = process.env.OUTPOST_SECRETS_MASTER_KEY_FILE;
  const secretsTmpDir = path.join(os.tmpdir(), `outpost-agent-secret-bindings-${randomUUID()}`);

  beforeAll(async () => {
    mkdirSync(secretsTmpDir, { recursive: true });
    process.env.OUTPOST_SECRETS_MASTER_KEY_FILE = path.join(secretsTmpDir, "master.key");
    const started = await startEmbeddedPostgresTestDatabase("agent-secret-bindings");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceSecretBindings);
    await db.delete(spaceSecretVersions);
    await db.delete(spaceSecrets);
    await db.delete(spaceSecretProviderConfigs);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await stopDb?.();
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
      name: "Outpost",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    return spaceId;
  }

  it("creates agent secret bindings when a new agent persists secret_ref env", async () => {
    const spaceId = await seedSpace();
    const secrets = secretService(db);
    const secret = await secrets.create(spaceId, {
      name: `anthropic-${randomUUID()}`,
      provider: "local_encrypted",
      value: "sk-ant-123",
    });

    const created = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Claude Novita",
      role: "engineer",
      status: "pending_approval",
      adapterType: "claude_local",
      adapterConfig: {
        env: {
          ANTHROPIC_API_KEY: { type: "secret_ref", secretId: secret.id, version: "latest" },
        },
      },
      runtimeConfig: {},
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    });

    const bindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(and(
        eq(spaceSecretBindings.spaceId, spaceId),
        eq(spaceSecretBindings.targetType, "agent"),
        eq(spaceSecretBindings.targetId, created.id),
      ));

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      secretId: secret.id,
      configPath: "env.ANTHROPIC_API_KEY",
      versionSelector: "latest",
      required: true,
    });
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "secret.binding.created",
          entityType: "agent",
          entityId: created.id,
          details: expect.objectContaining({ configPath: "env.ANTHROPIC_API_KEY" }),
        }),
      ]));
  });

  it("stores approved class-3 env lease metadata on agent secret bindings", async () => {
    const spaceId = await seedSpace();
    const secrets = secretService(db);
    const secret = await secrets.create(spaceId, {
      name: `slack-${randomUUID()}`,
      provider: "local_encrypted",
      value: "slack-test-token",
    });

    const created = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Slack Briefing",
      role: "briefing",
      adapterType: "codex_local",
      adapterConfig: {
        env: {
          SLACK_BOT_TOKEN: {
            type: "secret_ref",
            secretId: secret.id,
            version: "latest",
            projectionClass: "class_3_static_lease",
            projectionAllowlistKey: "slack.bot_token",
          },
        },
      },
      runtimeConfig: {},
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    });

    const bindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(and(
        eq(spaceSecretBindings.spaceId, spaceId),
        eq(spaceSecretBindings.targetType, "agent"),
        eq(spaceSecretBindings.targetId, created.id),
      ));

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      secretId: secret.id,
      configPath: "env.SLACK_BOT_TOKEN",
      projectionClass: "class_3_static_lease",
      projectionAllowlistKey: "slack.bot_token",
    });
  });

  it("rejects class-3 env lease bindings outside the enumerated allowlist", async () => {
    const spaceId = await seedSpace();
    const secrets = secretService(db);
    const secret = await secrets.create(spaceId, {
      name: `github-${randomUUID()}`,
      provider: "local_encrypted",
      value: "github-test-token",
    });

    await expect(
      createAgentLifecycle(db).requestCreation(spaceId, {
        name: "Unlisted Static Lease",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {
          env: {
            GITHUB_TOKEN: {
              type: "secret_ref",
              secretId: secret.id,
              version: "latest",
              projectionClass: "class_3_static_lease",
              projectionAllowlistKey: "github.token",
            },
          },
        },
        runtimeConfig: {},
        spentMonthlyCents: 0,
        lastHeartbeatAt: null,
      }),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: "class_3_static_lease_not_allowed" },
    });

    const persistedAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.spaceId, spaceId));
    expect(persistedAgents).toHaveLength(0);
  });

  it("replaces agent secret bindings when adapterConfig env changes", async () => {
    const spaceId = await seedSpace();
    const secrets = secretService(db);
    const oldSecret = await secrets.create(spaceId, {
      name: `old-${randomUUID()}`,
      provider: "local_encrypted",
      value: "old-value",
    });
    const nextSecret = await secrets.create(spaceId, {
      name: `next-${randomUUID()}`,
      provider: "local_encrypted",
      value: "next-value",
    });

    const created = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Binding Swapper",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {
        env: {
          OLD_KEY: { type: "secret_ref", secretId: oldSecret.id, version: "latest" },
        },
      },
      runtimeConfig: {},
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    });

    await agentService(db).update(created.id, {
      adapterConfig: {
        env: {
          NEW_KEY: { type: "secret_ref", secretId: nextSecret.id, version: "latest" },
        },
      },
    });

    const bindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(and(
        eq(spaceSecretBindings.spaceId, spaceId),
        eq(spaceSecretBindings.targetType, "agent"),
        eq(spaceSecretBindings.targetId, created.id),
      ));

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      secretId: nextSecret.id,
      configPath: "env.NEW_KEY",
    });
  });

  it("backfills missing secret bindings when a legacy pending agent is approved", async () => {
    const spaceId = await seedSpace();
    const secrets = secretService(db);
    const secret = await secrets.create(spaceId, {
      name: `legacy-${randomUUID()}`,
      provider: "local_encrypted",
      value: "legacy-value",
    });
    const agentId = randomUUID();

    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Legacy Pending Agent",
      role: "engineer",
      status: "pending_approval",
      adapterType: "claude_local",
      adapterConfig: {
        env: {
          ANTHROPIC_API_KEY: { type: "secret_ref", secretId: secret.id, version: "latest" },
        },
      },
      runtimeConfig: {},
      permissions: {},
    });

    const beforeBindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(eq(spaceSecretBindings.targetId, agentId));
    expect(beforeBindings).toHaveLength(0);

    const approved = await createAgentLifecycle(db).approveCreation(agentId);

    expect(approved).toMatchObject({
      activated: true,
      agent: {
        id: agentId,
        status: "paused",
        lifecycleState: "preparing",
      },
    });

    const afterBindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(and(
        eq(spaceSecretBindings.spaceId, spaceId),
        eq(spaceSecretBindings.targetType, "agent"),
        eq(spaceSecretBindings.targetId, agentId),
      ));

    expect(afterBindings).toHaveLength(1);
    expect(afterBindings[0]).toMatchObject({
      secretId: secret.id,
      configPath: "env.ANTHROPIC_API_KEY",
    });
  });

  it("rolls back create when binding sync fails", async () => {
    const spaceId = await seedSpace();
    const missingSecretId = randomUUID();

    await expect(
      createAgentLifecycle(db).requestCreation(spaceId, {
        name: "Broken Create",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          env: {
            ANTHROPIC_API_KEY: { type: "secret_ref", secretId: missingSecretId, version: "latest" },
          },
        },
        runtimeConfig: {},
        spentMonthlyCents: 0,
        lastHeartbeatAt: null,
      }),
    ).rejects.toBeTruthy();

    const persistedAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.spaceId, spaceId));
    expect(persistedAgents).toHaveLength(0);
  });

  it("rolls back adapterConfig updates when binding sync fails", async () => {
    const spaceId = await seedSpace();
    const secrets = secretService(db);
    const validSecret = await secrets.create(spaceId, {
      name: `valid-${randomUUID()}`,
      provider: "local_encrypted",
      value: "valid-value",
    });
    const created = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Transactional Update",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {
        env: {
          API_KEY: { type: "secret_ref", secretId: validSecret.id, version: "latest" },
        },
      },
      runtimeConfig: {},
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    });

    await expect(
      agentService(db).update(created.id, {
        adapterConfig: {
          env: {
            API_KEY: { type: "secret_ref", secretId: randomUUID(), version: "latest" },
          },
        },
      }),
    ).rejects.toBeTruthy();

    const reloaded = await agentService(db).getById(created.id);
    expect(reloaded?.adapterConfig).toMatchObject({
      env: {
        API_KEY: { type: "secret_ref", secretId: validSecret.id, version: "latest" },
      },
    });

    const bindings = await db
      .select()
      .from(spaceSecretBindings)
      .where(and(
        eq(spaceSecretBindings.spaceId, spaceId),
        eq(spaceSecretBindings.targetType, "agent"),
        eq(spaceSecretBindings.targetId, created.id),
      ));
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.secretId).toBe(validSecret.id);
  });

  it("keeps pending approval status when activation binding sync fails", async () => {
    const spaceId = await seedSpace();
    const agentId = randomUUID();

    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Broken Pending Agent",
      role: "engineer",
      status: "pending_approval",
      adapterType: "claude_local",
      adapterConfig: {
        env: {
          ANTHROPIC_API_KEY: { type: "secret_ref", secretId: randomUUID(), version: "latest" },
        },
      },
      runtimeConfig: {},
      permissions: {},
    });

    await expect(createAgentLifecycle(db).approveCreation(agentId)).rejects.toBeTruthy();

    const reloaded = await agentService(db).getById(agentId);
    expect(reloaded?.status).toBe("pending_approval");
  });
});
