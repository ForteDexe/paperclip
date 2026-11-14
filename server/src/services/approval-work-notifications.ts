import { and, eq } from "drizzle-orm";
import { approvals, issueApprovals, type Db } from "@outpost/db";
import { notifyIssueReviewState } from "./issue-review-state-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export const notifyApprovalQueueWork = (transaction: object, spaceId: string) => notifyDeliveryWork(transaction, DELIVERY_QUEUES.approvalQueueSeeding, spaceId);

type ApprovalChangeScope = { approvalId?: string; issueIds?: string[] };

export async function notifyApprovalWork(transaction: object, spaceId: string, scope?: ApprovalChangeScope) {
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.approvalRetention);
  await notifyApprovalQueueWork(transaction, spaceId);
  const issueIds = new Set(scope?.issueIds);
  if (scope?.approvalId) {



    await (transaction as Db).select({ id: approvals.id }).from(approvals)
      .where(and(eq(approvals.spaceId, spaceId), eq(approvals.id, scope.approvalId))).for("update");
    const links = await (transaction as Db).select({ issueId: issueApprovals.issueId }).from(issueApprovals)
      .where(and(eq(issueApprovals.spaceId, spaceId), eq(issueApprovals.approvalId, scope.approvalId)));
    for (const link of links) issueIds.add(link.issueId);
  }
  for (const issueId of issueIds) await notifyIssueReviewState(transaction, { spaceId, issueId });
}

export function writeApprovalChange<T>(db: Db, spaceId: string, write: (transaction: Db) => Promise<T>, scope?: ApprovalChangeScope): Promise<T> {
  return db.transaction(async tx => {
    await notifyApprovalWork(tx, spaceId, scope);
    return write(tx as unknown as Db);
  });
}
