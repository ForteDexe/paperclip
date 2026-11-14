import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";
import { issueThreadInteractions } from "./issue_thread_interactions.js";

/** Additional acknowledged retry keys for a reused canonical interaction. */
export const issueThreadInteractionIdempotencyKeys = pgTable("issue_thread_interaction_idempotency_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  interactionId: uuid("interaction_id").notNull().references(() => issueThreadInteractions.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  keyUq: uniqueIndex("issue_thread_interaction_idempotency_keys_scope_key_uq").on(table.spaceId, table.issueId, table.idempotencyKey),
  interactionIdx: index("issue_thread_interaction_idempotency_keys_interaction_idx").on(table.interactionId),
}));
