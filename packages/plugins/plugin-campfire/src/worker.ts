import { randomUUID } from "node:crypto";
import {
  definePlugin,
  runWorker,
  type AgentSessionEvent,
  type PluginContext,
} from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, STREAM_CHANNEL } from "./manifest.js";

type Params = Record<string, unknown>;

type RoomRow = {
  id: string;
  company_id: string;
  project_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

type MemberRow = {
  room_id: string;
  agent_id: string;
  handle: string;
  joined_at: string;
  name: string;
  status: string;
  adapter_type: string;
  session_id: string | null;
};

type MessageRow = {
  id: string;
  seq: string | number;
  room_id: string;
  author_kind: "human" | "agent" | "system";
  author_agent_id: string | null;
  author_name: string | null;
  author_handle: string | null;
  body: string;
  created_at: string;
};

function table(ctx: PluginContext, name: string): string {
  return `${ctx.db.namespace}.${name}`;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function companyId(params: Params): string {
  return requiredString(params.companyId, "companyId");
}

export function normalizeRoomName(value: unknown): string {
  const name = requiredString(value, "name").replace(/\s+/g, " ");
  if (name.length > 80) throw new Error("Room names are limited to 80 characters");
  return name;
}

export function normalizeHandle(value: unknown): string {
  const handle = requiredString(value, "handle").replace(/^@/, "");
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(handle)) {
    throw new Error("Handles use 1-32 letters, numbers, underscores, or hyphens");
  }
  return handle;
}

function defaultHandle(name: string, id: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 24);
  return base || `agent-${id.slice(0, 6)}`;
}

export function mentionHandles(body: string): string[] {
  const matches = body.matchAll(/(^|\s)@([A-Za-z0-9_-]{1,32})\b/g);
  return [...new Set([...matches].map((match) => match[2]!.toLowerCase()))];
}

async function listRooms(ctx: PluginContext, cid: string): Promise<RoomRow[]> {
  return ctx.db.query<RoomRow>(
    `SELECT id, company_id, project_id, name, created_at, updated_at
       FROM ${table(ctx, "rooms")}
      WHERE company_id = $1
      ORDER BY updated_at DESC, created_at ASC`,
    [cid],
  );
}

async function requireRoom(ctx: PluginContext, cid: string, roomId: string): Promise<RoomRow> {
  const rows = await ctx.db.query<RoomRow>(
    `SELECT id, company_id, project_id, name, created_at, updated_at
       FROM ${table(ctx, "rooms")}
      WHERE id = $1 AND company_id = $2`,
    [roomId, cid],
  );
  if (!rows[0]) throw new Error("Campfire room not found");
  return rows[0];
}

async function listMembers(ctx: PluginContext, cid: string, roomId: string): Promise<MemberRow[]> {
  return ctx.db.query<MemberRow>(
    `SELECT m.room_id, m.agent_id, m.handle, m.joined_at,
            a.name, a.status, a.adapter_type,
            s.session_id
       FROM ${table(ctx, "room_members")} m
       JOIN public.agents a ON a.id = m.agent_id AND a.company_id = m.company_id
       LEFT JOIN ${table(ctx, "agent_sessions")} s
         ON s.room_id = m.room_id AND s.agent_id = m.agent_id AND s.status = 'active'
      WHERE m.room_id = $1 AND m.company_id = $2
      ORDER BY m.joined_at ASC`,
    [roomId, cid],
  );
}

async function listMessages(ctx: PluginContext, cid: string, roomId: string): Promise<MessageRow[]> {
  return ctx.db.query<MessageRow>(
    `SELECT m.id, m.seq, m.room_id, m.author_kind, m.author_agent_id,
            a.name AS author_name, rm.handle AS author_handle, m.body, m.created_at
       FROM ${table(ctx, "messages")} m
       LEFT JOIN public.agents a ON a.id = m.author_agent_id
       LEFT JOIN ${table(ctx, "room_members")} rm
         ON rm.room_id = m.room_id AND rm.agent_id = m.author_agent_id
      WHERE m.room_id = $1 AND m.company_id = $2
      ORDER BY m.seq ASC
      LIMIT 500`,
    [roomId, cid],
  );
}

