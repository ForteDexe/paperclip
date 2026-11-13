import { and, eq, isNull } from "drizzle-orm";
import { agents, companies, type Db } from "@paperclipai/db";
import type { PrimaryAgentPreference } from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { persistActivity, publishActivity } from "./activity-log.js";

/**
 * Set the first agent as the Space default. The conditional update arbitrates
 * concurrent first creations without turning the default into hierarchy.
 */
export async function initializePrimaryAgent(db: Db, companyId: string, userId: string, agentId: string) {
  const rows = await db.update(companies).set({
    primaryAgentId: agentId,
    updatedAt: new Date(),
  }).where(and(eq(companies.id, companyId), isNull(companies.primaryAgentId))).returning();
  if (rows.length) await persistActivity(db, {
    companyId,
    actorType: "user",
    actorId: userId,
    action: "primary_agent.initialized",
    entityType: "company",
    entityId: companyId,
    details: { primaryAgentId: agentId },
  });
}

/** Clear a removed primary. A later agent creation may safely become default. */
export async function clearPrimaryAgent(db: Db, companyId: string, agentId: string, _userId?: string) {
  const rows = await db.update(companies).set({
    primaryAgentId: null,
    updatedAt: new Date(),
  }).where(and(eq(companies.id, companyId), eq(companies.primaryAgentId, agentId))).returning();
  for (const row of rows) await persistActivity(db, {
    companyId,
    actorType: "system",
    actorId: "primary-agent-lifecycle",
    action: "primary_agent.cleared",
    entityType: "company",
    entityId: row.id,
    details: { primaryAgentId: agentId },
  });
}

export function primaryAgentService(db: Db) {
  async function get(companyId: string, userId: string): Promise<PrimaryAgentPreference> {
    const row = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    return {
      companyId,
      userId,
      primaryAgentId: row?.primaryAgentId ?? null,
      initialized: Boolean(row?.primaryAgentId),
    };
  }

  return {
    get,
    async set(companyId: string, userId: string, agentId: string, _actor: Express.Request["actor"]) {
      const result = await db.transaction(async tx => {
        const txDb = tx as unknown as Db;
        const [agent] = await tx.select().from(agents)
          .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("update");
        if (!agent) throw notFound("Agent not found");
        if (agent.status === "terminated" || agent.status === "pending_approval") {
          throw unprocessable("Choose an active, approved agent as the default agent.");
        }
        await tx.update(companies).set({ primaryAgentId: agentId, updatedAt: new Date() })
          .where(eq(companies.id, companyId));
        const { publication } = await persistActivity(txDb, {
          companyId,
          actorType: "user",
          actorId: userId,
          action: "primary_agent.updated",
          entityType: "company",
          entityId: companyId,
          details: { primaryAgentId: agentId },
        });
        return { preference: await primaryAgentService(txDb).get(companyId, userId), publication };
      });
      publishActivity(result.publication);
      return result.preference;
    },
  };
}
