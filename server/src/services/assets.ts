import { eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { assets } from "@outpost/db";

export function assetService(db: Db) {
  return {
    create: (spaceId: string, data: Omit<typeof assets.$inferInsert, "spaceId">) =>
      db
        .insert(assets)
        .values({ ...data, spaceId })
        .returning()
        .then((rows) => rows[0]),

    getById: (id: string) =>
      db
        .select()
        .from(assets)
        .where(eq(assets.id, id))
        .then((rows) => rows[0] ?? null),
  };
}

