import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { agentLifecycleSpaceDeletion } from "../modules/agent-lifecycle/space-deletion.js";
import { createAgentLifecycle, configureAgentLifecycle } from "../services/agent-lifecycle.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyPendingMigrations,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  chatEndpoints,
  chatConversations,
  chatPublications,
  chatDiscordCommandOwners,
  toolApplications,
  toolConnections,
  activityLog,
  agents,
  spaces,
  spaceSkills,
  createDb,
  documents,
  documentRevisions,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issueExecutionDecisions,
  issueReadStates,
  issues,
  routines,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.ts";
import { spaceService } from "../services/space-service.ts";

const external = resolveExternalTestDatabaseUrl("OUTPOST_CLEANUP_TEST_DATABASE_URL");
const embeddedPostgresSupport = external ? { supported: true, reason: undefined } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping cleanup removal service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("cleanup removal services", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (!external) tempDb = await startEmbeddedPostgresTestDatabase("outpost-cleanup-removal-");
    if (external) await applyPendingMigrations(external);
    db = createDb(external ?? tempDb!.connectionString);
    configureAgentLifecycle(db, { requiredPluginIds: async () => [], runPlugin: async () => "complete", runHost: async () => "complete" });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(chatEndpoints);
    await db.delete(chatDiscordCommandOwners);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(issueReadStates);
    await db.delete(issueComments);
    await db.delete(issueExecutionDecisions);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(spaceSkills);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(routines);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  async function seedFixture() {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const issuePrefix = `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "CodexCoder",
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
      title: "Regression fixture",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      createdByUserId: "user-1",
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      invocationSource: "assignment",
      status: "completed",
      contextSnapshot: { issueId },
    });

    return { agentId, spaceId, issueId, runId };
  }

  it("removes agent-owned issue comments and run-linked activity before deleting the agent", async () => {
    const { agentId, spaceId, issueId, runId } = await seedFixture();

    await db.insert(issueComments).values({
      id: randomUUID(),
      spaceId,
      issueId,
      authorAgentId: agentId,
      body: "Agent-authored comment",
    });

    await db.insert(activityLog).values({
      id: randomUUID(),
      spaceId,
      actorType: "agent",
      actorId: agentId,
      action: "heartbeat.completed",
      entityType: "issue",
      entityId: issueId,
      runId,
      details: {},
    });

    await db.insert(issueExecutionDecisions).values({
      id: randomUUID(),
      spaceId,
      issueId,
      stageId: randomUUID(),
      stageType: "review",
      actorAgentId: agentId,
      outcome: "approved",
      body: "Looks good",
      createdByRunId: runId,
    });

    await db.update(agents).set({ status: "terminated", lifecycleState: "terminated" }).where(eq(agents.id, agentId));
    const removed = await agentService(db).remove(agentId);

    expect(removed?.id).toBe(agentId);
    await expect(db.select().from(agents).where(eq(agents.id, agentId))).resolves.toHaveLength(0);
    await expect(db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId))).resolves.toHaveLength(0);
    await expect(db.select().from(issueComments).where(eq(issueComments.issueId, issueId))).resolves.toHaveLength(0);
    await expect(db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).resolves.toHaveLength(0);
  });

  it("removes issue read states and activity rows before deleting the space", async () => {
    const { spaceId, issueId, runId } = await seedFixture();
    const documentId = randomUUID();
    const revisionId = randomUUID();

    await db.insert(issueReadStates).values({
      id: randomUUID(),
      spaceId,
      issueId,
      userId: "user-1",
    });

    await db.insert(spaceSkills).values({
      id: randomUUID(),
      spaceId,
      key: "outpost/outpost/outpost",
      slug: "outpost",
      name: "Outpost",
      markdown: "# Outpost",
    });

    await db.insert(activityLog).values({
      id: randomUUID(),
      spaceId,
      actorType: "system",
      actorId: "system",
      action: "run.created",
      entityType: "run",
      entityId: runId,
      runId,
      details: {},
    });

    await db.insert(documents).values({
      id: documentId,
      spaceId,
      title: "Run summary",
      latestBody: "body",
      latestRevisionId: revisionId,
      latestRevisionNumber: 1,
      createdByAgentId: null,
      createdByUserId: "user-1",
      updatedByAgentId: null,
      updatedByUserId: "user-1",
    });

    await db.insert(issueDocuments).values({
      id: randomUUID(),
      spaceId,
      issueId,
      documentId,
      key: "summary",
    });

    await db.insert(documentRevisions).values({
      id: revisionId,
      spaceId,
      documentId,
      revisionNumber: 1,
      title: "Run summary",
      format: "markdown",
      body: "body",
      createdByAgentId: null,
      createdByUserId: "user-1",
      createdByRunId: runId,
    });

    const removed = await spaceService(db).remove(spaceId);

    expect(removed?.id).toBe(spaceId);
    await expect(db.select().from(spaces).where(eq(spaces.id, spaceId))).resolves.toHaveLength(0);
    await expect(db.select().from(issues).where(eq(issues.id, issueId))).resolves.toHaveLength(0);
    await expect(db.select().from(spaceSkills).where(eq(spaceSkills.spaceId, spaceId))).resolves.toHaveLength(0);
    await expect(db.select().from(documents).where(eq(documents.id, documentId))).resolves.toHaveLength(0);
    await expect(db.select().from(documentRevisions).where(eq(documentRevisions.id, revisionId))).resolves.toHaveLength(0);
    await expect(db.select().from(issueReadStates).where(eq(issueReadStates.spaceId, spaceId))).resolves.toHaveLength(0);
    await expect(db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).resolves.toHaveLength(0);
  });

  it("removes heartbeat events by run id before deleting space-owned runs", async () => {
    const { agentId, spaceId, runId } = await seedFixture();
    const otherSpaceId = randomUUID();

    await db.insert(spaces).values({
      id: otherSpaceId,
      name: "Other Space",
      issuePrefix: `O${otherSpaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(heartbeatRunEvents).values({
      spaceId: otherSpaceId,
      runId,
      agentId,
      seq: 1,
      eventType: "output",
      message: "event with mismatched space scope",
    });

    const removed = await spaceService(db).remove(spaceId);

    expect(removed?.id).toBe(spaceId);
    await expect(db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId))).resolves.toHaveLength(0);
    await expect(db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, runId))).resolves.toHaveLength(0);
    await expect(db.select().from(spaces).where(eq(spaces.id, otherSpaceId))).resolves.toHaveLength(1);
  });

  it("removes routines before deleting space agents", async () => {
    const { agentId, spaceId } = await seedFixture();
    const routineId = randomUUID();

    await db.insert(routines).values({
      id: routineId,
      spaceId,
      title: "Daily cleanup",
      assigneeAgentId: agentId,
    });

    const removed = await spaceService(db).remove(spaceId);

    expect(removed?.id).toBe(spaceId);
    await expect(db.select().from(routines).where(eq(routines.id, routineId))).resolves.toHaveLength(0);
    await expect(db.select().from(agents).where(eq(agents.id, agentId))).resolves.toHaveLength(0);
    await expect(db.select().from(spaces).where(eq(spaces.id, spaceId))).resolves.toHaveLength(0);
  });
  async function seedEndpoint(spaceId: string, agentId: string, issueId: string) {
    const [app] = await db.insert(toolApplications).values({ spaceId, name: "Discord", type: "chat" }).returning();
    const [connection] = await db.insert(toolConnections).values({
      spaceId, applicationId: app.id, uid: randomUUID(), name: "Discord", transport: "chat_sdk", connectionPurpose: "channel",
    }).returning();
    const [endpoint] = await db.insert(chatEndpoints).values({
      spaceId, connectionId: connection.id, provider: "discord", publicId: randomUUID(), assignedAgentId: agentId,
    }).returning();
    const [conversation] = await db.insert(chatConversations).values({
      spaceId, endpointId: endpoint.id, issueId, externalConversationId: randomUUID(), externalLabel: "Saved chat",
    }).returning();
    await db.insert(chatPublications).values({
      spaceId, endpointId: endpoint.id, conversationId: conversation.id, issueId,
      idempotencyKey: randomUUID(), payload: { text: "Saved response" }, state: "published",
    });
    return endpoint;
  }

  it("deletes space endpoints before their agents while preserving other spaces and ownership tombstones", async () => {
    const first = await seedFixture(), second = await seedFixture();
    const endpoint = await seedEndpoint(first.spaceId, first.agentId, first.issueId);
    const other = await seedEndpoint(second.spaceId, second.agentId, second.issueId);
    const [owner] = await db.insert(chatDiscordCommandOwners).values({
      applicationId: String(1_400_000_000_000_000_000n + BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 12))),
      spaceId: first.spaceId, endpointId: endpoint.id, actionId: randomUUID(),
    }).returning();
    await spaceService(db).remove(first.spaceId);
    expect(await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id))).toEqual([]);
    expect(await db.select().from(chatConversations).where(eq(chatConversations.spaceId, first.spaceId))).toEqual([]);
    expect(await db.select().from(chatPublications).where(eq(chatPublications.spaceId, first.spaceId))).toEqual([]);
    expect(await db.select().from(agents).where(eq(agents.spaceId, first.spaceId))).toEqual([]);
    expect(await db.select().from(spaces).where(eq(spaces.id, first.spaceId))).toEqual([]);
    expect(await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, other.id))).toEqual([other]);
    expect(await db.select().from(chatDiscordCommandOwners).where(eq(chatDiscordCommandOwners.applicationId, owner.applicationId))).toEqual([owner]);
  });

  it("rolls back endpoint cleanup when the later agent deletion fails", async () => {
    const f = await seedFixture();
    const endpoint = await seedEndpoint(f.spaceId, f.agentId, f.issueId);
    vi.spyOn(agentLifecycleSpaceDeletion, "deleteSpaceData").mockImplementationOnce(async tx => {
      expect(await tx.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id))).toEqual([]);
      throw new Error("agent deletion failed");
    });
    await expect(spaceService(db).remove(f.spaceId)).rejects.toThrow("agent deletion failed");
    expect(await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id))).toEqual([endpoint]);
    expect(await db.select().from(chatConversations).where(eq(chatConversations.endpointId, endpoint.id))).toHaveLength(1);
    expect(await db.select().from(chatPublications).where(eq(chatPublications.endpointId, endpoint.id))).toHaveLength(1);
    expect(await db.select().from(spaces).where(eq(spaces.id, f.spaceId))).toHaveLength(1);
    expect(await db.select().from(agents).where(eq(agents.id, f.agentId))).toHaveLength(1);
  });

});
