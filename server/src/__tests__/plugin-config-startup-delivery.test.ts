import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spaces, createDb, pluginConfig, plugins } from "@outpost/db";
import { pluginRegistryService } from "../services/plugin-registry.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

/**
 * LOOA-629: a plugin worker is spawned once per plugin (not per space) with
 * an empty bootstrap config, and can only read space-scoped config from
 * inside a space-scoped invocation. A proactive plugin (e.g. the chat
 * gateway) has no such invocation at setup(), so the loader must replay every
 * configured space's config to the freshly-started worker. That replay reads
 * the config rows via `registry.listConfigs(pluginId)`, which this exercises.
 */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping plugin config startup-delivery tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

describeEmbeddedPostgres("registry.listConfigs (startup config delivery)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-plugin-config-delivery-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(pluginConfig);
    await db.delete(plugins);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedPlugin(pluginKey: string, installOrder: number) {
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey,
      packageName: `@outpost/${pluginKey}`,
      version: "0.0.1",
      apiVersion: 1,
      categories: ["automation"],
      manifestJson: {
        id: pluginKey,
        apiVersion: 1,
        version: "0.0.1",
        displayName: pluginKey,
        description: "Test plugin",
        author: "Outpost",
        categories: ["automation"],
        capabilities: [],
        entrypoints: { worker: "./dist/worker.js" },
      },
      status: "ready",
      installOrder,
    });
    return pluginId;
  }

  async function seedSpace() {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: `Co ${spaceId.slice(0, 6)}`,
      issuePrefix: issuePrefix(spaceId),
    });
    return spaceId;
  }

  it("returns every space-scoped config row for a plugin", async () => {
    const registry = pluginRegistryService(db);
    const pluginId = await seedPlugin("outpost.gateway-test", 1);
    const spaceA = await seedSpace();
    const spaceB = await seedSpace();

    await registry.upsertConfig(pluginId, spaceA, {
      spaceId: spaceA,
      configJson: { slackBotToken: "xoxb-a", slackAppToken: "xapp-a" },
    });
    await registry.upsertConfig(pluginId, spaceB, {
      spaceId: spaceB,
      configJson: { slackBotToken: "xoxb-b", slackAppToken: "xapp-b" },
    });

    const rows = await registry.listConfigs(pluginId);
    expect(rows).toHaveLength(2);

    const bySpace = new Map(rows.map((r) => [r.spaceId, r]));
    expect(bySpace.get(spaceA)?.configJson).toMatchObject({ slackBotToken: "xoxb-a" });
    expect(bySpace.get(spaceB)?.configJson).toMatchObject({ slackBotToken: "xoxb-b" });
  });

  it("only returns rows for the requested plugin (no cross-plugin bleed)", async () => {
    const registry = pluginRegistryService(db);
    const pluginId = await seedPlugin("outpost.gateway-test", 1);
    const otherPluginId = await seedPlugin("outpost.other-test", 2);
    const spaceA = await seedSpace();

    await registry.upsertConfig(pluginId, spaceA, {
      spaceId: spaceA,
      configJson: { marker: "mine" },
    });
    await registry.upsertConfig(otherPluginId, spaceA, {
      spaceId: spaceA,
      configJson: { marker: "theirs" },
    });

    const rows = await registry.listConfigs(pluginId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.configJson).toMatchObject({ marker: "mine" });
  });

  it("returns an empty list when the plugin has no configured spaces", async () => {
    const registry = pluginRegistryService(db);
    const pluginId = await seedPlugin("outpost.gateway-test", 1);
    const rows = await registry.listConfigs(pluginId);
    expect(rows).toEqual([]);
  });
});
