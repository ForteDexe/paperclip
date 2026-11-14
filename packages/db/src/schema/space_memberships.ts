import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";

export const spaceMemberships = pgTable(
  "space_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    status: text("status").notNull().default("active"),
    membershipRole: text("membership_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spacePrincipalUniqueIdx: uniqueIndex("space_memberships_space_principal_unique_idx").on(
      table.spaceId,
      table.principalType,
      table.principalId,
    ),
    principalStatusIdx: index("space_memberships_principal_status_idx").on(
      table.principalType,
      table.principalId,
      table.status,
    ),
    spaceStatusIdx: index("space_memberships_space_status_idx").on(table.spaceId, table.status),
  }),
);
