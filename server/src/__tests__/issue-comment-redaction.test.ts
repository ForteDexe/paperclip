import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  assets,
  spaces,
  closeRegisteredClients,
  spaceMemberships,
  createDb,
  issueAttachments,
  issueComments,
  issueReferenceMentions,
  issues,
} from "@outpost/db";
import {
  spaceSearchQuerySchema,
  LOW_TRUST_REVIEW_PRESET,
} from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { spaceSearchService } from "../services/space-search.js";
import { buildOutpostWakePayload } from "../services/heartbeat.js";
import { issueReferenceService } from "../services/issue-references.js";
import { issueService } from "../services/issues.js";
import type { StorageService } from "../storage/types.js";

const externalTestDatabaseUrl = process.env.OUTPOST_TEST_DATABASE_URL;
const embeddedPostgresSupport = externalTestDatabaseUrl
  ? { supported: true }
  : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue comment redaction tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("deleted issue comment redaction", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    if (externalTestDatabaseUrl) {
      db = createDb(externalTestDatabaseUrl);
    } else {
      tempDb = await startEmbeddedPostgresTestDatabase(
        "outpost-comment-redaction-",
      );
      db = createDb(tempDb.connectionString);
    }
    await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"));
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueReferenceMentions);
    await db.delete(issueAttachments);
    await db.delete(issueComments);
    await db.delete(assets);
    await db.delete(issues);
    await db.delete(spaceMemberships);
    await db.delete(spaces);
  });

  afterAll(async () => {
    if (externalTestDatabaseUrl) {
      await closeRegisteredClients(externalTestDatabaseUrl);
    }
    await tempDb?.cleanup();
  });

  async function seedIssue() {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Comment Redaction Co",
      issuePrefix: `R${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      identifier: "RED-1",
      title: "Deleted comment redaction",
      status: "todo",
      priority: "medium",
    });
    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "user",
      principalId: "operator-user-1",
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    return { spaceId, issueId };
  }

  function createApp(spaceId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "operator",
        userId: "operator-user-1",
        spaceIds: [spaceId],
        memberships: [{ spaceId, membershipRole: "owner", status: "active" }],
        source: "cloud_tenant",
        // cloud_tenant actors are never instance admins — reads flow through
        // the active space membership seeded in seedIssue().
        isInstanceAdmin: false,
      };
      next();
    });
    const storage: StorageService = {
      provider: "local_disk",
      putFile: vi.fn(async () => {
        throw new Error("Unexpected storage.putFile call");
      }),
      getObject: vi.fn(async () => {
        throw new Error("Unexpected storage.getObject call");
      }),
      headObject: vi.fn(async () => ({ exists: false })),
      deleteObject: vi.fn(async () => undefined),
    };
    app.use("/api", issueRoutes(db, storage));
    app.use(errorHandler);
    return app;
  }

  it("redacts deleted comment bodies from ordinary reads, heartbeat context, and wake payloads", async () => {
    const { spaceId, issueId } = await seedIssue();
    const commentId = randomUUID();
    const deletedAt = new Date("2026-06-03T12:00:00.000Z");
    await db.insert(issueComments).values({
      id: commentId,
      spaceId,
      issueId,
      authorUserId: "operator-user-1",
      body: "secret deleted body",
      presentation: { kind: "system_notice", tone: "warning", detailsDefaultOpen: false },
      metadata: {
        version: 1,
        sections: [{ rows: [{ type: "text", text: "secret metadata" }] }],
      },
      deletedAt,
      deletedByType: "user",
      deletedByUserId: "operator-user-1",
    });

    const comments = await issueService(db).listComments(issueId, {
      order: "asc",
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: commentId,
      body: "",
      presentation: null,
      metadata: null,
      deletedAt,
      deletedByType: "user",
      deletedByUserId: "operator-user-1",
    });

    const exactComment = await issueService(db).getComment(commentId);
    expect(exactComment?.body).toBe("");
    expect(exactComment?.metadata).toBeNull();

    const heartbeatContext = await request(createApp(spaceId))
      .get(`/api/issues/${issueId}/heartbeat-context`)
      .query({ wakeCommentId: commentId });
    expect(heartbeatContext.status, JSON.stringify(heartbeatContext.body)).toBe(
      200,
    );
    expect(heartbeatContext.body.wakeComment).toMatchObject({
      id: commentId,
      body: "",
      metadata: null,
      deletedByUserId: "operator-user-1",
    });
    expect(JSON.stringify(heartbeatContext.body)).not.toContain(
      "secret deleted body",
    );
    expect(JSON.stringify(heartbeatContext.body)).not.toContain(
      "secret metadata",
    );

    const wakePayload = await buildOutpostWakePayload({
      db,
      spaceId,
      contextSnapshot: {
        issueId,
        commentId,
        wakeCommentIds: [commentId],
        wakeReason: "issue_commented",
      },
    });

    expect(wakePayload?.comments).toEqual([
      expect.objectContaining({
        id: commentId,
        body: "",
        bodyTruncated: false,
        presentation: null,
        metadata: null,
        deletedAt: deletedAt.toISOString(),
        deletedByUserId: "operator-user-1",
      }),
    ]);
    expect(JSON.stringify(wakePayload)).not.toContain("secret deleted body");
    expect(JSON.stringify(wakePayload)).not.toContain("secret metadata");
  });

  it("never includes a same-space comment from another issue in a wake payload", async () => {
    const { spaceId, issueId } = await seedIssue();
    const foreignIssueId = randomUUID();
    await db.insert(issues).values({
      id: foreignIssueId,
      spaceId,
      identifier: "RED-2",
      title: "Foreign issue",
      status: "todo",
      priority: "medium",
    });
    const [sourceComment, foreignComment] = await db
      .insert(issueComments)
      .values([
        {
          spaceId,
          issueId,
          authorUserId: "operator-user-1",
          body: "Full external instruction. TRAILING-CLAUSE: keep this exact requirement.",
        },
        {
          spaceId,
          issueId: foreignIssueId,
          authorUserId: "operator-user-1",
          body: "FOREIGN-ISSUE-SECRET must never cross the task boundary",
        },
      ])
      .returning();

    const wakePayload = await buildOutpostWakePayload({
      db,
      spaceId,
      contextSnapshot: {
        issueId,
        wakeCommentId: sourceComment!.id,
        wakeCommentIds: [sourceComment!.id, foreignComment!.id],
        wakeReason: "issue_commented",
      },
    });

    expect(wakePayload?.comments).toEqual([
      expect.objectContaining({
        id: sourceComment!.id,
        issueId,
        body: "Full external instruction. TRAILING-CLAUSE: keep this exact requirement.",
        bodyTruncated: false,
      }),
    ]);
    expect(wakePayload?.commentWindow).toEqual({
      requestedCount: 2,
      includedCount: 1,
      missingCount: 1,
    });
    expect(JSON.stringify(wakePayload)).not.toContain("FOREIGN-ISSUE-SECRET");
  });

  it("includes bounded attachment descriptors only for requested comments in the same space and issue", async () => {
    const { spaceId, issueId } = await seedIssue();
    const otherIssueId = randomUUID();
    const otherSpaceId = randomUUID();
    const otherSpaceIssueId = randomUUID();
    await db.insert(spaces).values({
      id: otherSpaceId,
      name: "Other Attachment Co",
      issuePrefix: "OAT",
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(issues).values([
      {
        id: otherIssueId,
        spaceId,
        identifier: "RED-ATT-2",
        title: "Other attachment issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: otherSpaceIssueId,
        spaceId: otherSpaceId,
        identifier: "OAT-1",
        title: "Other space attachment issue",
        status: "todo",
        priority: "medium",
      },
    ]);
    const [
      sourceComment,
      unrequestedComment,
      quarantinedComment,
      otherIssueComment,
      otherSpaceComment,
    ] = await db
      .insert(issueComments)
      .values([
        {
          spaceId,
          issueId,
          authorUserId: "operator-user-1",
          body: "Inspect the attached evidence.",
        },
        {
          spaceId,
          issueId,
          authorUserId: "operator-user-1",
          body: "Same task, not part of this wake.",
        },
        {
          spaceId,
          issueId,
          body: "Quarantined file instructions.",
          sourceTrust: {
            preset: LOW_TRUST_REVIEW_PRESET,
            disposition: "quarantined",
            sourceIssueId: issueId,
          },
        },
        {
          spaceId,
          issueId: otherIssueId,
          authorUserId: "operator-user-1",
          body: "Other task.",
        },
        {
          spaceId: otherSpaceId,
          issueId: otherSpaceIssueId,
          authorUserId: "other-user",
          body: "Other space.",
        },
      ])
      .returning();
    const attachmentFixtures = [
      {
        spaceId,
        issueId,
        issueCommentId: sourceComment!.id,
        filename: "evidence.png",
      },
      {
        spaceId,
        issueId,
        issueCommentId: unrequestedComment!.id,
        filename: "same-task-unrequested.txt",
      },
      {
        spaceId,
        issueId,
        issueCommentId: quarantinedComment!.id,
        filename: "quarantined.txt",
      },
      {
        spaceId,
        issueId: otherIssueId,
        issueCommentId: otherIssueComment!.id,
        filename: "other-task.txt",
      },
      {
        spaceId: otherSpaceId,
        issueId: otherSpaceIssueId,
        issueCommentId: otherSpaceComment!.id,
        filename: "other-space.txt",
      },
    ];
    for (const [index, fixture] of attachmentFixtures.entries()) {
      const [asset] = await db
        .insert(assets)
        .values({
          spaceId: fixture.spaceId,
          provider: "local_disk",
          objectKey: `wake-attachment-${index}`,
          contentType: index === 0 ? "image/png" : "text/plain",
          byteSize: index === 0 ? 2048 : 128,
          sha256: `sha-${index}`,
          originalFilename: fixture.filename,
          createdByUserId: "operator-user-1",
        })
        .returning();
      await db.insert(issueAttachments).values({
        spaceId: fixture.spaceId,
        issueId: fixture.issueId,
        issueCommentId: fixture.issueCommentId,
        assetId: asset!.id,
      });
    }

    const wakePayload = await buildOutpostWakePayload({
      db,
      spaceId,
      contextSnapshot: {
        issueId,
        wakeCommentIds: [
          sourceComment!.id,
          sourceComment!.id,
          quarantinedComment!.id,
          otherIssueComment!.id,
          otherSpaceComment!.id,
        ],
        wakeReason: "issue_commented",
      },
    });

    expect(wakePayload?.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceComment!.id,
          attachments: [
            expect.objectContaining({
              filename: "evidence.png",
              contentType: "image/png",
              byteSize: 2048,
            }),
          ],
        }),
        expect.objectContaining({ id: quarantinedComment!.id }),
      ]),
    );
    expect(
      wakePayload?.comments.find(
        (comment) => comment.id === quarantinedComment!.id,
      ),
    ).not.toHaveProperty("attachments");
    expect(JSON.stringify(wakePayload)).not.toContain(
      "same-task-unrequested.txt",
    );
    expect(JSON.stringify(wakePayload)).not.toContain("other-task.txt");
    expect(JSON.stringify(wakePayload)).not.toContain("other-space.txt");
    expect(JSON.stringify(wakePayload)).not.toContain("quarantined.txt");

    const lowTrustWakePayload = await buildOutpostWakePayload({
      db,
      spaceId,
      contextSnapshot: {
        issueId,
        wakeCommentIds: [quarantinedComment!.id],
        wakeReason: "issue_commented",
      },
      exposeLowTrustRaw: true,
    });
    expect(lowTrustWakePayload?.comments).toEqual([
      expect.objectContaining({
        id: quarantinedComment!.id,
        attachments: [
          expect.objectContaining({ filename: "quarantined.txt" }),
        ],
      }),
    ]);
  });

  it("serializes comment timestamps as ISO strings through the redacted comments route (PAP-16607)", async () => {
    const { spaceId, issueId } = await seedIssue();
    const commentId = randomUUID();
    await db.insert(issueComments).values({
      id: commentId,
      spaceId,
      issueId,
      authorUserId: "operator-user-1",
      body: "ordinary comment",
    });

    const response = await request(createApp(spaceId)).get(
      `/api/issues/${issueId}/comments`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toHaveLength(1);
    // Secret redaction must not collapse Date instances to `{}` — the chat
    // renderer needs parseable timestamps.
    expect(typeof response.body[0].createdAt).toBe("string");
    expect(Number.isNaN(new Date(response.body[0].createdAt).getTime())).toBe(
      false,
    );
    expect(typeof response.body[0].updatedAt).toBe("string");
  });

  it("excludes deleted comment bodies from space search", async () => {
    const { spaceId, issueId } = await seedIssue();
    await db.insert(issueComments).values({
      spaceId,
      issueId,
      body: "vanished-search-needle",
      deletedAt: new Date("2026-06-03T12:00:00.000Z"),
      deletedByType: "user",
      deletedByUserId: "operator-user-1",
    });

    const result = await spaceSearchService(db).search(
      spaceId,
      spaceSearchQuerySchema.parse({
        q: "vanished-search-needle",
        scope: "comments",
      }),
    );

    expect(result.results).toEqual([]);
  });

  it("clears issue references sourced from deleted comment bodies", async () => {
    const spaceId = randomUUID();
    const sourceIssueId = randomUUID();
    const targetIssueId = randomUUID();
    const commentId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Reference Redaction Co",
      issuePrefix: "REF",
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(issues).values([
      {
        id: sourceIssueId,
        spaceId,
        identifier: "REF-1",
        title: "Source issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: targetIssueId,
        spaceId,
        identifier: "REF-2",
        title: "Target issue",
        status: "todo",
        priority: "medium",
      },
    ]);
    await db.insert(issueComments).values({
      id: commentId,
      spaceId,
      issueId: sourceIssueId,
      body: "Follow up in REF-2",
    });

    const refs = issueReferenceService(db);
    await refs.syncComment(commentId);
    expect(
      (await refs.listIssueReferenceSummary(sourceIssueId)).outbound.map(
        (item) => item.issue.id,
      ),
    ).toEqual([targetIssueId]);

    await db.update(issueComments).set({
      deletedAt: new Date("2026-06-03T12:00:00.000Z"),
      deletedByType: "user",
      deletedByUserId: "operator-user-1",
    });
    await refs.syncComment(commentId);

    expect(
      (await refs.listIssueReferenceSummary(sourceIssueId)).outbound,
    ).toEqual([]);
  });
});
