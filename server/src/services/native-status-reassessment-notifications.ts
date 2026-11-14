import { notifyStatusCardIssueChange } from "./status-card-notifications.js";
import { notifyIssueAttentionRetentionWork } from "./retention-work-notifications.js";
import { notifyIssueRecovery } from "./issue-recovery-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type NativeStatusReassessmentScope = { spaceId: string; issueId?: string; runId?: string; agentId?: string };

export async function notifyNativeStatusReassessment(tx: object, scope: NativeStatusReassessmentScope) {
  await notifyStatusCardIssueChange(tx, scope.spaceId);
  await notifyIssueAttentionRetentionWork(tx, { spaceId: scope.spaceId, issueId: scope.issueId, runId: scope.runId });
  await notifyIssueRecovery(tx, scope ? { spaceId: scope.spaceId } : undefined);
  return notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeStatusReassessment,
    JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId, runId: scope.runId, agentId: scope.agentId }));
}
