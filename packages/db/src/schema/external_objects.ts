import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ExternalObjectLivenessState,
  ExternalObjectStatusCategory,
  ExternalObjectStatusTone,
} from "@outpost/shared";
import { spaces } from "./spaces.js";
import { plugins } from "./plugins.js";

export const externalObjects = pgTable(
  "external_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    pluginId: uuid("plugin_id").references(() => plugins.id, { onDelete: "set null" }),
    objectType: text("object_type").notNull(),
    externalId: text("external_id").notNull(),
    sanitizedCanonicalUrl: text("sanitized_canonical_url"),
    canonicalIdentityHash: text("canonical_identity_hash"),
    displayKey: text("display_key"),
    iconKey: text("icon_key"),
    displayTitle: text("display_title"),
    statusKey: text("status_key"),
    statusLabel: text("status_label"),
    statusIconKey: text("status_icon_key"),
    statusCategory: text("status_category").$type<ExternalObjectStatusCategory>().notNull().default("unknown"),
    statusTone: text("status_tone").$type<ExternalObjectStatusTone>().notNull().default("neutral"),
    liveness: text("liveness").$type<ExternalObjectLivenessState>().notNull().default("unknown"),
    isTerminal: boolean("is_terminal").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    remoteVersion: text("remote_version"),
    etag: text("etag"),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }),
    refreshStartedAt: timestamp("refresh_started_at", { withTimezone: true }),
    refreshToken: uuid("refresh_token"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceProviderObjectIdx: index("external_objects_space_provider_object_idx").on(
      table.spaceId,
      table.providerKey,
      table.objectType,
    ),
    spaceProviderStatusIdx: index("external_objects_space_provider_status_idx").on(
      table.spaceId,
      table.providerKey,
      table.statusCategory,
    ),
    spaceRefreshIdx: index("external_objects_space_refresh_idx").on(table.spaceId, table.nextRefreshAt),
    spaceExternalIdUq: uniqueIndex("external_objects_space_external_id_uq").on(
      table.spaceId,
      table.providerKey,
      table.objectType,
      table.externalId,
    ),
    spaceCanonicalIdentityUq: uniqueIndex("external_objects_space_identity_uq").on(
      table.spaceId,
      table.providerKey,
      table.objectType,
      table.canonicalIdentityHash,
    ),
  }),
);
