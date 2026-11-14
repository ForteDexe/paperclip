import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { documents } from "./documents.js";
import { routines } from "./routines.js";

export const routineDocuments = pgTable(
  "routine_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    routineId: uuid("routine_id").notNull().references(() => routines.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceRoutineKeyUq: uniqueIndex("routine_documents_space_routine_key_uq").on(
      table.spaceId,
      table.routineId,
      table.key,
    ),
    documentUq: uniqueIndex("routine_documents_document_uq").on(table.documentId),
    spaceRoutineUpdatedIdx: index("routine_documents_space_routine_updated_idx").on(
      table.spaceId,
      table.routineId,
      table.updatedAt,
    ),
  }),
);
