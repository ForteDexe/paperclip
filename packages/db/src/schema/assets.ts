import { pgTable, uuid, text, bigint, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { agents } from "./agents.js";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    provider: text("provider").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    originalFilename: text("original_filename"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceCreatedIdx: index("assets_space_created_idx").on(table.spaceId, table.createdAt),
    spaceProviderIdx: index("assets_space_provider_idx").on(table.spaceId, table.provider),
    spaceObjectKeyUq: uniqueIndex("assets_space_object_key_uq").on(table.spaceId, table.objectKey),
  }),
);
