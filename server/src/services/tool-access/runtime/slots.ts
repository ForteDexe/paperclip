import type { ActorInfo } from "../types.js";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { toolConnections, toolRuntimeSlots } from "@outpost/db";
import type { ToolRuntimeSlot } from "@outpost/shared";
import { HttpError, notFound } from "../../../errors.js";
import { logActivity } from "../../activity-log.js";
import { createToolRuntimeSupervisor, ToolRuntimeSupervisorError } from "../../tool-runtime-supervisor.js";

function toRuntimeSlot(
  row: typeof toolRuntimeSlots.$inferSelect,
): ToolRuntimeSlot {
  return {
    id: row.id,
    spaceId: row.spaceId,
    applicationId: row.applicationId,
    connectionId: row.connectionId,
    projectWorkspaceId: row.projectWorkspaceId,
    executionWorkspaceId: row.executionWorkspaceId,
    issueId: row.issueId,
    ownerScopeType: row.ownerScopeType,
    ownerScopeId: row.ownerScopeId,
    runtimeKind: row.runtimeKind,
    slotKey: row.slotKey,
    status: row.status,
    reuseKey: row.reuseKey,
    workspaceScope: row.workspaceScope,
    credentialScopeHash: row.credentialScopeHash,
    provider: row.provider,
    providerRef: row.providerRef,
    processId: row.processId,
    commandTemplateKey: row.commandTemplateKey,
    healthStatus: row.healthStatus,
    healthMessage: row.healthMessage,
    lastHealthCheckAt: row.lastHealthCheckAt,
    lastStartedAt: row.lastStartedAt,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    lastUsedAt: row.lastUsedAt,
    idleExpiresAt: row.idleExpiresAt,
    idleDeadlineAt: row.idleDeadlineAt,
    lastError: row.lastError,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createToolRuntimeSlots(db: Db, runtimeSupervisor: Pick<ReturnType<typeof createToolRuntimeSupervisor>, "stopSlot" | "restartSlot">) {
  async function ensureRuntimeSlot(
    connection: typeof toolConnections.$inferSelect,
  ): Promise<ToolRuntimeSlot | null> {
    if (connection.transport !== "local_stdio" || connection.config.templateId === "outpost.cognee-cloud") return null;
    const slotKey = `mcp:${connection.spaceId}:${connection.id}`;
    const [existing] = await db
      .select()
      .from(toolRuntimeSlots)
      .where(
        and(
          eq(toolRuntimeSlots.spaceId, connection.spaceId),
          eq(toolRuntimeSlots.slotKey, slotKey),
        ),
      );
    if (existing) return toRuntimeSlot(existing);
    const [created] = await db
      .insert(toolRuntimeSlots)
      .values({
        spaceId: connection.spaceId,
        applicationId: connection.applicationId,
        connectionId: connection.id,
        slotKey,
        ownerScopeType: "connection",
        ownerScopeId: connection.id,
        runtimeKind: "local_stdio",
        status: "stopped",
        provider: "outpost",
        providerRef: `template:${String(connection.config.templateId)}`,
        commandTemplateKey: String(connection.config.templateId),
        healthStatus: "unchecked",
        metadata: { templateId: connection.config.templateId },
      })
      .returning();
    return toRuntimeSlot(created);
  }

  async function runtimeSlotById(
    spaceId: string,
    slotId: string,
  ): Promise<ToolRuntimeSlot> {
    const [row] = await db
      .select()
      .from(toolRuntimeSlots)
      .where(
        and(
          eq(toolRuntimeSlots.spaceId, spaceId),
          eq(toolRuntimeSlots.id, slotId),
        ),
      )
      .limit(1);
    if (!row) throw notFound("Runtime slot not found");
    return toRuntimeSlot(row);
  }

  function runtimeSupervisorHttpError(error: ToolRuntimeSupervisorError) {
    return new HttpError(error.status, error.message, {
      code: error.reasonCode,
      ...error.details,
    });
  }

  async function controlRuntimeSlot(input: {
    spaceId: string;
    slotId: string;
    action: "stop" | "restart";
    actor?: ActorInfo;
  }): Promise<ToolRuntimeSlot> {
    await input.actor?.managementContext?.reauthorize();
    try {
      if (input.action === "stop") {
        await runtimeSupervisor.stopSlot({
          spaceId: input.spaceId,
          slotId: input.slotId,
          reason: "operator_stop",
        });
      } else {
        await runtimeSupervisor.restartSlot({
          spaceId: input.spaceId,
          slotId: input.slotId,
        });
      }
      const slot = await runtimeSlotById(input.spaceId, input.slotId);
      await logActivity(db, {
        spaceId: input.spaceId,
        actorType: input.actor?.actorType ?? "system",
        actorId: input.actor?.actorId ?? "tool-access-service",
        ...input.actor?.managementContext?.audit,
        action:
          input.action === "stop"
            ? "tool_runtime_slot.operator_stopped"
            : "tool_runtime_slot.operator_restarted",
        entityType: "tool_runtime_slot",
        entityId: input.slotId,
        details: {
          runtimeKind: slot.runtimeKind,
          status: slot.status,
          slotKey: slot.slotKey,
        },
      });
      return slot;
    } catch (error) {
      if (error instanceof ToolRuntimeSupervisorError) {
        throw runtimeSupervisorHttpError(error);
      }
      throw error;
    }
  }
  return {
    ensureRuntimeSlot,
    api: {
      listRuntimeSlots: async (spaceId: string): Promise<ToolRuntimeSlot[]> => {
      const rows = await db
        .select()
        .from(toolRuntimeSlots)
        .where(eq(toolRuntimeSlots.spaceId, spaceId))
        .orderBy(desc(toolRuntimeSlots.updatedAt));
      return rows.map(toRuntimeSlot);
    },

      stopRuntimeSlot: (
      spaceId: string,
      slotId: string,
      actor?: ActorInfo,
    ): Promise<ToolRuntimeSlot> =>
      controlRuntimeSlot({ spaceId, slotId, action: "stop", actor }),

      restartRuntimeSlot: (
      spaceId: string,
      slotId: string,
      actor?: ActorInfo,
    ): Promise<ToolRuntimeSlot> =>
      controlRuntimeSlot({ spaceId, slotId, action: "restart", actor })
    },
  };
}
