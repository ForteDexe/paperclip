import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, agents, spaces, spaceMemberships, createDb, heartbeatRuns, issues, principalPermissionGrants } from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import {
  __clearIssueListResponseCacheForTests,
  __getIssueListResponseCacheSizeForTests,
  ISSUE_LIST_SERVER_CACHE_MAX_ENTRIES,
  issueRoutes,
} from "../routes/issues.js";
import { issueRecoveryActionService } from "../services/issue-recovery-actions.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";
import { resolveRequiredSuccessfulRunHandoffOnValidPath } from "../services/successful-run-handoff-state.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue list route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issue list routes assigneeAgentId filter", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issue-list-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    __clearIssueListResponseCacheForTests();
    await db.delete(issues);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(
    spaceId: string,
    opts: Parameters<typeof issueRoutes>[2] = {},
  ) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const userId = req.header("x-test-user-id") ?? "cloud-user-1";
      (req as any).actor = {
        type: "operator",
        userId,
        spaceIds: [spaceId],
        memberships: [{ spaceId, membershipRole: "owner", status: "active", principalId: userId }],
        source: "cloud_tenant",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any, opts));
    app.use(errorHandler);
    return app;
  }


  function uniqueIssuePrefix() {
    return `P${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  }

  async function seedCloudTenantMember(spaceId: string, userId = "cloud-user-1") {
    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      spaceId,
      principalId: userId,
      membershipRole: "owner",
      grantedByUserId: null,
    });
  }

  it.each(["index", "rows"])("revalidates %s rows immediately after a mutation", async (view) => {
    const spaceId = randomUUID(), issueId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Fresh list", issuePrefix: uniqueIssuePrefix() });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values({ id: issueId, spaceId, title: "Before" });
    const app = createApp(spaceId);
    const before = await request(app).get(`/api/spaces/${spaceId}/issues`).query({ view, ids: issueId }).expect(200);
    await db.update(issues).set({ title: "After" }).where(eq(issues.id, issueId));
    const after = await request(app).get(`/api/spaces/${spaceId}/issues`).query({ view, ids: issueId })
      .set("If-None-Match", before.headers.etag).expect(200);
    expect(after.body[0].title).toBe("After");
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(after.headers["x-outpost-request-cache"]).toBe("miss");
  });

  it("keeps index and row batches scoped to readable tasks and validates their bounds", async () => {
    vi.stubEnv("OUTPOST_ISSUE_PRIVACY_MODE", "enforce");
    try {
      const spaceId = randomUUID(), foreignSpaceId = randomUUID();
      const parentId = randomUUID(), childId = randomUUID(), privateId = randomUUID(), foreignId = randomUUID();
      await db.insert(spaces).values([
        { id: spaceId, name: "Lists", issuePrefix: uniqueIssuePrefix() },
        { id: foreignSpaceId, name: "Other", issuePrefix: uniqueIssuePrefix() },
      ]);
      await seedCloudTenantMember(spaceId);
      await db.insert(issues).values([
        { id: parentId, spaceId, title: "Public parent" },
        { id: childId, spaceId, parentId, title: "Public child" },
        { id: privateId, spaceId, parentId, title: "Private child", visibility: "private", privacyRootIssueId: privateId, createdByUserId: "someone-else" },
        { id: foreignId, spaceId: foreignSpaceId, title: "Foreign task" },
      ]);
      const app = createApp(spaceId);
      for (const view of ["index", "rows"]) {
        const selected = await request(app).get(`/api/spaces/${spaceId}/issues`).query({ view, ids: [parentId, privateId, foreignId].join(",") });
        expect(selected.status, JSON.stringify(selected.body)).toBe(200);
        expect(selected.body.map((row: { id: string }) => row.id)).toEqual([parentId]);
        const children = await request(app).get(`/api/spaces/${spaceId}/issues`).query({ view, parentIds: parentId });
        expect(children.status).toBe(200);
        expect(children.body.map((row: { id: string }) => row.id)).toEqual([childId]);
      }
      const preview = await request(app).get(`/api/spaces/${spaceId}/issues`).query({ view: "index", parentIds: parentId, oneChildPerParent: true }).expect(200);
      expect(preview.body.map((row: { id: string }) => row.id)).toEqual([childId]);
      for (const query of [
        { view: "index", ids: "invalid" },
        { view: "index", parentIds: Array.from({ length: 101 }, () => randomUUID()).join(",") },
        { view: "index", ids: parentId, attention: "blocked" },
        { view: "compact", ids: parentId },
        { view: "index", oneChildPerParent: true },
        { view: "rows", parentIds: parentId, oneChildPerParent: true },
        { view: "index", parentIds: parentId, oneChildPerParent: "invalid" },
      ]) {
        expect((await request(app).get(`/api/spaces/${spaceId}/issues`).query(query)).status).toBe(400);
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("returns one child per parent without letting a large collapsed tree fill the page", async () => {
    const spaceId = randomUUID(), firstParentId = randomUUID(), secondParentId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Collapsed trees", issuePrefix: uniqueIssuePrefix() });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values([
      { id: firstParentId, spaceId, title: "First parent" },
      { id: secondParentId, spaceId, title: "Second parent" },
    ]);
    await db.insert(issues).values([
      ...Array.from({ length: 120 }, (_, index) => ({ spaceId, parentId: firstParentId, title: `Child ${index}` })),
      { spaceId, parentId: secondParentId, title: "Other child" },
    ]);
    const response = await request(createApp(spaceId)).get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "index", parentIds: [firstParentId, secondParentId].join(","), oneChildPerParent: true, limit: 2 }).expect(200);
    expect(response.body).toHaveLength(2);
    expect(new Set(response.body.map((row: { parentId: string }) => row.parentId))).toEqual(new Set([firstParentId, secondParentId]));
  });

  it("returns only unassigned issues for assigneeAgentId=null", async () => {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    const assignedIssueId = randomUUID();
    const unassignedIssueId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(agents).values({
      id: assigneeAgentId,
      spaceId,
      name: "Assignee",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values([
      {
        id: assignedIssueId,
        spaceId,
        title: "Assigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
      {
        id: unassignedIssueId,
        spaceId,
        title: "Unassigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: null,
      },
    ]);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ status: "todo", assigneeAgentId: "null", limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.map((issue: { id: string }) => issue.id)).toEqual([unassignedIssueId]);
  });

  it("returns compact issue list rows with recovery chips but without detail-only fields", async () => {
    const spaceId = randomUUID();
    const ownerAgentId = randomUUID();
    const issueId = randomUUID();
    const sourceRunId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(agents).values({
      id: ownerAgentId,
      spaceId,
      name: "Recovery owner",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Compact issue",
      description: "This long detail belongs on the issue detail endpoint, not the operator list.",
      status: "todo",
      priority: "medium",
      billingCode: "product",
    });
    const recoveryAction = await issueRecoveryActionService(db).upsertSourceScoped({
      spaceId,
      sourceIssueId: issueId,
      kind: "missing_disposition",
      ownerType: "agent",
      ownerAgentId,
      cause: "successful_run_missing_issue_disposition",
      fingerprint: "missing-disposition:compact-route",
      evidence: { sourceRunId: "run-1" },
      nextAction: "Choose a valid issue disposition.",
      wakePolicy: { type: "wake_owner" },
    });
    await db.insert(activityLog).values({
      spaceId,
      actorType: "system",
      actorId: "system",
      action: "issue.successful_run_handoff_required",
      entityType: "issue",
      entityId: issueId,
      agentId: ownerAgentId,
      runId: null,
      details: {
        sourceRunId,
        detectedProgressSummary: "Implemented the requested change without choosing a disposition.",
      },
    });

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "compact", limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers.etag).toMatch(/^"compact-issues:/);
    expect(res.headers["cache-control"]).toBe("private, must-revalidate");
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: issueId,
      spaceId,
      title: "Compact issue",
      description: "This long detail belongs on the issue detail endpoint, not the operator list.",
      status: "todo",
      priority: "medium",
      billingCode: "product",
      activeRecoveryAction: {
        id: recoveryAction.id,
        sourceIssueId: issueId,
        ownerAgentId,
        kind: "missing_disposition",
      },
      successfulRunHandoff: {
        state: "required",
        required: true,
        hasLiveContinuation: false,
        sourceRunId,
        assigneeAgentId: ownerAgentId,
      },
    });
    const index = await request(app).get(`/api/spaces/${spaceId}/issues`).query({ view: "index", limit: "20" });
    expect(index.status).toBe(200);
    expect(index.body).toHaveLength(1);
    expect(index.body[0]).toMatchObject({ id: issueId, listProjection: "index", description: null, activeRecoveryAction: null, successfulRunHandoff: null });
    expect(index.headers.etag).not.toBe(res.headers.etag);
    const detailRows = await request(app).get(`/api/spaces/${spaceId}/issues`).query({ view: "rows", ids: issueId });
    expect(detailRows.status).toBe(200);
    expect(detailRows.body[0]).toMatchObject({ id: issueId, listProjection: "rows", description: null, activeRecoveryAction: { id: recoveryAction.id } });

    expect(res.body[0]).not.toHaveProperty("workProducts");
    expect(res.body[0]).not.toHaveProperty("project");
    expect(res.body[0]).not.toHaveProperty("goal");
  });

  it("marks a required successful-run handoff live while a run targets the issue", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Assignee",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Live handoff issue",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(activityLog).values({
      spaceId,
      actorType: "system",
      actorId: "system",
      action: "issue.successful_run_handoff_required",
      entityType: "issue",
      entityId: issueId,
      agentId,
      details: { sourceRunId: randomUUID() },
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "running",
      contextSnapshot: { taskId: issueId },
    });

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "compact", limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body[0]?.successfulRunHandoff).toMatchObject({
      state: "required",
      required: true,
      hasLiveContinuation: true,
      liveRunId: runId,
    });
  });

  it("marks an escalated successful-run handoff live while a run targets the issue", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Assignee",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Escalated handoff issue",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(activityLog).values({
      spaceId,
      actorType: "system",
      actorId: "system",
      action: "issue.successful_run_handoff_escalated",
      entityType: "issue",
      entityId: issueId,
      agentId,
      details: { sourceRunId: randomUUID() },
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "running",
      contextSnapshot: { taskId: issueId },
    });

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "compact", limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body[0]?.successfulRunHandoff).toMatchObject({
      state: "escalated",
      required: false,
      hasLiveContinuation: true,
      liveRunId: runId,
    });
  });

  it("logs resolved when a valid-path skip closes a stale required handoff", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const resolverRunId = randomUUID();
    const sourceRunId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Assignee",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: resolverRunId,
      spaceId,
      agentId,
      status: "succeeded",
      contextSnapshot: { issueId },
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      identifier: `${uniqueIssuePrefix()}-1`,
      title: "Stale handoff",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(activityLog).values({
      spaceId,
      actorType: "system",
      actorId: "heartbeat",
      action: "issue.successful_run_handoff_required",
      entityType: "issue",
      entityId: issueId,
      agentId,
      details: { sourceRunId },
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    await expect(resolveRequiredSuccessfulRunHandoffOnValidPath(db, {
      spaceId,
      issueId,
      issueIdentifier: "PAP-1",
      agentId,
      runId: resolverRunId,
      skipReason: "persisted issue monitor owns the next action",
    })).resolves.toBe(true);

    const resolved = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, issueId))
      .then((rows) => rows.find((row) => row.action === "issue.successful_run_handoff_resolved"));
    expect(resolved).toMatchObject({
      runId: resolverRunId,
      details: {
        sourceRunId,
        resolvedByRunId: resolverRunId,
        resolvedBySkipReason: "persisted issue monitor owns the next action",
      },
    });
  });

  it("returns 304 for unchanged compact issue list ETags", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Cached compact issue",
      status: "todo",
      priority: "medium",
    });

    const app = createApp(spaceId);
    const first = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "compact", limit: "20" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.headers.etag).toBeTruthy();

    const second = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "compact", limit: "20" })
      .set("If-None-Match", first.headers.etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });

  it("coalesces simultaneous identical compact issue-list requests into one service computation", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    let computeCount = 0;

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Coalesced issue",
      status: "todo",
      priority: "medium",
    });

    const app = createApp(spaceId, {
      issueListDiagnostics: {
        async onComputeStart() {
          computeCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      },
    });
    const responses = await Promise.all(Array.from({ length: 10 }, () =>
      request(app)
        .get(`/api/spaces/${spaceId}/issues`)
        .query({ view: "compact", limit: "20" })
    ));

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(responses.map((res) => res.body.map((issue: { id: string }) => issue.id))).toEqual(
      Array.from({ length: 10 }, () => [issueId]),
    );
    expect(computeCount).toBe(1);
    expect(responses.some((res) => res.headers["x-outpost-request-cache"] === "coalesced")).toBe(true);
  });

  it("keeps compact issue-list cache keys separated by operator user identity", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    let computeCount = 0;

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId, "cloud-user-1");
    await seedCloudTenantMember(spaceId, "cloud-user-2");
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Separated issue",
      status: "todo",
      priority: "medium",
    });

    const app = createApp(spaceId, {
      issueListDiagnostics: {
        async onComputeStart() {
          computeCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 40));
        },
      },
    });
    const [first, second] = await Promise.all([
      request(app)
        .get(`/api/spaces/${spaceId}/issues`)
        .set("X-Test-User-Id", "cloud-user-1")
        .query({ view: "compact", limit: "20" }),
      request(app)
        .get(`/api/spaces/${spaceId}/issues`)
        .set("X-Test-User-Id", "cloud-user-2")
        .query({ view: "compact", limit: "20" }),
    ]);

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(computeCount).toBe(2);
    expect(first.headers["x-outpost-request-cache"]).toBe("miss");
    expect(second.headers["x-outpost-request-cache"]).toBe("miss");
  });

  it("serves repeated compact issue-list requests from the short server cache", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    let computeCount = 0;

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Cached issue",
      status: "todo",
      priority: "medium",
    });

    const app = createApp(spaceId, {
      issueListDiagnostics: {
        onComputeStart() {
          computeCount += 1;
        },
      },
    });
    const first = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "compact", limit: "20" });
    const second = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ view: "compact", limit: "20" });

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(computeCount).toBe(1);
    expect(first.headers["x-outpost-request-cache"]).toBe("miss");
    expect(second.headers["x-outpost-request-cache"]).toBe("hit");
  });

  it("bounds compact issue-list server cache entries", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Bounded cache issue",
      status: "todo",
      priority: "medium",
    });

    const app = createApp(spaceId);
    // Filling the cache can take longer than its five-second expiry on CI.
    // Keep entries alive so this test measures capacity eviction alone.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    try {
      for (let index = 0; index < ISSUE_LIST_SERVER_CACHE_MAX_ENTRIES + 5; index += 1) {
        const res = await request(app)
          .get(`/api/spaces/${spaceId}/issues`)
          .query({ view: "compact", limit: "20", q: `cache-key-${index}` });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      }

      expect(__getIssueListResponseCacheSizeForTests()).toBe(ISSUE_LIST_SERVER_CACHE_MAX_ENTRIES);
    } finally {
      clock.mockRestore();
    }
  });

  it("logs request_storm_detected for identical in-flight compact issue-list fanout without query values", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const stormEvents: unknown[] = [];

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Storm issue",
      status: "todo",
      priority: "medium",
    });

    const app = createApp(spaceId, {
      issueListDiagnostics: {
        async onComputeStart() {
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
        onStormDetected(event) {
          stormEvents.push(event);
        },
      },
    });
    const responses = await Promise.all(Array.from({ length: 5 }, () =>
      request(app)
        .get(`/api/spaces/${spaceId}/issues`)
        .set("Referer", "http://localhost:3100/issues?q=do-not-log-this")
        .set("X-Outpost-Tab-Visible", "visible")
        .query({ view: "compact", limit: "20", q: "do-not-log-this" })
    ));

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(stormEvents).toHaveLength(1);
    expect(stormEvents[0]).toMatchObject({
      event: "request_storm_detected",
      route: "GET /api/spaces/:spaceId/issues",
      spaceId,
      visibilityHint: "visible",
      referer: "/issues",
    });
    expect((stormEvents[0] as { queryKeys: string[] }).queryKeys).toEqual(
      expect.arrayContaining(["limit", "q", "view"]),
    );
    expect(JSON.stringify(stormEvents[0])).not.toContain("do-not-log-this");
  });

  it("keeps UUID assignee filtering behavior unchanged", async () => {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    const otherAgentId = randomUUID();
    const assignedIssueId = randomUUID();
    const otherIssueId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(agents).values([
      {
        id: assigneeAgentId,
        spaceId,
        name: "Assignee",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        spaceId,
        name: "Other",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values([
      {
        id: assignedIssueId,
        spaceId,
        title: "Assigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
      {
        id: otherIssueId,
        spaceId,
        title: "Other issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: otherAgentId,
      },
    ]);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ status: "todo", assigneeAgentId, limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.map((issue: { id: string }) => issue.id)).toEqual([assignedIssueId]);
  });

  it("returns 422 for malformed assigneeAgentId filters", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ status: "todo", assigneeAgentId: "bad", limit: "20" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "assigneeAgentId must be a UUID or 'null'",
    });
  });

  it.each([
    "projectId",
    "parentId",
    "parentIssueId",
    "workspaceId",
    "executionWorkspaceId",
    "descendantOf",
    "labelId",
    "participantAgentId",
    "createdFromIssueId",
  ])("returns 422 instead of a DB error for malformed %s filters", async (param) => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ status: "todo", [param]: "d", limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ error: `${param} must be a UUID` });
  });

  it.each([
    "projectId",
    "parentId",
    "parentIssueId",
    "workspaceId",
    "executionWorkspaceId",
    "descendantOf",
    "labelId",
    "participantAgentId",
    "createdFromIssueId",
  ])("returns 422 from issues/count for malformed %s filters", async (param) => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues/count`)
      .query({ attention: "blocked", [param]: "d" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ error: `${param} must be a UUID` });
  });

  it("returns opt-in live descendant counts for offscreen live descendants only", async () => {
    const spaceId = randomUUID();
    const otherSpaceId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    const rootIssueId = randomUUID();
    const childIssueId = randomUUID();
    const grandchildIssueId = randomUUID();
    const hiddenChildIssueId = randomUUID();
    const crossSpaceChildIssueId = randomUUID();
    const rootRunId = randomUUID();
    const grandchildRunId = randomUUID();
    const hiddenRunId = randomUUID();
    const crossSpaceRunId = randomUUID();

    await db.insert(spaces).values([
      {
        id: spaceId,
        name: "Outpost",
        issuePrefix: uniqueIssuePrefix(),
        requireOperatorApprovalForNewAgents: false,
      },
      {
        id: otherSpaceId,
        name: "Other Space",
        issuePrefix: uniqueIssuePrefix(),
        requireOperatorApprovalForNewAgents: false,
      },
    ]);
    await seedCloudTenantMember(spaceId);
    await db.insert(agents).values([
      {
        id: agentId,
        spaceId,
        name: "Assignee",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        spaceId: otherSpaceId,
        name: "Other",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(heartbeatRuns).values([
      {
        id: rootRunId,
        spaceId,
        agentId,
        status: "running",
        contextSnapshot: { issueId: rootIssueId },
      },
      {
        id: grandchildRunId,
        spaceId,
        agentId,
        status: "queued",
        contextSnapshot: { issueId: grandchildIssueId },
      },
      {
        id: hiddenRunId,
        spaceId,
        agentId,
        status: "running",
        contextSnapshot: { issueId: hiddenChildIssueId },
      },
      {
        id: crossSpaceRunId,
        spaceId: otherSpaceId,
        agentId: otherAgentId,
        status: "running",
        contextSnapshot: { issueId: crossSpaceChildIssueId },
      },
    ]);
    await db.insert(issues).values([
      {
        id: rootIssueId,
        spaceId,
        title: "Blocked parent",
        status: "blocked",
        priority: "critical",
        executionRunId: rootRunId,
        assigneeAgentId: agentId,
      },
      {
        id: childIssueId,
        spaceId,
        title: "Offscreen child",
        status: "todo",
        priority: "medium",
        parentId: rootIssueId,
        assigneeAgentId: agentId,
      },
      {
        id: grandchildIssueId,
        spaceId,
        title: "Offscreen live grandchild",
        status: "todo",
        priority: "medium",
        parentId: childIssueId,
        executionRunId: grandchildRunId,
        assigneeAgentId: agentId,
      },
      {
        id: hiddenChildIssueId,
        spaceId,
        title: "Hidden live child",
        status: "todo",
        priority: "medium",
        parentId: rootIssueId,
        executionRunId: hiddenRunId,
        hiddenAt: new Date("2026-07-02T00:00:00.000Z"),
        assigneeAgentId: agentId,
      },
      {
        id: crossSpaceChildIssueId,
        spaceId: otherSpaceId,
        title: "Cross-space live child",
        status: "todo",
        priority: "medium",
        parentId: rootIssueId,
        executionRunId: crossSpaceRunId,
        assigneeAgentId: otherAgentId,
      },
    ]);

    const app = createApp(spaceId);
    const withoutSummary = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ status: "blocked", limit: "20" });

    expect(withoutSummary.status, JSON.stringify(withoutSummary.body)).toBe(200);
    expect(withoutSummary.body).toHaveLength(1);
    expect(withoutSummary.body[0].id).toBe(rootIssueId);
    expect(withoutSummary.body[0].liveDescendantCount).toBeUndefined();

    const withSummary = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ status: "blocked", includeLiveDescendantSummary: "true", limit: "20" });

    expect(withSummary.status, JSON.stringify(withSummary.body)).toBe(200);
    expect(withSummary.body).toHaveLength(1);
    expect(withSummary.body[0]).toMatchObject({
      id: rootIssueId,
      liveDescendantCount: 1,
    });
  });

  it("does not recurse forever when live descendant summaries encounter a parent cycle", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const parentIssueId = randomUUID();
    const childIssueId = randomUUID();
    const runId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Assignee",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "running",
      contextSnapshot: { issueId: childIssueId },
    });
    await db.insert(issues).values([
      {
        id: parentIssueId,
        spaceId,
        title: "Cycle parent",
        status: "blocked",
        priority: "medium",
        parentId: childIssueId,
        assigneeAgentId: agentId,
      },
      {
        id: childIssueId,
        spaceId,
        title: "Cycle live child",
        status: "in_progress",
        priority: "medium",
        parentId: parentIssueId,
        executionRunId: runId,
        assigneeAgentId: agentId,
      },
    ]);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ status: "blocked", includeLiveDescendantSummary: "true", limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: parentIssueId,
      liveDescendantCount: 1,
    });
  });
});
