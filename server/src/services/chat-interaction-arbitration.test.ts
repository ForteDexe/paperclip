import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  chatConversations,
  chatEndpoints,
  chatPublications,
  spaces,
  createDb,
  heartbeatRuns,
  issues,
  issueThreadInteractions,
  toolApplications,
  toolConnections,
} from "@outpost/db";
import { startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { resolveExternalTestDatabaseUrl } from "../__tests__/helpers/external-test-database.js";
import { hasChatRunOwnedProviderInteraction } from "./chat-interaction-arbitration.js";

const externalDatabaseUrl = resolveExternalTestDatabaseUrl("OUTPOST_ARBITRATION_TEST_DATABASE_URL");

describe("provider-owned interaction arbitration", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    if (!externalDatabaseUrl) temporary = await startEmbeddedPostgresTestDatabase("chat-interaction-owner-");
    db = createDb(externalDatabaseUrl ?? temporary!.connectionString);
  }, 30_000);
  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
  });

  async function seed() {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const interactionId = randomUUID();
    await db
      .insert(spaces)
      .values({
        id: spaceId,
        name: "Arbitration",
        issuePrefix: `C${spaceId.slice(0, 7)}`,
      });
    await db.insert(agents).values(
      [agentId, otherAgentId].map((id) => ({
        id,
        spaceId,
        name: "Chat agent",
        adapterType: "outpost_runner",
        status: "active",
      })),
    );
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Chat response",
      status: "in_progress",
      assigneeAgentId: agentId,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "succeeded",
      contextSnapshot: { issueId, source: "chat:discord" },
    });
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      spaceId,
      issueId,
      sourceRunId: runId,
      kind: "request_confirmation",
      status: "pending",
      title: "Native completion review",
      payload: {
        version: 1,
        prompt: "Review native evidence",
        rejectRequiresReason: true,
        target: {
          type: "custom",
          key: "native_completion_review",
          label: "Completion decision",
        },
      },
    });
    return { spaceId, agentId, otherAgentId, issueId, runId, interactionId };
  }

  it("does not suppress a chat final for a system, operator, or originating agent completion review", async () => {
    const binding = await seed();
    expect(await hasChatRunOwnedProviderInteraction(db, binding)).toBe(false);
    await db
      .update(issueThreadInteractions)
      .set({ createdByUserId: "operator-user" })
      .where(eq(issueThreadInteractions.id, binding.interactionId));
    expect(await hasChatRunOwnedProviderInteraction(db, binding)).toBe(false);
    await db
      .update(issueThreadInteractions)
      .set({ createdByUserId: null, createdByAgentId: binding.agentId })
      .where(eq(issueThreadInteractions.id, binding.interactionId));
    expect(await hasChatRunOwnedProviderInteraction(db, binding)).toBe(false);
  });

  it("reserves the response slot only for a pending interaction authored by the source run agent", async () => {
    const binding = await seed();
    await db
      .update(issueThreadInteractions)
      .set({ createdByAgentId: binding.otherAgentId, payload: { version: 1, prompt: "Confirm the requested action" } })
      .where(eq(issueThreadInteractions.id, binding.interactionId));
    expect(await hasChatRunOwnedProviderInteraction(db, binding)).toBe(false);
    await db
      .update(issueThreadInteractions)
      .set({ createdByAgentId: binding.agentId })
      .where(eq(issueThreadInteractions.id, binding.interactionId));
    expect(await hasChatRunOwnedProviderInteraction(db, binding)).toBe(true);
    expect(
      await hasChatRunOwnedProviderInteraction(db, {
        ...binding,
        spaceId: randomUUID(),
      }),
    ).toBe(false);
    expect(
      await hasChatRunOwnedProviderInteraction(db, {
        ...binding,
        runId: randomUUID(),
      }),
    ).toBe(false);
    await db
      .update(issueThreadInteractions)
      .set({ status: "accepted" })
      .where(eq(issueThreadInteractions.id, binding.interactionId));
    expect(await hasChatRunOwnedProviderInteraction(db, binding)).toBe(false);
  });

  it("keeps a resolved source run internal when its actual provider prompt exists", async () => {
    const binding = await seed();
    const applicationId = randomUUID();
    const connectionId = randomUUID();
    const endpointId = randomUUID();
    const conversationId = randomUUID();
    await db.insert(toolApplications).values({
      id: applicationId,
      spaceId: binding.spaceId,
      applicationKey: `chat:discord:${endpointId}`,
      name: "Discord",
      type: "chat",
      status: "active",
    });
    await db.insert(toolConnections).values({
      id: connectionId,
      spaceId: binding.spaceId,
      applicationId,
      uid: endpointId,
      name: "Discord",
      connectionPurpose: "channel",
      transport: "chat_sdk",
      status: "active",
    });
    await db.insert(chatEndpoints).values({
      id: endpointId,
      spaceId: binding.spaceId,
      connectionId,
      provider: "discord",
      publicId: randomUUID(),
      assignedAgentId: binding.agentId,
      status: "active",
    });
    await db.insert(chatConversations).values({
      id: conversationId,
      spaceId: binding.spaceId,
      endpointId,
      issueId: binding.issueId,
      externalConversationId: "discord-thread",
      externalLabel: "Discord thread",
      state: "active",
    });
    await db
      .update(issueThreadInteractions)
      .set({ createdByAgentId: binding.agentId, status: "accepted" })
      .where(eq(issueThreadInteractions.id, binding.interactionId));
    await db.insert(chatPublications).values({
      spaceId: binding.spaceId,
      issueId: binding.issueId,
      endpointId,
      conversationId,
      idempotencyKey: `interaction:${binding.interactionId}:${endpointId}`,
      state: "published",
      payload: { text: "Confirm?", interactionId: binding.interactionId },
    });
    expect(await hasChatRunOwnedProviderInteraction(db, binding)).toBe(true);
  });
});
