import { agents } from "@outpost/db";
import { and, eq, inArray } from "drizzle-orm";
import type { SpaceDeletionParticipant } from "../../../lib/space-deletion.js";
import { AgentLifecycleConflict, assertAgentPurgeAllowed } from "../domain/policy.js";

export const agentLifecycleSpaceDeletion: SpaceDeletionParticipant = {
  async deleteSpaceData(tx, spaceId) {
    if (!("nestedIndex" in tx)) {
      throw new AgentLifecycleConflict("Outpost deletion requires a database transaction");
    }
    const rows = await tx.select({ lifecycleState: agents.lifecycleState }).from(agents)
      .where(eq(agents.spaceId, spaceId)).for("update");
    for (const agent of rows) assertAgentPurgeAllowed(agent);
    await tx.delete(agents).where(and(
      eq(agents.spaceId, spaceId),
      inArray(agents.lifecycleState, ["terminated", "rejected"]),
    ));
  },
};
