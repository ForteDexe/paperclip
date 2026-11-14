import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { documents } from "./documents.js";

export const documentMemberships = pgTable(
  "document_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    starredAt: timestamp("starred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceUserStarredIdx: index("document_memberships_space_user_starred_idx").on(
      table.spaceId,
      table.userId,
      table.starredAt,
    ),
    spaceUserDocumentUq: uniqueIndex("document_memberships_space_user_document_uq").on(
      table.spaceId,
      table.userId,
      table.documentId,
    ),
  }),
);
