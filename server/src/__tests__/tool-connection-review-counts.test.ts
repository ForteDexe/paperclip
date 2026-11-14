import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createDb, spaces, toolActionRequests, toolCatalogEntries, toolConnections, toolInvocations } from "@outpost/db";
import { startRecoveryPostgres } from "./helpers/recovery-postgres.js";
import { createConnectionReviewCountsFixture } from "./helpers/tool-connection-review-counts-fixture.js";
import { createToolAppAttention } from "../services/tool-access/catalog/attention.js";
import { getToolConnectionReviewCounts } from "../services/tool-access/catalog/review-counts.js";

const zero = { pendingActionRequestCount: 0, quarantinedCatalogEntryCount: 0 };
describe("connection review counts on PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startRecoveryPostgres>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startRecoveryPostgres("connection-review-counts-"); db = createDb(database.connectionString); }, 90_000);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });
  it("preserves the complete legacy badge projection without fanout and recomputes after changes", async () => {
    const f = await createConnectionReviewCountsFixture(db);
    const legacy = createToolAppAttention(db, () => new Date());
    const compare = async (id: string) => {
      const item = (await legacy(f.space.id)).apps.find(app => app.connection.id === id);
      const expected = item ? { pendingActionRequestCount: item.pendingActionRequestCount, quarantinedCatalogEntryCount: item.quarantinedCatalogEntryCount } : zero;
      const result = await getToolConnectionReviewCounts(db, f.space.id, id);
      expect(result).toEqual(expected);
      return result;
    };
    expect(await compare(f.connection.id)).toEqual({ pendingActionRequestCount: 2, quarantinedCatalogEntryCount: 3 });
    expect(await compare(f.sibling.id)).toEqual({ pendingActionRequestCount: 1, quarantinedCatalogEntryCount: 3 });
    const [foreign] = await db.insert(spaces).values({ name: "Foreign review counts", issuePrefix: "FRC" }).returning();
    // Historical schema permits cross-space references: neither side can contribute.
    const [invocation] = await db.insert(toolInvocations).values({ spaceId: foreign.id, connectionId: f.connection.id, toolName: "foreign" }).returning();
    await db.insert(toolActionRequests).values([
      { spaceId: f.space.id, invocationId: invocation.id, signedArguments: "signed", canonicalArgumentsHash: "hash", canonicalArgumentsSummary: { summary: "Synthetic review request" } },
      { spaceId: foreign.id, invocationId: f.invocation.id, signedArguments: "signed", canonicalArgumentsHash: "hash", canonicalArgumentsSummary: { summary: "Synthetic review request" } },
    ]);
    await db.insert(toolCatalogEntries).values({ spaceId: foreign.id, connectionId: f.connection.id, name: "foreign", toolName: "foreign", versionHash: "v1", status: "quarantined" });
    expect(await compare(f.connection.id)).toEqual({ pendingActionRequestCount: 2, quarantinedCatalogEntryCount: 3 });
    await db.update(toolConnections).set({ status: "archived" }).where(eq(toolConnections.id, f.connection.id));
    expect(await compare(f.connection.id)).toEqual(zero);
    await db.update(toolConnections).set({ status: "active" }).where(eq(toolConnections.id, f.connection.id));
    expect(await compare(f.connection.id)).toEqual({ pendingActionRequestCount: 2, quarantinedCatalogEntryCount: 3 });
    await db.update(toolActionRequests).set({ status: "rejected" }).where(eq(toolActionRequests.spaceId, f.space.id));
    await db.update(toolCatalogEntries).set({ status: "active" }).where(and(eq(toolCatalogEntries.spaceId, f.space.id), eq(toolCatalogEntries.status, "quarantined")));
    expect(await compare(f.connection.id)).toEqual(zero);
    expect(await compare(f.sibling.id)).toEqual(zero); // unhealthy-only remains a zero badge
  });
});
