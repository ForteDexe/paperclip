import { randomUUID } from "node:crypto";
import {
  agentTaskSessions,
  agents,
  campfireAgentSessions,
  campfireMessageDeliveries,
  campfireMessageMentions,
  campfireMessages,
  campfireRoomMembers,
  campfireRooms,
  heartbeatRuns,
  type Db,
} from "@outpost/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";
import { agentService } from "./agents.js";
import { heartbeatService } from "./heartbeat.js";
import { buildHeartbeatRunStatusLiveEventPayload } from "./heartbeat-run-status-payload.js";
import { subscribeSpaceLiveEvents } from "./live-events.js";
import { logger } from "../middleware/logger.js";

export type CampfireAuthorKind = "human" | "agent" | "system";

export function normalizeCampfireRoomName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("Room name is required");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > 80) throw new Error("Room names are limited to 80 characters");
  return name;
}

export function normalizeCampfireHandle(value: unknown): string {
  if (typeof value !== "string") throw new Error("Handle is required");
  const handle = value.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(handle)) {
    throw new Error("Handles use 1-32 letters, numbers, underscores, or hyphens");
  }
  return handle;
}

export function campfireMentionHandles(body: string): string[] {
  const matches = body.matchAll(/(^|\s)@([A-Za-z0-9_-]{1,32})\b/g);
  return [...new Set([...matches].map((match) => match[2]!.toLowerCase()))];
}

function defaultHandle(name: string, id: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 24);
  return base || `agent-${id.slice(0, 6)}`;
}

