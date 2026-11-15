import {
  bigserial,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { agentTaskSessions } from "./agent_task_sessions.js";
import { spaces } from "./spaces.js";

export const campfireRooms = pgTable(
  "campfire_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceNameUnique: uniqueIndex("campfire_rooms_space_name_uniq").on(table.spaceId, table.name),
    spaceUpdated: index("campfire_rooms_space_updated_idx").on(table.spaceId, table.updatedAt),
  }),
);

export const campfireRoomMembers = pgTable(
  "campfire_room_members",
  {
    roomId: uuid("room_id").notNull().references(() => campfireRooms.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.agentId] }),
    spaceAgentUnique: uniqueIndex("campfire_room_members_space_agent_uniq").on(table.spaceId, table.agentId),
    roomHandleUnique: uniqueIndex("campfire_room_members_room_handle_uniq").on(table.roomId, table.handle),
  }),
);

export const campfireAgentSessions = pgTable(
  "campfire_agent_sessions",
  {
    roomId: uuid("room_id").notNull().references(() => campfireRooms.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => agentTaskSessions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.agentId] }),
    sessionUnique: uniqueIndex("campfire_agent_sessions_session_uniq").on(table.sessionId),
  }),
);

export const campfireMessages = pgTable(
  "campfire_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    roomId: uuid("room_id").notNull().references(() => campfireRooms.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    authorKind: text("author_kind").notNull(),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomSeqUnique: uniqueIndex("campfire_messages_room_seq_uniq").on(table.roomId, table.seq),
    roomSeq: index("campfire_messages_room_seq_idx").on(table.roomId, table.seq),
  }),
);

export const campfireMessageMentions = pgTable(
  "campfire_message_mentions",
  {
    messageId: uuid("message_id").notNull().references(() => campfireMessages.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  },
  (table) => ({ pk: primaryKey({ columns: [table.messageId, table.agentId] }) }),
);

export const campfireMessageDeliveries = pgTable(
  "campfire_message_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id").notNull().references(() => campfireMessages.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    runId: uuid("run_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    messageAgentUnique: uniqueIndex("campfire_deliveries_message_agent_uniq").on(table.messageId, table.agentId),
    pending: index("campfire_deliveries_status_idx").on(table.status, table.createdAt),
  }),
);
