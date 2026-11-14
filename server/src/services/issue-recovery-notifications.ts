import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

/** An issue hint is reserved for local facts such as comments. Lifecycle,
 * graph, run and eligibility changes retain space scope because their
 * consequences can include ancestors and shared execution references. */
export type IssueRecoveryScope = { spaceId: string; issueId?: string };

export async function notifyIssueRecovery(transaction: object, scope?: IssueRecoveryScope) {
  const spaceHint = scope ? JSON.stringify({ spaceId: scope.spaceId }) : "*";
  const issueHint = scope ? JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId }) : "*";
  for (const queue of [DELIVERY_QUEUES.orphanBlockers, DELIVERY_QUEUES.activeRecoveryActions, DELIVERY_QUEUES.strandedAssignments, DELIVERY_QUEUES.resolvedDependencies,
    DELIVERY_QUEUES.taskWatchdogs, DELIVERY_QUEUES.staleIssueLocks]) {
    await notifyDeliveryWork(transaction, queue,
      queue === DELIVERY_QUEUES.strandedAssignments || queue === DELIVERY_QUEUES.staleIssueLocks ? issueHint : spaceHint);
  }
}
