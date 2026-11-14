import { agents, spaces, type Db } from "@outpost/db";
import { AGENT_STATUSES, SPACE_STATUSES } from "@outpost/shared";
import { eq, getTableColumns } from "drizzle-orm";
import { evaluateAgentInvokability } from "../agent-invokability.js";
import { supportsUnscopedTimerHeartbeat } from "../heartbeat-policy.js";
import { createHeartbeatTimerPolicy, heartbeatTimerPolicyIsWellFormed } from "./timer-policy.js";
import { idleDeadlineRowLimit, isFutureIdleDeadline, type IdleDeadlineSnapshot } from "../idle-deadline-types.js";

export async function readIdleAgentTimerSchedule(tx: Pick<Db, "select">, now: number,
  env: Record<string, string | undefined> = process.env, checkBudget: () => void = () => {}): Promise<IdleDeadlineSnapshot> {
  const flags = [env.HEARTBEAT_SCHEDULER_ENABLED, env.OUTPOST_IN_WORKTREE,
    env.OUTPOST_DATABASE_RESTORE_IN_PROGRESS, env.OUTPOST_RESTORE_IN_PROGRESS];
  const state: unknown[] = [flags];
  const blocked = () => ({ blocked: true, state, deadlines: [] });
  if (flags[0] === "false" || flags.slice(1).some(v => ["true", "1", "yes", "on"].includes(v ?? ""))) return blocked();
  const rows = await tx.select({ agent: getTableColumns(agents), spaceStatus: spaces.status,
    spaceUpdatedAt: spaces.updatedAt }).from(agents).leftJoin(spaces, eq(spaces.id, agents.spaceId))
    .orderBy(agents.id).limit(idleDeadlineRowLimit + 1);
  state.push(rows);
  if (rows.length > idleDeadlineRowLimit) return blocked();
  const bySpace = new Map<string, Map<string, typeof agents.$inferSelect>>();
  for (const { agent } of rows) {
    const group = bySpace.get(agent.spaceId) ?? new Map<string, typeof agents.$inferSelect>();
    if (group.has(agent.id)) return blocked();
    group.set(agent.id, agent);
    bySpace.set(agent.spaceId, group);
  }
  const owner = createHeartbeatTimerPolicy(tx);
  const candidates: typeof agents.$inferSelect[] = [];
  const deadlines: number[] = [];
  for (const { agent, spaceStatus } of rows) {
    checkBudget();
    if (!AGENT_STATUSES.includes(agent.status as typeof AGENT_STATUSES[number]) || !spaceStatus || !SPACE_STATUSES.includes(spaceStatus as typeof SPACE_STATUSES[number]) || agent.status === "running") return blocked();
    if (spaceStatus !== "active") continue;
    if (!heartbeatTimerPolicyIsWellFormed(agent)) return blocked();
    const policy = owner.parseHeartbeatPolicy(agent);
    if (!Number.isFinite(policy.intervalSec)) return blocked();
    if (!policy.enabled || policy.intervalSec <= 0 || !supportsUnscopedTimerHeartbeat(agent)) continue;
    const ancestors: typeof agents.$inferSelect[] = [];
    const seen = new Set<string>();
    let current: typeof agents.$inferSelect | undefined = agent;
    while (current && !seen.has(current.id)) {
      checkBudget();
      seen.add(current.id);
      ancestors.push(current);
      current = current.reportsTo ? bySpace.get(agent.spaceId)!.get(current.reportsTo) : undefined;
    }
    const invokability = evaluateAgentInvokability(agent, ancestors);
    if (!invokability.invokable) {
      if (invokability.invalidOrgChain || invokability.reason === "unknown_status") return blocked();
      continue;
    }
    candidates.push(agent);
  }
  const batch = await owner.readTimerHeartbeatSchedules(candidates, new Date(now), checkBudget);
  if (!batch || batch.schedules.size !== candidates.length) return blocked();
  state.push(batch.state);
  for (const agent of candidates) {
    checkBudget();
    const snapshot = batch.schedules.get(agent.id);
    if (!snapshot) return blocked();
    state.push([agent.id, snapshot]);
    if (snapshot.deadline === null) continue;
    if (!isFutureIdleDeadline(snapshot.deadline, now)) return blocked();
    deadlines.push(snapshot.deadline);
  }
  return { blocked: false, state, deadlines };
}
