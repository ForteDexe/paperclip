import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { spaces, createDb, goals } from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { HttpError } from "../errors.js";
import { goalService } from "../services/goals.js";
import { buildHostServices } from "../services/plugin-host-services.js";
import { createPluginEventBus } from "../services/plugin-event-bus.js";
import { createHostClientHandlers } from "../../../packages/plugins/sdk/src/host-client-factory.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Goal parent space tests unsupported: ${support.reason}`);

describeDatabase("goal parent space validation", () => {
  let db!: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let sequence = 0;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("outpost-goal-parent-space-");
    db = createDb(database.connectionString, { maxConnections: 6 });
  }, 20_000);
  afterEach(async () => {
    await db.delete(goals);
    await db.delete(spaces);
  });
  afterAll(async () => { await database?.cleanup(); });

  async function space() {
    const [row] = await db.insert(spaces).values({
      name: "Synthetic goal boundary fixture", issuePrefix: `GP${++sequence}`,
    }).returning();
    return row.id;
  }

  it("keeps same-space team/task hierarchy and achieved updates usable", async () => {
    const spaceId = await space();
    const service = goalService(db);
    const parent = await service.create(spaceId, { title: "Team", level: "team" });
    const child = await service.create(spaceId, { title: "Task", level: "task", parentId: parent.id });
    const updated = await service.update(child.id, { title: "Checked", description: "Synthetic", status: "achieved" });
    expect(updated).toMatchObject({ spaceId, parentId: parent.id, status: "achieved", title: "Checked" });
    const replacement = await service.create(spaceId, { title: "Replacement", level: "team", status: "achieved" });
    expect(await service.update(child.id, { parentId: replacement.id })).toMatchObject({ parentId: replacement.id });
    expect(await service.update(child.id, { title: "Title only" })).toMatchObject({ parentId: replacement.id, title: "Title only" });
    expect(await service.update(child.id, { parentId: null })).toMatchObject({ parentId: null });
  });

  it("rejects a foreign parent before inserting a child", async () => {
    const home = await space();
    const foreign = await space();
    const service = goalService(db);
    const parent = await service.create(foreign, { title: "Foreign parent" });
    const failure = await service.create(home, { title: "Must not exist", parentId: parent.id })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(422);
    expect((failure as Error).message).toBe("Parent north star not found in this space");
    expect(await service.list(home)).toEqual([]);
    expect(await service.getById(parent.id)).toMatchObject({ spaceId: foreign });
  });

  it("rejects a foreign parent update atomically and preserves the existing hierarchy", async () => {
    const home = await space();
    const foreign = await space();
    const service = goalService(db);
    const parent = await service.create(home, { title: "Home parent" });
    const child = await service.create(home, { title: "Original", parentId: parent.id });
    const other = await service.create(foreign, { title: "Foreign parent" });
    const failure = await service.update(child.id, { title: "Must not change", parentId: other.id })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(422);
    expect((failure as Error).message).toBe("Parent north star not found in this space");
    const [stored] = await db.select().from(goals).where(eq(goals.id, child.id));
    expect(stored).toMatchObject({ spaceId: home, title: "Original", parentId: parent.id });
  });

  it("uses the same denial for missing parents on create and update without changing rows", async () => {
    const spaceId = await space();
    const service = goalService(db);
    const child = await service.create(spaceId, { title: "Original" });
    const parentId = "db7da378-99a6-43ea-964f-000000000000";
    for (const write of [
      () => service.create(spaceId, { title: "Must not exist", parentId }),
      () => service.update(child.id, { title: "Must not change", parentId }),
    ]) {
      const failure = await write().then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(HttpError);
      expect((failure as HttpError).status).toBe(422);
      expect((failure as Error).message).toBe("Parent north star not found in this space");
    }
    expect(await service.list(spaceId)).toMatchObject([{ id: child.id, title: "Original", parentId: null }]);
  });

  it("keeps a missing update target as null", async () => {
    expect(await goalService(db).update("db7da378-99a6-43ea-964f-000000000000", { title: "Missing" })).toBeNull();
  });

  it("rejects raw plugin patches that move the goal to another space", async () => {
    const home = await space();
    const foreign = await space();
    const service = goalService(db);
    const parent = await service.create(home, { title: "Home parent" });
    const child = await service.create(home, { title: "Original", parentId: parent.id });
    const patch = { spaceId: foreign, parentId: parent.id, title: "Must not change" };
    const failure = await service.update(child.id, patch as any)
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(422);
    expect(await service.getById(child.id)).toMatchObject({ spaceId: home, title: "Original", parentId: parent.id });
  });

  it("keeps runtime identity fields out of allowed same-space updates", async () => {
    const spaceId = await space();
    const service = goalService(db);
    const goal = await service.create(spaceId, { title: "Original" });
    const unwantedId = "db7da378-99a6-43ea-964f-000000000000";
    const patch = { id: unwantedId, spaceId, title: "Allowed" };
    expect(await service.update(goal.id, patch as any)).toMatchObject({ id: goal.id, spaceId, title: "Allowed" });
    expect(await service.getById(unwantedId)).toBeNull();
  });

  it("enforces the space boundary through the actual plugin host raw-patch producer", async () => {
    const home = await space();
    const foreign = await space();
    const service = goalService(db);
    const parent = await service.create(home, { title: "Home parent" });
    const child = await service.create(home, { title: "Original", parentId: parent.id });
    const host = buildHostServices(db, "goal-test-plugin", "goal-test", createPluginEventBus());
    try {
      const failure = await host.goals.update({ spaceId: home, goalId: child.id,
        patch: { spaceId: foreign, parentId: parent.id, title: "Must not change" },
      }).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(HttpError);
      expect((failure as HttpError).status).toBe(422);
      expect(await service.getById(child.id)).toMatchObject({ spaceId: home, title: "Original", parentId: parent.id });
      expect(await host.goals.update({ spaceId: home, goalId: child.id, patch: { title: "Allowed" } }))
        .toMatchObject({ spaceId: home, title: "Allowed", parentId: parent.id });
    } finally {
      host.dispose();
    }
  });

  it.each([
    { name: "null", patch: null },
    { name: "missing", patch: undefined },
    { name: "array", patch: [] },
    { name: "string", patch: "invalid" },
    { name: "null-title", patch: { title: null } },
    { name: "non-GUID-parent", patch: { parentId: 17 } },
  ])("rejects a malformed plugin patch $name without writing", async ({ patch }) => {
    const spaceId = await space();
    const service = goalService(db);
    const goal = await service.create(spaceId, { title: "Original" });
    const host = buildHostServices(db, "goal-test-plugin", "goal-test", createPluginEventBus());
    const handlers = createHostClientHandlers({ pluginId: "goal-test", capabilities: ["goals.update"], services: host });
    try {
      const failure = await handlers["goals.update"]({ spaceId, goalId: goal.id, patch: patch as any },
        { invocationScope: { spaceId } }).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(HttpError);
      expect((failure as HttpError).status).toBe(422);
      expect(await service.getById(goal.id)).toMatchObject({ title: "Original", updatedAt: goal.updatedAt });
    } finally {
      host.dispose();
    }
  });

  it("keeps the checked parent alive through a concurrent child creation", async () => {
    const spaceId = await space();
    const service = goalService(db);
    const parent = await service.create(spaceId, { title: "Parent" });
    await db.execute(sql`create function goal_parent_insert_gate() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock_shared(hashtextextended(current_database() || 'goal-parent-insert', 0));
        return new;
      end $$`);
    await db.execute(sql`create trigger goal_parent_insert_gate before insert on goals
      for each row execute function goal_parent_insert_gate()`);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const gateReady = new Promise<number>((resolve) => { ready = resolve; });
    const gate = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_database() || 'goal-parent-insert', 0))`);
      const [owner] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      ready(owner.pid);
      await released;
    });
    let creation: Promise<unknown> | undefined;
    let deletion: Promise<unknown> | undefined;
    try {
      const gatePid = await Promise.race([gateReady, gate]);
      if (gatePid === undefined) throw new Error("Insert gate ended before it was ready");
      creation = service.create(spaceId, { title: "Child", parentId: parent.id });
      void creation.catch(() => {});
      await expect.poll(async () => {
        const [waiting] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_locks
          where locktype = 'advisory' and not granted and ${gatePid} = any(pg_blocking_pids(pid))`);
        return waiting.count;
      }, { timeout: 5_000 }).toBe(1);
      let deletionPid!: number;
      let deletionReady!: () => void;
      let deletionSettled = false;
      const deletionStarted = new Promise<void>((resolve) => { deletionReady = resolve; });
      deletion = db.transaction(async (tx) => {
        const [owner] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        deletionPid = owner.pid;
        deletionReady();
        await tx.delete(goals).where(eq(goals.id, parent.id));
      }).finally(() => { deletionSettled = true; });
      void deletion.catch(() => {});
      const results = Promise.allSettled([creation, deletion]);
      await Promise.race([deletionStarted, deletion]);
      await expect.poll(async () => {
        const [state] = await db.execute<{ blocked: boolean }>(sql`select cardinality(pg_blocking_pids(${deletionPid})) > 0 as blocked`);
        return deletionSettled || state.blocked;
      }, { timeout: 5_000 }).toBe(true);
      const deleteWasBlocked = !deletionSettled;
      release();
      await gate;
      const [created, deleted] = await results;
      const code = (result: PromiseSettledResult<unknown>) => result.status === "rejected"
        ? result.reason?.cause?.code ?? result.reason?.code ?? String(result.reason) : null;
      expect({ deleteWasBlocked, createError: code(created), deleteError: code(deleted) })
        .toEqual({ deleteWasBlocked: true, createError: null, deleteError: "23503" });
    } finally {
      release();
      await Promise.allSettled([gate, ...(creation ? [creation] : []), ...(deletion ? [deletion] : [])]);
      await db.execute(sql`drop trigger goal_parent_insert_gate on goals`);
      await db.execute(sql`drop function goal_parent_insert_gate()`);
    }
  });

  it("allows concurrent parent edits without conflicting with foreign-key checks", async () => {
    const spaceId = await space();
    const service = goalService(db);
    const first = await service.create(spaceId, { title: "First" });
    const second = await service.create(spaceId, { title: "Second" });
    await db.execute(sql`create function goal_parent_test_gate() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock_shared(hashtextextended(current_database() || 'goal-parent-test', 0));
        return new;
      end $$`);
    await db.execute(sql`create trigger goal_parent_test_gate before update on goals
      for each row execute function goal_parent_test_gate()`);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const gateReady = new Promise<number>((resolve) => { ready = resolve; });
    const gate = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_database() || 'goal-parent-test', 0))`);
      const [owner] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      ready(owner.pid);
      await released;
    });
    let edits: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const ownerPid = await Promise.race([gateReady, gate]);
      if (ownerPid === undefined) throw new Error("Update gate ended before it was ready");
      edits = Promise.allSettled([
        service.update(first.id, { parentId: second.id }),
        service.update(second.id, { parentId: first.id }),
      ]);
      await expect.poll(async () => {
        const [waiting] = await db.execute<{ count: number }>(sql`select count(*)::int as count
          from pg_locks where locktype = 'advisory' and not granted
          and ${ownerPid} = any(pg_blocking_pids(pid))`);
        return waiting.count;
      }, { timeout: 5_000 }).toBe(2);
      release();
      await gate;
      const failures = (await edits).flatMap((result) => result.status === "rejected"
        ? [result.reason?.cause?.code ?? result.reason?.code ?? String(result.reason)]
        : []);
      expect(failures).toEqual([]);
      expect(await service.getById(first.id)).toMatchObject({ parentId: second.id });
      expect(await service.getById(second.id)).toMatchObject({ parentId: first.id });
    } finally {
      release();
      await Promise.allSettled([gate, ...(edits ? [edits] : [])]);
      await db.execute(sql`drop trigger goal_parent_test_gate on goals`);
      await db.execute(sql`drop function goal_parent_test_gate()`);
    }
  });
});
