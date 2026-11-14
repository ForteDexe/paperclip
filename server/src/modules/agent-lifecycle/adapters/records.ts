import { preserveAgentInteractionPermissions } from "../../../lib/agent-interaction-permissions.js";
import type { LifecycleEffects } from "./effects.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { agents, agentApiKeys, spaces, type Db } from "@outpost/db";
import { conflict, notFound } from "../../../errors.js";
import { agentRecordQueries, type CreateAgentOptions, type CreateAgentData } from "../../../lib/agent-records.js";
import { isAgentSetupDraft, canConfigureAgentConnection } from "../domain/policy.js";

export function agentRecords(db: Db, effects: LifecycleEffects) {
  const { getById } = agentRecordQueries(db);

  return {
    getById,
    create: async (spaceId: string, data: CreateAgentData, options?: CreateAgentOptions) => {
      if (Object.keys(data).some(key => key.startsWith("lifecycle"))) throw conflict("Lifecycle fields belong to the lifecycle module");
      return effects.transaction(db, spaceId, async (txDb, publications) => {
        const tx = txDb;
        const setupId = options?.setupAgentId ?? (options?.setupOnly ? data.id : undefined);
        const [setup] = setupId ? await tx.select().from(agents).where(eq(agents.id, setupId)).for("update") : [];
        if (setup && setup.spaceId !== spaceId) {
          throw conflict("Agent setup is no longer available");
        }
        if (options?.setupOnly && setup) {
          if (setup.createdByUserId !== (options.createdByUserId ?? null)) throw notFound("Agent setup not found");
          const existing = await agentRecordQueries(txDb).getById(setup.id);
          if (!existing) throw notFound("Agent setup not found");
          return existing;
        }
        if (setup && (!isAgentSetupDraft(setup) || setup.lifecycleState === "pausing" || !setup.lifecycleHolds.includes("setup"))) {
          throw conflict("Agent setup is no longer available");
        }
        if (options?.setupAgentId && !setup) throw notFound("Agent setup not found");
        const prepared = await effects.prepareCreate(txDb, spaceId, data, options);
        const status = options?.setupOnly ? "paused" : data.status;
        const pauseReason = options?.setupOnly ? "setup" : data.pauseReason;
        const [space] = await tx.select({ status: spaces.status }).from(spaces).where(eq(spaces.id, spaceId));
        const spaceHolds = space?.status === "paused" ? ["space_paused"] : space?.status === "archived" ? ["space_archived"] : [];
        const holds = [...(status === "paused" ? [pauseReason ?? "manual"] : []), ...spaceHolds];
        const prepareSetup = options?.setupOnly && !spaceHolds.length && await effects.setupRequiresPreparation(txDb, spaceId, prepared.defaultEnvironmentId, prepared);
        const lifecycleState = status === "pending_approval" ? "pending_approval" : status === "terminated" ? "terminated"
          : prepareSetup ? "preparing" : status === "paused" ? "paused" : spaceHolds.length ? "pausing" : "preparing";
        if (lifecycleState === "preparing" || lifecycleState === "pausing") await effects.notifyWork(tx);
        const createdStatus=status === "pending_approval" ? "pending_approval" : status === "terminated" ? "terminated" : "paused";
        const values: typeof agents.$inferInsert = {
          ...prepared,
          ...(setup ? { permissions: preserveAgentInteractionPermissions(setup.permissions, prepared.permissions) } : {}),
          createdByUserId: setup?.createdByUserId ?? options?.createdByUserId ?? null,
          lifecycleState,
          lifecycleVersion: setup ? setup.lifecycleVersion + 1 : 1,
          lifecycleHolds: holds,
          pauseReason: holds[0] ?? null,
          pausedAt: holds.length ? new Date() : null,
          lifecycleOperation: { id: randomUUID(), hostComplete: false, completedPluginIds: [], attempts: 0, resumeState: "preparing" as const, responsibleUserId: options?.responsibleUserId ?? options?.createdByUserId },
          status: createdStatus,
          spaceId,
        };
        if(setup&&!canConfigureAgentConnection(setup)&&canConfigureAgentConnection({lifecycleState,status:createdStatus}))await effects.beforeConnectionEligibilityRestore?.(txDb,spaceId,setup.id);
        const created = await (options?.setupAgentId
          ? tx.update(agents).set({ ...values, updatedAt: new Date() }).where(eq(agents.id, options.setupAgentId))
          : tx.insert(agents).values(values))
          .returning()
          .then((rows) => rows[0]);
        await effects.initializeCreate(txDb, created, options);
        if (!options?.setupOnly && status !== "pending_approval" && status !== "terminated"
          && created.budgetMonthlyCents > 0 && options?.initialBudgetPolicyUserId) {
          await effects.setAgentBudget(txDb, publications, spaceId, created.id, created.budgetMonthlyCents, options.initialBudgetPolicyUserId);
        }
        if (!options?.setupOnly && created.status !== "pending_approval" && created.status !== "terminated") {
          await effects.recordCreation(txDb, spaceId, created.id);
        }
        const normalizedCreated = await agentRecordQueries(txDb).getById(created.id);
        if (!normalizedCreated) {
          throw notFound("Agent not found");
        }
        return normalizedCreated;
      });
    },

    clearError: async (id: string) => {
      const existing = await getById(id);
      if (!existing) return null;
      if (existing.status === "terminated") throw conflict("Cannot clear error on terminated agent");
      if (existing.status === "pending_approval") {
        throw conflict("Pending approval agents cannot have errors cleared");
      }
      if (existing.status !== "error") {
        throw conflict("Only agents in error status can have their error cleared");
      }

      const updated = await effects.transaction(db, existing.spaceId, async tx => {
        const [current] = await tx.select({ status: agents.status, lifecycleState: agents.lifecycleState })
          .from(agents).where(and(eq(agents.id, id), eq(agents.spaceId, existing.spaceId))).for("no key update");
        if (current?.status !== "error" || current.lifecycleState !== "ready") {
          throw conflict("Only agents in error status can have their error cleared");
        }
        await effects.beforeStatusChange(tx, existing.spaceId, id, "error", "idle");
        const [saved] = await tx.update(agents).set({
          status: "idle", pauseReason: null, pausedAt: null, errorReason: null, updatedAt: new Date(),
        }).where(and(eq(agents.id, id), eq(agents.status, "error"), eq(agents.lifecycleState, "ready"))).returning();
        if (!saved) throw conflict("Only agents in error status can have their error cleared");
        return saved;
      });

      return getById(updated.id);
    },

    rejectPendingCreation: async (id: string) => {
      const [pending] = await db.select({ spaceId: agents.spaceId, status: agents.status }).from(agents)
        .where(and(eq(agents.id, id), eq(agents.lifecycleState, "pending_approval"))).for("update");
      if (!pending) return [];
      await effects.beforeStatusChange(db, pending.spaceId, id, pending.status, "terminated");
      const rows = await db.update(agents).set({ status: "terminated", lifecycleState: "rejected",
        lifecycleVersion: sql`${agents.lifecycleVersion} + 1`, lifecycleOperation: null,
        updatedAt: new Date() }).where(and(eq(agents.id, id), eq(agents.lifecycleState, "pending_approval"))).returning();
      for (const row of rows) {
        await effects.clearPrimary(db, row.spaceId, id);
        await db.update(agentApiKeys).set({ revokedAt: new Date() }).where(eq(agentApiKeys.agentId, id));
        await effects.recordStatus(db, row.spaceId, id, "pending_approval", "terminated");
      }
      return rows;
    },

    activatePendingApproval: async (id: string, approvedPayload?: Record<string, unknown> | null, requestedByUserId?: string | null) => {
      const activatedAgent = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const existing = await agentRecordQueries(txDb).getById(id);
        if (!existing || existing.status !== "pending_approval") return null;
        const patch = await effects.prepareCreationApproval(txDb, existing, approvedPayload);
        const [space] = await tx.select({ status: spaces.status }).from(spaces).where(eq(spaces.id, existing.spaceId));
        const holds = existing.lifecycleHolds.filter(hold => hold !== "space_paused" && hold !== "space_archived");
        if (space?.status === "paused") holds.push("space_paused");
        if (space?.status === "archived") holds.push("space_archived");
        if(!holds.length)await effects.beforeConnectionEligibilityRestore?.(txDb,existing.spaceId,existing.id);
        await effects.notifyWork(txDb);
        const updated = await tx
          .update(agents)
          .set({ ...patch, status: "paused", lifecycleState: holds.length ? "pausing" : "preparing", lifecycleHolds: holds, pauseReason: holds[0] ?? null, lifecycleVersion: existing.lifecycleVersion + 1, lifecycleError: null, lifecycleOperation: sql`jsonb_build_object('id', ${randomUUID()}::text, 'hostComplete', false, 'completedPluginIds', '[]'::jsonb, 'attempts', 0, 'responsibleUserId', coalesce(nullif(${agents.lifecycleOperation}->'responsibleUserId', 'null'::jsonb), to_jsonb(${requestedByUserId ?? null}::text)))`, updatedAt: new Date() })
          .where(and(eq(agents.id, id), eq(agents.status, "pending_approval")))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;
        await effects.completeCreationApproval(txDb, updated, existing);
        await effects.recordCreation(txDb, existing.spaceId, updated.id);
        const agent = await agentRecordQueries(txDb).getById(updated.id);
        if (!agent) {
          throw notFound("Agent not found");
        }
        return agent;
      });

      if (activatedAgent) {
        return { agent: activatedAgent, activated: true };
      }

      const existing = await getById(id);
      return existing ? { agent: existing, activated: false } : null;
    },

  };
}
