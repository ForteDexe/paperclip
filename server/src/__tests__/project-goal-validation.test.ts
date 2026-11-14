import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  spaces,
  createDb,
  goals,
  projectGoals,
  projects as projectsTable,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { HttpError } from "../errors.js";
import { projectService } from "../services/projects.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project goal validation tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// A project's goals must exist and belong to the same space. Before this
// validation, a nonexistent goal id died at the projects.goal_id foreign key
// as an opaque 500 (observed live 2026-09-03, retried four times by the
// caller), and a goal from another space linked silently — the foreign key
// proves existence, not ownership.
describeEmbeddedPostgres("project goal validation", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let prefixCounter = 0;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-project-goal-validation-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(projectGoals);
    await db.delete(projectsTable);
    await db.delete(goals);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSpace(name: string): Promise<string> {
    prefixCounter += 1;
    const [space] = await db
      .insert(spaces)
      .values({ name, issuePrefix: `GV${prefixCounter}` })
      .returning();
    return space.id;
  }

  async function seedGoal(spaceId: string, title: string): Promise<string> {
    const [goal] = await db
      .insert(goals)
      .values({ spaceId, title, level: "task", status: "active" })
      .returning();
    return goal.id;
  }

  function expectUnprocessable(error: unknown, unknownGoalId: string) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(422);
    expect((error as Error).message).toContain(unknownGoalId);
  }

  it("creates and links a project to a goal of the same space", async () => {
    const spaceId = await seedSpace("Valid Co");
    const goalId = await seedGoal(spaceId, "Ship it");
    const projects = projectService(db);

    const created = await projects.create(spaceId, { name: "Rocket", goalIds: [goalId] });
    expect(created.goalIds).toEqual([goalId]);
  });

  it("rejects a create whose goal id does not exist, before any insert", async () => {
    const spaceId = await seedSpace("Missing Goal Co");
    const projects = projectService(db);
    const ghost = "db7da378-99a6-43ea-964f-000000000000";

    const failure = await projects
      .create(spaceId, { name: "Rocket", goalIds: [ghost] })
      .then(() => null, (error: unknown) => error);
    expectUnprocessable(failure, ghost);

    const rows = await db.select({ id: projectsTable.id }).from(projectsTable);
    expect(rows).toHaveLength(0);
  });

  it("rejects the legacy single goalId field the same way", async () => {
    const spaceId = await seedSpace("Legacy Field Co");
    const projects = projectService(db);
    const ghost = "db7da378-99a6-43ea-964f-111111111111";

    const failure = await projects
      .create(spaceId, { name: "Rocket", goalId: ghost })
      .then(() => null, (error: unknown) => error);
    expectUnprocessable(failure, ghost);
  });

  it("rejects another space's goal on create — the FK only proves existence", async () => {
    const spaceId = await seedSpace("Home Co");
    const otherSpaceId = await seedSpace("Other Co");
    const foreignGoalId = await seedGoal(otherSpaceId, "Not yours");
    const projects = projectService(db);

    const failure = await projects
      .create(spaceId, { name: "Rocket", goalIds: [foreignGoalId] })
      .then(() => null, (error: unknown) => error);
    expectUnprocessable(failure, foreignGoalId);
  });

  it("ignores the legacy goalId when an explicit empty goalIds list wins resolution", async () => {
    // goalIds and goalId may arrive together; the resolved set (goalIds
    // first) is canonical for persistence too. Before this rule, an empty
    // list skipped validation while the raw legacy id was still written —
    // unvalidated, and unchecked for ownership.
    const spaceId = await seedSpace("Conflicting Fields Co");
    const otherSpaceId = await seedSpace("Conflicting Other Co");
    const foreignGoalId = await seedGoal(otherSpaceId, "Should not link");
    const projects = projectService(db);

    const created = await projects.create(spaceId, {
      name: "Rocket",
      goalIds: [],
      goalId: foreignGoalId,
    });
    expect(created.goalIds).toEqual([]);

    const [row] = await db
      .select({ goalId: projectsTable.goalId })
      .from(projectsTable)
      .where(eq(projectsTable.id, created.id));
    expect(row.goalId).toBeNull();
  });

  it("rejects an update to an unknown or foreign goal and leaves links unchanged", async () => {
    const spaceId = await seedSpace("Update Co");
    const otherSpaceId = await seedSpace("Update Other Co");
    const goodGoalId = await seedGoal(spaceId, "Good goal");
    const foreignGoalId = await seedGoal(otherSpaceId, "Foreign goal");
    const projects = projectService(db);

    const created = await projects.create(spaceId, { name: "Rocket", goalIds: [goodGoalId] });

    const failure = await projects
      .update(created.id, { goalIds: [foreignGoalId] })
      .then(() => null, (error: unknown) => error);
    expectUnprocessable(failure, foreignGoalId);

    const fetched = await projects.getById(created.id);
    expect(fetched?.goalIds).toEqual([goodGoalId]);
  });
});
