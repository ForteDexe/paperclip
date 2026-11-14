import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";

export const inboxDismissals = pgTable(
  "inbox_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    userId: text("user_id").notNull(),
    itemKey: text("item_key").notNull(),
    kind: text("kind").$type<"dismiss" | "snooze">().notNull().default("dismiss"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceUserIdx: index("inbox_dismissals_space_user_idx").on(table.spaceId, table.userId),
    spaceItemIdx: index("inbox_dismissals_space_item_idx").on(table.spaceId, table.itemKey),
    spaceUserItemUnique: uniqueIndex("inbox_dismissals_space_user_item_idx").on(
      table.spaceId,
      table.userId,
      table.itemKey,
    ),
  }),
);
