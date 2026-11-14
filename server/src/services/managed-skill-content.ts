import { and, eq, sql } from "drizzle-orm";
import type { StorageService } from "../storage/index.js";
import { spaces, spaceSkills, spaceSkillVersions, spaceSkillRepositorySnapshots, type Db } from "@outpost/db";
import type { SpaceSkillVersionFileInventoryEntry } from "@outpost/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { notifySkillVersionRetention } from "./skill-version-retention-notifications.js";
import { skillPackageStore, skillPackageStorageEnabled, skillVersionFileMap, skillVersionMetadataColumns, type StoredSkillVersion } from "./skill-package-store.js";
import { assertSkillSnapshotPath, MAX_SKILL_SNAPSHOT_BYTES, MAX_SKILL_SNAPSHOT_FILES, skillFileBytes, skillSnapshotHash } from "./skill-snapshot.js";

export type SkillContentTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type SkillContentRow = typeof spaceSkills.$inferSelect;
const contentMetadataFields = ["name", "description", "iconUrl", "color", "tagline", "authorName", "homepageUrl", "categories", "metadata"] as const;
export type SkillContentActor = { type: "agent" | "user" | "system"; agentId?: string | null; userId?: string | null };
export type PreparedSkillContent = {
  files: SpaceSkillVersionFileInventoryEntry[];
  packageSnapshotId: string | null;
  packageFileMap: (typeof spaceSkillVersions.$inferInsert)["packageFileMap"];
  implicitFileMap: (typeof spaceSkillVersions.$inferInsert)["packageFileMap"];
  contentHash: string;
};
export type SkillContentPublication = {
  expectedVersionId?: string | null;
  label?: string | null;
  reuseCurrentVersion?: boolean;
  beforeLock?: (tx: SkillContentTransaction) => Promise<void>;
  validate?: (tx: SkillContentTransaction) => Promise<void>;
  afterPublish?: (tx: SkillContentTransaction, skill: SkillContentRow, version: StoredSkillVersion) => Promise<void>;
};

