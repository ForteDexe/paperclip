import { pgTable, uuid, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { assets } from "./assets.js";

export const runnerApiResponseReservations = pgTable("runner_api_response_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({ spaceIdx: index("runner_api_response_reservations_space_idx").on(table.spaceId) }));
