import { and, eq, inArray } from "drizzle-orm";
import { agents, userInboxAgentPolicies, type Db } from "@outpost/db";
import type { InboxAgentPolicy, UpdateInboxAgentPolicy } from "@outpost/shared";
import { unprocessable } from "../errors.js";

export function inboxAgentPolicyService(db: Db) {
  async function get(spaceId: string, userId: string): Promise<InboxAgentPolicy> {
    const row = await db
      .select()
      .from(userInboxAgentPolicies)
      .where(and(
        eq(userInboxAgentPolicies.spaceId, spaceId),
        eq(userInboxAgentPolicies.userId, userId),
      ))
      .then((rows) => rows[0] ?? null);
    return row
      ? { ...row, materialized: true }
      : {
          spaceId,
          userId,
          mode: "open",
          allowedAgentIds: [],
          materialized: false,
          createdAt: null,
          updatedAt: null,
        };
  }

  async function update(spaceId: string, userId: string, input: UpdateInboxAgentPolicy): Promise<InboxAgentPolicy> {
    const allowedAgentIds = input.mode === "allowlist" ? [...new Set(input.allowedAgentIds)] : [];
    if (allowedAgentIds.length > 0) {
      const spaceAgentIds = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.spaceId, spaceId), inArray(agents.id, allowedAgentIds)))
        .then((rows) => new Set(rows.map((row) => row.id)));
      const invalidAgentIds = allowedAgentIds.filter((agentId) => !spaceAgentIds.has(agentId));
      if (invalidAgentIds.length > 0) {
        throw unprocessable("Inbox agent policy contains agents outside the space", {
          code: "inbox_agent_policy_invalid_agents",
          invalidAgentIds,
        });
      }
    }
    const now = new Date();
    const [row] = await db
      .insert(userInboxAgentPolicies)
      .values({ spaceId, userId, mode: input.mode, allowedAgentIds, updatedAt: now })
      .onConflictDoUpdate({
        target: [userInboxAgentPolicies.spaceId, userInboxAgentPolicies.userId],
        set: { mode: input.mode, allowedAgentIds, updatedAt: now },
      })
      .returning();
    return { ...row!, materialized: true };
  }

  return { get, update };
}
