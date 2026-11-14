import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  spaces,
  spaceMemberships,
  createDb,
  documents,
  issueComments,
  issueDocuments,
  issues,
} from "@outpost/db";
import {
  SPACE_SEARCH_EXTRACT_DEFAULT_MATCHES_PER_ISSUE,
  SPACE_SEARCH_EXTRACT_MAX_MATCHES_PER_ISSUE,
  spaceSearchExtractQuerySchema,
} from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { spaceSearchExtractService } from "../services/space-search-extract.js";
import { issueReadSqlCondition, type AuthorizationActor } from "../services/authorization.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres extract-search tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("extract-search query validation", () => {
  it("accepts supported extraction filters and rejects unsafe or ambiguous input", () => {
    const parsed = spaceSearchExtractQuerySchema.parse({
      contains: "github.com/paperclipai/paperclip/pull",
      kind: "url",
      scope: "comments",
      status: "in_progress,in_review",
      limit: "200",
      offset: "5000",
      matchesPerIssue: "200",
      updatedWithin: "30d",
    });

    expect(parsed.kind).toBe("url");
    expect(parsed.scope).toBe("comments");
    expect(parsed.status).toEqual(["in_progress", "in_review"]);
    expect(parsed.matchesPerIssue).toBe(SPACE_SEARCH_EXTRACT_MAX_MATCHES_PER_ISSUE);
    expect(() => spaceSearchExtractQuerySchema.parse({ contains: ".*", kind: "regex" })).toThrow();
    expect(() => spaceSearchExtractQuerySchema.parse({ contains: "x" })).toThrow();
    expect(() => spaceSearchExtractQuerySchema.parse({ contains: "needle", limit: "201" })).toThrow();
    expect(() => spaceSearchExtractQuerySchema.parse({ contains: "needle", matchesPerIssue: "201" })).toThrow();
    expect(() => spaceSearchExtractQuerySchema.parse({
      contains: "needle",
      updatedWithin: "30d",
      updatedAfter: "2026-01-01T00:00:00.000Z",
    })).toThrow();
  });
});

