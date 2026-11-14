import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { inboxDismissals } from "@outpost/db";
import type { InboxDismissalKind } from "@outpost/shared";

export function inboxDismissalService(db: Db) {
  async function upsert(
    spaceId: string,
    userId: string,
    itemKey: string,
    input: { kind: InboxDismissalKind; dismissedAt?: Date; snoozedUntil?: Date | null },
  ) {
    const now = new Date();
    const dismissedAt = input.dismissedAt ?? now;
    const snoozedUntil = input.kind === "snooze" ? input.snoozedUntil ?? null : null;
    const [row] = await db
      .insert(inboxDismissals)
      .values({
        spaceId,
        userId,
        itemKey,
        kind: input.kind,
        dismissedAt,
        snoozedUntil,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [inboxDismissals.spaceId, inboxDismissals.userId, inboxDismissals.itemKey],
        set: {
          kind: input.kind,
          dismissedAt,
          snoozedUntil,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  return {
    list: async (spaceId: string, userId: string) =>
      db
        .select()
        .from(inboxDismissals)
        .where(and(eq(inboxDismissals.spaceId, spaceId), eq(inboxDismissals.userId, userId)))
        .orderBy(desc(inboxDismissals.updatedAt)),

    dismiss: async (
      spaceId: string,
      userId: string,
      itemKey: string,
      dismissedAt: Date = new Date(),
    ) => upsert(spaceId, userId, itemKey, { kind: "dismiss", dismissedAt }),

    snooze: async (
      spaceId: string,
      userId: string,
      itemKey: string,
      snoozedUntil: Date,
      dismissedAt: Date = new Date(),
    ) => upsert(spaceId, userId, itemKey, { kind: "snooze", dismissedAt, snoozedUntil }),

    restore: async (spaceId: string, userId: string, itemKey: string) => {
      const [row] = await db
        .delete(inboxDismissals)
        .where(and(
          eq(inboxDismissals.spaceId, spaceId),
          eq(inboxDismissals.userId, userId),
          eq(inboxDismissals.itemKey, itemKey),
        ))
        .returning();
      return row ?? null;
    },
  };
}
