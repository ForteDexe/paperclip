import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spaces, createDb, projects as projectsTable } from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { projectService } from "../services/projects.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project icon tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// Verifies the PAP-69 data layer: the 0094 migration applies cleanly (the
// embedded harness runs all pending migrations on startup) and the `icon`
// column persists + round-trips through the projects service.
describeEmbeddedPostgres("project icon persistence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let spaceId!: string;
  let prefixCounter = 0;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-project-icon-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(projectsTable);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSpace(): Promise<string> {
    prefixCounter += 1;
    const [space] = await db
      .insert(spaces)
      .values({ name: "Icon Co", issuePrefix: `ICN${prefixCounter}` })
      .returning();
    return space.id;
  }

  it("persists and round-trips a project icon on create", async () => {
    spaceId = await seedSpace();
    const projects = projectService(db);

    const created = await projects.create(spaceId, { name: "Rocket", icon: "rocket" });
    expect(created.icon).toBe("rocket");

    const fetched = await projects.getById(created.id);
    expect(fetched?.icon).toBe("rocket");
  });

  it("defaults icon to null when none is provided", async () => {
    spaceId = await seedSpace();
    const projects = projectService(db);

    const created = await projects.create(spaceId, { name: "Plain" });
    expect(created.icon).toBeNull();

    const fetched = await projects.getById(created.id);
    expect(fetched?.icon).toBeNull();
  });

  // PAP-71: new projects must NOT auto-assign a color — they stay neutral gray
  // (color = null) unless an explicit color is supplied on create.
  it("defaults color to null when none is provided (no auto-assign)", async () => {
    spaceId = await seedSpace();
    const projects = projectService(db);

    const created = await projects.create(spaceId, { name: "Gray" });
    expect(created.color).toBeNull();

    const fetched = await projects.getById(created.id);
    expect(fetched?.color).toBeNull();
  });

  it("still persists an explicit color when one is supplied", async () => {
    spaceId = await seedSpace();
    const projects = projectService(db);

    const created = await projects.create(spaceId, { name: "Blue", color: "#3b82f6" });
    expect(created.color).toBe("#3b82f6");

    const fetched = await projects.getById(created.id);
    expect(fetched?.color).toBe("#3b82f6");
  });
});
