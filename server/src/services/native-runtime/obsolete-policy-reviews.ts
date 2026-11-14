import type { ObsoletePolicyReviewScope } from "../obsolete-policy-review-notifications.js";
import { DELIVERY_QUEUES } from "../delivery-work-notifications.js";
import type { createDeliveryWorkCoordinator } from "../delivery-work-coordinator.js";
import { registerScopedDeadlineWork } from "../scoped-deadline-work.js";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  approvals, heartbeatRuns, issueApprovals, issueThreadInteractions, issues,
  nativeRunFinalizations, statusDecisionEffects, statusDecisions, workAssessments,
  type Db,
} from "@outpost/db";
import { logger } from "../../middleware/logger.js";
import { issueService } from "../issues.js";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { enqueueTerminalIssueInteractionChatPublications } from "../chat-interaction-publications.js";
import { notifyChatRunMilestones } from "../chat-run-milestone-notifications.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";

const obsoletePrompt = "Review the superseding native policy assessment.";

/** Retire only the old version-change gate, never a real completion review. */
function findObsoletePolicyReviews(db: Db, options: { runIds?: string[]; scope?: ObsoletePolicyReviewScope; id?: string; after?: string } = {}) {
  return db.select({
    interaction: issueThreadInteractions,
    decision: statusDecisions,
    priorDecisionId: workAssessments.priorDecisionId,
  }).from(issueThreadInteractions)
    .innerJoin(statusDecisionEffects, and(
      eq(statusDecisionEffects.spaceId, issueThreadInteractions.spaceId),
      eq(statusDecisionEffects.issueId, issueThreadInteractions.issueId),
      sql`${statusDecisionEffects.targetId} = ${issueThreadInteractions.id}::text`,
      eq(statusDecisionEffects.targetType, "issue_thread_interaction"),
      eq(statusDecisionEffects.effectKind, "bind_reviewer"),
    ))
    .innerJoin(statusDecisions, and(
      eq(statusDecisions.id, statusDecisionEffects.decisionId),
      eq(statusDecisions.spaceId, issueThreadInteractions.spaceId),
      eq(statusDecisions.issueId, issueThreadInteractions.issueId),
      eq(statusDecisions.runId, issueThreadInteractions.sourceRunId),
    ))
    .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, issueThreadInteractions.sourceRunId),
      eq(heartbeatRuns.spaceId, issueThreadInteractions.spaceId)))
    .innerJoin(workAssessments, and(
      eq(workAssessments.id, statusDecisions.assessmentId),
      eq(workAssessments.spaceId, statusDecisions.spaceId),
      eq(workAssessments.issueId, statusDecisions.issueId),
    ))
    .where(and(
      eq(issueThreadInteractions.status, "pending"),
      eq(issueThreadInteractions.kind, "request_confirmation"),
      or(isNull(issueThreadInteractions.createdByAgentId),
        eq(issueThreadInteractions.createdByAgentId, heartbeatRuns.agentId)),
      isNull(issueThreadInteractions.createdByUserId),
      eq(statusDecisions.applicationState, "applied"),
      eq(statusDecisions.reasonCode, "completion_review_required"),
      eq(statusDecisions.toStatus, "in_review"),
      sql`${issueThreadInteractions.idempotencyKey} = 'native-review:' || ${statusDecisions.id}::text`,
      sql`${issueThreadInteractions.payload}->>'prompt' = ${obsoletePrompt}`,
      // Match the complete old decision, including its unique assessment-only effect.
      sql`${statusDecisions.decisionJson}->'effects' = ${JSON.stringify([
        { kind: "bind_reviewer", prompt: obsoletePrompt, ownerUserId: null },
        { kind: "append_superseding_assessment" },
      ])}::jsonb`,
      ...(options.runIds?.length ? [inArray(statusDecisions.runId, options.runIds)] : []),
      options.scope ? and(eq(issueThreadInteractions.spaceId, options.scope.spaceId), eq(issueThreadInteractions.issueId, options.scope.issueId)) : undefined,
      options.id ? eq(issueThreadInteractions.id, options.id) : undefined,
      options.after ? gt(issueThreadInteractions.id, options.after) : undefined,
    )).orderBy(asc(issueThreadInteractions.id)).limit(100);
}

export async function dismissObsoleteNativePolicyReviews(db: Db, runIds?: string[]) {
  await dismissCandidates(db, await findObsoletePolicyReviews(db, { runIds }));
}

