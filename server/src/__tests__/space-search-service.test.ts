import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  spaces,
  createDb,
  documents,
  issueComments,
  issueDocuments,
  issueAccessGrants,
  issueRelations,
  issueLabels,
  issueWorkProducts,
  issues,
  labels,
  projectAccessMembers,
  projects,
} from "@outpost/db";
import { spaceSearchQuerySchema, SPACE_SEARCH_MAX_QUERY_LENGTH } from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  SPACE_SEARCH_BRANCH_FETCH_LIMIT,
  spaceSearchBranchFetchLimit,
  spaceSearchService,
} from "../services/space-search.js";
import { issueReadSqlCondition, projectReadSqlCondition } from "../services/authorization.js";
import { issueService } from "../services/issues.js";

const externalDatabaseUrl = resolveExternalTestDatabaseUrl("OUTPOST_SPACE_SEARCH_TEST_DATABASE_URL");
const embeddedPostgresSupport = externalDatabaseUrl ? { supported: true } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres space search tests on this host: ${("reason" in embeddedPostgresSupport ? embeddedPostgresSupport.reason : "unsupported environment")}`,
  );
}

describe("space search query validation", () => {
  it("truncates long text queries but rejects invalid filters, sort, and pagination", () => {
    const parsed = spaceSearchQuerySchema.parse({
      q: "x".repeat(SPACE_SEARCH_MAX_QUERY_LENGTH + 50),
      limit: "50",
      offset: "200",
      scope: "all",
      status: "todo,blocked",
      priority: ["critical", "low"],
      sort: "priority",
      updatedWithin: "7d",
    });

    expect(parsed.q).toHaveLength(SPACE_SEARCH_MAX_QUERY_LENGTH);
    expect(parsed.status).toEqual(["todo", "blocked"]);
    expect(parsed.priority).toEqual(["critical", "low"]);
    expect(parsed.sort).toBe("priority");
    expect(parsed.updatedWithin).toBe("7d");
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", limit: "500" })).toThrow();
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", offset: "9000" })).toThrow();
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", scope: "not-a-scope" })).toThrow();
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", status: "not-a-status" })).toThrow();
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", priority: "urgent" })).toThrow();
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", sort: "oldest" })).toThrow();
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", updatedWithin: "forever" })).toThrow();
    expect(() => spaceSearchQuerySchema.parse({ q: "needle", projectId: "not-a-uuid" })).toThrow();
  });

  it("includes offset in the internal per-branch fetch window", () => {
    const lowOffset = spaceSearchQuerySchema.parse({ q: "needle", limit: "50", offset: "0" });
    const highOffset = spaceSearchQuerySchema.parse({ q: "needle", limit: "50", offset: "200" });

    expect(spaceSearchBranchFetchLimit(lowOffset.limit, lowOffset.offset)).toBe(51);
    expect(spaceSearchBranchFetchLimit(highOffset.limit, highOffset.offset)).toBe(SPACE_SEARCH_BRANCH_FETCH_LIMIT);
  });
});

describeEmbeddedPostgres("spaceSearchService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof spaceSearchService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (!externalDatabaseUrl) tempDb = await startEmbeddedPostgresTestDatabase("outpost-space-search-");
    db = createDb(externalDatabaseUrl ?? tempDb!.connectionString, { maxConnections: 6 });
    // External suites can reuse this dedicated database sequentially. Match
    // the fresh embedded fixture before this suite creates its own rows.
    if (externalDatabaseUrl) await db.execute(sql`TRUNCATE TABLE spaces CASCADE`);
    svc = spaceSearchService(db);
    await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"));
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(issueLabels);
    await db.delete(issueAccessGrants);
    await db.delete(issues);
    await db.delete(labels);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  async function createSpace(name = "Outpost") {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name,
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    return spaceId;
  }

  async function createIssue(spaceId: string, values: Partial<typeof issues.$inferInsert> = {}) {
    const id = values.id ?? randomUUID();
    await db.insert(issues).values({
      id,
      spaceId,
      title: values.title ?? "Search target",
      description: values.description ?? null,
      status: values.status ?? "todo",
      priority: values.priority ?? "medium",
      identifier: values.identifier ?? null,
      hiddenAt: values.hiddenAt ?? null,
      ...values,
    });
    return id;
  }

  async function createAgent(spaceId: string, values: Partial<typeof agents.$inferInsert> = {}) {
    const id = values.id ?? randomUUID();
    await db.insert(agents).values({
      id,
      spaceId,
      name: values.name ?? "Search agent",
      role: values.role ?? "engineer",
      title: values.title ?? null,
      capabilities: values.capabilities ?? null,
      ...values,
    });
    return id;
  }

  async function createProject(spaceId: string, values: Partial<typeof projects.$inferInsert> = {}) {
    const id = values.id ?? randomUUID();
    await db.insert(projects).values({
      id,
      spaceId,
      name: values.name ?? "Search project",
      description: values.description ?? null,
      ...values,
    });
    return id;
  }

  async function createLabel(spaceId: string, values: Partial<typeof labels.$inferInsert> = {}) {
    const id = values.id ?? randomUUID();
    await db.insert(labels).values({
      id,
      spaceId,
      name: values.name ?? "Search label",
      color: values.color ?? "blue",
      ...values,
    });
    return id;
  }

  it("returns glyph-only blocker state for blocked results without blocker details (BUG-07)", async () => {
    const spaceId = await createSpace();
    const parent = await createIssue(spaceId, { title: "Launch parent", status: "blocked" });
    const blocker = await createIssue(spaceId, { title: "Hidden blocker detail", status: "todo", identifier: "SRCH-2" });
    const open = await createIssue(spaceId, { title: "Launch open", status: "todo" });
    await db.insert(issueRelations).values({ spaceId, issueId: blocker, relatedIssueId: parent, type: "blocks" });
    try {
      const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "launch", scope: "issues" }));
      const blocked = result.results.find((row) => row.id === parent)?.issue;
      expect(blocked?.blockerAttention).toMatchObject({ state: "needs_attention", unresolvedBlockerCount: 1 });
      expect(Object.keys(blocked!.blockerAttention!).sort()).toEqual([
        "attentionBlockerCount", "coveredBlockerCount", "reason", "sampleBlockerIdentifier",
        "sampleStalledBlockerIdentifier", "stalledBlockerCount", "state", "unresolvedBlockerCount",
      ]);
      expect(blocked?.blockerAttention?.sampleBlockerIdentifier).toBeNull();
      expect(JSON.stringify(result)).not.toContain("Hidden blocker detail");
      expect(JSON.stringify(result)).not.toContain(blocker);
      expect(result.results.find((row) => row.id === open)?.issue).not.toHaveProperty("blockerAttention");
    } finally {
      await db.delete(issueRelations);
    }
  });

  it("paginates issue-result-only searches before unrelated entity competition", async () => {
    const spaceId = await createSpace();
    const now = Date.now();
    const older = await createIssue(spaceId, { title: "Launch older", updatedAt: new Date(now - 2_000) });
    await createIssue(spaceId, { title: "Launch newer", updatedAt: new Date(now - 1_000) });
    await createAgent(spaceId, { name: "Launch agent", updatedAt: new Date(now) });
    await createProject(spaceId, { name: "Launch project", updatedAt: new Date(now + 1_000) });
    const holder = await createIssue(spaceId, { title: "Artifact holder" });
    await db.insert(issueWorkProducts).values({ spaceId, issueId: holder, type: "artifact", provider: "outpost",
      title: "Launch artifact", status: "ready", updatedAt: new Date(now + 2_000) });
    const query = spaceSearchQuerySchema.parse({ q: "launch", scope: "all", sort: "updated", limit: 1, offset: 1 });
    const mixed = await svc.search(spaceId, { ...query, limit: 10, offset: 0 });
    expect(new Set(mixed.results.map(row => row.type))).toEqual(new Set(["issue", "agent", "project", "artifact"]));
    const result = await svc.search(spaceId, query, { issueResultsOnly: true });
    expect(result.results.map(row => row.id)).toEqual([older]);
    expect(result.countsByType).toMatchObject({ issue: 2, agent: 0, project: 0, artifact: 0 });
    expect(result.filterOptionCounts.status.todo).toBe(2);
    expect(result.hasMore).toBe(false);
    for (const scope of ["agents", "projects", "artifacts"] as const) {
      let membership: Date | null | undefined;
      const excluded = await svc.search(spaceId, { ...query, scope }, {
        issueResultsOnly: true, onNextMembershipChange: at => { membership = at; },
      });
      expect(excluded.results).toEqual([]);
      expect(Object.values(excluded.countsByType).every(count => count === 0)).toBe(true);
      expect(excluded.filterOptionCounts.status).toEqual({});
      expect(excluded.hasMore).toBe(false);
      expect(membership).toBeNull();
    }
    let deadline: Date | null = null;
    await svc.search(spaceId, { ...query, updatedWithin: "1h" }, {
      issueResultsOnly: true, onNextMembershipChange: at => { deadline = at; },
    });
    expect(deadline).toEqual(new Date(now - 2_000 + 3_600_001));
  });

  it.each(["all", "comments", "documents"] as const)("preserves issue-result-only %s text matching and read boundaries", async scope => {
    const previous = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
    try {
      const spaceId = await createSpace();
      const comment = await createIssue(spaceId, { title: "Comment context" });
      const document = await createIssue(spaceId, { title: "Document context" });
      const privateId = randomUUID();
      await createIssue(spaceId, { id: privateId, title: "Private context", visibility: "private",
        privacyRootIssueId: privateId, responsibleUserId: "private-owner" });
      const foreign = await createIssue(await createSpace(), { title: "Foreign context" });
      const hidden = await createIssue(spaceId, { title: "Hidden context", hiddenAt: new Date() });
      for (const issueId of [comment, privateId, hidden]) await db.insert(issueComments).values({ spaceId, issueId, body: "Needle context" });
      const foreignSpace = await db.select({ spaceId: issues.spaceId }).from(issues).where(sql`${issues.id} = ${foreign}`);
      await db.insert(issueComments).values({ spaceId: foreignSpace[0]!.spaceId, issueId: foreign, body: "Needle context" });
      for (const issueId of [document, privateId, hidden]) {
        const id = randomUUID();
        await db.insert(documents).values({ id, spaceId, title: "Context", latestBody: "Needle context", format: "markdown" });
        await db.insert(issueDocuments).values({ spaceId, issueId, documentId: id, key: "brief" });
      }
      const condition = await issueReadSqlCondition(db, { type: "operator", userId: "reader", source: "session" });
      const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "needle", scope }), {
        issueResultsOnly: true, issueReadCondition: condition,
      });
      expect(new Set(result.results.map(row => row.id))).toEqual(new Set(scope === "all" ? [comment, document] : [scope === "comments" ? comment : document]));
      expect(result.results.every(row => row.type === "issue")).toBe(true);
      expect(result.countsByType).toMatchObject({ agent: 0, project: 0, artifact: 0 });
    } finally {
      if (previous === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previous;
    }
  });

  it("keeps issue-result-only loosen counts inside the selected result kinds", async () => {
    const spaceId = await createSpace();
    await createIssue(spaceId, { title: "Launch done", status: "done" });
    await createAgent(spaceId, { name: "Launch agent" });
    await createProject(spaceId, { name: "Launch project" });
    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "launch", status: "todo" }), { issueResultsOnly: true });
    expect(result.results).toEqual([]);
    expect(result.zeroResults).toMatchObject({ unfilteredTotal: 1,
      loosenSuggestions: [{ filter: "status", resultCount: 1, additionalCount: 1 }] });
    expect(result.filterOptionCounts.status.done).toBe(1);
  });

  it("keeps exact entity names ahead of speculative task typos and rejects empty quotes", async () => {
    const spaceId = await createSpace();
    const agentId = await createAgent(spaceId, { name: "Mibile" });
    const projectId = await createProject(spaceId, { name: "Mibile" });
    const taskId = await createIssue(spaceId, { title: "Mobile navigation" });
    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "mibile" }));
    const ids = result.results.map((row) => row.id);
    expect(ids).toContain(taskId);
    expect(ids.indexOf(agentId)).toBeLessThan(ids.indexOf(taskId));
    expect(ids.indexOf(projectId)).toBeLessThan(ids.indexOf(taskId));
    expect((await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: '""' }))).results).toEqual([]);
  });

  it("ranks exact issue identifiers before weaker title matches", async () => {
    const spaceId = await createSpace();
    const exactId = await createIssue(spaceId, {
      identifier: "TST-42",
      title: "Backend endpoint",
    });
    await createIssue(spaceId, {
      identifier: "TST-43",
      title: "TST-42 mentioned in title only",
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "TST-42" }));

    expect(result.results[0]?.id).toBe(exactId);
    expect(result.results[0]?.matchedFields).toContain("identifier");
  });

  it("ranks phrase before reordered title words and rejects partial matches", async () => {
    const spaceId = await createSpace();
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const partialTokenId = await createIssue(spaceId, {
      identifier: "TST-50",
      title: "Alpha-only deployment",
      updatedAt: new Date(base + 3_000),
    });
    const allTokenId = await createIssue(spaceId, {
      identifier: "TST-51",
      title: "Alpha rollout beta",
      updatedAt: new Date(base + 2_000),
    });
    const phraseId = await createIssue(spaceId, {
      identifier: "TST-52",
      title: "Alpha beta deployment",
      updatedAt: new Date(base + 1_000),
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "alpha beta", scope: "issues" }));

    expect(result.results.map((row) => row.id)).toEqual([phraseId, allTokenId]);
    expect(result.results.map((row) => row.id)).not.toContain(partialTokenId);
  });

  it("matches multiple tokens across the same issue thread and returns comment snippets", async () => {
    const spaceId = await createSpace();
    const issueId = await createIssue(spaceId, {
      identifier: "TST-7",
      title: "Checkout semantics",
      description: "Atomic ownership is enforced here.",
    });
    const commentId = randomUUID();
    await db.insert(issueComments).values({
      id: commentId,
      spaceId,
      issueId,
      body: "The ranking snippet should explain why this thread matched.",
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "checkout snippet" }));
    const match = result.results.find((item) => item.id === issueId);

    expect(match).toBeTruthy();
    expect(match?.matchedFields).toEqual(expect.arrayContaining(["title", "comment"]));
    expect(match?.href).toContain(`#comment-${commentId}`);
    expect(match?.snippets.some((snippet) => snippet.field === "comment" && /snippet/i.test(snippet.text))).toBe(true);
    expect(match?.snippets.find((snippet) => snippet.field === "comment")?.highlights.length).toBeGreaterThan(0);
    expect(result.countsByType.comment).toBe(1);
  });

  it("searches issue documents and returns document metadata for snippets", async () => {
    const spaceId = await createSpace();
    const issueId = await createIssue(spaceId, {
      identifier: "TST-8",
      title: "Adapter manager",
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      spaceId,
      title: "Hermes Parser Plan",
      latestBody: "The external adapter parser should be discovered from the plugin package.",
      format: "markdown",
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId,
      documentId,
      key: "plan",
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "Hermes parser", scope: "documents" }));

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe(issueId);
    expect(result.results[0]?.matchedFields).toContain("document");
    expect(result.results[0]?.href).toContain("#document-plan");
    expect(result.results[0]?.snippet).toMatch(/parser/i);
    expect(result.results[0]?.snippets[0]).toMatchObject({ field: "document", label: "Hermes Parser Plan" });
    expect(result.results[0]?.snippets[0]?.highlights.length).toBeGreaterThan(0);
    expect(result.countsByType.document).toBe(1);
  });

  it("keeps private task artifacts out of an unrelated member's search", async () => {
    const previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
    try {
      const spaceId = await createSpace();
      const agentId = await createAgent(spaceId, { name: "Private Writer" });
      const ownerId = `owner-${randomUUID()}`, outsiderId = `outsider-${randomUUID()}`;
      const privateId = randomUUID();
      await createIssue(spaceId, { id: privateId, title: "Confidential work", visibility: "private",
        privacyRootIssueId: privateId, responsibleUserId: ownerId });
      const documentId = randomUUID();
      await db.insert(documents).values({ id: documentId, spaceId, title: "Confidential draft",
        latestBody: "Launch code nightjar-secret for internal review.", format: "markdown", createdByAgentId: agentId });
      await db.insert(issueDocuments).values({ spaceId, issueId: privateId, documentId, key: "announcement" });
      const conditionFor = async (userId: string) => ({
        issueReadCondition: await issueReadSqlCondition(db, { type: "operator", userId, source: "session" }),
      });
      const query = spaceSearchQuerySchema.parse({ q: "nightjar-secret" });

      const outsider = await svc.search(spaceId, query, await conditionFor(outsiderId));
      expect(outsider.results.filter(row => row.type === "artifact")).toEqual([]);
      expect(outsider.countsByType.artifact).toBe(0);
      const owner = await svc.search(spaceId, query, await conditionFor(ownerId));
      expect(owner.results.filter(row => row.type === "artifact")).toHaveLength(1);
      expect(owner.countsByType.artifact).toBe(1);
    } finally {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
    }
  });

  it("searches artifact projections through the artifacts scope", async () => {
    const spaceId = await createSpace();
    const agentId = await createAgent(spaceId, { name: "Artifact Writer" });
    const issueId = await createIssue(spaceId, {
      identifier: "TST-88",
      title: "Produce artifact",
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      spaceId,
      title: "Launch Artifact Brief",
      latestBody: "The searchable artifact body mentions a comet-tail preview.",
      format: "markdown",
      createdByAgentId: agentId,
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId,
      documentId,
      key: "brief",
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "comet-tail", scope: "artifacts" }));

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      type: "artifact",
      title: "Launch Artifact Brief",
      href: expect.stringContaining("#document-brief"),
      artifact: expect.objectContaining({
        mediaKind: "document",
        issueIdentifier: "TST-88",
      }),
    });
    expect(result.results[0]?.snippet).toMatch(/comet tail/i);
    expect(result.countsByType).toEqual({ issue: 0, comment: 0, document: 0, artifact: 1, agent: 0, project: 0 });
  });

  it("does not pass high-offset search fetch windows through to artifact query validation", async () => {
    const spaceId = await createSpace();

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({
      q: "artifact",
      scope: "artifacts",
      limit: "50",
      offset: "75",
    }));

    expect(result.results).toEqual([]);
    expect(result.countsByType.artifact).toBe(0);
  });

  it("applies issue filters before sorting and pagination", async () => {
    const spaceId = await createSpace();
    const agentId = await createAgent(spaceId, { name: "Needle engineer" });
    const projectId = await createProject(spaceId, { name: "Needle project" });
    const labelId = await createLabel(spaceId, { name: "Needle label" });
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const newestMatch = await createIssue(spaceId, {
      identifier: "TST-30",
      title: "Needle newest",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      projectId,
      updatedAt: new Date(base + 3_000),
    });
    const olderMatch = await createIssue(spaceId, {
      identifier: "TST-31",
      title: "Needle older",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      projectId,
      updatedAt: new Date(base + 2_000),
    });
    const statusDecoy = await createIssue(spaceId, {
      identifier: "TST-32",
      title: "Needle done",
      status: "done",
      priority: "high",
      assigneeAgentId: agentId,
      projectId,
      updatedAt: new Date(base + 4_000),
    });
    await db.insert(issueLabels).values([
      { spaceId, issueId: newestMatch, labelId },
      { spaceId, issueId: olderMatch, labelId },
      { spaceId, issueId: statusDecoy, labelId },
    ]);

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({
      q: "needle",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      projectId,
      labelId,
      updatedAfter: new Date(base + 1_000).toISOString(),
      sort: "updated",
      limit: "1",
      offset: "1",
    }));

    expect(result.results.map((row) => row.id)).toEqual([olderMatch]);
    expect(result.countsByType.issue).toBe(2);
    expect(result.countsByType.agent).toBe(0);
    expect(result.countsByType.project).toBe(0);
    expect(result.filterOptionCounts.status.todo).toBe(2);
    expect(result.filterOptionCounts.status.done).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("returns issue rows for filter-only searches", async () => {
    const spaceId = await createSpace();
    const agentId = await createAgent(spaceId, { name: "Filter owner" });
    const matchingIssue = await createIssue(spaceId, {
      identifier: "TST-34",
      title: "Filtered task",
      status: "todo",
      assigneeAgentId: agentId,
    });
    await createIssue(spaceId, {
      identifier: "TST-35",
      title: "Filtered decoy",
      status: "done",
      assigneeAgentId: agentId,
    });
    await createAgent(spaceId, { name: "Todo" });
    await createProject(spaceId, { name: "Todo" });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({
      q: "",
      status: "todo",
      assigneeAgentId: agentId,
    }));

    expect(result.results.map((row) => row.id)).toEqual([matchingIssue]);
    expect(result.countsByType.issue).toBe(1);
    expect(result.countsByType.agent).toBe(0);
    expect(result.countsByType.project).toBe(0);
    expect(result.results[0]?.snippets).toEqual([]);
  });

  it("returns zero-result loosen data and suppresses agent/project rows while issue filters are active", async () => {
    const spaceId = await createSpace();
    await createAgent(spaceId, { name: "Needle agent", capabilities: "Needle capabilities" });
    await createProject(spaceId, { name: "Needle project", description: "Needle roadmap" });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "needle", status: "todo" }));

    expect(result.results).toEqual([]);
    expect(result.countsByType.agent).toBe(0);
    expect(result.countsByType.project).toBe(0);
    expect(result.zeroResults).toMatchObject({
      unfilteredTotal: 2,
      loosenSuggestions: [
        { filter: "status", values: ["todo"], resultCount: 2, additionalCount: 2 },
      ],
    });
  });

  it("does not leak hidden issue-backed artifacts", async () => {
    const spaceId = await createSpace();
    const agentId = await createAgent(spaceId, { name: "Artifact Writer" });
    const visibleIssueId = await createIssue(spaceId, {
      identifier: "TST-33",
      title: "Visible artifact holder",
    });
    const hiddenIssueId = await createIssue(spaceId, {
      identifier: "TST-34",
      title: "Hidden artifact holder",
      hiddenAt: new Date(),
    });
    const visibleDocumentId = randomUUID();
    const hiddenDocumentId = randomUUID();
    await db.insert(documents).values([
      {
        id: visibleDocumentId,
        spaceId,
        title: "Visible Artifact",
        latestBody: "Searchable artifact body",
        format: "markdown",
        createdByAgentId: agentId,
      },
      {
        id: hiddenDocumentId,
        spaceId,
        title: "Hidden Artifact",
        latestBody: "Searchable artifact body",
        format: "markdown",
        createdByAgentId: agentId,
      },
    ]);
    await db.insert(issueDocuments).values([
      { spaceId, issueId: visibleIssueId, documentId: visibleDocumentId, key: "visible" },
      { spaceId, issueId: hiddenIssueId, documentId: hiddenDocumentId, key: "hidden" },
    ]);

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "artifact", scope: "artifacts" }));

    expect(result.results.map((row) => row.artifact?.issueId)).toEqual([visibleIssueId]);
    expect(result.countsByType.artifact).toBe(1);
  });

  it("excludes hidden issues and other spaces' data", async () => {
    const spaceId = await createSpace("Visible Co");
    const otherSpaceId = await createSpace("Other Co");
    const visibleId = await createIssue(spaceId, {
      identifier: "VIS-1",
      title: "Visible needle",
    });
    await createIssue(spaceId, {
      identifier: "HID-1",
      title: "Hidden needle",
      hiddenAt: new Date(),
    });
    await createIssue(spaceId, {
      identifier: "HAR-1",
      title: "Harness needle",
      harnessKind: "skill_test",
    });
    await createIssue(otherSpaceId, {
      identifier: "OTH-1",
      title: "Other space needle",
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "needle" }));

    expect(result.results.map((item) => item.id)).toEqual([visibleId]);
  });

  it("treats bare SQL wildcard characters as literals instead of match-all queries", async () => {
    const spaceId = await createSpace();
    const issueId = await createIssue(spaceId, {
      identifier: "TST-20",
      title: "Plain issue target",
      description: "Plain issue description",
    });
    await db.insert(issueComments).values({
      spaceId,
      issueId,
      body: "Plain comment body",
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      spaceId,
      title: "Plain document",
      latestBody: "Plain document body",
      format: "markdown",
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId,
      documentId,
      key: "plain",
    });
    await createAgent(spaceId, {
      name: "Plain Agent",
      role: "engineer",
      capabilities: "Plain agent capabilities",
    });
    await createProject(spaceId, {
      name: "Plain Project",
      description: "Plain project description",
    });

    for (const q of ["%", "_", "\\"]) {
      const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q }));
      expect(result.results, `q=${q}`).toEqual([]);
    }
  });

  it("matches percent characters literally across issue, comment, document, agent, and project results", async () => {
    const spaceId = await createSpace();
    const issueMatchId = await createIssue(spaceId, {
      identifier: "TST-21",
      title: "Release 100% checklist",
    });
    const issueDecoyId = await createIssue(spaceId, {
      identifier: "TST-22",
      title: "Release 1000 checklist",
    });
    const commentMatchId = await createIssue(spaceId, {
      identifier: "TST-23",
      title: "Comment literal holder",
    });
    const commentDecoyId = await createIssue(spaceId, {
      identifier: "TST-24",
      title: "Comment decoy holder",
    });
    await db.insert(issueComments).values([
      {
        spaceId,
        issueId: commentMatchId,
        body: "QA is 100% confident in this result.",
      },
      {
        spaceId,
        issueId: commentDecoyId,
        body: "QA is 1000 confident in this result.",
      },
    ]);
    const documentMatchIssueId = await createIssue(spaceId, {
      identifier: "TST-25",
      title: "Document literal holder",
    });
    const documentDecoyIssueId = await createIssue(spaceId, {
      identifier: "TST-26",
      title: "Document decoy holder",
    });
    const documentMatchId = randomUUID();
    const documentDecoyId = randomUUID();
    await db.insert(documents).values([
      {
        id: documentMatchId,
        spaceId,
        title: "Literal rollout",
        latestBody: "Ship 100% complete adapter support.",
        format: "markdown",
      },
      {
        id: documentDecoyId,
        spaceId,
        title: "Decoy rollout",
        latestBody: "Ship 1000 complete adapter support.",
        format: "markdown",
      },
    ]);
    await db.insert(issueDocuments).values([
      {
        spaceId,
        issueId: documentMatchIssueId,
        documentId: documentMatchId,
        key: "literal",
      },
      {
        spaceId,
        issueId: documentDecoyIssueId,
        documentId: documentDecoyId,
        key: "decoy",
      },
    ]);
    const agentMatchId = await createAgent(spaceId, {
      name: "100% Specialist",
      role: "engineer",
    });
    const agentDecoyId = await createAgent(spaceId, {
      name: "1000 Specialist",
      role: "engineer",
    });
    const projectMatchId = await createProject(spaceId, {
      name: "100% Launch Plan",
    });
    const projectDecoyId = await createProject(spaceId, {
      name: "1000 Launch Plan",
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "100%" }));
    const ids = result.results.map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining([
      issueMatchId,
      commentMatchId,
      documentMatchIssueId,
      agentMatchId,
      projectMatchId,
    ]));
    expect(ids).not.toEqual(expect.arrayContaining([
      issueDecoyId,
      commentDecoyId,
      documentDecoyIssueId,
      agentDecoyId,
      projectDecoyId,
    ]));
  });

  it("applies offset after merging cross-type result ranking", async () => {
    const spaceId = await createSpace();
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const agentIds = await Promise.all([
      createAgent(spaceId, { name: "Needle agent 1", updatedAt: new Date(base + 6_000) }),
      createAgent(spaceId, { name: "Needle agent 2", updatedAt: new Date(base + 5_000) }),
      createAgent(spaceId, { name: "Needle agent 3", updatedAt: new Date(base + 4_000) }),
    ]);
    const projectIds = await Promise.all([
      createProject(spaceId, { name: "Needle project 1", updatedAt: new Date(base + 3_000) }),
      createProject(spaceId, { name: "Needle project 2", updatedAt: new Date(base + 2_000) }),
      createProject(spaceId, { name: "Needle project 3", updatedAt: new Date(base + 1_000) }),
    ]);

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "needle", limit: "2", offset: "2" }));

    expect(result.results.map((row) => row.id)).toEqual([agentIds[2], projectIds[0]]);
    expect(result.countsByType).toEqual({ issue: 0, comment: 0, document: 0, artifact: 0, agent: 3, project: 3 });
    expect(result.hasMore).toBe(true);
  });

  it("escapes underscore and backslash characters in issue phrase and token patterns", async () => {
    const spaceId = await createSpace();
    const literalId = await createIssue(spaceId, {
      identifier: "TST-27",
      title: "Literal foo_bar path c:\\tmp",
    });
    const decoyId = await createIssue(spaceId, {
      identifier: "TST-28",
      title: "Decoy fooXbar path c:tmp",
    });

    for (const q of ["foo_bar", "c:\\tmp"]) {
      const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q, scope: "issues" }));
      const ids = result.results.map((row) => row.id);
      expect(ids, `q=${q}`).toContain(literalId);
      expect(ids, `q=${q}`).not.toContain(decoyId);
    }
  });

  it("does not interpret short UI terms as the middle of unrelated words", async () => {
    const spaceId = await createSpace();
    const target = await createIssue(spaceId, { title: "Improve mobile UI" });
    await createIssue(spaceId, { title: "Build billing reports" });
    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "UI" }));
    expect(result.results.map((row) => row.id)).toEqual([target]);
  });

  it("keeps typo fallback inside the requested filters", async () => {
    const spaceId = await createSpace();
    await createIssue(spaceId, { title: "Mibile API", status: "done" });
    const target = await createIssue(spaceId, { title: "Mobile API", status: "todo" });
    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "mibile api", status: "todo" }));
    expect(result.results.map((row) => row.id)).toEqual([target]);
  });

  it("keeps exact title hits on the task and chooses the most complete context evidence", async () => {
    const spaceId = await createSpace();
    const task = await createIssue(spaceId, { title: "Aurora callback" });
    await db.insert(issueComments).values({ spaceId, issueId: task, body: "Aurora callback is mentioned here too." });
    const exact = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "Aurora callback" }));
    expect(exact.results[0]?.href).not.toContain("#comment-");

    const holder = await createIssue(spaceId, { title: "Connection investigation" });
    await db.insert(issueComments).values({ spaceId, issueId: holder, body: "Aurora was discussed.", updatedAt: new Date("2026-06-01") });
    const strongest = randomUUID();
    await db.insert(issueComments).values({ id: strongest, spaceId, issueId: holder,
      body: "Aurora loses the callback state.", updatedAt: new Date("2026-01-01") });
    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "aurora state callback" }));
    expect(result.results[0]?.href).toContain(`#comment-${strongest}`);
    expect(result.results[0]?.snippet).toContain("state");
  });

  it.each(["comment", "document"] as const)("preserves %s evidence when title and identifier both match", async (source) => {
    const spaceId = await createSpace();
    const task = await createIssue(spaceId, {
      identifier: "CTX-123", title: "CTX callback investigation", description: "CTX callback details",
    });
    const sourceId = randomUUID();
    if (source === "comment") {
      await db.insert(issueComments).values({ id: sourceId, spaceId, issueId: task, body: "The missing signal is quasar." });
    } else {
      await db.insert(documents).values({ id: sourceId, spaceId, title: "Investigation plan", latestBody: "The missing signal is quasar.", format: "markdown" });
      await db.insert(issueDocuments).values({ spaceId, issueId: task, documentId: sourceId, key: "plan" });
    }

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "CTX quasar" }));
    const match = result.results.find((row) => row.id === task)!;
    expect(match.matchedFields).toEqual(expect.arrayContaining(["identifier", "title", source]));
    expect(match.score).toBeGreaterThanOrEqual(2000);
    expect(match.score).toBeLessThan(3000);
    expect(match.snippets).toHaveLength(2);
    expect(match.snippets[0]).toMatchObject({ field: source, text: expect.stringContaining("quasar") });
    expect(match.snippet).toContain("quasar");
    expect(match.href).toContain(source === "comment" ? `#comment-${sourceId}` : "#document-plan");
  });

  it("reflects edits, deleted comments and document updates immediately", async () => {
    const spaceId = await createSpace();
    const task = await createIssue(spaceId, { title: "Old uniquequartz title" });
    const find = () => svc.search(spaceId, spaceSearchQuerySchema.parse({ q: '"uniquequartz"' }));
    expect((await find()).results.map((row) => row.id)).toEqual([task]);
    await db.update(issues).set({ title: "New title" }).where(sql`${issues.id} = ${task}`);
    expect((await find()).results).toEqual([]);
    const comment = randomUUID();
    await db.insert(issueComments).values({ id: comment, spaceId, issueId: task, body: "uniquequartz" });
    expect((await find()).results.map((row) => row.id)).toEqual([task]);
    await db.update(issueComments).set({ deletedAt: new Date() }).where(sql`${issueComments.id} = ${comment}`);
    expect((await find()).results).toEqual([]);
    const doc = randomUUID();
    await db.insert(documents).values({ id: doc, spaceId, title: "Findings", latestBody: "uniquequartz", format: "markdown" });
    await db.insert(issueDocuments).values({ spaceId, issueId: task, documentId: doc, key: "plan" });
    expect((await find()).results.map((row) => row.id)).toEqual([task]);
    await db.update(documents).set({ latestBody: "Updated findings" }).where(sql`${documents.id} = ${doc}`);
    expect((await find()).results).toEqual([]);
  });

  it("uses pg_trgm for conservative fuzzy title matches", async () => {
    const spaceId = await createSpace();
    const issueId = await createIssue(spaceId, {
      identifier: "TST-9",
      title: "Onboarding wizard polish",
    });

    const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: "onbordng wizard" }));

    expect(result.results[0]?.id).toBe(issueId);
    expect(result.results[0]?.matchedFields).toContain("title");
  });

  it("matches transposition typos against multi-word titles", async () => {
    const spaceId = await createSpace();
    const searchIssueId = await createIssue(spaceId, {
      identifier: "TST-10",
      title: "Improve search performance",
    });
    const mobileIssueId = await createIssue(spaceId, {
      identifier: "TST-11",
      title: "Polish mobile navigation",
    });
    const otherIssueId = await createIssue(spaceId, {
      identifier: "TST-12",
      title: "Refactor billing reports",
    });

    const transpositionCases: Array<{ query: string; expectedId: string; rejected: string }> = [
      { query: "serach", expectedId: searchIssueId, rejected: otherIssueId },
      { query: "mibile", expectedId: mobileIssueId, rejected: otherIssueId },
      { query: "mobail", expectedId: mobileIssueId, rejected: otherIssueId },
    ];

    for (const { query, expectedId, rejected } of transpositionCases) {
      const result = await svc.search(spaceId, spaceSearchQuerySchema.parse({ q: query }));
      const ids = result.results.map((row) => row.id);
      expect(ids, `query=${query}`).toContain(expectedId);
      expect(ids, `query=${query} should not match unrelated issue`).not.toContain(rejected);
    }
  });

  it("pushes private issue filtering into list, count, and space search queries", async () => {
    const previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
    try {
      const spaceId = await createSpace();
      const ownerId = `owner-${randomUUID()}`;
      const otherId = `other-${randomUUID()}`;
      const granteeId = `grantee-${randomUUID()}`;
      const openId = await createIssue(spaceId, { title: "privacy needle open" });
      const privateId = randomUUID();
      await createIssue(spaceId, {
        id: privateId,
        title: "privacy needle private",
        visibility: "private",
        privacyRootIssueId: privateId,
        responsibleUserId: ownerId,
});
      await db.insert(issueAccessGrants).values({
        issueId: privateId,
        subjectType: "user",
        subjectId: granteeId,
        source: "explicit",
        grantedByUserId: ownerId,
      });

      const issuesSvc = issueService(db);
      const conditionFor = (userId: string) => issueReadSqlCondition(db, {
        type: "operator",
        userId,
        source: "session",
      });
      const otherCondition = await conditionFor(otherId);
      const ownerCondition = await conditionFor(ownerId);
      const granteeCondition = await conditionFor(granteeId);

      await expect(issuesSvc.list(spaceId, { readCondition: otherCondition })).resolves.toMatchObject([
        { id: openId },
      ]);
      await expect(issuesSvc.count(spaceId, { readCondition: otherCondition })).resolves.toBe(1);
      await expect(issuesSvc.count(spaceId, { readCondition: ownerCondition })).resolves.toBe(2);
      await expect(issuesSvc.count(spaceId, { readCondition: granteeCondition })).resolves.toBe(2);

      const result = await svc.search(
        spaceId,
        spaceSearchQuerySchema.parse({ q: "privacy needle", scope: "issues" }),
        { issueReadCondition: otherCondition },
      );
      expect(result.results.map((row) => row.id)).toEqual([openId]);
    } finally {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
    }
  });

  it("pushes private project filtering into project search and counts", async () => {
    const previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
    try {
      const spaceId = await createSpace();
      const memberId = `member-${randomUUID()}`;
      const outsiderId = `outsider-${randomUUID()}`;
      const openId = await createProject(spaceId, { name: "privacy project open" });
      const privateId = await createProject(spaceId, {
        name: "privacy project private",
        visibility: "private",
      });
      await db.insert(projectAccessMembers).values({
        spaceId,
        projectId: privateId,
        subjectType: "user",
        subjectId: memberId,
      });
      const conditionFor = (userId: string) => projectReadSqlCondition(db, {
        type: "operator",
        userId,
        source: "session",
      });
      const query = spaceSearchQuerySchema.parse({ q: "privacy project", scope: "projects" });
      const outsiderResult = await svc.search(spaceId, query, {
        projectReadCondition: await conditionFor(outsiderId),
      });
      expect(outsiderResult.results.map((row) => row.id)).toEqual([openId]);
      expect(outsiderResult.countsByType.project).toBe(1);

      const memberResult = await svc.search(spaceId, query, {
        projectReadCondition: await conditionFor(memberId),
      });
      expect(memberResult.results.map((row) => row.id)).toEqual(expect.arrayContaining([openId, privateId]));
      expect(memberResult.countsByType.project).toBe(2);
    } finally {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
    }
  });
});
