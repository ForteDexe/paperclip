import { Readable } from "node:stream";
import express from "express";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  assets,
  spaces,
  createDb,
  documentMemberships,
  documents,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issueDocuments,
  issues,
  issueWorkProducts,
  projects,
} from "@outpost/db";
import { ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY } from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { spaceRoutes } from "../routes/spaces.js";
import { spaceArtifactsService } from "../services/space-artifacts.js";
import type { StorageService } from "../storage/types.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres space artifacts tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function createStorageService(files: Record<string, Buffer> = {}): StorageService {
  return {
    provider: "local_disk",
    putFile: vi.fn(),
    getObject: vi.fn(async (_spaceId, objectKey, options) => {
      const body = files[objectKey] ?? Buffer.alloc(0);
      const range = options?.range;
      const ranged = range ? body.subarray(range.start, range.end + 1) : body;
      return {
        stream: Readable.from(ranged),
        contentType: "text/plain",
        contentLength: ranged.length,
      };
    }),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
  };
}

describeEmbeddedPostgres("spaceArtifactsService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-space-artifacts-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(documentMemberships);
    await db.delete(issueWorkProducts);
    await db.delete(issueAttachments);
    await db.delete(assets);
    await db.delete(issueComments);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedArtifacts() {
    const spaceId = "11111111-1111-4111-8111-111111111111";
    const otherSpaceId = "22222222-2222-4222-8222-222222222222";
    const agentId = "33333333-3333-4333-8333-333333333333";
    const otherAgentId = "44444444-4444-4444-8444-444444444444";
    const projectId = "55555555-5555-4555-8555-555555555555";
    const issueId = "66666666-6666-4666-8666-666666666666";
    const secondIssueId = "77777777-7777-4777-8777-777777777777";
    const otherIssueId = "88888888-8888-4888-8888-888888888888";
    const runId = "99999999-9999-4999-8999-999999999999";
    const otherRunId = "19191919-1919-4191-8191-191919191919";
    const directAttachmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const workProductAttachmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    await db.insert(spaces).values([
      { id: spaceId, name: "Outpost", issuePrefix: "PAP", requireOperatorApprovalForNewAgents: false },
      { id: otherSpaceId, name: "OtherCo", issuePrefix: "OTH", requireOperatorApprovalForNewAgents: false },
    ]);
    await db.insert(agents).values([
      { id: agentId, spaceId, name: "Coder", role: "engineer" },
      { id: otherAgentId, spaceId: otherSpaceId, name: "Other", role: "engineer" },
    ]);
    await db.insert(projects).values({ id: projectId, spaceId, name: "Artifacts", status: "in_progress" });
    await db.insert(issues).values([
      {
        id: issueId,
        spaceId,
        projectId,
        identifier: "PAP-1",
        title: "Make the reel",
        status: "done",
        priority: "medium",
      },
      {
        id: secondIssueId,
        spaceId,
        identifier: "PAP-2",
        title: "Write the plan",
        status: "done",
        priority: "medium",
      },
      {
        id: otherIssueId,
        spaceId: otherSpaceId,
        identifier: "OTH-1",
        title: "Other output",
        status: "done",
        priority: "medium",
      },
    ]);
    await db.insert(heartbeatRuns).values([
      {
        id: runId,
        spaceId,
        agentId,
        status: "completed",
      },
      {
        id: otherRunId,
        spaceId: otherSpaceId,
        agentId: otherAgentId,
        status: "completed",
      },
    ]);
    await db.insert(documents).values([
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        spaceId,
        title: "Review Notes",
        latestBody: "# Review\n\nAgent-created review document with useful details.",
        createdByAgentId: agentId,
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        spaceId,
        title: "Continuation Summary",
        latestBody: "System handoff",
        createdByAgentId: agentId,
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        spaceId,
        title: "User Upload Notes",
        latestBody: "User-authored context",
        createdByUserId: "user-1",
        updatedAt: new Date("2026-01-06T00:00:00.000Z"),
      },
      {
        id: "20202020-2020-4020-8020-202020202020",
        spaceId,
        title: "Plan",
        latestBody: "Human-approved plan",
        createdByUserId: "user-1",
        updatedAt: new Date("2026-01-08T00:00:00.000Z"),
      },
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        spaceId: otherSpaceId,
        title: "Other Space Plan",
        latestBody: "Must not cross tenants",
        createdByAgentId: otherAgentId,
        updatedAt: new Date("2026-01-07T00:00:00.000Z"),
      },
    ]);
    await db.insert(issueDocuments).values([
      {
        spaceId,
        issueId: secondIssueId,
        documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        key: "review",
      },
      {
        spaceId,
        issueId,
        documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        key: ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
      },
      {
        spaceId,
        issueId,
        documentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        key: "user-notes",
      },
      {
        spaceId,
        issueId: secondIssueId,
        documentId: "20202020-2020-4020-8020-202020202020",
        key: "plan",
      },
      {
        spaceId: otherSpaceId,
        issueId: otherIssueId,
        documentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        key: "plan",
      },
    ]);
    await db.insert(issueComments).values({
      id: "12121212-1212-4121-8121-121212121212",
      spaceId,
      issueId,
      authorType: "agent",
      authorAgentId: agentId,
      body: "comment with screenshot",
    });
    await db.insert(assets).values([
      {
        id: "13131313-1313-4131-8131-131313131313",
        spaceId,
        provider: "local_disk",
        objectKey: "direct-video.mp4",
        contentType: "video/mp4",
        byteSize: 100,
        sha256: "sha256-direct-video",
        originalFilename: "direct-video.mp4",
        createdByAgentId: agentId,
      },
      {
        id: "14141414-1414-4141-8141-141414141414",
        spaceId,
        provider: "local_disk",
        objectKey: "primary-cut.mp4",
        contentType: "video/mp4",
        byteSize: 200,
        sha256: "sha256-primary-cut",
        originalFilename: "primary-cut.mp4",
        createdByAgentId: agentId,
      },
      {
        id: "15151515-1515-4151-8151-151515151515",
        spaceId,
        provider: "local_disk",
        objectKey: "operator-screenshot.png",
        contentType: "image/png",
        byteSize: 300,
        sha256: "sha256-user",
        originalFilename: "operator-screenshot.png",
        createdByUserId: "user-1",
      },
      {
        id: "16161616-1616-4161-8161-161616161616",
        spaceId,
        provider: "local_disk",
        objectKey: "comment-screenshot.png",
        contentType: "image/png",
        byteSize: 400,
        sha256: "sha256-comment",
        originalFilename: "comment-screenshot.png",
        createdByAgentId: agentId,
      },
      {
        id: "17171717-1717-4171-8171-171717171717",
        spaceId,
        provider: "local_disk",
        objectKey: "notes.txt",
        contentType: "text/plain",
        byteSize: 64,
        sha256: "sha256-notes",
        originalFilename: "notes.txt",
        createdByAgentId: agentId,
      },
    ]);
    await db.insert(issueAttachments).values([
      {
        id: directAttachmentId,
        spaceId,
        issueId,
        assetId: "13131313-1313-4131-8131-131313131313",
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
      {
        id: workProductAttachmentId,
        spaceId,
        issueId,
        assetId: "14141414-1414-4141-8141-141414141414",
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        spaceId,
        issueId,
        assetId: "15151515-1515-4151-8151-151515151515",
        updatedAt: new Date("2026-01-08T00:00:00.000Z"),
      },
      {
        spaceId,
        issueId,
        assetId: "16161616-1616-4161-8161-161616161616",
        issueCommentId: "12121212-1212-4121-8121-121212121212",
        updatedAt: new Date("2026-01-09T00:00:00.000Z"),
      },
      {
        spaceId,
        issueId,
        assetId: "17171717-1717-4171-8171-171717171717",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    await db.insert(issueWorkProducts).values({
      id: "18181818-1818-4181-8181-181818181818",
      spaceId,
      projectId,
      issueId,
      type: "artifact",
      provider: "outpost",
      title: "Primary Cut",
      status: "ready_for_review",
      summary: "Main render for review",
      isPrimary: true,
      metadata: {
        attachmentId: workProductAttachmentId,
        contentType: "video/mp4",
        byteSize: 200,
        contentPath: `/api/attachments/${workProductAttachmentId}/content`,
        openPath: `/api/attachments/${workProductAttachmentId}/content`,
        downloadPath: `/api/attachments/${workProductAttachmentId}/content?download=1`,
        originalFilename: "primary-cut.mp4",
      },
      createdByRunId: runId,
      updatedAt: new Date("2026-01-02T12:00:00.000Z"),
    });

    return { spaceId, otherSpaceId, projectId, issueId, secondIssueId, otherIssueId, otherRunId };
  }

  it("returns only the caller's starred documents, including plan and human-authored documents, with cursor order", async () => {
    const { spaceId } = await seedArtifacts();
    await db.insert(documentMemberships).values([
      {
        spaceId,
        documentId: "20202020-2020-4020-8020-202020202020",
        userId: "user-1",
        starredAt: new Date("2026-02-03T00:00:00.000Z"),
      },
      {
        spaceId,
        documentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        userId: "user-1",
        starredAt: new Date("2026-02-02T00:00:00.000Z"),
      },
      {
        spaceId,
        documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        userId: "other-user",
        starredAt: new Date("2026-02-04T00:00:00.000Z"),
      },
    ]);

    const app = express();
    app.use((req, _res, next) => {
      req.actor = {
        type: "operator",
        userId: "user-1",
        source: "session",
        spaceIds: [spaceId],
        memberships: [{ spaceId, membershipRole: "viewer", status: "active" }],
      };
      next();
    });
    app.use("/api/spaces", spaceRoutes(db, createStorageService()));
    app.use(errorHandler);

    const first = await request(app).get(`/api/spaces/${spaceId}/artifacts?starred=true&limit=1`);
    expect(first.status).toBe(200);
    expect(first.body.artifacts.map((artifact: { title: string }) => artifact.title)).toEqual(["Plan"]);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app).get(
      `/api/spaces/${spaceId}/artifacts?starred=true&limit=10&cursor=${first.body.nextCursor}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.artifacts.map((artifact: { title: string }) => artifact.title)).toEqual(["User Upload Notes"]);
    expect(second.body.artifacts.every((artifact: { source: string }) => artifact.source === "document")).toBe(true);

    const incompatibleKind = await request(app).get(
      `/api/spaces/${spaceId}/artifacts?starred=true&kind=image`,
    );
    expect(incompatibleKind.status).toBe(200);
    expect(incompatibleKind.body).toEqual({ artifacts: [], nextCursor: null });
  });

  it("lists only artifacts on tasks the caller can read", async () => {
    const previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
    try {
      const { spaceId, issueId } = await seedArtifacts();
      await db.update(issues).set({ visibility: "private", privacyRootIssueId: sql`${issues.id}`, responsibleUserId: "owner-user" })
        .where(eq(issues.spaceId, spaceId));
      const list = async (userId: string, search = "limit=50") => {
        const app = express();
        app.use((req, _res, next) => {
          req.actor = { type: "operator", userId, source: "session", spaceIds: [spaceId],
            memberships: [{ spaceId, membershipRole: "viewer", status: "active" }] };
          next();
        });
        app.use("/api/spaces", spaceRoutes(db, createStorageService()));
        app.use(errorHandler);
        return request(app).get(`/api/spaces/${spaceId}/artifacts?${search}`);
      };
      const outsider = await list("user-1");
      expect(outsider.status).toBe(200);
      expect(outsider.body.artifacts).toEqual([]);
      expect((await list("owner-user")).body.artifacts.length).toBeGreaterThan(0);
      // A task id in the group selector reveals nothing about an unreadable task.
      for (const groupBy of ["task", "parent_task"]) {
        const grouped = await list("user-1", `groupBy=${groupBy}&groupIssueId=${issueId}`);
        expect(grouped.status).toBe(200);
        expect(grouped.body).toEqual({ artifacts: [], selectedGroup: null, nextCursor: null });
        expect((await list("user-1", `groupBy=${groupBy}`)).body.artifacts).toEqual([]);
      }
      expect((await list("owner-user", `groupBy=task&groupIssueId=${issueId}`)).body.selectedGroup).toMatchObject({ issue: { id: issueId } });
    } finally {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
    }
  });

  it("returns an empty starred view for agent callers", async () => {
    const { spaceId, otherRunId } = await seedArtifacts();
    await db.insert(documentMemberships).values({
      spaceId,
      documentId: "20202020-2020-4020-8020-202020202020",
      userId: "user-1",
    });
    const app = express();
    app.use((req, _res, next) => {
      req.actor = {
        type: "agent",
        agentId: "33333333-3333-4333-8333-333333333333",
        spaceId,
        runId: otherRunId,
        source: "agent_key",
      };
      next();
    });
    app.use("/api/spaces", spaceRoutes(db, createStorageService()));
    app.use(errorHandler);

    const response = await request(app).get(`/api/spaces/${spaceId}/artifacts?starred=true`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ artifacts: [], nextCursor: null });
  });

  it("projects agent-created documents, direct attachments, and work products while excluding noisy sources", async () => {
    const { spaceId } = await seedArtifacts();
    const storage = createStorageService({ "notes.txt": Buffer.from("Text file preview from an agent output.") });
    const result = await spaceArtifactsService(db, storage).list(spaceId, { limit: 20 });

    expect(result.nextCursor).toBeNull();
    expect(result.artifacts.map((artifact) => artifact.title)).toEqual([
      "Review Notes",
      "direct-video.mp4",
      "Primary Cut",
      "notes.txt",
    ]);
    expect(result.artifacts.map((artifact) => artifact.source)).toEqual([
      "document",
      "attachment",
      "work_product",
      "attachment",
    ]);
    expect(result.artifacts.find((artifact) => artifact.title === "notes.txt")?.previewText)
      .toBe("Text file preview from an agent output.");
    expect(result.artifacts.some((artifact) => artifact.title === "primary-cut.mp4")).toBe(false);
    expect(result.artifacts.some((artifact) => artifact.title === "Continuation Summary")).toBe(false);
    expect(result.artifacts.some((artifact) => artifact.title === "operator-screenshot.png")).toBe(false);
    expect(result.artifacts.some((artifact) => artifact.title === "comment-screenshot.png")).toBe(false);
    expect(result.artifacts.some((artifact) => artifact.issue.identifier === "OTH-1")).toBe(false);
  });

  it("supports project, kind, search, and cursor filters", async () => {
    const { spaceId, projectId } = await seedArtifacts();
    const storage = createStorageService({ "notes.txt": Buffer.from("Searchable notes preview") });

    const projectVideos = await spaceArtifactsService(db, storage).list(spaceId, {
      projectId,
      kind: "video",
      limit: 10,
    });
    expect(projectVideos.artifacts.map((artifact) => artifact.title)).toEqual(["direct-video.mp4", "Primary Cut"]);

    const search = await spaceArtifactsService(db, storage).list(spaceId, {
      q: "review document",
      limit: 10,
    });
    expect(search.artifacts.map((artifact) => artifact.title)).toEqual(["Review Notes"]);

    const firstPage = await spaceArtifactsService(db, storage).list(spaceId, { limit: 2 });
    expect(firstPage.artifacts.map((artifact) => artifact.title)).toEqual(["Review Notes", "direct-video.mp4"]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await spaceArtifactsService(db, storage).list(spaceId, {
      limit: 10,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.artifacts.map((artifact) => artifact.title)).toEqual(["Primary Cut", "notes.txt"]);

    const pageAfterPrimaryWorkProduct = await spaceArtifactsService(db, storage).list(spaceId, { limit: 3 });
    expect(pageAfterPrimaryWorkProduct.artifacts.map((artifact) => artifact.title)).toEqual([
      "Review Notes",
      "direct-video.mp4",
      "Primary Cut",
    ]);

    const afterPrimaryCursor = await spaceArtifactsService(db, storage).list(spaceId, {
      limit: 10,
      cursor: pageAfterPrimaryWorkProduct.nextCursor ?? undefined,
    });
    expect(afterPrimaryCursor.artifacts.map((artifact) => artifact.title)).toEqual(["notes.txt"]);
  });

  it("filters every artifact source by the agent it is attributed to", async () => {
    const { spaceId } = await seedArtifacts();
    const writerId = "21212121-2121-4121-8121-212121212121";
    await db.insert(agents).values({ id: writerId, spaceId, name: "Writer", role: "engineer" });
    await db.update(documents).set({ createdByAgentId: writerId })
      .where(eq(documents.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
    const storage = createStorageService({ "notes.txt": Buffer.from("notes") });

    const writer = await spaceArtifactsService(db, storage).list(spaceId, { agentId: writerId, limit: 20 });
    expect(writer.artifacts.map((artifact) => artifact.title)).toEqual(["Review Notes"]);

    const original = await spaceArtifactsService(db, storage).list(spaceId, {
      agentId: "33333333-3333-4333-8333-333333333333",
      limit: 20,
    });
    expect(original.artifacts.map((artifact) => artifact.title)).toEqual(["direct-video.mp4", "Primary Cut", "notes.txt"]);
    expect(new Set(original.artifacts.map((artifact) => artifact.createdByAgent?.id)))
      .toEqual(new Set(["33333333-3333-4333-8333-333333333333"]));

    const foreign = await spaceArtifactsService(db, storage).list(spaceId, {
      agentId: "44444444-4444-4444-8444-444444444444",
      limit: 20,
    });
    expect(foreign.artifacts).toEqual([]);
  });

  it("deduplicates work product attachments beyond the work product fetch window", async () => {
    const { spaceId, projectId, issueId } = await seedArtifacts();
    const dedupedAttachmentId = "abababab-abab-4bab-8bab-abababababab";

    await db.insert(assets).values({
      id: "acacacac-acac-4cac-8cac-acacacacacac",
      spaceId,
      provider: "local_disk",
      objectKey: "late-render.mp4",
      contentType: "video/mp4",
      byteSize: 500,
      sha256: "sha256-late-render",
      originalFilename: "late-render.mp4",
      createdByAgentId: "33333333-3333-4333-8333-333333333333",
    });
    await db.insert(issueAttachments).values({
      id: dedupedAttachmentId,
      spaceId,
      issueId,
      assetId: "acacacac-acac-4cac-8cac-acacacacacac",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
    });

    const fillerWorkProducts = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      spaceId,
      projectId,
      issueId,
      type: "artifact" as const,
      provider: "outpost",
      title: `Filler Video ${index + 1}`,
      status: "ready_for_review" as const,
      summary: "Filler artifact to push the attachment-backed work product past the fetch window",
      metadata: { contentType: "video/mp4" },
      createdByRunId: "99999999-9999-4999-8999-999999999999",
      updatedAt: new Date(`2026-01-10T00:${String(index).padStart(2, "0")}:00.000Z`),
    }));
    await db.insert(issueWorkProducts).values([
      ...fillerWorkProducts,
      {
        id: "adadadad-adad-4dad-8dad-adadadadadad",
        spaceId,
        projectId,
        issueId,
        type: "artifact",
        provider: "outpost",
        title: "Late Render",
        status: "ready_for_review",
        summary: "Attachment-backed work product outside the limited fetch window",
        metadata: {
          attachmentId: dedupedAttachmentId,
          contentType: "video/mp4",
          byteSize: 500,
          contentPath: `/api/attachments/${dedupedAttachmentId}/content`,
          openPath: `/api/attachments/${dedupedAttachmentId}/content`,
          downloadPath: `/api/attachments/${dedupedAttachmentId}/content?download=1`,
          originalFilename: "late-render.mp4",
        },
        createdByRunId: "99999999-9999-4999-8999-999999999999",
        updatedAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    ]);

    const result = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      kind: "video",
      limit: 20,
    });

    expect(result.artifacts.some((artifact) => artifact.title === "late-render.mp4")).toBe(false);
  });

  it("does not project a foreign agent from a malformed work product run reference", async () => {
    const { spaceId, issueId, otherRunId } = await seedArtifacts();

    await db.insert(issueWorkProducts).values({
      id: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
      spaceId,
      issueId,
      type: "artifact",
      provider: "outpost",
      title: "Forged Run Artifact",
      status: "ready_for_review",
      summary: "Historically malformed run attribution",
      metadata: { contentType: "text/plain" },
      createdByRunId: otherRunId,
      updatedAt: new Date("2026-01-10T00:00:00.000Z"),
    });

    const result = await spaceArtifactsService(db, createStorageService()).list(spaceId, { limit: 20 });
    const forged = result.artifacts.find((artifact) => artifact.title === "Forged Run Artifact");

    expect(forged).toBeTruthy();
    expect(forged?.createdByAgent).toBeNull();
    expect(result.artifacts.some((artifact) => artifact.createdByAgent?.name === "Other")).toBe(false);
  });

  it("does not leak foreign issue or project metadata through malformed artifact link rows", async () => {
    const { spaceId, otherSpaceId, otherIssueId } = await seedArtifacts();
    const foreignProjectId = "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b";
    const malformedAttachmentId = "1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c";

    await db.insert(projects).values({
      id: foreignProjectId,
      spaceId: otherSpaceId,
      name: "Foreign Project",
      status: "in_progress",
    });
    await db.update(issues).set({ projectId: foreignProjectId }).where(eq(issues.id, otherIssueId));
    await db.insert(documents).values({
      id: "1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d",
      spaceId,
      title: "Forged Link Document",
      latestBody: "This row is space-owned but points at a foreign issue.",
      createdByAgentId: "33333333-3333-4333-8333-333333333333",
      updatedAt: new Date("2026-01-30T00:00:00.000Z"),
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId: otherIssueId,
      documentId: "1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d",
      key: "forged-link-document",
    });
    await db.insert(assets).values({
      id: "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e",
      spaceId,
      provider: "local_disk",
      objectKey: "forged-link.txt",
      contentType: "text/plain",
      byteSize: 42,
      sha256: "sha256-forged-link",
      originalFilename: "forged-link.txt",
      createdByAgentId: "33333333-3333-4333-8333-333333333333",
    });
    await db.insert(issueAttachments).values({
      id: malformedAttachmentId,
      spaceId,
      issueId: otherIssueId,
      assetId: "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e",
      updatedAt: new Date("2026-01-29T00:00:00.000Z"),
    });
    await db.insert(issueWorkProducts).values({
      id: "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f",
      spaceId,
      issueId: otherIssueId,
      type: "artifact",
      provider: "outpost",
      title: "Forged Link Work Product",
      status: "ready_for_review",
      summary: "This row is space-owned but points at a foreign issue.",
      metadata: { contentType: "text/plain" },
      createdByRunId: "99999999-9999-4999-8999-999999999999",
      updatedAt: new Date("2026-01-28T00:00:00.000Z"),
    });

    const flat = await spaceArtifactsService(db, createStorageService()).list(spaceId, { limit: 20 });
    expect(flat.artifacts.map((artifact) => artifact.title)).not.toEqual(expect.arrayContaining([
      "Forged Link Document",
      "forged-link.txt",
      "Forged Link Work Product",
    ]));
    expect(flat.artifacts.some((artifact) => artifact.issue.identifier === "OTH-1")).toBe(false);
    expect(flat.artifacts.some((artifact) => artifact.issue.title === "Other output")).toBe(false);
    expect(flat.artifacts.some((artifact) => artifact.project?.name === "Foreign Project")).toBe(false);

    const grouped = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      limit: 20,
    });
    expect(grouped.groups?.some((group) => group.issue.identifier === "OTH-1")).toBe(false);
    expect(grouped.groups?.some((group) => group.issue.title === "Other output")).toBe(false);
    expect(grouped.groups?.some((group) =>
      group.previewArtifacts.some((artifact) => artifact.project?.name === "Foreign Project")
    )).toBe(false);

    const selectedForeignGroup = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      groupIssueId: otherIssueId,
      limit: 20,
    });
    expect(selectedForeignGroup).toEqual({
      artifacts: [],
      selectedGroup: null,
      nextCursor: null,
    });
  });

  it("groups artifacts by task after applying media, project, and search filters", async () => {
    const { spaceId, projectId, issueId } = await seedArtifacts();
    const storage = createStorageService({ "notes.txt": Buffer.from("Searchable notes preview") });

    const grouped = await spaceArtifactsService(db, storage).list(spaceId, {
      groupBy: "task",
      limit: 10,
    });
    expect(grouped.artifacts).toEqual([]);
    expect(grouped.nextCursor).toBeNull();
    expect(grouped.groups?.map((group) => ({
      issue: group.issue.identifier,
      count: group.count,
      mediaKinds: group.mediaKinds,
      href: group.href,
    }))).toEqual([
      {
        issue: "PAP-2",
        count: 1,
        mediaKinds: ["document"],
        href: "/PAP/artifacts?groupBy=task&groupIssueId=77777777-7777-4777-8777-777777777777",
      },
      {
        issue: "PAP-1",
        count: 3,
        mediaKinds: ["video", "text"],
        href: "/PAP/artifacts?groupBy=task&groupIssueId=66666666-6666-4666-8666-666666666666",
      },
    ]);
    expect(grouped.groups?.find((group) => group.issue.id === issueId)?.previewArtifacts.map((artifact) => artifact.title))
      .toEqual(["direct-video.mp4", "Primary Cut", "notes.txt"]);

    const projectVideos = await spaceArtifactsService(db, storage).list(spaceId, {
      groupBy: "task",
      projectId,
      kind: "video",
      limit: 10,
    });
    expect(projectVideos.groups?.map((group) => ({
      issue: group.issue.identifier,
      count: group.count,
      href: group.href,
    }))).toEqual([
      {
        issue: "PAP-1",
        count: 2,
        href:
          "/PAP/artifacts?groupBy=task&groupIssueId=66666666-6666-4666-8666-666666666666&kind=video&projectId=55555555-5555-4555-8555-555555555555",
      },
    ]);

    const search = await spaceArtifactsService(db, storage).list(spaceId, {
      groupBy: "task",
      q: "review document",
      limit: 10,
    });
    expect(search.groups?.map((group) => ({ issue: group.issue.identifier, count: group.count }))).toEqual([
      { issue: "PAP-2", count: 1 },
    ]);
  });

  it("paginates grouped task lists with the active group cursor", async () => {
    const { spaceId } = await seedArtifacts();

    const firstPage = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      limit: 1,
    });
    expect(firstPage.groups?.map((group) => group.issue.identifier)).toEqual(["PAP-2"]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      limit: 10,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.groups?.map((group) => group.issue.identifier)).toEqual(["PAP-1"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("groups parent-task artifacts under the topmost same-space ancestor", async () => {
    const { spaceId, issueId, secondIssueId } = await seedArtifacts();
    const grandchildIssueId = "21212121-2121-4212-8121-212121212121";
    const grandchildAttachmentId = "23232323-2323-4232-8232-232323232323";

    await db.update(issues).set({ parentId: issueId }).where(eq(issues.id, secondIssueId));
    await db.insert(issues).values({
      id: grandchildIssueId,
      spaceId,
      parentId: secondIssueId,
      identifier: "PAP-3",
      title: "Grandchild render",
      status: "done",
      priority: "medium",
    });
    await db.insert(assets).values({
      id: "24242424-2424-4242-8242-242424242424",
      spaceId,
      provider: "local_disk",
      objectKey: "grandchild.txt",
      contentType: "text/plain",
      byteSize: 48,
      sha256: "sha256-grandchild",
      originalFilename: "grandchild.txt",
      createdByAgentId: "33333333-3333-4333-8333-333333333333",
    });
    await db.insert(issueAttachments).values({
      id: grandchildAttachmentId,
      spaceId,
      issueId: grandchildIssueId,
      assetId: "24242424-2424-4242-8242-242424242424",
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    });

    const grouped = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "parent_task",
      limit: 10,
    });

    expect(grouped.artifacts).toEqual([]);
    expect(grouped.groups?.map((group) => ({
      issue: group.issue.identifier,
      count: group.count,
      previewTitles: group.previewArtifacts.map((artifact) => artifact.title),
    }))).toEqual([
      {
        issue: "PAP-1",
        count: 5,
        previewTitles: ["grandchild.txt", "Review Notes", "direct-video.mp4"],
      },
    ]);
  });

  it("returns selected group artifact pages and metadata without leaking foreign group issues", async () => {
    const { spaceId, issueId, otherIssueId } = await seedArtifacts();

    const selected = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      groupIssueId: issueId,
      limit: 2,
    });
    expect(selected.groups).toBeUndefined();
    expect(selected.selectedGroup).toMatchObject({
      id: `task:${issueId}`,
      groupBy: "task",
      issue: { identifier: "PAP-1" },
      count: 3,
    });
    expect(selected.artifacts.map((artifact) => artifact.title)).toEqual(["direct-video.mp4", "Primary Cut"]);
    expect(selected.nextCursor).toEqual(expect.any(String));

    const selectedSecondPage = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      groupIssueId: issueId,
      limit: 10,
      cursor: selected.nextCursor ?? undefined,
    });
    expect(selectedSecondPage.artifacts.map((artifact) => artifact.title)).toEqual(["notes.txt"]);

    const selectedEmptyByFilter = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      groupIssueId: issueId,
      q: "does-not-match-this-stack",
      limit: 10,
    });
    expect(selectedEmptyByFilter.selectedGroup).toMatchObject({
      id: `task:${issueId}`,
      count: 0,
    });
    expect(selectedEmptyByFilter.artifacts).toEqual([]);

    const foreignSelected = await spaceArtifactsService(db, createStorageService()).list(spaceId, {
      groupBy: "task",
      groupIssueId: otherIssueId,
      limit: 10,
    });
    expect(foreignSelected).toEqual({
      artifacts: [],
      selectedGroup: null,
      nextCursor: null,
    });
  });
});

describe("space artifacts route authorization", () => {
  it("rejects agent access across space boundaries before reading artifacts", async () => {
    const app = express();
    app.use((_req, _res, next) => {
      (_req as any).actor = {
        type: "agent",
        agentId: "agent-1",
        spaceId: "space-allowed",
      };
      next();
    });
    app.use("/api/spaces", spaceRoutes({} as any, createStorageService()));
    app.use(errorHandler);

    const res = await request(app).get("/api/spaces/space-denied/artifacts");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Agent key cannot access another space");
  });
});
