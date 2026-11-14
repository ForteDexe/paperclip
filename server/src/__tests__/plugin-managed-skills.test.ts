import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  spaces,
  spaceSkills,
  createDb,
  pluginManagedResources,
  plugins,
} from "@outpost/db";
import type { OutpostPluginManifestV1 } from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { spaceSkillService } from "../services/space-skills.js";
import { buildHostServices } from "../services/plugin-host-services.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: async () => {},
        subscribe: () => {},
      };
    },
  } as any;
}

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function manifest(): OutpostPluginManifestV1 {
  return {
    id: "outpost.managed-skills-test",
    apiVersion: 1,
    version: "0.1.0",
    displayName: "Managed Skills Test",
    description: "Test plugin",
    author: "Outpost",
    categories: ["automation"],
    capabilities: ["skills.managed"],
    entrypoints: { worker: "./dist/worker.js" },
    skills: [{
      skillKey: "wiki-maintainer",
      displayName: "Wiki Maintainer Skill",
      description: "Use LLM Wiki tools to maintain space knowledge.",
      files: [{
        path: "references/wiki-style.md",
        content: "# Wiki style\n\nKeep pages cited and terse.\n",
      }],
    }],
  };
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres plugin-managed skill tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("plugin-managed skills", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-plugin-managed-skills-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(pluginManagedResources);
    await db.delete(spaceSkills);
    await db.delete(plugins);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSpaceAndPlugin(pluginManifest = manifest()) {
    const spaceId = randomUUID();
    const pluginId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: issuePrefix(spaceId),
    });
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: pluginManifest.id,
      packageName: "@outpost/plugin-managed-skills-test",
      version: pluginManifest.version,
      apiVersion: pluginManifest.apiVersion,
      categories: pluginManifest.categories,
      manifestJson: pluginManifest,
      status: "ready",
      installOrder: 1,
    });
    const services = buildHostServices(db, pluginId, pluginManifest.id, createEventBusStub(), undefined, {
      manifest: pluginManifest,
    });
    return { spaceId, pluginId, pluginManifest, services };
  }

  it("installs and resolves managed space skills by stable resource key", async () => {
    const { spaceId, services } = await seedSpaceAndPlugin();

    const created = await services.skills.managedReconcile({
      spaceId,
      skillKey: "wiki-maintainer",
    });

    expect(created.status).toBe("created");
    expect(created.skill).toMatchObject({
      name: "plugin-managed-skills-test-wiki-maintainer",
      slug: "plugin-managed-skills-test-wiki-maintainer",
      key: "plugin/outpost-managed-skills-test/wiki-maintainer",
      sourceType: "managed",
      sourceLocator: null,
      fileInventory: expect.arrayContaining([
        expect.objectContaining({ path: "SKILL.md", kind: "skill" }),
        expect.objectContaining({ path: "references/wiki-style.md", kind: "reference" }),
      ]),
    });

    const resolved = await services.skills.managedGet({
      spaceId,
      skillKey: "wiki-maintainer",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.skillId).toBe(created.skillId);

    const [binding] = await db.select().from(pluginManagedResources);
    expect(binding).toMatchObject({
      spaceId,
      resourceKind: "skill",
      resourceKey: "wiki-maintainer",
      resourceId: created.skillId,
    });
  });

  it("keeps a same-slug user skill separate through automatic install, reset, and relinking", async () => {
    const { spaceId, services } = await seedSpaceAndPlugin();
    const original = await spaceSkillService(db).createLocalSkill(spaceId, { name: "Wiki Maintainer Skill", markdown: "# User instructions\n" });
    const created = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(created.skillId).not.toBe(original.id);
    expect(created.skill!.key).toBe("plugin/outpost-managed-skills-test/wiki-maintainer");
    expect(created.skill!.slug).toBe("plugin-managed-skills-test-wiki-maintainer");
    expect(created.skill!.markdown).toContain('name: "plugin-managed-skills-test-wiki-maintainer"');
    await services.skills.managedReset({ spaceId, skillKey: "wiki-maintainer" });
    await db.delete(pluginManagedResources).where(eq(pluginManagedResources.resourceId, created.skillId!));
    const relinked = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(relinked.skillId).toBe(created.skillId);
    expect((await db.select().from(spaceSkills).where(eq(spaceSkills.id, original.id)))[0]).toMatchObject({ key: original.key, slug: original.slug, markdown: original.markdown });
  });

  it("claims the plugin name while preserving a conflicting space skill as a separate record", async () => {
    const { spaceId, services } = await seedSpaceAndPlugin();
    const original = await spaceSkillService(db).createLocalSkill(spaceId, {
      name: "plugin-managed-skills-test-wiki-maintainer", markdown: "# User instructions\n",
    });
    const installed = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(installed.skill!.slug).toBe(original.slug);
    expect(installed.skill!.id).not.toBe(original.id);
    await services.skills.managedReset({ spaceId, skillKey: "wiki-maintainer" });
    const records = (await db.select().from(spaceSkills)).filter(skill => [original.key, installed.skill!.key].includes(skill.key));
    expect(records).toHaveLength(2);
    expect(records.find(skill => skill.id === original.id)).toMatchObject({ key: original.key, markdown: original.markdown });
    expect(await db.select().from(pluginManagedResources)).toEqual([expect.objectContaining({ resourceId: installed.skill!.id })]);
  });
  it("preserves operator edits during reconcile and restores manifest defaults on reset", async () => {
    const { spaceId, services } = await seedSpaceAndPlugin();
    const created = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(created.skillId).toBeTruthy();

    await db
      .update(spaceSkills)
      .set({
        name: "Custom Wiki Skill",
        markdown: "# Custom instructions\n",
        updatedAt: new Date(),
      })
      .where(eq(spaceSkills.id, created.skillId!));

    const reconciled = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(reconciled.status).toBe("resolved");
    expect(reconciled.skill).toMatchObject({
      name: "Custom Wiki Skill",
      markdown: "# Custom instructions\n",
    });

    const reset = await services.skills.managedReset({ spaceId, skillKey: "wiki-maintainer" });
    expect(reset.status).toBe("reset");
    expect(reset.skill).toMatchObject({
      name: "plugin-managed-skills-test-wiki-maintainer",
      description: "Use LLM Wiki tools to maintain space knowledge.",
    });
    expect(reset.skill?.markdown).toContain("key: \"plugin/outpost-managed-skills-test/wiki-maintainer\"");
  });

  it("does not rewrite managed skill bindings when defaults are unchanged", async () => {
    const { spaceId, services } = await seedSpaceAndPlugin();
    const created = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(created.skillId).toBeTruthy();

    const [binding] = await db.select().from(pluginManagedResources);
    const oldUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
    await db
      .update(pluginManagedResources)
      .set({ updatedAt: oldUpdatedAt })
      .where(eq(pluginManagedResources.id, binding.id));

    const reconciled = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    const [bindingAfter] = await db.select().from(pluginManagedResources);

    expect(reconciled.status).toBe("resolved");
    expect(bindingAfter.updatedAt.toISOString()).toBe(oldUpdatedAt.toISOString());
  });

  it("relinks an existing canonical skill without overwriting operator edits", async () => {
    const { spaceId, services } = await seedSpaceAndPlugin();
    const created = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(created.skillId).toBeTruthy();

    await db.delete(pluginManagedResources).where(eq(pluginManagedResources.resourceId, created.skillId!));
    await db
      .update(spaceSkills)
      .set({
        name: "Existing Customized Wiki Skill",
        markdown: "# Existing customized instructions\n",
        updatedAt: new Date(),
      })
      .where(eq(spaceSkills.id, created.skillId!));

    const relinked = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });

    expect(relinked.status).toBe("relinked");
    expect(relinked.skillId).toBe(created.skillId);
    expect(relinked.skill).toMatchObject({
      name: "Existing Customized Wiki Skill",
      markdown: "# Existing customized instructions\n",
    });
    expect(relinked.defaultDrift).toEqual({ changedFiles: ["SKILL.md"] });

    const [binding] = await db.select().from(pluginManagedResources);
    expect(binding).toMatchObject({
      spaceId,
      resourceKind: "skill",
      resourceKey: "wiki-maintainer",
      resourceId: created.skillId,
    });
  });

  it("reports drift when installed skill files differ from plugin defaults", async () => {
    const { spaceId, services } = await seedSpaceAndPlugin();
    const created = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(created.defaultDrift).toBeNull();

    await db
      .update(spaceSkills)
      .set({
        markdown: "# Custom instructions\n",
        updatedAt: new Date(),
      })
      .where(eq(spaceSkills.id, created.skillId!));

    const drifted = await services.skills.managedReconcile({ spaceId, skillKey: "wiki-maintainer" });
    expect(drifted.status).toBe("resolved");
    expect(drifted.defaultDrift).toEqual({ changedFiles: ["SKILL.md"] });

    const reset = await services.skills.managedReset({ spaceId, skillKey: "wiki-maintainer" });
    expect(reset.defaultDrift).toBeNull();
  });

  it("preserves unrelated YAML while replacing quoted and multiline identity fields", async () => {
    const declaration = manifest();
    declaration.skills = [{ skillKey: "yaml-skill", displayName: "YAML skill", markdown:
      '---\n"name": |\n  Previous name\nslug: old-slug\ndescription: >\n  Keep this folded description.\nmetadata:\n  "category": desktop\n# Keep this comment.\n---\nBody stays unchanged.\n' }];
    const { spaceId, services } = await seedSpaceAndPlugin(declaration);
    const created = await services.skills.managedReconcile({ spaceId, skillKey: "yaml-skill" });
    expect(created.skill!.markdown).toContain('name: "plugin-managed-skills-test-yaml-skill"');
    expect(created.skill!.markdown).not.toContain("Previous name");
    expect(created.skill!.markdown).toContain('description: >\n  Keep this folded description.\nmetadata:\n  "category": desktop\n# Keep this comment.');
    expect(created.skill!.markdown).toMatch(/Body stays unchanged\.\n$/);
    await services.skills.managedReset({ spaceId, skillKey: "yaml-skill" });
  });
  it("adds the canonical managed key to manifest-provided markdown skills", async () => {
    const pluginManifest = manifest();
    pluginManifest.skills = [
      ...(pluginManifest.skills ?? []),
      {
        skillKey: "markdown-skill",
        displayName: "Markdown Skill",
        markdown: [
          "---",
          "name: markdown-skill",
          "description: Markdown source without a key.",
          "---",
          "",
          "# Markdown Skill",
          "",
          "Follow the managed markdown.",
        ].join("\n"),
      },
    ];
    const { spaceId, services } = await seedSpaceAndPlugin(pluginManifest);

    const created = await services.skills.managedReconcile({ spaceId, skillKey: "markdown-skill" });

    expect(created.status).toBe("created");
    expect(created.skill).toMatchObject({
      key: "plugin/outpost-managed-skills-test/markdown-skill",
      name: "plugin-managed-skills-test-markdown-skill",
    });
    expect(created.skill?.markdown).toContain('key: "plugin/outpost-managed-skills-test/markdown-skill"');
  });
});
