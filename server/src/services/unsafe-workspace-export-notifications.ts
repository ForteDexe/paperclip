import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type UnsafeWorkspaceExportScope = { spaceId: string; issueId?: string };

export async function notifyUnsafeWorkspaceExportRecovery(transaction: object, scope: UnsafeWorkspaceExportScope) {
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.unsafeWorkspaceExportRecovery,
    JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId }));
  // Recovery settlement can release a retained remote workspace snapshot.
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.remoteWorkspaceSnapshots,
    scope.issueId ? `issue:${scope.issueId}` : `space:${scope.spaceId}`);
}

export async function notifyUnsafeWorkspaceExportRunChange(transaction: object, run: {
  spaceId: string; nativeIssueId: string | null; contextSnapshot: Record<string, unknown> | null;
}) {
  const contextIssueId = run.contextSnapshot?.issueId;
  const issueIds = new Set([run.nativeIssueId, typeof contextIssueId === "string" ? contextIssueId : null]);
  for (const issueId of issueIds) if (issueId) await notifyUnsafeWorkspaceExportRecovery(transaction, { spaceId: run.spaceId, issueId });
}
