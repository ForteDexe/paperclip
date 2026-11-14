import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { externalObjectMentions } from "./schema/external_object_mentions.js";
import { externalObjects } from "./schema/external_objects.js";

function indexColumns(table: Parameters<typeof getTableConfig>[0], indexName: string): string[] {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === indexName);
  if (!index) return [];
  return index.config.columns.map((column) => (column as { name: string }).name);
}

describe("external object reference schema", () => {
  it("scopes external object uniqueness by space", () => {
    expect(indexColumns(externalObjects, "external_objects_space_external_id_uq")).toEqual([
      "space_id",
      "provider_key",
      "object_type",
      "external_id",
    ]);
    expect(indexColumns(externalObjects, "external_objects_space_identity_uq")).toEqual([
      "space_id",
      "provider_key",
      "object_type",
      "canonical_identity_hash",
    ]);
  });

  it("indexes status, refresh scheduling, source issue, and object lookups by space", () => {
    expect(indexColumns(externalObjects, "external_objects_space_provider_status_idx")).toEqual([
      "space_id",
      "provider_key",
      "status_category",
    ]);
    expect(indexColumns(externalObjects, "external_objects_space_refresh_idx")).toEqual([
      "space_id",
      "next_refresh_at",
    ]);
    expect(indexColumns(externalObjectMentions, "external_object_mentions_space_source_issue_idx")).toEqual([
      "space_id",
      "source_issue_id",
    ]);
    expect(indexColumns(externalObjectMentions, "external_object_mentions_space_object_idx")).toEqual([
      "space_id",
      "object_id",
    ]);
  });
});
