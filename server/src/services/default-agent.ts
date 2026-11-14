import { and, eq, isNull } from "drizzle-orm";
import { agents, spaces, type Db } from "@outpost/db";
import { productLabel, type DefaultAgentPreference } from "@outpost/shared";
import { notFound, unprocessable } from "../errors.js";
import { persistActivity, publishActivity } from "./activity-log.js";

/**
 * Set the first agent as the Space default. The conditional update arbitrates
 * concurrent first creations without turning the default into hierarchy.
 */
export async function initializeDefaultAgent(db: Db, spaceId: string, userId: string, agentId: string) {
  const rows = await db.update(spaces).set({
    defaultAgentId: agentId,
    updatedAt: new Date(),
  }).where(and(eq(spaces.id, spaceId), isNull(spaces.defaultAgentId))).returning();
  if (rows.length) await persistActivity(db, {
    spaceId,
    actorType: "user",
    actorId: userId,
    action: "default_agent.initialized",
    entityType: "space",
    entityId: spaceId,
    details: { defaultAgentId: agentId },
  });
}

/** Clear a removed default. A later agent creation may safely become default. */
export async function clearDefaultAgent(db: Db, spaceId: string, agentId: string, _userId?: string) {
  const rows = await db.update(spaces).set({
    defaultAgentId: null,
    updatedAt: new Date(),
  }).where(and(eq(spaces.id, spaceId), eq(spaces.defaultAgentId, agentId))).returning();
  for (const row of rows) await persistActivity(db, {
    spaceId,
    actorType: "system",
    actorId: "default-agent-lifecycle",
    action: "default_agent.cleared",
    entityType: "space",
    entityId: row.id,
    details: { defaultAgentId: agentId },
  });
}

export function defaultAgentService(db: Db) {
  async function get(spaceId: string, userId: string): Promise<DefaultAgentPreference> {
    const row = await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
    return {
      spaceId,
      userId,
      defaultAgentId: row?.defaultAgentId ?? null,
      initialized: Boolean(row?.defaultAgentId),
    };
  }

  return {
    get,
    async set(spaceId: string, userId: string, agentId: string, _actor: Express.Request["actor"]) {
      const result = await db.transaction(async tx => {
        const txDb = tx as unknown as Db;
        const [agent] = await tx.select().from(agents)
          .where(and(eq(agents.spaceId, spaceId), eq(agents.id, agentId))).for("update");
        if (!agent) throw notFound("Agent not found");
        if (agent.status === "terminated" || agent.status === "pending_approval") {
          throw unprocessable(`Choose an active, approved agent as the ${productLabel("defaultAgent", { casing: "lower" })}.`);
        }
        await tx.update(spaces).set({ defaultAgentId: agentId, updatedAt: new Date() })
          .where(eq(spaces.id, spaceId));
        const { publication } = await persistActivity(txDb, {
          spaceId,
          actorType: "user",
          actorId: userId,
          action: "default_agent.updated",
          entityType: "space",
          entityId: spaceId,
          details: { defaultAgentId: agentId },
        });
        return { preference: await defaultAgentService(txDb).get(spaceId, userId), publication };
      });
      publishActivity(result.publication);
      return result.preference;
    },
  };
}
