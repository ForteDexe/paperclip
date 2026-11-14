import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ExternalObjectMentionConfidence, ExternalObjectMentionSourceKind } from "@outpost/shared";
import { spaces } from "./spaces.js";
import { externalObjects } from "./external_objects.js";
import { issues } from "./issues.js";
import { plugins } from "./plugins.js";

export const externalObjectMentions = pgTable(
  "external_object_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    sourceIssueId: uuid("source_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").$type<ExternalObjectMentionSourceKind>().notNull(),
    sourceRecordId: uuid("source_record_id"),
    documentKey: text("document_key"),
    propertyKey: text("property_key"),
    matchedTextRedacted: text("matched_text_redacted"),
    sanitizedDisplayUrl: text("sanitized_display_url"),
    canonicalIdentityHash: text("canonical_identity_hash"),
    canonicalIdentity: jsonb("canonical_identity").$type<Record<string, unknown>>(),
    objectId: uuid("object_id").references(() => externalObjects.id, { onDelete: "set null" }),
    providerKey: text("provider_key"),
    detectorKey: text("detector_key"),
    objectType: text("object_type"),
    confidence: text("confidence").$type<ExternalObjectMentionConfidence>().notNull().default("exact"),
    createdByPluginId: uuid("created_by_plugin_id").references(() => plugins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceSourceIssueIdx: index("external_object_mentions_space_source_issue_idx").on(
      table.spaceId,
      table.sourceIssueId,
    ),
    spaceObjectIdx: index("external_object_mentions_space_object_idx").on(table.spaceId, table.objectId),
    spaceProviderIdx: index("external_object_mentions_space_provider_idx").on(
      table.spaceId,
      table.providerKey,
      table.objectType,
    ),
    spaceSourceMentionWithRecordUq: uniqueIndex("external_object_mentions_space_source_record_uq").on(
      table.spaceId,
      table.sourceIssueId,
      table.sourceKind,
      table.sourceRecordId,
      table.documentKey,
      table.propertyKey,
      table.canonicalIdentityHash,
    ).where(sql`${table.sourceRecordId} is not null and ${table.canonicalIdentityHash} is not null`),
    spaceSourceMentionWithoutRecordUq: uniqueIndex("external_object_mentions_space_source_null_record_uq").on(
      table.spaceId,
      table.sourceIssueId,
      table.sourceKind,
      table.documentKey,
      table.propertyKey,
      table.canonicalIdentityHash,
    ).where(sql`${table.sourceRecordId} is null and ${table.canonicalIdentityHash} is not null`),
  }),
);
