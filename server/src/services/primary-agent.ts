import { and, eq, isNull } from "drizzle-orm";
import { agents, spaces, type Db } from "@outpost/db";
import type { PrimaryAgentPreference } from "@outpost/shared";
import { notFound, unprocessable } from "../errors.js";
import { persistActivity, publishActivity } from "./activity-log.js";

/**
 * Set the first agent as the Space default. The conditional update arbitrates
 * concurrent first creations without turning the default into hierarchy.
 */
export async function initializePrimaryAgent(db: Db, spaceId: string, userId: string, agentId: string) {
  const rows = await db.update(spaces).set({
    primaryAgentId: agentId,
    updatedAt: new Date(),
  }).where(and(eq(spaces.id, spaceId), isNull(spaces.primaryAgentId))).returning();
  if (rows.length) await persistActivity(db, {
    spaceId,
    actorType: "user",
    actorId: userId,
    action: "primary_agent.initialized",
    entityType: "space",
    entityId: spaceId,
    details: { primaryAgentId: agentId },
  });
}

/** Clear a removed primary. A later agent creation may safely become default. */
export async function clearPrimaryAgent(db: Db, spaceId: string, agentId: string, _userId?: string) {
  const rows = await db.update(spaces).set({
    primaryAgentId: null,
    updatedAt: new Date(),
  }).where(and(eq(spaces.id, spaceId), eq(spaces.primaryAgentId, agentId))).returning();
  for (const row of rows) await persistActivity(db, {
    spaceId,
    actorType: "system",
    actorId: "primary-agent-lifecycle",
    action: "primary_agent.cleared",
    entityType: "space",
    entityId: row.id,
    details: { primaryAgentId: agentId },
  });
}

export function primaryAgentService(db: Db) {
  async function get(spaceId: string, userId: string): Promise<PrimaryAgentPreference> {
    const row = await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
    return {
      spaceId,
      userId,
      primaryAgentId: row?.primaryAgentId ?? null,
      initialized: Boolean(row?.primaryAgentId),
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
          throw unprocessable("Choose an active, approved agent as the default agent.");
        }
        await tx.update(spaces).set({ primaryAgentId: agentId, updatedAt: new Date() })
          .where(eq(spaces.id, spaceId));
        const { publication } = await persistActivity(txDb, {
          spaceId,
          actorType: "user",
          actorId: userId,
          action: "primary_agent.updated",
          entityType: "space",
          entityId: spaceId,
          details: { primaryAgentId: agentId },
        });
        return { preference: await primaryAgentService(txDb).get(spaceId, userId), publication };
      });
      publishActivity(result.publication);
      return result.preference;
    },
  };
}
