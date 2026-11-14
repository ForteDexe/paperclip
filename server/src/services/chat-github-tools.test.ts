import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  chatMessageLinks,
  spaces,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
  runIdentityContexts,
  toolApplications,
  toolConnections,
} from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { GITHUB_BOT_TOOLS, githubGuestBotConnectionForSession } from "./chat-github-tools.js";

describe("GitHub review tool contract", () => {
  it("discovers the repository-specific finding category constraint", () => {
    const submit = GITHUB_BOT_TOOLS.find(tool => tool.name === "submit_review")!;
    expect(submit.schema).toMatchObject({
      properties: {
        findings: {
          items: {
            properties: {
              category: {
                description: expect.stringContaining("begin_review.findingCategories"),
              },
            },
          },
        },
      },
    });
    expect(submit.schema).not.toHaveProperty("properties.findings.items.properties.category.enum");
  });
  it("tells new bots which review sections Outpost renders", () => {
    const submit = GITHUB_BOT_TOOLS.find(tool => tool.name === "submit_review")!;
    const properties = submit.schema.properties!;
    expect(properties.summary).toMatchObject({
      description: expect.stringContaining("Review body only"),
      maxLength: 24000,
    });
    expect(properties.summary).toMatchObject({
      description: expect.stringContaining("Outpost adds"),
    });
    expect(properties.rationale).toMatchObject({
      description: expect.stringContaining("Do not repeat the summary"),
      maxLength: 12000,
    });
  });
});

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("GitHub guest bot connection discovery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("outpost-github-guest-");
    db = createDb(database.connectionString);
  }, 30_000);
  afterAll(async () => { await database?.cleanup(); }, 60_000);

  async function fixture() {
    const [space] = await db.insert(spaces).values({ name: "Guest discovery", issuePrefix: randomUUID().slice(0, 8) }).returning();
    const [first, second] = await db.insert(agents).values([
      { spaceId: space.id, name: "First agent", role: "general", adapterType: "codex_local" },
      { spaceId: space.id, name: "Second agent", role: "general", adapterType: "codex_local" },
    ]).returning();
    const [issue, other] = await db.insert(issues).values([
      { spaceId: space.id, title: "Reassigned task", assigneeAgentId: second.id },
      { spaceId: space.id, title: "Other task", assigneeAgentId: second.id },
    ]).returning();
    return { space, first, second, issue, other };
  }

  async function continuation(f: Awaited<ReturnType<typeof fixture>>, parent: { agentId: string; issueId: string }) {
    const [source, continued] = await db.insert(heartbeatRuns).values([
      { spaceId: f.space.id, agentId: parent.agentId, status: "succeeded", nativeIssueId: parent.issueId, contextSnapshot: {}, responsibleUserId: "requester" },
      { spaceId: f.space.id, agentId: f.second.id, status: "running", nativeIssueId: f.issue.id, contextSnapshot: {}, responsibleUserId: "requester" },
    ]).returning();
    const [origin] = await db.insert(runIdentityContexts).values({ spaceId: f.space.id, runId: source.id, revision: 1, responsibleUserId: "requester", cause: "dispatch", correlationId: "dispatch" }).returning();
    const [context] = await db.insert(runIdentityContexts).values({ spaceId: f.space.id, runId: continued.id, revision: 1, responsibleUserId: "requester", parentContextId: origin.id, cause: "dispatch", correlationId: "dispatch" }).returning();
    await db.update(heartbeatRuns).set({ activeIdentityContextId: context.id }).where(eq(heartbeatRuns.id, continued.id));
    return { spaceId: f.space.id, agentId: f.second.id, runId: continued.id, issueId: f.issue.id };
  }

  async function guestSource(f: Awaited<ReturnType<typeof fixture>>, guest: boolean) {
    const endpointId = randomUUID();
    const [application] = await db.insert(toolApplications).values({ spaceId: f.space.id, applicationKey: `chat:github:${endpointId}`, name: `GitHub ${endpointId}`, type: "chat", status: "active" }).returning();
    const [connection] = await db.insert(toolConnections).values({ spaceId: f.space.id, applicationId: application.id, name: "GitHub", uid: `chat-github-${endpointId}`, connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true }).returning();
    await db.insert(chatEndpoints).values({ id: endpointId, spaceId: f.space.id, connectionId: connection.id, provider: "github", publicId: randomUUID(), assignedAgentId: f.second.id, status: "active" });
    const [conversation] = await db.insert(chatConversations).values({ spaceId: f.space.id, endpointId, issueId: f.issue.id, externalConversationId: `github:owner/repo:${endpointId}`, externalLabel: "Guest thread" }).returning();
    const [comment] = await db.insert(issueComments).values({ spaceId: f.space.id, issueId: f.issue.id, authorType: "user", authorUserId: "requester", body: "Please review" }).returning();
    const [delivery] = await db.insert(chatDeliveries).values({ spaceId: f.space.id, endpointId, conversationId: conversation.id, providerEventId: randomUUID(), deduplicationKey: randomUUID(), eventKind: "message", normalizedEvent: { githubAuthority: { guest } }, state: "processed" }).returning();
    await db.insert(chatMessageLinks).values({ spaceId: f.space.id, endpointId, conversationId: conversation.id, deliveryId: delivery.id, commentId: comment.id, providerMessageId: randomUUID(), direction: "inbound" });
    return { connectionId: connection.id, commentId: comment.id };
  }

  async function sponsoredRun(f: Awaited<ReturnType<typeof fixture>>, commentId: string) {
    const [run] = await db.insert(heartbeatRuns).values({ spaceId: f.space.id, agentId: f.second.id, status: "running", nativeIssueId: f.issue.id, contextSnapshot: {}, responsibleUserId: "requester" }).returning();
    const [context] = await db.insert(runIdentityContexts).values({ spaceId: f.space.id, runId: run.id, revision: 1, responsibleUserId: "requester", messageId: commentId, cause: "instruction", correlationId: "message" }).returning();
    await db.update(heartbeatRuns).set({ activeIdentityContextId: context.id }).where(eq(heartbeatRuns.id, run.id));
    return { spaceId: f.space.id, agentId: f.second.id, runId: run.id, issueId: f.issue.id };
  }

  it.each(["agent", "task"])("finds no guest sponsor when the run chain continues another %s", async (fault) => {
    const f = await fixture();
    const session = await continuation(f, fault === "agent"
      ? { agentId: f.first.id, issueId: f.issue.id }
      : { agentId: f.second.id, issueId: f.other.id });
    expect(await githubGuestBotConnectionForSession(db, session)).toBeNull();
  });

  it("still refuses a guest-sponsored task whose run chain continues another agent", async () => {
    const f = await fixture();
    await guestSource(f, true);
    const session = await continuation(f, { agentId: f.first.id, issueId: f.issue.id });
    await expect(githubGuestBotConnectionForSession(db, session)).rejects.toMatchObject({ status: 403 });
  });

  it.each([true, false])("resolves the bot connection only for a run sponsored by a GitHub guest (guest=%s)", async (guest) => {
    const f = await fixture();
    const source = await guestSource(f, guest);
    const session = await sponsoredRun(f, source.commentId);
    expect(await githubGuestBotConnectionForSession(db, session)).toBe(guest ? source.connectionId : null);
  });
});
