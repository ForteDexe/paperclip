import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "@outpost/shared";
import { createTestHarness } from "@outpost/plugin-sdk/testing";
import type { AgentSessionEvent } from "@outpost/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin, {
  agentPrompt,
  mentionHandles,
  normalizeHandle,
  normalizeRoomName,
} from "../src/worker.js";

describe("Campfire plugin", () => {
  it("declares a space-scoped database, page, sidebar, and persistent sessions", () => {
    expect(pluginManifestV1Schema.parse(manifest)).toMatchObject({
      id: "forted.campfire",
      database: {
        namespaceSlug: "campfire",
        migrationsDir: "migrations",
        coreReadTables: ["spaces", "agents", "projects"],
      },
      capabilities: expect.arrayContaining([
        "agent.sessions.create",
        "agent.sessions.send",
        "ui.page.register",
      ]),
    });
  });

  it("normalizes room names, validates handles, and scopes explicit mentions", () => {
    expect(normalizeRoomName("  Model   Training  ")).toBe("Model Training");
    expect(normalizeHandle("@rocky_model")).toBe("rocky_model");
    expect(() => normalizeHandle("rocky model")).toThrow(/Handles use/);
    expect(mentionHandles("Ask @rocky and @Claude; then ask @rocky again.")).toEqual([
      "rocky",
      "claude",
    ]);
  });

  it("creates rooms without silently creating a default General room", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<{ roomId: string }>("create-room", {
      spaceId: "4ab1fb3f-cc8f-41d2-bb32-f0be3cc46ae1",
      projectId: "a8c982f5-52c8-4c44-bdc9-94ce47fe82f5",
      name: "Backend",
    });

    expect(result.roomId).toEqual(expect.any(String));
    expect(harness.dbExecutes).toHaveLength(1);
    expect(harness.dbExecutes[0]?.sql).toContain(".rooms");
    expect(harness.dbExecutes[0]?.params).toEqual([
      result.roomId,
      "4ab1fb3f-cc8f-41d2-bb32-f0be3cc46ae1",
      "a8c982f5-52c8-4c44-bdc9-94ce47fe82f5",
      "Backend",
    ]);
  });

  it("prompts only with the new room message and relies on the persistent session", () => {
    const prompt = agentPrompt(
      {
        id: "room-1",
        space_id: "space-1",
        project_id: null,
        name: "Backend",
        created_at: "2026-11-12T00:00:00.000Z",
        updated_at: "2026-11-12T00:00:00.000Z",
      },
      {
        room_id: "room-1",
        agent_id: "agent-1",
        handle: "rocky",
        joined_at: "2026-11-12T00:00:00.000Z",
        name: "Rocky",
        status: "idle",
        adapter_type: "codex_local",
        session_id: "session-1",
      },
      "Please review the API boundary.",
    );

    expect(prompt).toContain("persistent room session");
    expect(prompt).toContain("Please review the API boundary.");
    expect(prompt).not.toContain("chat history");
  });

  it("reuses the same native agent session across room turns", async () => {
    const spaceId = "4ab1fb3f-cc8f-41d2-bb32-f0be3cc46ae1";
    const roomId = "a8c982f5-52c8-4c44-bdc9-94ce47fe82f5";
    const agentId = "05f13867-3484-4316-b4e5-1b1382ed559d";
    const harness = createTestHarness({ manifest });
    const originalExecute = harness.ctx.db.execute.bind(harness.ctx.db);
    let storedSessionId: string | null = null;
    let latestHumanBody = "";
    const savedAgentReplies: string[] = [];
    let createCalls = 0;
    let sendCalls = 0;
    let sessionCallback: ((event: AgentSessionEvent) => void) | undefined;

    harness.ctx.db.query = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM test_forted_campfire.rooms") && sql.includes("WHERE id =")) {
        return [{
          id: roomId,
          space_id: spaceId,
          project_id: null,
          name: "Backend",
          created_at: "2026-11-12T00:00:00.000Z",
          updated_at: "2026-11-12T00:00:00.000Z",
        }] as T[];
      }
      if (sql.includes("FROM test_forted_campfire.room_members") && sql.includes("JOIN public.agents")) {
        return [{
          room_id: roomId,
          agent_id: agentId,
          handle: "rocky",
          joined_at: "2026-11-12T00:00:00.000Z",
          name: "Rocky",
          status: "idle",
          adapter_type: "codex_local",
          session_id: storedSessionId,
        }] as T[];
      }
      if (sql.includes("FROM test_forted_campfire.agent_sessions")) {
        return (storedSessionId ? [{ session_id: storedSessionId }] : []) as T[];
      }
      if (sql.includes("SELECT body FROM test_forted_campfire.messages")) {
        return [{ body: latestHumanBody }] as T[];
      }
      return [];
    };
    harness.ctx.db.execute = async (sql, params) => {
      if (sql.includes("INSERT INTO test_forted_campfire.messages") && params?.[3] === "human") {
        latestHumanBody = String(params[5]);
      }
      if (sql.includes("INSERT INTO test_forted_campfire.messages") && params?.[3] === "agent") {
        savedAgentReplies.push(String(params[5]));
      }
      if (sql.includes("INSERT INTO test_forted_campfire.agent_sessions")) {
        storedSessionId = String(params?.[3]);
      }
      return originalExecute(sql, params);
    };
    harness.ctx.agents.sessions.create = async () => {
      createCalls += 1;
      return {
        sessionId: "persistent-session-1",
        agentId,
        spaceId,
        status: "active",
        createdAt: "2026-11-12T00:00:00.000Z",
      };
    };
    harness.ctx.agents.sessions.sendMessage = async (_sessionId, _spaceId, options) => {
      sendCalls += 1;
      sessionCallback = options.onEvent;
      return { runId: `run-${sendCalls}` };
    };

    await plugin.definition.setup(harness.ctx);
    await harness.performAction("send-message", {
      spaceId,
      roomId,
      body: "First turn",
    });
    sessionCallback?.({
      sessionId: "persistent-session-1",
      runId: "run-1",
      seq: 1,
      eventType: "done",
      stream: "system",
      message: "First reply",
      payload: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await harness.performAction("send-message", {
      spaceId,
      roomId,
      body: "Second turn",
    });

    expect(createCalls).toBe(1);
    expect(sendCalls).toBe(2);
    expect(storedSessionId).toBe("persistent-session-1");
    expect(savedAgentReplies).toContain("First reply");
  });
});
