import { pgTable, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { assets } from "./assets.js";

export const spaceLogos = pgTable(
  "space_logos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceUq: uniqueIndex("space_logos_space_uq").on(table.spaceId),
    assetUq: uniqueIndex("space_logos_asset_uq").on(table.assetId),
  }),
);