export function campfireService(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const agentSvc = agentService(db);
  const heartbeat = heartbeatService(db, { pluginWorkerManager: options.pluginWorkerManager });

  async function requireRoom(spaceId: string, roomId: string) {
    const [room] = await db.select().from(campfireRooms).where(and(
      eq(campfireRooms.id, roomId),
      eq(campfireRooms.spaceId, spaceId),
    ));
    if (!room) throw new Error("Campfire room not found");
    return room;
  }

  async function listMembers(spaceId: string, roomId: string) {
    return db
      .select({
        roomId: campfireRoomMembers.roomId,
        agentId: campfireRoomMembers.agentId,
        handle: campfireRoomMembers.handle,
        joinedAt: campfireRoomMembers.joinedAt,
        name: agents.name,
        status: agents.status,
        adapterType: agents.adapterType,
        sessionId: campfireAgentSessions.sessionId,
      })
      .from(campfireRoomMembers)
      .innerJoin(agents, and(
        eq(agents.id, campfireRoomMembers.agentId),
        eq(agents.spaceId, campfireRoomMembers.spaceId),
      ))
      .leftJoin(campfireAgentSessions, and(
        eq(campfireAgentSessions.roomId, campfireRoomMembers.roomId),
        eq(campfireAgentSessions.agentId, campfireRoomMembers.agentId),
        eq(campfireAgentSessions.status, "active"),
      ))
      .where(and(
        eq(campfireRoomMembers.roomId, roomId),
        eq(campfireRoomMembers.spaceId, spaceId),
      ))
      .orderBy(asc(campfireRoomMembers.joinedAt));
  }

  async function listMessages(spaceId: string, roomId: string) {
    return db
      .select({
        id: campfireMessages.id,
        seq: campfireMessages.seq,
        roomId: campfireMessages.roomId,
        authorKind: campfireMessages.authorKind,
        authorAgentId: campfireMessages.authorAgentId,
        authorName: agents.name,
        authorHandle: campfireRoomMembers.handle,
        body: campfireMessages.body,
        createdAt: campfireMessages.createdAt,
      })
      .from(campfireMessages)
      .leftJoin(agents, eq(agents.id, campfireMessages.authorAgentId))
      .leftJoin(campfireRoomMembers, and(
        eq(campfireRoomMembers.roomId, campfireMessages.roomId),
        eq(campfireRoomMembers.agentId, campfireMessages.authorAgentId),
      ))
      .where(and(eq(campfireMessages.roomId, roomId), eq(campfireMessages.spaceId, spaceId)))
      .orderBy(asc(campfireMessages.seq))
      .limit(500);
  }

  async function listDeliveries(spaceId: string, roomId: string) {
    return db
      .select({
        id: campfireMessageDeliveries.id,
        messageId: campfireMessageDeliveries.messageId,
        agentId: campfireMessageDeliveries.agentId,
        agentName: agents.name,
        agentHandle: campfireRoomMembers.handle,
        status: campfireMessageDeliveries.status,
        runId: campfireMessageDeliveries.runId,
        error: campfireMessageDeliveries.error,
        runError: heartbeatRuns.error,
        errorCode: heartbeatRuns.errorCode,
        createdAt: campfireMessageDeliveries.createdAt,
        finishedAt: campfireMessageDeliveries.finishedAt,
      })
      .from(campfireMessageDeliveries)
      .innerJoin(campfireMessages, and(
        eq(campfireMessages.id, campfireMessageDeliveries.messageId),
        eq(campfireMessages.spaceId, spaceId),
        eq(campfireMessages.roomId, roomId),
      ))
      .innerJoin(agents, eq(agents.id, campfireMessageDeliveries.agentId))
      .leftJoin(campfireRoomMembers, and(
        eq(campfireRoomMembers.roomId, roomId),
        eq(campfireRoomMembers.agentId, campfireMessageDeliveries.agentId),
      ))
      .leftJoin(heartbeatRuns, eq(heartbeatRuns.id, campfireMessageDeliveries.runId))
      .orderBy(asc(campfireMessageDeliveries.createdAt));
  }

  async function insertMessage(input: {
    spaceId: string;
    roomId: string;
    authorKind: CampfireAuthorKind;
    authorAgentId?: string | null;
    body: string;
  }) {
    const [message] = await db.insert(campfireMessages).values({
      id: randomUUID(),
      spaceId: input.spaceId,
      roomId: input.roomId,
      authorKind: input.authorKind,
      authorAgentId: input.authorAgentId ?? null,
      body: input.body,
    }).returning();
    await db.update(campfireRooms).set({ updatedAt: new Date() }).where(and(
      eq(campfireRooms.id, input.roomId),
      eq(campfireRooms.spaceId, input.spaceId),
    ));
    return message!;
  }

  async function persistentSession(spaceId: string, roomId: string, agentId: string) {
    const [existing] = await db.select().from(campfireAgentSessions).where(and(
      eq(campfireAgentSessions.roomId, roomId),
      eq(campfireAgentSessions.agentId, agentId),
      eq(campfireAgentSessions.status, "active"),
    ));
    if (existing) return existing.sessionId;

    const agent = await agentSvc.getById(agentId);
    if (!agent || agent.spaceId !== spaceId) throw new Error("Outpost agent not found");
    const taskKey = `campfire:room:${roomId}:agent:${agentId}`;
    const inserted = await db.insert(agentTaskSessions).values({
      spaceId,
      agentId,
      adapterType: agent.adapterType,
      taskKey,
    }).onConflictDoNothing().returning();
    const session = inserted[0] ?? (await db.select().from(agentTaskSessions).where(and(
      eq(agentTaskSessions.spaceId, spaceId),
      eq(agentTaskSessions.agentId, agentId),
      eq(agentTaskSessions.adapterType, agent.adapterType),
      eq(agentTaskSessions.taskKey, taskKey),
    )))[0];
    if (!session) throw new Error("Could not create Campfire agent session");
    await db.insert(campfireAgentSessions).values({
      roomId,
      spaceId,
      agentId,
      sessionId: session.id,
      status: "active",
    }).onConflictDoUpdate({
      target: [campfireAgentSessions.roomId, campfireAgentSessions.agentId],
      set: { sessionId: session.id, status: "active", updatedAt: new Date() },
    });
    return session.id;
  }

  function agentPrompt(room: typeof campfireRooms.$inferSelect, member: Awaited<ReturnType<typeof listMembers>>[number], body: string) {
    return [
      `Campfire room #${room.name} has a new human message for @${member.handle}.`,
      "This is your persistent room session, so use the context you already have from earlier turns.",
      "Reply with only the message you want posted into the room.",
      "",
      body,
    ].join("\n");
  }

  async function deliver(
    room: typeof campfireRooms.$inferSelect,
    member: Awaited<ReturnType<typeof listMembers>>[number],
    message: typeof campfireMessages.$inferSelect,
  ) {
    const [delivery] = await db.insert(campfireMessageDeliveries).values({
      messageId: message.id,
      agentId: member.agentId,
    }).returning();
    if (!delivery) return;

    let runId: string | null = null;
    let settled = false;
    const settle = async (status: string, finalText?: string | null, runError?: string | null) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timeout);
      if (status === "succeeded" && finalText?.trim()) {
        await insertMessage({
          spaceId: room.spaceId,
          roomId: room.id,
          authorKind: "agent",
          authorAgentId: member.agentId,
          body: finalText.trim(),
        });
      }
      await db.update(campfireMessageDeliveries).set({
        status: status === "succeeded" ? "delivered" : "failed",
        error: status === "succeeded" ? null : runError?.trim() || `Run ${status}`,
        finishedAt: new Date(),
      }).where(eq(campfireMessageDeliveries.id, delivery.id));
    };
    const unsubscribe = subscribeSpaceLiveEvents(room.spaceId, (event) => {
      if (!runId || event.payload.runId !== runId || event.type !== "heartbeat.run.status") return;
      const status = typeof event.payload.status === "string" ? event.payload.status : "";
      if (!["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(status)) return;
      void settle(
        status,
        typeof event.payload.finalText === "string" ? event.payload.finalText : null,
        typeof event.payload.error === "string" ? event.payload.error : null,
      ).catch((error) => {
        logger.error({ error, roomId: room.id, agentId: member.agentId }, "failed to settle Campfire delivery");
      });
    });
    const timeout = setTimeout(() => {
      void settle("timed_out").catch((error) => {
        logger.error({ error, roomId: room.id, agentId: member.agentId }, "Campfire delivery timeout cleanup failed");
      });
    }, 24 * 60 * 60 * 1000);
    timeout.unref?.();

    try {
      const sessionId = await persistentSession(room.spaceId, room.id, member.agentId);
      const run = await heartbeat.wakeup(member.agentId, {
        source: "automation",
        triggerDetail: "system",
        reason: `Campfire #${room.name}`,
        payload: { prompt: agentPrompt(room, member, message.body) },
        contextSnapshot: {
          taskKey: `campfire:room:${room.id}:agent:${member.agentId}`,
          wakeReason: `Campfire #${room.name}`,
          wakeSource: "automation",
          wakeTriggerDetail: "system",
          outpostAgentMessage: {
            text: agentPrompt(room, member, message.body),
            source: "campfire_session",
            sessionId,
            roomId: room.id,
          },
        },
        requestedByActorType: "system",
        requestedByActorId: "campfire",
      });
      if (!run) throw new Error("Agent wakeup was skipped by heartbeat policy");
      runId = run.id;
      await db.update(campfireMessageDeliveries).set({ status: "delivered", runId: run.id })
        .where(eq(campfireMessageDeliveries.id, delivery.id));

      // A very short run can finish before wakeup() returns and before the
      // subscriber knows which run id to watch. Re-read it after binding the
      // id so Campfire never loses a fast completion between those two steps.
      const [currentRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
      if (currentRun && ["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(currentRun.status)) {
        const payload = buildHeartbeatRunStatusLiveEventPayload(currentRun);
        await settle(
          currentRun.status,
          typeof payload.finalText === "string" ? payload.finalText : null,
          typeof payload.error === "string" ? payload.error : null,
        );
      }
    } catch (error) {
      await settle("failed");
      await db.update(campfireMessageDeliveries).set({
        error: error instanceof Error ? error.message : String(error),
      }).where(eq(campfireMessageDeliveries.id, delivery.id));
    }
  }

  return {
    async state(spaceId: string, requestedRoomId?: string | null) {
      const rooms = await db.select().from(campfireRooms)
        .where(eq(campfireRooms.spaceId, spaceId))
        .orderBy(desc(campfireRooms.updatedAt), asc(campfireRooms.createdAt));
      const room = requestedRoomId
        ? await requireRoom(spaceId, requestedRoomId)
        : rooms[0] ?? null;
      const allAgents = await agentSvc.list(spaceId);
      const bookings = await db.select({
        agentId: campfireRoomMembers.agentId,
        roomId: campfireRoomMembers.roomId,
        roomName: campfireRooms.name,
      }).from(campfireRoomMembers).innerJoin(campfireRooms, eq(campfireRooms.id, campfireRoomMembers.roomId))
        .where(eq(campfireRoomMembers.spaceId, spaceId));
      const bookingByAgent = new Map(bookings.map((booking) => [booking.agentId, booking]));
      return {
        rooms,
        room,
        members: room ? await listMembers(spaceId, room.id) : [],
        messages: room ? await listMessages(spaceId, room.id) : [],
        deliveries: room ? await listDeliveries(spaceId, room.id) : [],
        agents: allAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          adapterType: agent.adapterType,
          booking: bookingByAgent.get(agent.id) ?? null,
        })),
      };
    },

    async createRoom(spaceId: string, name: unknown) {
      const [room] = await db.insert(campfireRooms).values({ spaceId, name: normalizeCampfireRoomName(name) }).returning();
      return room!;
    },

    async addMember(spaceId: string, roomId: string, agentId: string, requestedHandle?: unknown) {
      await requireRoom(spaceId, roomId);
      const agent = await agentSvc.getById(agentId);
      if (!agent || agent.spaceId !== spaceId || agent.status === "terminated") throw new Error("Outpost agent not found");
      const handle = requestedHandle ? normalizeCampfireHandle(requestedHandle) : defaultHandle(agent.name, agent.id);
      const [booking] = await db.select({ roomId: campfireRoomMembers.roomId, roomName: campfireRooms.name })
        .from(campfireRoomMembers)
        .innerJoin(campfireRooms, eq(campfireRooms.id, campfireRoomMembers.roomId))
        .where(and(eq(campfireRoomMembers.spaceId, spaceId), eq(campfireRoomMembers.agentId, agentId)));
      if (booking && booking.roomId !== roomId) throw new Error(`${agent.name} is already booked in #${booking.roomName}`);
      await db.insert(campfireRoomMembers).values({ spaceId, roomId, agentId, handle }).onConflictDoUpdate({
        target: [campfireRoomMembers.roomId, campfireRoomMembers.agentId],
        set: { handle },
      });
      await insertMessage({ spaceId, roomId, authorKind: "system", body: `${agent.name} (@${handle}) joined Campfire.` });
      return { roomId, agentId, handle };
    },

    async removeMember(spaceId: string, roomId: string, agentId: string) {
      await requireRoom(spaceId, roomId);
      const members = await listMembers(spaceId, roomId);
      const member = members.find((entry) => entry.agentId === agentId);
      if (!member) throw new Error("Agent is not a member of this room");
      if (member.sessionId) {
        await db.delete(agentTaskSessions).where(and(
          eq(agentTaskSessions.id, member.sessionId),
          eq(agentTaskSessions.spaceId, spaceId),
          eq(agentTaskSessions.agentId, agentId),
        ));
      }
      await insertMessage({ spaceId, roomId, authorKind: "system", body: `${member.name} (@${member.handle}) left Campfire.` });
      await db.delete(campfireRoomMembers).where(and(
        eq(campfireRoomMembers.roomId, roomId),
        eq(campfireRoomMembers.spaceId, spaceId),
        eq(campfireRoomMembers.agentId, agentId),
      ));
      return { roomId, agentId };
    },

    async sendMessage(spaceId: string, roomId: string, rawBody: unknown) {
      if (typeof rawBody !== "string" || rawBody.trim().length === 0) throw new Error("Message is required");
      const body = rawBody.trim();
      if (body.length > 100_000) throw new Error("Messages are limited to 100,000 characters");
      const room = await requireRoom(spaceId, roomId);
      const members = await listMembers(spaceId, roomId);
      const handles = campfireMentionHandles(body);
      const byHandle = new Map(members.map((member) => [member.handle.toLowerCase(), member]));
      const unknown = handles.filter((handle) => !byHandle.has(handle));
      if (unknown.length) throw new Error(`Unknown Campfire handle${unknown.length === 1 ? "" : "s"}: ${unknown.map((handle) => `@${handle}`).join(", ")}`);
      const recipients = handles.length ? handles.map((handle) => byHandle.get(handle)!) : members;
      const message = await insertMessage({ spaceId, roomId, authorKind: "human", body });
      if (recipients.length) await db.insert(campfireMessageMentions).values(
        recipients.map((member) => ({ messageId: message.id, agentId: member.agentId })),
      ).onConflictDoNothing();
      await Promise.all(recipients.map((member) => deliver(room, member, message)));
      return { messageId: message.id, recipients: recipients.map((member) => ({ agentId: member.agentId, handle: member.handle })) };
    },
  };
}
