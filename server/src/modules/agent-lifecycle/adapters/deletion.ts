import { agents, type Db } from "@outpost/db";
import { and, eq, inArray } from "drizzle-orm";
import { agentRecordQueries } from "../../../lib/agent-records.js";
import { assertAgentPurgeAllowed } from "../domain/policy.js";
import type { LifecycleEffects } from "./effects.js";

export async function purgeAgent(db: Db, effects: LifecycleEffects, id: string) {
  const { getById, normalizeAgentRow } = agentRecordQueries(db);
  const existing = await getById(id);
  if (!existing) return null;
  return effects.transaction(db, existing.spaceId, async tx => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, id)).for("update");
    if (!agent) return null;
    assertAgentPurgeAllowed(agent);
    await effects.deleteDependencies(tx, agent.spaceId, id);
    const [deleted] = await tx.delete(agents).where(and(
      eq(agents.id, id), inArray(agents.lifecycleState, ["terminated", "rejected"]),
    )).returning();
    return deleted ? normalizeAgentRow(deleted) : null;
  });
}
