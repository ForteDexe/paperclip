import { and, eq, inArray, or, sql } from "drizzle-orm";
import { spaceSkills, pluginSpaceSettings, pluginManagedResources, plugins, type Db } from "@outpost/db";
import { readOutpostSkillSyncPreference, resolveOutpostDesiredSkillNames, writeOutpostSkillSyncPreference } from "@outpost/adapter-utils/server-utils";
import { unprocessable } from "../errors.js";
import { buildSkillRuntimeName } from "./space-skills.js";
import { pluginManagedSkillService } from "./plugin-managed-skills.js";

/** Environment capabilities join the normal authorized, versioned skill selection. */
export async function environmentSkillConfig(db: Db, spaceId: string,
  environment: { driver: string; config: Record<string, unknown> | null } | null | undefined,
  config: Record<string, unknown>, installMissing = true): Promise<{ config: Record<string, unknown>; skillKeys: string[]; shadowedSkills?: Array<{ key: string; shadowedBy: string }> }> {
  if (environment?.driver !== "plugin") return { config, skillKeys: [] };
  const { pluginKey, driverKey } = environment.config ?? {};
  if (typeof pluginKey !== "string" || typeof driverKey !== "string") return { config, skillKeys: [] };
  const [plugin] = await db.select().from(plugins).where(eq(plugins.pluginKey, pluginKey));
  const keys = plugin?.manifestJson.environmentDrivers?.find(driver => driver.driverKey === driverKey)?.skillKeys ?? [];
  if (!plugin || !keys.length) return { config, skillKeys: [] };
  const [settings] = await db.select().from(pluginSpaceSettings).where(and(
    eq(pluginSpaceSettings.spaceId, spaceId), eq(pluginSpaceSettings.pluginId, plugin.id)));
  if (plugin.status !== "ready" || settings?.enabled === false || !plugin.manifestJson.capabilities.includes("skills.managed")) {
    throw unprocessable("Environment skills require an enabled plugin with skills.managed capability");
  }
  // Existing bindings need only a bounded metadata query, not a file-by-file drift scan.
  const installed = await db.select({ resourceKey: pluginManagedResources.resourceKey, key: spaceSkills.key })
    .from(pluginManagedResources).innerJoin(spaceSkills, and(
      eq(spaceSkills.id, pluginManagedResources.resourceId), eq(spaceSkills.spaceId, spaceId)))
    .where(and(eq(pluginManagedResources.spaceId, spaceId), eq(pluginManagedResources.pluginId, plugin.id),
      eq(pluginManagedResources.resourceKind, "skill"), inArray(pluginManagedResources.resourceKey, keys)));
  const selected = new Map(installed.map(skill => [skill.resourceKey, skill.key]));
  for (const key of keys) {
    if (selected.has(key) || !installMissing) continue;
    const result = await db.transaction(async tx => {
      // Serialize first installation across concurrent agents in this space.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`environment-skill:${spaceId}:${plugin.id}:${key}`}, 0))`);
      return pluginManagedSkillService(tx as unknown as Db, { pluginId: plugin.id, pluginKey, manifest: plugin.manifestJson }).reconcile(key, spaceId);
    });
    if (!result.skill) throw unprocessable("Environment skill is unavailable");
    selected.set(key, result.skill.key);
  }
  const preference = readOutpostSkillSyncPreference(config);
  const explicit = new Set(preference.desiredSkillEntries.map(entry => entry.key));
  const skillKeys = keys.flatMap(key => selected.has(key) ? [selected.get(key)!] : []);
  const candidates = await db.select({ key: spaceSkills.key, slug: spaceSkills.slug, name: spaceSkills.name })
    .from(spaceSkills).where(and(eq(spaceSkills.spaceId, spaceId),
      or(inArray(sql<string>`lower(${spaceSkills.key})`, [...new Set([...explicit, ...skillKeys])].map(key => key.toLowerCase())),
        inArray(sql<string>`lower(${spaceSkills.slug})`, [...explicit].map(key => key.toLowerCase().split("/").at(-1)!.replace(/--[a-f0-9]{10}$/, ""))))));
  const names = candidates.map(skill => ({ key: skill.key, runtimeName: buildSkillRuntimeName(skill.key, skill.slug) }));
  const entries = preference.desiredSkillEntries.map(entry => ({ ...entry,
    key: resolveOutpostDesiredSkillNames(writeOutpostSkillSyncPreference({}, [entry]), names)[0] ?? entry.key,
  }));
  const selectedKeys = new Set(entries.map(entry => entry.key));
  const required = candidates.filter(skill => skillKeys.includes(skill.key));
  const shadowedSkills = candidates.flatMap(skill => {
    if (skillKeys.includes(skill.key) || !selectedKeys.has(skill.key)) return [];
    const winner = required.find(candidate => candidate.slug === skill.slug || candidate.name === skill.name);
    return winner ? [{ key: skill.key, shadowedBy: winner.key }] : [];
  });
  const shadowed = new Set(shadowedSkills.map(skill => skill.key));
  return { config: writeOutpostSkillSyncPreference(config, [
    ...entries.filter(entry => !shadowed.has(entry.key)),
    ...skillKeys.filter(key => !selectedKeys.has(key))]), skillKeys,
    ...(shadowedSkills.length ? { shadowedSkills } : {}),
  };
}
