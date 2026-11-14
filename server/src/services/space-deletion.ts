import { notifyExternalObjectRefresh } from "./external-object-refresh-notifications.js";
import { notifyIssueRecovery } from "./issue-recovery-notifications.js";
import { notifyUnsafeWorkspaceExportRecovery } from "./unsafe-workspace-export-notifications.js";
import { notifyCancelledWorkspacePreservation } from "./cancelled-workspace-preservation-notifications.js";
import { notifyInstructionCollection } from "./instruction-collection-notifications.js";
import { notifyDirectoryCleanup } from "./directory-cleanup-notifications.js";
import { notifyInstructionCommit } from "./instruction-commit-notifications.js";
import { notifyScheduledRetryCancellation } from "./scheduled-retry-cancellation-notifications.js";
import { notifyChatSpaceConfiguration } from "./chat-channels/configuration-work-notifications.js";
import { chatSpaceDeletion } from "./chat-channels/space-deletion.js";
import { notifyToolConnectionHealth } from "./tool-connection-health-notifications.js";
import { notifySpaceRetentionWork } from "./retention-work-notifications.js";
import { notifyToolReviewChange } from "./tool-review-work-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { withAccountHomeSecretMutationLock } from "@outpost/adapter-codex-local/server";
import type { Db } from "@outpost/db";
import { eq, inArray } from "drizzle-orm";
import { createAgentLifecycle, processAgentLifecycle } from "./agent-lifecycle.js";
import { requestRestorePointDeletion } from "./git-restore-point-ledger.js";
import { agentLifecycleSpaceDeletion } from "../modules/agent-lifecycle/space-deletion.js";
import { executionAdmissionSpaceDeletion } from "../modules/execution-admission/space-deletion.js";
import {
  spaces,
  agents,
  spaceLogos,
  assets,
  agentApiKeys,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  issues,
  issueComments,
  projects,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  runIdentityContexts,
  heartbeatRunEvents,
  costEvents,
  decisionInvocations,
  financeEvents,
  budgetPolicies,
  budgetIncidents,
  issueReadStates,
  approvalComments,
  approvals,
  activityLog,
  spaceSecrets,
  joinRequests,
  invites,
  principalPermissionGrants,
  spaceMemberships,
  spaceSkills,
  cases,
  documents,
  routineRuns,
  routineTriggers,
  routineRevisions,
  routines,
} from "@outpost/db";

