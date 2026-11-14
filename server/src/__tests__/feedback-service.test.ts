import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  documentRevisions,
  documents,
  feedbackExports,
  feedbackVotes,
  issueComments,
  issueDocuments,
  issues,
} from "@outpost/db";
import { feedbackService } from "../services/feedback.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres feedback service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("feedbackService local votes", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof feedbackService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("outpost-feedback-service-");
    db = createDb(started.connectionString);
    svc = feedbackService(db);
    tempDb = started;
  }, 120_000);

  afterEach(async () => {
    await db.delete(feedbackExports);
    await db.delete(feedbackVotes);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
  });

  async function seedIssue() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Outpost",
      issuePrefix: `O${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Rocky",
      role: "worker",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Local feedback",
      status: "todo",
      priority: "medium",
      createdByUserId: "user-1",
    });
    return { companyId, agentId, issueId };
  }

  async function seedAgentComment() {
    const seeded = await seedIssue();
    const commentId = randomUUID();
    await db.insert(issueComments).values({
      id: commentId,
      companyId: seeded.companyId,
      issueId: seeded.issueId,
      authorAgentId: seeded.agentId,
      body: "Agent result",
    });
    return { ...seeded, commentId };
  }

  it("stores feedback locally without creating an export trace", async () => {
    const { issueId, commentId } = await seedAgentComment();

    const vote = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "up",
      authorUserId: "user-1",
    });

    expect(vote).toMatchObject({
      issueId,
      targetId: commentId,
      vote: "up",
      reason: null,
    });
    expect(await svc.listIssueVotesForUser(issueId, "user-1")).toHaveLength(1);
    expect(await db.select().from(feedbackExports)).toEqual([]);
  });

  it("upserts one local vote and normalizes the optional downvote reason", async () => {
    const { issueId, commentId } = await seedAgentComment();
    const first = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "down",
      reason: "  Missing the edge case.  ",
      authorUserId: "user-1",
    });
    const second = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "up",
      reason: "ignored for an upvote",
      authorUserId: "user-1",
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ vote: "up", reason: null });
    expect(await svc.listIssueVotesForUser(issueId, "user-1")).toHaveLength(1);
  });

  it("supports an agent-authored document revision target", async () => {
    const { companyId, agentId, issueId } = await seedIssue();
    const documentId = randomUUID();
    const revisionId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Plan",
      format: "markdown",
      latestBody: "Agent plan",
      latestRevisionId: revisionId,
      latestRevisionNumber: 1,
      createdByAgentId: agentId,
      updatedByAgentId: agentId,
    });
    await db.insert(documentRevisions).values({
      id: revisionId,
      companyId,
      documentId,
      revisionNumber: 1,
      body: "Agent plan",
      createdByAgentId: agentId,
    });
    await db.insert(issueDocuments).values({
      companyId,
      issueId,
      documentId,
      key: "plan",
    });

    await expect(
      svc.saveIssueVote({
        issueId,
        targetType: "issue_document_revision",
        targetId: revisionId,
        vote: "up",
        authorUserId: "user-1",
      }),
    ).resolves.toMatchObject({ targetId: revisionId, vote: "up" });
  });

  it("rejects feedback on human-authored comments", async () => {
    const { companyId, issueId } = await seedIssue();
    const commentId = randomUUID();
    await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId,
      authorUserId: "user-1",
      body: "Human comment",
    });

    await expect(
      svc.saveIssueVote({
        issueId,
        targetType: "issue_comment",
        targetId: commentId,
        vote: "up",
        authorUserId: "user-1",
      }),
    ).rejects.toThrow("Feedback voting is only available on agent-authored issue comments");
  });
});
