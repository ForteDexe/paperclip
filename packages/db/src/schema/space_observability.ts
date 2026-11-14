import { boolean, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AgentObservabilityCapture, AgentObservabilityDestination, AgentObservabilityTestReceipt } from "@outpost/shared";
import { spaces } from "./spaces.js";
import { spaceSecrets } from "./space_secrets.js";

export const spaceObservability = pgTable("space_observability", {
  spaceId: uuid("space_id").primaryKey().references(() => spaces.id, { onDelete: "cascade" }),
  revision: uuid("revision").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  destination: jsonb("destination").$type<AgentObservabilityDestination>().notNull(),
  capture: jsonb("capture").$type<AgentObservabilityCapture>().notNull(),
  credentialsSecretId: uuid("credentials_secret_id").references(() => spaceSecrets.id, { onDelete: "set null" }),
  headerNames: jsonb("header_names").$type<string[]>().notNull().default([]),
  lastTest: jsonb("last_test").$type<AgentObservabilityTestReceipt>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
