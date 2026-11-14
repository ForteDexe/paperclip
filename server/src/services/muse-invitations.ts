import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { activityLog, agents, spaces, museAgentBindings, type Db } from "@outpost/db";
import { agentService } from "./agents.js";
import { createAgentLifecycle, scheduleAgentLifecycle } from "./agent-lifecycle.js";
import { withDedicatedDbConnection } from "@outpost/db";
import { approvalService } from "./approvals.js";
import { accessService } from "./access.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { loadDefaultAgentInstructionsBundle } from "./default-agent-instructions.js";
import { logActivity } from "./activity-log.js";
import { museRunnerBroker } from "./muse-runner-broker.js";
import { notFound, unprocessable } from "../errors.js";

/** One unfinished invitation per operator/space. Only non-secret references are persisted. */
export function museInvitationService(db: Db) {
  async function pending(database: Db, spaceId: string, operatorId: string, recoverIncomplete = false) {
    const rows = await database.select({ agent: agents, binding: museAgentBindings })
      .from(agents).leftJoin(museAgentBindings, and(eq(museAgentBindings.agentId, agents.id), isNull(museAgentBindings.revokedAt)))
      .where(and(eq(agents.spaceId, spaceId), ne(agents.status, "terminated"),
        eq(agents.adapterType, "outpost_runner"), sql`${agents.adapterConfig}->>'provider' = 'muse'`,
        sql`((${recoverIncomplete} and ${agents.metadata}->'museInvitation'->>'operatorId' = ${operatorId}
          and ${agents.lifecycleOperation}->>'responsibleUserId' = ${operatorId}) or exists (select 1 from ${activityLog} where ${activityLog.spaceId} = ${agents.spaceId}
          and ${activityLog.entityId} = ${agents.id}::text and ${activityLog.entityType} = 'agent'
          and ${activityLog.actorType} = 'user' and ${activityLog.actorId} = ${operatorId}
          and ${activityLog.action} = 'agent.create_created' and ${activityLog.details}->>'source' = 'muse-invitation'))`)).orderBy(desc(agents.createdAt));
    return rows.find(row => row.binding?.status !== "ready")?.agent ?? null;
  }
  async function describe(agent: Pick<typeof agents.$inferSelect, "id" | "name" | "spaceId" | "status">, database: Db = db) {
    const approval = await approvalService(database).findOpenCreationApprovalForAgent(agent.spaceId, agent.id);
    return { agent: { id: agent.id, name: agent.name, status: agent.status }, approvalId: approval?.id ?? null,
      binding: await museRunnerBroker(database).bindingForAgent(agent.spaceId, agent.id) };
  }
  return {
    async resume(spaceId: string, operatorId: string) {
      const agent = await pending(db, spaceId, operatorId);
      return agent ? describe(agent) : null;
    },
    async create(spaceId: string, operatorId: string, input: { name: string; role: string }) {
      if (!await museRunnerBroker(db).enabled()) throw unprocessable("Enable Muse and Outpost Runner in experimental settings.");
      const database = db;
      const lockKey = `outpost:muse-invitation:${spaceId}:${operatorId}`;
      return withDedicatedDbConnection(db, lockDb => lockDb.transaction(async lock => {
        await lock.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        // SQL locking also serializes retries on different control-plane replicas.
        const [space] = await database.select().from(spaces).where(eq(spaces.id, spaceId));
        if (!space) throw notFound("Outpost not found");
        if (space.status !== "active") throw unprocessable("Activate this space before inviting Muse.");
        const existing = await pending(database, spaceId, operatorId, true);
        if (existing) {
          const [completed] = await database.select({ id: activityLog.id }).from(activityLog).where(and(
            eq(activityLog.spaceId, spaceId), eq(activityLog.entityId, existing.id),
            eq(activityLog.action, "agent.create_created"), eq(activityLog.actorId, operatorId),
            sql`${activityLog.details}->>'source' = 'muse-invitation'`)).limit(1);
          if (completed) return describe(existing, database);
        }
        const svc = agentService(database);
        let created = existing ?? await createAgentLifecycle(database).requestCreation(spaceId, {
          name: input.name, role: input.role, adapterType: "outpost_runner",
          adapterConfig: { provider: "muse", lifecycleMode: "per_turn", allowUnmeteredProvider: true,
            dotWorkspaceAccess: false, dotAttachmentAccess: false },
          runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
          status: space.requireOperatorApprovalForNewAgents ? "pending_approval" : "idle",
          metadata: { museInvitation: { operatorId } },
        }, { createdByUserId: operatorId });
        const bundle = await agentInstructionsService(database).materializeManagedBundle(created,
          await loadDefaultAgentInstructionsBundle("default"), { entryFile: "AGENTS.md", replaceExisting: false });
        created = (await svc.update(created.id, { adapterConfig: bundle.adapterConfig }, { allowPendingApprovalConfigUpdate: true }))!;
        await database.transaction(async tx => {
          const txDb = tx as unknown as Db;
          const access = accessService(txDb);
          await access.ensureMembership(spaceId, "agent", created.id, "member", "active");
          await access.setPrincipalPermission(spaceId, "agent", created.id, "tasks:assign", true, operatorId);
          const approval = await approvalService(txDb).findOpenCreationApprovalForAgent(spaceId, created.id) ?? (space.requireOperatorApprovalForNewAgents ? await approvalService(txDb).create(spaceId, {
            type: "create_agent", status: "pending", requestedByUserId: operatorId,
            payload: { agentId: created.id, name: created.name, role: created.role, adapterType: created.adapterType,
              adapterConfig: created.adapterConfig, runtimeConfig: created.runtimeConfig, metadata: created.metadata,
              budgetMonthlyCents: created.budgetMonthlyCents, requestedConfigurationSnapshot: {
                adapterType: created.adapterType, runtimeConfig: created.runtimeConfig, adapterConfig: created.adapterConfig,
              } },
          }) : null);
          await logActivity(txDb, { spaceId, actorType: "user", actorId: operatorId, action: "agent.create_created",
            entityType: "agent", entityId: created.id, details: { name: created.name, role: created.role,
              requiresApproval: !!approval, approvalId: approval?.id ?? null, source: "muse-invitation" } });
          if (approval) await logActivity(txDb, { spaceId, actorType: "user", actorId: operatorId, action: "approval.created",
            entityType: "approval", entityId: approval.id, details: { type: "create_agent", agentId: created.id } });
        });
        scheduleAgentLifecycle(db, created.id);
        return describe(created, database);
      }));
    },
  };
}