async function dismissCandidates(db: Db, candidates: Awaited<ReturnType<typeof findObsoletePolicyReviews>>) {
  for (const { interaction, decision, priorDecisionId } of candidates) {
    const publications: ActivityPublication[] = [];
    try {
      await db.transaction(async (tx) => {
        // Same lock order as status commits: coordinator, issue, interaction.
        await tx.select({ runId: nativeRunFinalizations.runId }).from(nativeRunFinalizations)
          .where(and(eq(nativeRunFinalizations.runId, decision.runId),
            eq(nativeRunFinalizations.spaceId, decision.spaceId)))
          .for("update");
        const issue = await tx.select().from(issues).where(and(
          eq(issues.id, decision.issueId), eq(issues.spaceId, decision.spaceId),
        )).for("update").then((rows) => rows[0]);
        if (!issue) return;
        await notifyChatRunMilestones(tx, interaction);
        const now = new Date();
        const [cancelled] = await tx.update(issueThreadInteractions).set({
          status: "cancelled",
          result: { version: 1, outcome: "withdrawn", reason: "An Outpost upgrade does not require completion review." },
          resolvedAt: now,
          updatedAt: now,
        }).where(and(
          eq(issueThreadInteractions.id, interaction.id),
          eq(issueThreadInteractions.spaceId, decision.spaceId),
          eq(issueThreadInteractions.status, "pending"),
          eq(issueThreadInteractions.payload, interaction.payload),
          eq(issueThreadInteractions.kind, interaction.kind),
          eq(issueThreadInteractions.sourceRunId, decision.runId),
          eq(issueThreadInteractions.idempotencyKey, interaction.idempotencyKey!),
          interaction.createdByAgentId
            ? eq(issueThreadInteractions.createdByAgentId, interaction.createdByAgentId)
            : isNull(issueThreadInteractions.createdByAgentId),
          isNull(issueThreadInteractions.createdByUserId),
        )).returning({ id: issueThreadInteractions.id });
        if (!cancelled) return;
        const terminalInteraction = await issueThreadInteractionService(tx as unknown as Db).getById(cancelled.id);
        if (terminalInteraction) {
          await enqueueTerminalIssueInteractionChatPublications(tx as unknown as Db, terminalInteraction);
        }

        const pendingInteraction = await tx.select({ id: issueThreadInteractions.id })
          .from(issueThreadInteractions).where(and(
            eq(issueThreadInteractions.spaceId, issue.spaceId),
            eq(issueThreadInteractions.issueId, issue.id),
            eq(issueThreadInteractions.status, "pending"),
          )).limit(1);
        const pendingApproval = await tx.select({ id: approvals.id }).from(issueApprovals)
          .innerJoin(approvals, and(eq(approvals.id, issueApprovals.approvalId),
            eq(approvals.spaceId, issue.spaceId)))
          .where(and(eq(issueApprovals.spaceId, issue.spaceId), eq(issueApprovals.issueId, issue.id),
            inArray(approvals.status, ["pending", "revision_requested"]))).limit(1);
        const restoreStatus = issue.status === "in_review"
          && issue.lastStatusDecisionId === decision.id
          && issue.statusVersion === Number(decision.decisionJson.projectedStatusVersion ?? decision.decisionVersion)
          && ["backlog", "todo", "in_progress", "blocked"].includes(decision.fromStatus)
          && pendingInteraction.length === 0 && pendingApproval.length === 0
          && issue.executionState?.status !== "pending";
        if (restoreStatus) {
          const priorDecision = priorDecisionId ? await tx.select().from(statusDecisions).where(and(
            eq(statusDecisions.id, priorDecisionId), eq(statusDecisions.spaceId, issue.spaceId),
            eq(statusDecisions.issueId, issue.id),
          )).then((rows) => rows[0]) : null;
          await issueService(tx as unknown as Db).update(issue.id, {
            status: decision.fromStatus,
            // This is an administrative correction, not a replay of the old decision.
            lastStatusDecisionId: null,
            unblockDescriptor: priorDecision?.decisionJson.unblockDescriptor as typeof issue.unblockDescriptor ?? null,
          }, tx, publications);
        }
        const { publication } = await persistActivity(tx as unknown as Db, {
          spaceId: issue.spaceId,
          actorType: "system",
          actorId: "native-policy-review-cleanup",
          action: restoreStatus ? "issue.updated" : "issue.interaction_cancelled",
          entityType: "issue",
          entityId: issue.id,
          issueId: issue.id,
          runId: decision.runId,
          details: {
            source: "obsolete_native_policy_review",
            interactionId: interaction.id,
            decisionId: decision.id,
            fromStatus: issue.status,
            toStatus: restoreStatus ? decision.fromStatus : issue.status,
          },
        });
        publications.push(publication);
      });
    } catch (err) {
      logger.warn({ err, interactionId: interaction.id, issueId: decision.issueId },
        "Failed to withdraw obsolete native policy review; will retry on the next pass");
      continue;
    }
    for (const publication of publications) {
      try {
        publishActivity(publication);
      } catch (err) {
        logger.warn({ err, interactionId: interaction.id, issueId: decision.issueId },
          "Obsolete native policy review cleanup committed; live activity publication failed, history is preserved");
      }
    }
  }
}

export function registerObsoletePolicyReviewWork(db: Db, coordinator: ReturnType<typeof createDeliveryWorkCoordinator>, canRun: () => boolean) {
  type Entry = { id: string; spaceId: string; issueId: string; dueAt: number };
  async function load(scope?: ObsoletePolicyReviewScope, signal?: AbortSignal): Promise<Entry[]> {
    const entries = new Map<string, Entry>();
    let after: string | undefined;
    while (canRun() && !signal?.aborted) {
      const rows = await findObsoletePolicyReviews(db, { scope, after });
      for (const { interaction } of rows) entries.set(interaction.id, {
        id: interaction.id, spaceId: interaction.spaceId, issueId: interaction.issueId, dueAt: 0,
      });
      if (rows.length < 100) return [...entries.values()];
      after = rows[rows.length - 1].interaction.id;
    }
    throw new Error("Obsolete policy review discovery stopped");
  }
  return registerScopedDeadlineWork(coordinator, {
    queue: DELIVERY_QUEUES.obsoletePolicyReviews, batchSize: 20,
    decodeScope: (hint: string): ObsoletePolicyReviewScope | undefined => hint === "*" ? undefined : JSON.parse(hint),
    matches: (entry: Entry, scope?: ObsoletePolicyReviewScope) => !scope || entry.spaceId === scope.spaceId && entry.issueId === scope.issueId,
    load,
    check: async (entry: Entry, signal?: AbortSignal) => {
      const candidates = await findObsoletePolicyReviews(db, { scope: entry, id: entry.id });
      if (!canRun() || signal?.aborted) throw new Error("Obsolete policy review cleanup stopped");
      await dismissCandidates(db, candidates);
      const pending = await findObsoletePolicyReviews(db, { scope: entry, id: entry.id });
      return pending.length ? { ...entry, dueAt: Date.now() + 30_000 } : null;
    },
  }, canRun);
}
