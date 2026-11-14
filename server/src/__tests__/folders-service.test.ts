import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  folderSlugSchema,
} from "@outpost/shared";
import {
  spaces,
  spaceSkills,
  createDb,
  folders,
  routines,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { folderService } from "../services/folders.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("folder service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-folders-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(spaceSkills);
    await db.delete(routines);
    await db.delete(folders);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSpace() {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    return spaceId;
  }

  async function seedRoutine(spaceId: string, title: string, folderId?: string | null) {
    const [routine] = await db
      .insert(routines)
      .values({
        spaceId,
        title,
        folderId: folderId ?? null,
        responsibleUserId: "responsible-user",
      })
      .returning();
    return routine!;
  }

  async function seedSkill(spaceId: string, slug: string, folderId?: string | null) {
    const [skill] = await db
      .insert(spaceSkills)
      .values({
        spaceId,
        folderId: folderId ?? null,
        key: `space/${spaceId}/${slug}`,
        slug,
        name: slug,
        markdown: `# ${slug}`,
      })
      .returning();
    return skill!;
  }

  it("creates, updates, reorders, and lists routine folders with counts", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);

    const reporting = await svc.create(spaceId, {
      kind: "routine",
      name: "Reporting",
      color: "green",
    });
    const cleanup = await svc.create(spaceId, {
      kind: "routine",
      name: "Cleanup",
      color: null,
    });
    await seedRoutine(spaceId, "Filed", reporting.id);
    await seedRoutine(spaceId, "Unfiled");

    const renamed = await svc.update(spaceId, cleanup.id, { name: "Ops", color: "cyan" });
    expect(renamed).toMatchObject({ id: cleanup.id, name: "Ops", color: "cyan" });
    const cleared = await svc.update(spaceId, cleanup.id, { color: null });
    expect(cleared).toMatchObject({ id: cleanup.id, color: null });

    const movedFolder = await svc.moveFolder(spaceId, reporting.id, { position: 10 });
    expect(movedFolder).toMatchObject({ id: reporting.id, position: 10 });

    const listed = await svc.list(spaceId, "routine");
    expect(listed.allCount).toBe(2);
    expect(listed.unfiledCount).toBe(1);
    expect(listed.folders).toEqual([
      expect.objectContaining({ id: cleanup.id, name: "Ops", itemCount: 0 }),
      expect.objectContaining({ id: reporting.id, name: "Reporting", itemCount: 1 }),
    ]);
  });

  it("moves routines and skills to folders and back to virtual Unfiled", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const routineFolder = await svc.create(spaceId, { kind: "routine", name: "Reports" });
    const skillFolder = await svc.create(spaceId, { kind: "skill", name: "Runtime" });
    const routine = await seedRoutine(spaceId, "Daily report");
    const skill = await seedSkill(spaceId, "review");

    await expect(svc.moveItem(spaceId, {
      kind: "routine",
      itemId: routine.id,
      folderId: routineFolder.id,
    })).resolves.toEqual({ kind: "routine", itemId: routine.id, folderId: routineFolder.id });
    await expect(svc.moveItem(spaceId, {
      kind: "skill",
      itemId: skill.id,
      folderId: skillFolder.id,
    })).resolves.toEqual({ kind: "skill", itemId: skill.id, folderId: skillFolder.id });

    await expect(svc.moveItem(spaceId, {
      kind: "routine",
      itemId: routine.id,
      folderId: null,
    })).resolves.toEqual({ kind: "routine", itemId: routine.id, folderId: null });

    const [updatedRoutine] = await db.select().from(routines).where(eq(routines.id, routine.id));
    const [updatedSkill] = await db.select().from(spaceSkills).where(eq(spaceSkills.id, skill.id));
    expect(updatedRoutine?.folderId).toBeNull();
    expect(updatedSkill?.folderId).toBe(skillFolder.id);
  });

  it("rejects moving an item into a folder of the wrong kind", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const skillFolder = await svc.create(spaceId, { kind: "skill", name: "Runtime" });
    const routine = await seedRoutine(spaceId, "Daily report");

    await expect(svc.moveItem(spaceId, {
      kind: "routine",
      itemId: routine.id,
      folderId: skillFolder.id,
    })).rejects.toMatchObject({
      status: 422,
      message: "Folder kind must match item kind",
    });
  });

  it("deletes folders without deleting contents by moving items to Unfiled", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const folder = await svc.create(spaceId, { kind: "routine", name: "Reports" });
    const routine = await seedRoutine(spaceId, "Daily report", folder.id);

    const deleted = await svc.deleteFolder(spaceId, folder.id);
    expect(deleted).toMatchObject({ id: folder.id, name: "Reports" });

    const [updatedRoutine] = await db.select().from(routines).where(eq(routines.id, routine.id));
    expect(updatedRoutine?.folderId).toBeNull();
    expect(await db.select().from(folders).where(eq(folders.id, folder.id))).toHaveLength(0);
  });

  it("computes canonical paths and updates descendant paths after rename and move", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const root = await svc.create(spaceId, { kind: "skill", name: "Engineering" });
    const child = await svc.create(spaceId, { kind: "skill", parentId: root.id, name: "Code Review" });
    const destination = await svc.create(spaceId, { kind: "skill", name: "Operations" });

    expect(child).toMatchObject({ path: "engineering/code-review", depth: 2 });
    await svc.update(spaceId, root.id, { name: "Product Engineering" });
    expect(await svc.getFolder(spaceId, child.id)).toMatchObject({
      path: "product-engineering/code-review",
      depth: 2,
    });

    await svc.moveFolder(spaceId, child.id, { parentId: destination.id, position: 0 });
    expect(await svc.getFolder(spaceId, child.id)).toMatchObject({
      parentId: destination.id,
      path: "operations/code-review",
      depth: 2,
    });
  });

  it("rejects invalid slugs, cycles, and folders deeper than four levels", async () => {
    expect(folderSlugSchema.safeParse("../escape").success).toBe(false);
    expect(folderSlugSchema.safeParse("Valid Slug").success).toBe(false);
    expect(folderSlugSchema.safeParse("valid-slug-2").success).toBe(true);

    const spaceId = await seedSpace();
    const svc = folderService(db);
    const level1 = await svc.create(spaceId, { kind: "skill", name: "Level 1" });
    const level2 = await svc.create(spaceId, { kind: "skill", parentId: level1.id, name: "Level 2" });
    const level3 = await svc.create(spaceId, { kind: "skill", parentId: level2.id, name: "Level 3" });
    const level4 = await svc.create(spaceId, { kind: "skill", parentId: level3.id, name: "Level 4" });

    await expect(svc.create(spaceId, {
      kind: "skill",
      parentId: level4.id,
      name: "Level 5",
    })).rejects.toMatchObject({ status: 422, message: "Folder depth cannot exceed 4" });
    await expect(svc.moveFolder(spaceId, level1.id, {
      parentId: level3.id,
      position: 0,
    })).rejects.toMatchObject({ status: 422, message: "A folder cannot be moved into its own subtree" });
  });

  it("creates stable personal roots and protects bundled folders", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const personal = await svc.ensureMyFolder(spaceId, "user-1", "Ada Lovelace");
    const repeated = await svc.ensureMyFolder(spaceId, "user-1", "Ada Lovelace");
    const bundled = await svc.ensureBundledCategory(spaceId, "software-development");

    expect(repeated.id).toBe(personal.id);
    expect(personal).toMatchObject({ systemKey: "my:user-1", path: "my/ada-lovelace", depth: 2 });
    expect(bundled.path).toBe("bundled/software-development");
    await expect(svc.create(spaceId, {
      kind: "skill",
      parentId: bundled.id,
      name: "Nested",
    })).rejects.toMatchObject({ status: 403, message: "Bundled folders are read-only" });
    await expect(svc.update(spaceId, bundled.id, { name: "Changed" })).rejects.toMatchObject({ status: 403 });
  });

  it("heals legacy bundled category names without changing folder identity", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const legacy = await svc.ensureBundledCategory(spaceId, "software-development");

    const reconciled = await svc.ensureBundledCategory(spaceId, "Software Development");

    expect(reconciled).toMatchObject({
      id: legacy.id,
      name: "Software Development",
      path: "bundled/software-development",
      systemKey: "bundled:software-development",
    });
  });

  it("creates reserved folders idempotently under concurrent requests", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);

    const [personalA, personalB] = await Promise.all([
      svc.ensureMyFolder(spaceId, "user-1", "Ada Lovelace"),
      svc.ensureMyFolder(spaceId, "user-1", "Ada Lovelace"),
    ]);
    const [projectA, projectB] = await Promise.all([
      svc.ensureProjectFolder(spaceId, "project-1", "Core App"),
      svc.ensureProjectFolder(spaceId, "project-1", "Core App"),
    ]);
    const [bundledA, bundledB] = await Promise.all([
      svc.ensureBundledCategory(spaceId, "software-development"),
      svc.ensureBundledCategory(spaceId, "software-development"),
    ]);

    expect(personalA.id).toBe(personalB.id);
    expect(projectA.id).toBe(projectB.id);
    expect(bundledA.id).toBe(bundledB.id);
  });

  it("reserves system skill roots from manual create, update, and move", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);

    for (const slug of ["bundled", "my", "projects"]) {
      await expect(svc.create(spaceId, {
        kind: "skill",
        name: slug,
        slug,
      })).rejects.toMatchObject({ status: 403, message: "Reserved skill folders are system-managed" });
    }

    const editable = await svc.create(spaceId, { kind: "skill", name: "Editable" });
    await expect(svc.update(spaceId, editable.id, { slug: "bundled" })).rejects.toMatchObject({ status: 403 });

    const parent = await svc.create(spaceId, { kind: "skill", name: "Parent" });
    const nestedReserved = await svc.create(spaceId, { kind: "skill", parentId: parent.id, name: "Projects" });
    await expect(svc.moveFolder(spaceId, nestedReserved.id, { parentId: null, position: 0 })).rejects.toMatchObject({
      status: 403,
      message: "Reserved skill folders are system-managed",
    });
  });

  it("allows only system helpers to create children under personal and project roots", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const personal = await svc.ensureMyFolder(spaceId, "user-1", "Ada Lovelace");
    const project = await svc.ensureProjectFolder(spaceId, "project-1", "Core App");
    const myRoot = await svc.getFolder(spaceId, personal.parentId!);
    const projectsRoot = await svc.getFolder(spaceId, project.parentId!);
    const movable = await svc.create(spaceId, { kind: "skill", name: "Movable" });

    expect(myRoot?.systemKey).toBe("my");
    expect(projectsRoot?.systemKey).toBe("projects");
    await expect(svc.create(spaceId, {
      kind: "skill",
      parentId: myRoot!.id,
      name: "Spoofed User",
    })).rejects.toMatchObject({ status: 403 });
    await expect(svc.moveFolder(spaceId, movable.id, {
      parentId: projectsRoot!.id,
      position: 0,
    })).rejects.toMatchObject({ status: 403 });
  });

  it("moves squatted roots aside instead of adopting them as system containers", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const [squattedMy, squattedProjects] = await db.insert(folders).values([
      { spaceId, kind: "skill", parentId: null, name: "Attacker My", slug: "my", position: 0 },
      { spaceId, kind: "skill", parentId: null, name: "Attacker Projects", slug: "projects", position: 1 },
    ]).returning();

    const personal = await svc.ensureMyFolder(spaceId, "user-1", "Ada Lovelace");
    const project = await svc.ensureProjectFolder(spaceId, "project-1", "Core App");
    const myRoot = await svc.getFolder(spaceId, personal.parentId!);
    const projectsRoot = await svc.getFolder(spaceId, project.parentId!);
    const repairedMy = await svc.getFolder(spaceId, squattedMy!.id);
    const repairedProjects = await svc.getFolder(spaceId, squattedProjects!.id);

    expect(myRoot).toMatchObject({ slug: "my", systemKey: "my" });
    expect(projectsRoot).toMatchObject({ slug: "projects", systemKey: "projects" });
    expect(repairedMy).toMatchObject({ name: "Attacker My", systemKey: null });
    expect(repairedMy?.slug).toMatch(/^my-[a-f0-9]{8}$/);
    expect(repairedProjects).toMatchObject({ name: "Attacker Projects", systemKey: null });
    expect(repairedProjects?.slug).toMatch(/^projects-[a-f0-9]{8}$/);
  });

  it("suffixes system children when legacy rows squat personal and project slugs", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const initialPersonal = await svc.ensureMyFolder(spaceId, "seed-user", "Seed User");
    const initialProject = await svc.ensureProjectFolder(spaceId, "seed-project", "Seed Project");
    const myRootId = initialPersonal.parentId!;
    const projectsRootId = initialProject.parentId!;
    await db.insert(folders).values([
      { spaceId, kind: "skill", parentId: myRootId, name: "Ada Squat", slug: "ada-lovelace", position: 1 },
      { spaceId, kind: "skill", parentId: projectsRootId, name: "Core Squat", slug: "core-app", position: 1 },
    ]);

    const personal = await svc.ensureMyFolder(spaceId, "user-12345678", "Ada Lovelace");
    const project = await svc.ensureProjectFolder(spaceId, "project-12345678", "Core App");

    expect(personal).toMatchObject({ path: "my/ada-lovelace-user-12345678", systemKey: "my:user-12345678" });
    expect(project).toMatchObject({ path: "projects/core-app-project-12345678", systemKey: "project:project-12345678" });
  });

  it("does not adopt a legacy category row under the bundled root", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const initialCategory = await svc.ensureBundledCategory(spaceId, "initial");
    const bundledRootId = initialCategory.parentId!;
    const [squatted] = await db.insert(folders).values({
      spaceId,
      kind: "skill",
      parentId: bundledRootId,
      name: "User Software Development",
      slug: "software-development",
      position: 1,
    }).returning();

    const category = await svc.ensureBundledCategory(spaceId, "software-development");

    expect(category).toMatchObject({
      path: "bundled/software-development-bundled",
      systemKey: "bundled:software-development",
    });
    expect(await svc.getFolder(spaceId, squatted!.id)).toMatchObject({
      path: "bundled/software-development",
      systemKey: null,
    });
  });

  it("serializes concurrent system folder ensures", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    await db.insert(folders).values({
      spaceId,
      kind: "skill",
      name: "Squatted My",
      slug: "my",
      position: 0,
    });

    const personalFolders = await Promise.all(
      Array.from({ length: 8 }, () => svc.ensureMyFolder(spaceId, "user-123", "Ada Lovelace")),
    );

    expect(new Set(personalFolders.map((folder) => folder.id)).size).toBe(1);
    const rows = await db.select().from(folders).where(eq(folders.spaceId, spaceId));
    expect(rows.filter((row) => row.systemKey === "my")).toHaveLength(1);
    expect(rows.filter((row) => row.systemKey === "my:user-123")).toHaveLength(1);
    expect(rows.find((row) => row.systemKey === null)).toMatchObject({ name: "Squatted My" });
  });

  it("rechecks nested folders after waiting for the space mutation lock", async () => {
    const spaceId = await seedSpace();
    const svc = folderService(db);
    const parent = await svc.create(spaceId, { kind: "routine", name: "Parent" });
    let releaseLock!: () => void;
    let markLockAcquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { markLockAcquired = resolve; });
    const holdLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const lockKey = `outpost:folders:${spaceId}`;
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      markLockAcquired();
      await holdLock;
    });
    await lockAcquired;

    const deletion = svc.deleteFolder(spaceId, parent.id);
    await db.insert(folders).values({
      spaceId,
      kind: "routine",
      parentId: parent.id,
      name: "Child",
      slug: "child",
      position: 0,
    });
    releaseLock();
    await blocker;

    await expect(deletion).rejects.toMatchObject({
      status: 409,
      message: "Move or delete nested folders first",
    });
    await expect(svc.getFolder(spaceId, parent.id)).resolves.toMatchObject({ id: parent.id });
  });
});