describeEmbeddedPostgres("spaceSearchExtractService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof spaceSearchExtractService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-space-search-extract-");
    db = createDb(tempDb.connectionString);
    svc = spaceSearchExtractService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(spaceMemberships);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createSpace(name = "Outpost") {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name,
      issuePrefix: `E${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    return spaceId;
  }

  async function createIssue(spaceId: string, values: Partial<typeof issues.$inferInsert> = {}) {
    const id = values.id ?? randomUUID();
    await db.insert(issues).values({
      id,
      spaceId,
      identifier: values.identifier ?? "EXT-1",
      title: values.title ?? "Extract target",
      description: values.description ?? null,
      status: values.status ?? "in_progress",
      priority: values.priority ?? "medium",
      ...values,
    });
    return id;
  }

  it("expands and deduplicates URLs across issue, comment, and document sources", async () => {
    const spaceId = await createSpace();
    const firstUrl = "https://github.com/paperclipai/paperclip/pull/123";
    const secondUrl = "https://github.com/paperclipai/paperclip/pull/456";
    const thirdUrl = "https://github.com/paperclipai/paperclip/pull/789";
    const issueId = await createIssue(spaceId, {
      description: `Primary ${firstUrl} and duplicate ${firstUrl}.`,
    });
    await db.insert(issueComments).values({
      spaceId,
      issueId,
      body: `Review ${secondUrl} and repeat ${firstUrl}`,
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      spaceId,
      title: `PR notes ${thirdUrl}`,
      latestBody: `Also see [the second PR](${secondUrl}).`,
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId,
      documentId,
      key: "plan",
    });

    const result = await svc.extract(spaceId, spaceSearchExtractQuerySchema.parse({
      contains: "github.com/paperclipai/paperclip/pull",
      kind: "url",
    }));

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.matches.map((match) => match.value)).toEqual([firstUrl, secondUrl, thirdUrl]);
    expect(result.results[0]?.matches.map((match) => match.field)).toEqual([
      "description",
      "comment",
      "document_title",
    ]);
    expect(result.results[0]?.matchesTruncated).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("keeps URL sources selected by scheme-less queries", async () => {
    const spaceId = await createSpace();
    const titleUrl = "https://github.com/paperclipai/paperclip/pull/101";
    const descriptionUrl = "https://github.com/paperclipai/paperclip/pull/102";
    const documentTitleUrl = "https://github.com/paperclipai/paperclip/pull/103";
    const documentBodyUrl = "https://github.com/paperclipai/paperclip/pull/104";
    const issueId = await createIssue(spaceId, {
      title: `Review ${titleUrl}`,
      description: `Then merge ${descriptionUrl}`,
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      spaceId,
      title: `Tracking ${documentTitleUrl}`,
      latestBody: `Final follow-up ${documentBodyUrl}`,
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId,
      documentId,
      key: "plan",
    });

    const result = await svc.extract(spaceId, spaceSearchExtractQuerySchema.parse({
      contains: "github.com/paperclipai/paperclip/pull",
      kind: "url",
      scope: "all",
    }));

    expect(result.results[0]?.matches.map((match) => [match.field, match.value])).toEqual([
      ["title", titleUrl],
      ["description", descriptionUrl],
      ["document_title", documentTitleUrl],
      ["document_body", documentBodyUrl],
    ]);
  });

  it("filters by issue update window and status", async () => {
    const spaceId = await createSpace();
    const now = Date.now();
    const recentId = await createIssue(spaceId, {
      identifier: "EXT-RECENT",
      description: "needle",
      status: "in_review",
      updatedAt: new Date(now - 24 * 60 * 60 * 1000),
    });
    await createIssue(spaceId, {
      identifier: "EXT-OLD",
      description: "needle",
      status: "in_review",
      updatedAt: new Date(now - 60 * 24 * 60 * 60 * 1000),
    });
    await createIssue(spaceId, {
      identifier: "EXT-DONE",
      description: "needle",
      status: "done",
      updatedAt: new Date(now - 24 * 60 * 60 * 1000),
    });

    const result = await svc.extract(spaceId, spaceSearchExtractQuerySchema.parse({
      contains: "needle",
      updatedWithin: "30d",
      status: "in_review",
    }));

    expect(result.results.map((row) => row.issueId)).toEqual([recentId]);
  });

  it("uses the default distinct-match cap and marks truncation explicitly", async () => {
    const spaceId = await createSpace();
    const urls = Array.from(
      { length: SPACE_SEARCH_EXTRACT_DEFAULT_MATCHES_PER_ISSUE + 1 },
      (_, index) => `https://github.com/paperclipai/paperclip/pull/${index + 1}`,
    );
    await createIssue(spaceId, { description: urls.join(" ") });

    const result = await svc.extract(spaceId, spaceSearchExtractQuerySchema.parse({
      contains: "github.com/paperclipai/paperclip/pull",
      kind: "url",
    }));

    expect(result.matchesPerIssue).toBe(SPACE_SEARCH_EXTRACT_DEFAULT_MATCHES_PER_ISSUE);
    expect(result.results[0]?.matches).toHaveLength(SPACE_SEARCH_EXTRACT_DEFAULT_MATCHES_PER_ISSUE);
    expect(result.results[0]?.matchesTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("supports a bounded per-issue match cap for complete machine extraction", async () => {
    const spaceId = await createSpace();
    const urls = Array.from(
      { length: SPACE_SEARCH_EXTRACT_DEFAULT_MATCHES_PER_ISSUE + 1 },
      (_, index) => `https://github.com/paperclipai/paperclip/pull/${index + 1}`,
    );
    await createIssue(spaceId, { description: urls.join(" ") });

    const result = await svc.extract(spaceId, spaceSearchExtractQuerySchema.parse({
      contains: "github.com/paperclipai/paperclip/pull",
      kind: "url",
      matchesPerIssue: SPACE_SEARCH_EXTRACT_MAX_MATCHES_PER_ISSUE,
    }));

    expect(result.matchesPerIssue).toBe(SPACE_SEARCH_EXTRACT_MAX_MATCHES_PER_ISSUE);
    expect(result.results[0]?.matches).toHaveLength(urls.length);
    expect(result.results[0]?.matchesTruncated).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("does not return matching issues from another space", async () => {
    const spaceId = await createSpace();
    const otherSpaceId = await createSpace("Other");
    await createIssue(otherSpaceId, { description: "needle" });

    const result = await svc.extract(spaceId, spaceSearchExtractQuerySchema.parse({ contains: "needle" }));

    expect(result.results).toEqual([]);
  });

  it("does not extract content from a private issue for a non-member", async () => {
    const spaceId = await createSpace();
    const viewerId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "user",
      principalId: viewerId,
      membershipRole: "operator",
      status: "active",
});
    const visibleIssueId = await createIssue(spaceId, {
      identifier: "EXT-PUBLIC",
      description: "privacy-leak-needle",
    });
    const privateIssueId = randomUUID();
    await createIssue(spaceId, {
      id: privateIssueId,
      identifier: "EXT-PRIVATE",
      description: "privacy-leak-needle private payload",
      visibility: "private",
      privacyRootIssueId: privateIssueId,
      responsibleUserId: randomUUID(),
    });
    const actor: AuthorizationActor = {
      type: "operator",
      userId: viewerId,
      source: "session",
    };

    const result = await svc.extract(
      spaceId,
      spaceSearchExtractQuerySchema.parse({ contains: "privacy-leak-needle" }),
      { issueReadCondition: await issueReadSqlCondition(db, actor) },
    );

    expect(result.results.map((row) => row.issueId)).toEqual([visibleIssueId]);
    expect(JSON.stringify(result)).not.toContain(privateIssueId);
    expect(JSON.stringify(result)).not.toContain("private payload");
  });
});
