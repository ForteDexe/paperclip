import { and, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { agents } from "@outpost/db";
import type { CreateApprovedPayload } from "@outpost/adapter-utils";
import { findActiveServerAdapter } from "../adapters/registry.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";

const AGENT_CREATED_MESSAGE =
  "Tell the user that your agent setup was approved. They can now assign you a task in Outpost or ask you to create tasks.";

export interface NotifyCreateApprovedInput {
  spaceId: string;
  agentId: string;
  source: "join_request" | "approval";
  sourceId: string;
  approvedAt?: Date;
}

/**
 * Invokes the adapter's onCreateApproved hook when an agent is approved (join-request or create_agent approval).
 * Failures are non-fatal: we log and write to activity, never throw.
 */
export async function notifyCreateApproved(
  db: Db,
  input: NotifyCreateApprovedInput,
): Promise<void> {
  const { spaceId, agentId, source, sourceId } = input;
  const approvedAt = input.approvedAt ?? new Date();

  const row = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.spaceId, spaceId)))
    .then((rows) => rows[0] ?? null);

  if (!row) {
    logger.warn({ spaceId, agentId, source, sourceId }, "create hook: agent not found in space, skipping");
    return;
  }

  const adapterType = row.adapterType ?? "process";
  const adapter = findActiveServerAdapter(adapterType);
  const onCreateApproved = adapter?.onCreateApproved;
  if (!onCreateApproved) {
    return;
  }

  const payload: CreateApprovedPayload = {
    spaceId,
    agentId,
    agentName: row.name,
    adapterType,
    source,
    sourceId,
    approvedAt: approvedAt.toISOString(),
    message: AGENT_CREATED_MESSAGE,
  };

  const adapterConfig =
    typeof row.adapterConfig === "object" && row.adapterConfig !== null && !Array.isArray(row.adapterConfig)
      ? (row.adapterConfig as Record<string, unknown>)
      : {};

  try {
    const result = await onCreateApproved(payload, adapterConfig);
    if (result.ok) {
      await logActivity(db, {
        spaceId,
        actorType: "system",
        actorId: "create_hook",
        action: "create_hook.succeeded",
        entityType: "agent",
        entityId: agentId,
        details: { source, sourceId, adapterType },
      });
      return;
    }

    logger.warn(
      { spaceId, agentId, adapterType, source, sourceId, error: result.error, detail: result.detail },
      "create hook: adapter returned failure",
    );
    await logActivity(db, {
      spaceId,
      actorType: "system",
      actorId: "create_hook",
      action: "create_hook.failed",
      entityType: "agent",
      entityId: agentId,
      details: { source, sourceId, adapterType, error: result.error, detail: result.detail },
    });
  } catch (err) {
    logger.error(
      { err, spaceId, agentId, adapterType, source, sourceId },
      "create hook: adapter threw",
    );
    await logActivity(db, {
      spaceId,
      actorType: "system",
      actorId: "create_hook",
      action: "create_hook.error",
      entityType: "agent",
      entityId: agentId,
      details: {
        source,
        sourceId,
        adapterType,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