async function roomState(ctx: PluginContext, params: Params) {
  const cid = companyId(params);
  const rooms = await listRooms(ctx, cid);
  const requestedRoomId = typeof params.roomId === "string" ? params.roomId : null;
  const room = requestedRoomId
    ? await requireRoom(ctx, cid, requestedRoomId)
    : rooms[0] ?? null;
  const members = room ? await listMembers(ctx, cid, room.id) : [];
  const allAgents = await ctx.agents.list({ companyId: cid, limit: 200 });
  const bookings = await ctx.db.query<{ agent_id: string; room_id: string; room_name: string }>(
    `SELECT m.agent_id, m.room_id, r.name AS room_name
       FROM ${table(ctx, "room_members")} m
       JOIN ${table(ctx, "rooms")} r ON r.id = m.room_id
      WHERE m.company_id = $1`,
    [cid],
  );
  const bookingByAgent = new Map(bookings.map((entry) => [entry.agent_id, entry]));

  return {
    rooms,
    room,
    members,
    messages: room ? await listMessages(ctx, cid, room.id) : [],
    agents: allAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      adapterType: agent.adapterType,
      booking: bookingByAgent.get(agent.id) ?? null,
    })),
  };
}

async function insertMessage(
  ctx: PluginContext,
  input: {
    companyId: string;
    roomId: string;
    authorKind: "human" | "agent" | "system";
    authorAgentId?: string | null;
    body: string;
  },
): Promise<string> {
  const id = randomUUID();
  await ctx.db.execute(
    `INSERT INTO ${table(ctx, "messages")}
       (id, room_id, company_id, author_kind, author_agent_id, body)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.roomId, input.companyId, input.authorKind, input.authorAgentId ?? null, input.body],
  );
  await ctx.db.execute(
    `UPDATE ${table(ctx, "rooms")} SET updated_at = now() WHERE id = $1 AND company_id = $2`,
    [input.roomId, input.companyId],
  );
  return id;
}

function emitChanged(ctx: PluginContext, cid: string, roomId: string, reason: string) {
  ctx.streams.emit(STREAM_CHANNEL, { type: "room.changed", roomId, reason });
}

async function persistentSession(
  ctx: PluginContext,
  cid: string,
  roomId: string,
  agentId: string,
) {
  const existing = await ctx.db.query<{ session_id: string }>(
    `SELECT session_id FROM ${table(ctx, "agent_sessions")}
      WHERE room_id = $1 AND company_id = $2 AND agent_id = $3 AND status = 'active'`,
    [roomId, cid, agentId],
  );
  if (existing[0]) return existing[0].session_id;

  const session = await ctx.agents.sessions.create(agentId, cid, {
    taskKey: `plugin:${PLUGIN_ID}:room:${roomId}:agent:${agentId}`,
    reason: "Campfire persistent room session",
  });
  await ctx.db.execute(
    `INSERT INTO ${table(ctx, "agent_sessions")}
       (room_id, company_id, agent_id, session_id, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (room_id, agent_id) DO UPDATE SET
       session_id = EXCLUDED.session_id,
       status = 'active',
       updated_at = now()`,
    [roomId, cid, agentId, session.sessionId],
  );
  return session.sessionId;
}

export function agentPrompt(room: RoomRow, member: MemberRow, body: string): string {
  return [
    `Campfire room #${room.name} has a new human message for @${member.handle}.`,
    "This is your persistent room session, so use the context you already have from earlier turns.",
    "Reply with only the message you want posted into the room.",
    "",
    body,
  ].join("\n");
}

async function saveAgentReply(
  ctx: PluginContext,
  input: { companyId: string; roomId: string; agentId: string; body: string },
) {
  const body = input.body.trim();
  if (!body) return;
  await insertMessage(ctx, {
    companyId: input.companyId,
    roomId: input.roomId,
    authorKind: "agent",
    authorAgentId: input.agentId,
    body,
  });
  emitChanged(ctx, input.companyId, input.roomId, "agent-reply");
}

async function deliver(
  ctx: PluginContext,
  room: RoomRow,
  member: MemberRow,
  sourceMessageId: string,
  onTerminal: () => void,
) {
  const deliveryId = randomUUID();
  await ctx.db.execute(
    `INSERT INTO ${table(ctx, "message_deliveries")} (id, message_id, agent_id)
     VALUES ($1, $2, $3)`,
    [deliveryId, sourceMessageId, member.agent_id],
  );

  let chunks = "";
  let terminalHandled = false;
  try {
    const sessionId = await persistentSession(ctx, room.company_id, room.id, member.agent_id);
    const result = await ctx.agents.sessions.sendMessage(sessionId, room.company_id, {
      prompt: agentPrompt(room, member, await messageBody(ctx, room.company_id, sourceMessageId)),
      reason: `Campfire #${room.name}`,
      onEvent: (event: AgentSessionEvent) => {
        if (event.eventType === "chunk" && event.stream !== "stderr" && event.message) {
          chunks += event.message;
        }
        ctx.streams.emit(STREAM_CHANNEL, {
          type: "agent.event",
          roomId: room.id,
          agentId: member.agent_id,
          eventType: event.eventType,
        });
        if ((event.eventType === "done" || event.eventType === "error") && !terminalHandled) {
          terminalHandled = true;
          const finalBody = event.eventType === "done" ? event.message ?? chunks : "";
          void (async () => {
            if (event.eventType === "done") {
              await saveAgentReply(ctx, {
                companyId: room.company_id,
                roomId: room.id,
                agentId: member.agent_id,
                body: finalBody,
              });
            } else {
              await ctx.db.execute(
                `UPDATE ${table(ctx, "message_deliveries")}
                    SET status = 'failed', error = $2, finished_at = now()
                  WHERE id = $1`,
                [deliveryId, event.message ?? "Agent session failed"],
              );
            }
            onTerminal();
          })().catch((error) => {
            ctx.logger.error("Failed to persist Campfire agent event", {
              error: error instanceof Error ? error.message : String(error),
              roomId: room.id,
              agentId: member.agent_id,
            });
            onTerminal();
          });
        }
      },
    });
    await ctx.db.execute(
      `UPDATE ${table(ctx, "message_deliveries")}
          SET status = 'delivered', run_id = $2, finished_at = now()
        WHERE id = $1`,
      [deliveryId, result.runId],
    );
  } catch (error) {
    terminalHandled = true;
    await ctx.db.execute(
      `UPDATE ${table(ctx, "message_deliveries")}
          SET status = 'failed', error = $2, finished_at = now()
        WHERE id = $1`,
      [deliveryId, error instanceof Error ? error.message : String(error)],
    );
    onTerminal();
  }
}

async function messageBody(ctx: PluginContext, companyId: string, messageId: string): Promise<string> {
  const rows = await ctx.db.query<{ body: string }>(
    `SELECT body FROM ${table(ctx, "messages")} WHERE id = $1 AND company_id = $2`,
    [messageId, companyId],
  );
  if (!rows[0]) throw new Error("Campfire source message not found");
  return rows[0].body;
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.data.register("room-state", (params) => roomState(ctx, params));

    ctx.actions.register("create-room", async (params) => {
      const cid = companyId(params);
      const name = normalizeRoomName(params.name);
      const projectId = typeof params.projectId === "string" && params.projectId ? params.projectId : null;
      const id = randomUUID();
      await ctx.db.execute(
        `INSERT INTO ${table(ctx, "rooms")} (id, company_id, project_id, name)
         VALUES ($1, $2, $3, $4)`,
        [id, cid, projectId, name],
      );
      return { roomId: id };
    });

    ctx.actions.register("add-member", async (params) => {
      const cid = companyId(params);
      const roomId = requiredString(params.roomId, "roomId");
      const agentId = requiredString(params.agentId, "agentId");
      await requireRoom(ctx, cid, roomId);
      const agent = await ctx.agents.get(agentId, cid);
      if (!agent) throw new Error("Paperclip agent not found");
      const handle = params.handle
        ? normalizeHandle(params.handle)
        : defaultHandle(agent.name, agent.id);
      const existing = await ctx.db.query<{ room_id: string; room_name: string }>(
        `SELECT m.room_id, r.name AS room_name
           FROM ${table(ctx, "room_members")} m
           JOIN ${table(ctx, "rooms")} r ON r.id = m.room_id
          WHERE m.company_id = $1 AND m.agent_id = $2`,
        [cid, agentId],
      );
      if (existing[0] && existing[0].room_id !== roomId) {
        throw new Error(`${agent.name} is already booked in #${existing[0].room_name}`);
      }
      await ctx.db.execute(
        `INSERT INTO ${table(ctx, "room_members")} (room_id, company_id, agent_id, handle)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (room_id, agent_id) DO UPDATE SET handle = EXCLUDED.handle`,
        [roomId, cid, agentId, handle],
      );
      await insertMessage(ctx, {
        companyId: cid,
        roomId,
        authorKind: "system",
        body: `${agent.name} (@${handle}) joined Campfire.`,
      });
      return { roomId, agentId, handle };
    });

    ctx.actions.register("remove-member", async (params) => {
      const cid = companyId(params);
      const roomId = requiredString(params.roomId, "roomId");
      const agentId = requiredString(params.agentId, "agentId");
      const room = await requireRoom(ctx, cid, roomId);
      const members = await listMembers(ctx, cid, roomId);
      const member = members.find((entry) => entry.agent_id === agentId);
      if (!member) throw new Error("Agent is not a member of this room");
      if (member.session_id) {
        await ctx.agents.sessions.close(member.session_id, cid).catch((error) => {
          ctx.logger.warn("Campfire session was already unavailable while removing a member", {
            roomId,
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      await insertMessage(ctx, {
        companyId: cid,
        roomId,
        authorKind: "system",
        body: `${member.name} (@${member.handle}) left Campfire.`,
      });
      await ctx.db.execute(
        `DELETE FROM ${table(ctx, "room_members")}
          WHERE room_id = $1 AND company_id = $2 AND agent_id = $3`,
        [roomId, cid, agentId],
      );
      ctx.streams.open(STREAM_CHANNEL, cid);
      emitChanged(ctx, cid, room.id, "member-removed");
      ctx.streams.close(STREAM_CHANNEL);
      return { roomId, agentId };
    });

    ctx.actions.register("send-message", async (params) => {
      const cid = companyId(params);
      const roomId = requiredString(params.roomId, "roomId");
      const body = requiredString(params.body, "body");
      if (body.length > 100_000) throw new Error("Messages are limited to 100,000 characters");
      const room = await requireRoom(ctx, cid, roomId);
      const members = await listMembers(ctx, cid, roomId);
      const handles = mentionHandles(body);
      const byHandle = new Map(members.map((member) => [member.handle.toLowerCase(), member]));
      const unknown = handles.filter((handle) => !byHandle.has(handle));
      if (unknown.length > 0) {
        throw new Error(`Unknown Campfire handle${unknown.length === 1 ? "" : "s"}: ${unknown.map((handle) => `@${handle}`).join(", ")}`);
      }
      const recipients = handles.length > 0
        ? handles.map((handle) => byHandle.get(handle)!)
        : members;
      const messageId = await insertMessage(ctx, {
        companyId: cid,
        roomId,
        authorKind: "human",
        body,
      });
      for (const recipient of recipients) {
        await ctx.db.execute(
          `INSERT INTO ${table(ctx, "message_mentions")} (message_id, agent_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [messageId, recipient.agent_id],
        );
      }

      ctx.streams.open(STREAM_CHANNEL, cid);
      emitChanged(ctx, cid, roomId, "human-message");
      if (recipients.length === 0) {
        ctx.streams.close(STREAM_CHANNEL);
        return { messageId, recipients: [] };
      }

      let remaining = recipients.length;
      const onTerminal = () => {
        remaining -= 1;
        if (remaining <= 0) ctx.streams.close(STREAM_CHANNEL);
      };
      await Promise.all(recipients.map((member) => deliver(ctx, room, member, messageId, onTerminal)));
      return {
        messageId,
        recipients: recipients.map((member) => ({ agentId: member.agent_id, handle: member.handle })),
      };
    });
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Campfire plugin worker is ready",
      details: { surfaces: ["rooms", "persistent-agent-sessions", "group-chat"] },
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
