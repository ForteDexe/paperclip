import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { goals } from "@outpost/db";
import { updateGoalSchema, type UpdateGoal } from "@outpost/shared";
import { unprocessable } from "../errors.js";

type GoalReader = Pick<Db, "select">;

async function assertParentSpace(
  db: GoalReader,
  spaceId: string,
  parentId: string | null | undefined,
) {
  if (!parentId) return;
  const [parent] = await db.select({ id: goals.id }).from(goals)
    .where(and(eq(goals.id, parentId), eq(goals.spaceId, spaceId))).for("key share");
  if (!parent) throw unprocessable("Parent north star not found in this space");
}

export async function getDefaultSpaceGoal(db: GoalReader, spaceId: string) {
  const activeRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.spaceId, spaceId),
        eq(goals.level, "space"),
        eq(goals.status, "active"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (activeRootGoal) return activeRootGoal;

  const anyRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.spaceId, spaceId),
        eq(goals.level, "space"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (anyRootGoal) return anyRootGoal;

  return db
    .select()
    .from(goals)
    .where(and(eq(goals.spaceId, spaceId), eq(goals.level, "space")))
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
}

export function goalService(db: Db) {
  return {
    list: (spaceId: string) => db.select().from(goals).where(eq(goals.spaceId, spaceId)),

    getById: (id: string) =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null),

    getDefaultSpaceGoal: (spaceId: string) => getDefaultSpaceGoal(db, spaceId),

    create: (spaceId: string, data: Omit<typeof goals.$inferInsert, "spaceId">) =>
      db.transaction(async (tx) => {
        await assertParentSpace(tx, spaceId, data.parentId);
        return tx
          .insert(goals)
          .values({ ...data, spaceId })
          .returning()
          .then((rows) => rows[0]);
      }),

    update: (id: string, data: UpdateGoal) =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select({ spaceId: goals.spaceId }).from(goals)
          .where(eq(goals.id, id)).for("no key update");
        if (!existing) return null;
        const parsed = updateGoalSchema.safeParse(data);
        if (!parsed.success) {
          throw unprocessable("Invalid north star update", parsed.error.issues);
        }
        const requestedSpaceId = (data as Record<string, unknown>).spaceId;
        if (requestedSpaceId !== undefined && requestedSpaceId !== existing.spaceId) {
          throw unprocessable("North Star space cannot be changed");
        }
        const patch = parsed.data;
        await assertParentSpace(tx, existing.spaceId, patch.parentId);
        return tx
          .update(goals)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(goals.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
      }),

    remove: (id: string) =>
      db
        .delete(goals)
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