export function managedSkillContent(db: Db, packageDb: Db = db, storage?: StorageService) {
  const packages = skillPackageStore(packageDb, storage);

  async function read(spaceId: string, skillId: string, versionId: string) {
    const version = await packages.version(spaceId, skillId, versionId);
    if (!version) throw notFound("Skill version not found");
    return { version, files: await packages.versionFiles(version) };
  }

  async function prepare(spaceId: string, files: SpaceSkillVersionFileInventoryEntry[], signal?: AbortSignal): Promise<PreparedSkillContent> {
    signal?.throwIfAborted();
    const paths = new Set<string>();
    let bytes = 0;
    for (const file of files) {
      try { assertSkillSnapshotPath(file.path); } catch { throw unprocessable("Invalid skill file path."); }
      if (paths.has(file.path)) throw unprocessable("Duplicate skill file path.");
      paths.add(file.path);
      bytes += skillFileBytes(file).length;
    }
    if (files.length > MAX_SKILL_SNAPSHOT_FILES || bytes > MAX_SKILL_SNAPSHOT_BYTES) {
      throw unprocessable("Skill exceeds package size limits.");
    }
    if (!files.some(file => file.path === "SKILL.md" && file.encoding !== "base64")) {
      throw unprocessable("A skill must contain a UTF-8 SKILL.md file.");
    }
    const packageSnapshotId = skillPackageStorageEnabled() ? await packages.prepare(spaceId, files, false, signal) : null;
    if (packageSnapshotId && !await packages.verifyDurable(spaceId, packageSnapshotId, signal)) {
      throw unprocessable("Skill package is not durably available.");
    }
    return { files, packageSnapshotId, contentHash: skillSnapshotHash(files),
      packageFileMap: packageSnapshotId ? skillVersionFileMap(files) : null,
      implicitFileMap: packageSnapshotId ? skillVersionFileMap((await packages.manifest(spaceId, packageSnapshotId, signal)).files) : null };
  }

  function fileMapIdentity(files: PreparedSkillContent["packageFileMap"]) {
    return JSON.stringify(files?.map(file => ({ path: file.path, sourcePath: file.sourcePath,
      kind: file.kind, encoding: file.encoding ?? "utf8" })).sort((left, right) => left.path.localeCompare(right.path)));
  }

  async function append(tx: SkillContentTransaction, skill: SkillContentRow, candidate: PreparedSkillContent,
    actor: SkillContentActor | null, options: SkillContentPublication, fields: Partial<typeof spaceSkills.$inferInsert> = {}) {
    await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillPackages);
    await notifySkillVersionRetention(tx, skill.spaceId);
    if (candidate.packageSnapshotId) {
      const [receipt] = await tx.select({ storage: spaceSkillRepositorySnapshots.storage })
        .from(spaceSkillRepositorySnapshots).where(and(eq(spaceSkillRepositorySnapshots.spaceId, skill.spaceId),
          eq(spaceSkillRepositorySnapshots.id, candidate.packageSnapshotId))).for("update");
      if (!receipt?.storage) throw conflict("Skill package changed during publication. Retry the operation.");
    }
    if (options.reuseCurrentVersion && skill.currentVersionId && candidate.packageSnapshotId) {
      const [version] = await tx.select(skillVersionMetadataColumns).from(spaceSkillVersions).where(and(
        eq(spaceSkillVersions.spaceId, skill.spaceId), eq(spaceSkillVersions.spaceSkillId, skill.id),
        eq(spaceSkillVersions.id, skill.currentVersionId)));
      if (version && !version.repositorySnapshotId && version.packageSnapshotId === candidate.packageSnapshotId
        && fileMapIdentity(version.packageFileMap ?? candidate.implicitFileMap) === fileMapIdentity(candidate.packageFileMap)) {
        if (!version.packageFileMap) {
          await tx.update(spaceSkillVersions).set({ packageFileMap: candidate.packageFileMap })
            .where(and(eq(spaceSkillVersions.spaceId, skill.spaceId), eq(spaceSkillVersions.id, version.id)));
          version.packageFileMap = candidate.packageFileMap ?? null;
        }
        const [saved] = await tx.update(spaceSkills).set({ ...fields, updatedAt: new Date() })
          .where(and(eq(spaceSkills.spaceId, skill.spaceId), eq(spaceSkills.id, skill.id))).returning();
        await options.afterPublish?.(tx, saved!, version);
        return { skill: saved!, version };
      }
    }
    const [revision] = await tx.select({ next: sql<number>`coalesce(max(${spaceSkillVersions.revisionNumber}), 0) + 1` })
      .from(spaceSkillVersions).where(and(eq(spaceSkillVersions.spaceId, skill.spaceId), eq(spaceSkillVersions.spaceSkillId, skill.id)));
    const [version] = await tx.insert(spaceSkillVersions).values({
      spaceId: skill.spaceId, spaceSkillId: skill.id, revisionNumber: Number(revision!.next),
      label: options.label ?? null, packageSnapshotId: candidate.packageSnapshotId, packageFileMap: candidate.packageFileMap,
      fileInventory: candidate.packageSnapshotId ? [] : candidate.files,
      migrationAt: candidate.packageSnapshotId ? null : new Date(),
      authorAgentId: actor?.type === "agent" ? actor.agentId : null,
      authorUserId: actor?.type === "user" ? actor.userId : null,
    }).returning();
    const [saved] = await tx.update(spaceSkills).set({ ...fields, currentVersionId: version!.id, updatedAt: new Date() })
      .where(and(eq(spaceSkills.spaceId, skill.spaceId), eq(spaceSkills.id, skill.id))).returning();
    await options.afterPublish?.(tx, saved!, version!);
    return { skill: saved!, version: version! };
  }

  async function publish(base: Pick<SkillContentRow, "id" | "spaceId" | "slug" | "key" | "sourceType" | "currentVersionId" | typeof contentMetadataFields[number]> & { accessSourceId?: string | null }, candidate: PreparedSkillContent,
    fields: Partial<typeof spaceSkills.$inferInsert>, actor: SkillContentActor | null = null,
    options: SkillContentPublication = {}) {
    if (options.expectedVersionId !== undefined && options.expectedVersionId !== base.currentVersionId) {
      throw conflict("Skill version changed. Read the current version before retrying.");
    }
    return db.transaction(async tx => {
      await options.beforeLock?.(tx);
      for (const slug of [...new Set([base.slug, fields.slug ?? base.slug])].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${base.spaceId}:${slug}`}, 0))`);
      }
      const [current] = await tx.select().from(spaceSkills).where(and(eq(spaceSkills.spaceId, base.spaceId), eq(spaceSkills.id, base.id))).for("update");
      if (!current) throw notFound("Skill not found");
      if (current.currentVersionId !== base.currentVersionId || current.key !== base.key || current.sourceType !== base.sourceType
        || current.accessSourceId !== (base.accessSourceId ?? null)) {
        throw conflict("Skill version changed. Read the current version before retrying.");
      }
      if (contentMetadataFields.some(field => Object.hasOwn(fields, field)
        && JSON.stringify(current[field]) !== JSON.stringify(base[field]))) {
        throw conflict("Skill metadata changed. Read the current skill before retrying.");
      }
      await options.validate?.(tx);
      return append(tx, current, candidate, actor, options, fields);
    });
  }

  async function create(values: typeof spaceSkills.$inferInsert, candidate: PreparedSkillContent,
    actor: SkillContentActor | null = null, options: SkillContentPublication = {}) {
    return db.transaction(async tx => {
      const [space] = await tx.select({ id: spaces.id }).from(spaces)
        .where(eq(spaces.id, values.spaceId)).for("share");
      if (!space) throw notFound("Outpost not found");
      await options.beforeLock?.(tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${values.spaceId}:${values.slug}`}, 0))`);
      await options.validate?.(tx);
      const [existing] = await tx.select({ id: spaceSkills.id }).from(spaceSkills)
        .where(and(eq(spaceSkills.spaceId, values.spaceId), eq(spaceSkills.key, values.key)));
      if (existing) throw conflict(`A space skill with slug "${values.slug}" already exists.`);
      const [skill] = await tx.insert(spaceSkills).values(values).returning();
      return append(tx, skill!, candidate, actor, options);
    });
  }

  return { read, prepare, publish, create };
}
