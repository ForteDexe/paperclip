import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, spaces, spaceMemberships, spaceSkills, spaceSkillSources, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  projectAccessMembers, projects, projectSkillSources } from "@outpost/db";
import { and, eq } from "drizzle-orm";
import { OUTPOST_OPERATIONAL_SKILL_KEY } from "@outpost/adapter-utils/server-utils";
import { spaceSkillService } from "../services/space-skills.js";
import { withSkillActor } from "../services/skill-access.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("concurrent runtime skill preparation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home: string;
  const previousHome = process.env.OUTPOST_HOME;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("runtime-skill-concurrency-");
    db = createDb(database.connectionString);
    home = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-skill-concurrency-"));
    process.env.OUTPOST_HOME = home;
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (previousHome === undefined) delete process.env.OUTPOST_HOME;
    else process.env.OUTPOST_HOME = previousHome;
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    if (home) await fs.rm(home, { recursive: true, force: true });
  });

  it("shares an in-flight inventory refresh across service instances before snapshot locking", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Concurrent skill readers", issuePrefix: `SC${spaceId.slice(0, 6)}` });
    const select = vi.spyOn(db, "select");
    try {
      const selections = await Promise.all(Array.from({ length: 6 }, () => spaceSkillService(db).listRuntimeSkillEntries(spaceId, {
        selectionConfig: { outpostSkillSync: { desiredSkills: [] } }, includeLegacy: true, snapshotLatest: true,
      })));
      for (const entries of selections) {
        expect(entries.map(entry => entry.key)).toEqual([OUTPOST_OPERATIONAL_SKILL_KEY]);
        expect(entries.every(entry => entry.sourceStatus === "available" && entry.versionId)).toBe(true);
      }
      expect(select.mock.calls.filter(([fields]) => fields && Object.keys(fields).length === 1 && fields.id === spaces.id)).toHaveLength(1);
      await spaceSkillService(db).listRuntimeSkillEntries(spaceId, {
        selectionConfig: { outpostSkillSync: { desiredSkills: [] } }, includeLegacy: true, snapshotLatest: true,
      });
      expect(select.mock.calls.filter(([fields]) => fields && Object.keys(fields).length === 1 && fields.id === spaces.id)).toHaveLength(2);
    } finally { select.mockRestore(); }
  }, 30_000);

  it("shares inventory work without sharing actor visibility or retaining revoked project access", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Separate skill readers", issuePrefix: `SV${spaceId.slice(0, 6)}` });
    const readers = await db.insert(agents).values(["Allowed", "Denied"].map(name => ({ spaceId, name, adapterType: "codex_local" }))).returning();
    await db.insert(spaceMemberships).values(readers.map(reader => ({ spaceId, principalType: "agent", principalId: reader.id, membershipRole: "member" })));
    const [project] = await db.insert(projects).values({ spaceId, name: "Private skill source", visibility: "private" }).returning();
    const [source] = await db.insert(spaceSkillSources).values({ spaceId, repositoryUrl: "https://github.com/fixture/private-skills",
      fullName: "fixture/private-skills", trackingRef: "main", accessScope: "projects" }).returning();
    await db.insert(projectSkillSources).values({ spaceId, projectId: project!.id, sourceId: source!.id,
      repositoryUrl: source!.repositoryUrl, trackingRef: "main", status: "ready" });
    await db.insert(projectAccessMembers).values({ spaceId, projectId: project!.id, subjectType: "agent", subjectId: readers[0]!.id });
    const skill = await spaceSkillService(db).createLocalSkill(spaceId, { name: "Private local skill" });
    await db.update(spaceSkills).set({ accessSourceId: source!.id }).where(eq(spaceSkills.id, skill.id));
    const read = (agentId: string) => withSkillActor({ type: "agent", spaceId, agentId, source: "agent_jwt" },
      () => spaceSkillService(db).listRuntimeSkillEntries(spaceId, { onlyKeys: new Set([skill.key]), snapshotLatest: true }));
    const [allowed, denied] = await Promise.all(readers.map(reader => read(reader.id)));
    expect(allowed!.map(entry => entry.key)).toEqual([skill.key]);
    expect(allowed![0]!.sourceStatus).toBe("available");
    expect(denied).toEqual([]);
    await db.delete(projectAccessMembers).where(and(eq(projectAccessMembers.projectId, project!.id), eq(projectAccessMembers.subjectId, readers[0]!.id)));
    expect(await read(readers[0]!.id)).toEqual([]);
  });
});
