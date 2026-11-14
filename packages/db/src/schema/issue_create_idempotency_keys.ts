import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";

export const issueCreateIdempotencyKeys = pgTable(
  "issue_create_idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceKeyIdx: uniqueIndex("issue_create_idempotency_keys_space_key_uq").on(
      table.spaceId,
      table.idempotencyKey,
    ),
    issueIdx: index("issue_create_idempotency_keys_issue_idx").on(table.issueId),
    spaceCreatedAtIdx: index("issue_create_idempotency_keys_space_created_at_idx").on(
      table.spaceId,
      table.createdAt,
    ),
  }),
);