export async function deleteSpace(db: Db, id: string) {
  const lifecycle = createAgentLifecycle(db);
  const spaceAgents = await db.select({ id: agents.id }).from(agents).where(eq(agents.spaceId, id));
  for (const agent of spaceAgents) {
    await lifecycle.terminateAgent(agent.id);
    await processAgentLifecycle(db, agent.id);
  }
  return withAccountHomeSecretMutationLock(undefined, id, () => db.transaction(async (tx) => {
        // Exclude accounting writers before taking child locks. KEY SHARE must
        // remain compatible: native writers can already hold a child row while
        // saving a space-scoped result. FOR UPDATE would deadlock that save.
        const [existing] = await tx.select({ id: spaces.id }).from(spaces)
          .where(eq(spaces.id, id)).for("no key update");
        if (!existing) return null;
        await notifyExternalObjectRefresh(tx, id);
        await notifyIssueRecovery(tx, { spaceId: id });
        await notifyChatSpaceConfiguration(tx, id);
        await chatSpaceDeletion.deleteSpaceData(tx, id);
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillSourceSync);
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillPackages);
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.routineSchedules);
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.issueMonitors);
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.secretProposalExpiry, id);
        await notifyToolReviewChange(tx, id);
        // Finance can reference costs and both can reference runs. Incidents
        // reference policies and approvals; delete these dependents first.
        await tx.delete(financeEvents).where(eq(financeEvents.spaceId, id));
        await tx.delete(decisionInvocations).where(eq(decisionInvocations.spaceId, id));
        await tx.delete(costEvents).where(eq(costEvents.spaceId, id));
        await tx.delete(budgetIncidents).where(eq(budgetIncidents.spaceId, id));
        await tx.delete(budgetPolicies).where(eq(budgetPolicies.spaceId, id));
        // Cases retain task and agent references. Their dependent handoffs and
        // access sources cascade here before those task/agent records are removed.
        await tx.delete(cases).where(eq(cases.spaceId, id));
        // Delete from child tables in dependency order
        const spaceRunIds = await tx
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.spaceId, id));

        await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.spaceId, id));
        if (spaceRunIds.length > 0) {
          await tx
            .delete(heartbeatRunEvents)
            .where(inArray(heartbeatRunEvents.runId, spaceRunIds.map((run) => run.id)));
        }
        await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.spaceId, id));
        await tx.delete(activityLog).where(eq(activityLog.spaceId, id));
        await tx.delete(runIdentityContexts).where(eq(runIdentityContexts.spaceId, id));
        await notifyScheduledRetryCancellation(tx, { spaceId: id });
        await notifyInstructionCommit(tx, { spaceId: id });
        await notifyDirectoryCleanup(tx, { spaceId: id });
        await notifyInstructionCollection(tx, { spaceId: id });
        await notifyCancelledWorkspacePreservation(tx, { spaceId: id });
        await notifyUnsafeWorkspaceExportRecovery(tx, { spaceId: id });
        await executionAdmissionSpaceDeletion.deleteSpaceData(tx, id);
        await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.spaceId, id));
        await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, id));
        await tx.delete(agentApiKeys).where(eq(agentApiKeys.spaceId, id));
        await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.spaceId, id));
        // Match receipt completion and comment deletion: task before comment.
        await tx.select({ id: issues.id }).from(issues)
          .where(eq(issues.spaceId, id)).orderBy(issues.id).for("no key update");
        await tx.delete(issueComments).where(eq(issueComments.spaceId, id));
        await tx.delete(approvalComments).where(eq(approvalComments.spaceId, id));
        await notifySpaceRetentionWork(tx, id);
        await tx.delete(approvals).where(eq(approvals.spaceId, id));
        await tx.delete(spaceSecrets).where(eq(spaceSecrets.spaceId, id));
        await tx.delete(joinRequests).where(eq(joinRequests.spaceId, id));
        await tx.delete(invites).where(eq(invites.spaceId, id));
        await tx.delete(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, id));
        await tx.delete(spaceMemberships).where(eq(spaceMemberships.spaceId, id));
        await tx.delete(spaceSkills).where(eq(spaceSkills.spaceId, id));
        await tx.delete(routineRuns).where(eq(routineRuns.spaceId, id));
        await tx.delete(routineTriggers).where(eq(routineTriggers.spaceId, id));
        await tx.delete(routineRevisions).where(eq(routineRevisions.spaceId, id));
        await tx.delete(routines).where(eq(routines.spaceId, id));
        await tx.delete(issueReadStates).where(eq(issueReadStates.spaceId, id));
        await tx.delete(documents).where(eq(documents.spaceId, id));
        await tx.delete(issues).where(eq(issues.spaceId, id));
        await tx.delete(spaceLogos).where(eq(spaceLogos.spaceId, id));
        await tx.delete(assets).where(eq(assets.spaceId, id));
        await tx.delete(goals).where(eq(goals.spaceId, id));
        await requestRestorePointDeletion(tx, { spaceId: id });
        await tx.delete(executionWorkspaces).where(eq(executionWorkspaces.spaceId, id));
        await tx.delete(projects).where(eq(projects.spaceId, id));
        await agentLifecycleSpaceDeletion.deleteSpaceData(tx, id);
        await notifyToolConnectionHealth(tx, id);
        const rows = await tx
          .delete(spaces)
          .where(eq(spaces.id, id))
          .returning();
        return rows[0] ?? null;
      }));
}
