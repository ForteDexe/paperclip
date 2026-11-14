import { agentAppearanceSchema } from "@outpost/shared";
import { approvals, type Db } from "@outpost/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { unprocessable } from "../../../errors.js";
import { approvalResolutionRecords, resolvableApprovalStatuses } from "../../../lib/approval-records.js";
import { agentRecords } from "./records.js";
import { createLifecycleStore } from "./postgres.js";
import type { LifecycleEffects } from "./effects.js";

export type CreationDecisionTarget = string | { approvalId: string };
type CreationDecisionResult = {
  approval: typeof approvals.$inferSelect | null;
  agent: Awaited<ReturnType<ReturnType<typeof agentRecords>["getById"]>>;
  applied: boolean;
  activated: boolean;
  createApprovedAgentId: string | null;
};

export function creationApprovalService(db: Db, effects: LifecycleEffects) {
  const { getExistingApproval, resolveApproval } = approvalResolutionRecords(db);
  async function decide(target: CreationDecisionTarget, status: "approved" | "rejected", userId: string, note?: string | null): Promise<CreationDecisionResult | null> {
    const initial = typeof target === "string"
      ? await agentRecords(db, effects).getById(target)
      : await getExistingApproval(target.approvalId);
    if (!initial) return null;
    if (typeof target !== "string" && (!("type" in initial) || initial.type !== "create_agent")) throw unprocessable("Expected a create approval");
    const spaceId = initial.spaceId;
    // Create decisions acquire the space lock before changing an approval or agent.
    return effects.transaction(db, spaceId, async (tx, publications) => {
      const records = agentRecords(tx, effects);
      let approvalId = typeof target === "string" ? null : target.approvalId;
      if (typeof target === "string") {
        const [open] = await tx.select({ id: approvals.id }).from(approvals).where(and(
          eq(approvals.spaceId, spaceId), eq(approvals.type, "create_agent"),
          inArray(approvals.status, resolvableApprovalStatuses),
          sql`${approvals.payload}->>'agentId' = ${target}`,
        )).orderBy(desc(approvals.createdAt)).limit(1);
        approvalId = open?.id ?? null;
      }
      let approval: typeof approvals.$inferSelect | null = null;
      let applied = true;
      if (approvalId) {
        const result = await resolveApproval(approvalId, status, userId, note, tx);
        approval = result.approval;
        applied = result.applied;
      }
      const payload = approval?.payload ?? {};
      let agentId = typeof target === "string" ? target : typeof payload.agentId === "string" ? payload.agentId : null;
      if (applied && status === "approved") {
        if (agentId) {
          const activated = await records.activatePendingApproval(agentId, approval ? payload : null, approval ? approval.requestedByUserId : userId);
          if (!approval) applied = activated?.activated ?? false;
        } else {
          const created = await records.create(spaceId, {
            name: String(payload.name ?? "New Agent"),
            appearance: payload.appearance == null ? undefined : agentAppearanceSchema.parse(payload.appearance),
            role: String(payload.role ?? "general"),
            title: typeof payload.title === "string" ? payload.title : null,
            reportsTo: typeof payload.reportsTo === "string" ? payload.reportsTo : null,
            capabilities: typeof payload.capabilities === "string" ? payload.capabilities : null,
            adapterType: String(payload.adapterType ?? "process"),
            adapterConfig:
              typeof payload.adapterConfig === "object" && payload.adapterConfig !== null
                ? (payload.adapterConfig as Record<string, unknown>)
                : {},
            budgetMonthlyCents:
              typeof payload.budgetMonthlyCents === "number" ? payload.budgetMonthlyCents : 0,
            metadata:
              typeof payload.metadata === "object" && payload.metadata !== null
                ? (payload.metadata as Record<string, unknown>)
                : null,
            status: "idle",
            spentMonthlyCents: 0,
            permissions: undefined,
            lastHeartbeatAt: null,
          }, { runnerResolved: true, createdByUserId: approval!.requestedByAgentId ? null : approval!.requestedByUserId, responsibleUserId: approval!.requestedByUserId });
          agentId = created.id;
        }
        if (approval && agentId && typeof payload.budgetMonthlyCents === "number" && payload.budgetMonthlyCents > 0) {
          await effects.setAgentBudget(tx, publications, spaceId, agentId, payload.budgetMonthlyCents, userId);
        }
      } else if (applied && agentId) {
        if (approval) await records.rejectPendingCreation(agentId);
        else {
          const before = await records.getById(agentId);
          await createLifecycleStore(tx, effects).change(agentId, "reject");
          applied = before?.lifecycleState !== "rejected";
        }
      }
      return { approval, agent: agentId ? await records.getById(agentId) : null, applied,
        activated: status === "approved" && applied,
        createApprovedAgentId: status === "approved" && applied ? agentId : null };
    });
  }
  return { decide };
}
