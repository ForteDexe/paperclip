import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AiProvider, AiAuthMethod } from "@outpost/shared";
import { spaces } from "./spaces.js";
import { connectionGrants } from "./tool_access.js";

/** A retained row with a null/revoked grant is an unavailable default, never permission to auto-select. */
export const aiConnectionDefaults = pgTable(
  "ai_connection_defaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    provider: text("provider").$type<AiProvider>().notNull(),
    method: text("method").$type<AiAuthMethod>().notNull(),
    grantId: uuid("grant_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_connection_defaults_owner_method_uq").on(
      t.spaceId,
      t.userId,
      t.provider,
      t.method,
    ),
    foreignKey({
      columns: [t.spaceId, t.grantId],
      foreignColumns: [connectionGrants.spaceId, connectionGrants.id],
      name: "ai_connection_defaults_space_grant_fk",
    }),
    check(
      "ai_connection_defaults_provider_check",
      sql`${t.provider} in ('anthropic','openai','openrouter','xai','google','github')`,
    ),
    check(
      "ai_connection_defaults_method_check",
      sql`${t.method} in ('subscription','api_key')`,
    ),
  ],
);
