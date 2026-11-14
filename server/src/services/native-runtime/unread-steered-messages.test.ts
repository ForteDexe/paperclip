import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  spaces,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueThreadInteractions,
  issues,
} from "@outpost/db";

import { readUnreadSteeredMessages } from "./unread-steered-messages.js";
import { queuedInteractionSteeringBody } from "../queued-interaction-response.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("unread steered messages", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-unread-steered-");
    db = createDb(tempDb.connectionString);
  }, 120_000);

  afterAll(async () => {
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
  });

  async function seedIssue(spaceId: string, agentId: string, issueNumber: number, prefix: string) {
    const id = randomUUID();
    await db.insert(issues).values({
      id, spaceId, title: "Steered task", status: "in_progress", priority: "medium",
      assigneeAgentId: agentId, issueNumber, identifier: `${prefix}-${issueNumber}`,
    });
    return id;
  }

  it("returns acknowledged steers the model never read, from the durable run log only", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const prefix = `S${spaceId.replaceAll("-", "").slice(0, 6)}`;
    await db.insert(spaces).values({ id: spaceId, name: "Outpost", issuePrefix: prefix, requireOperatorApprovalForNewAgents: false });
    await db.insert(agents).values({
      id: agentId, spaceId, name: "Codex", role: "engineer", status: "running",
      adapterType: "outpost_runner", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    const issueId = await seedIssue(spaceId, agentId, 1, prefix);
    const otherIssueId = await seedIssue(spaceId, agentId, 2, prefix);
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    const [read, unread, notValidated, otherIssue] = await db.insert(issueComments).values([
      { spaceId, issueId, authorUserId: "operator", body: "Already read" },
      { spaceId, issueId, authorUserId: "operator", body: "HELLO unread" },
      { spaceId, issueId, authorUserId: "operator", body: "Never acknowledged by the transport" },
      { spaceId, issueId: otherIssueId, authorUserId: "operator", body: "Another task" },
    ]).returning();
    const [interaction] = await db.insert(issueThreadInteractions).values({
      spaceId, issueId, kind: "ask_user_questions", status: "answered", effectiveResolverPolicy: "human_only",
      sourceRunId: runId, payload: { version: 1, questions: [] }, result: { version: 1, answers: [] },
    }).returning();
    let seq = 0;
    const event = (eventType: string, turnId: string, kind: string | null, itemId?: string, validated = true) => ({
      spaceId, runId, agentId, seq: ++seq, eventType, sourceEventId: validated ? randomUUID() : null,
      payload: { orpEvent: { turnId, ...(itemId ? { itemId } : {}), payload: kind ? { kind } : {} } },
    });
    await db.insert(heartbeatRunEvents).values([
      event("item.started", "t1", "userMessage", "t1:input"),
      event("item.completed", "t1", "steering_acknowledgement", `t1:steer:${read!.id}`),
      event("item.started", "t1", "userMessage", "t1:steered"),
      event("item.completed", "t1", "steering_acknowledgement", `t1:steer:${unread!.id}`),
      event("item.completed", "t1", "steering_acknowledgement", `t1:steer:${notValidated!.id}`, false),
      event("item.completed", "t1", "steering_acknowledgement", `t1:steer:${otherIssue!.id}`),
      event("item.completed", "t1", "steering_acknowledgement", `t1:steer:${interaction!.id}`),
      // A model output item alone is not read evidence.
      event("item.started", "t1", "agentMessage", "t1:message"),
      event("turn.failed", "t1", null),
    ]);

    expect(await readUnreadSteeredMessages(db, { spaceId, runId, issueId })).toEqual([
      { id: unread!.id, text: "HELLO unread" },
      { id: interaction!.id, text: queuedInteractionSteeringBody(interaction!) },
    ]);

    // The continuation's input reaches the model: nothing is delivered twice.
    await db.insert(heartbeatRunEvents).values(event("item.started", "t2", "userMessage", "t2:input"));
    expect(await readUnreadSteeredMessages(db, { spaceId, runId, issueId })).toEqual([]);
  });
});
