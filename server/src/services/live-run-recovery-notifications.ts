import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type LiveRunRecoveryScope = { spaceId: string; runId?: string; issueId?: string; agentId?: string };

export async function notifyActiveRunSilence(tx: object, scope?: LiveRunRecoveryScope) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.activeRunSilence, scope
    ? JSON.stringify({ spaceId: scope.spaceId, runId: scope.runId, issueId: scope.issueId }) : "*");
}

export async function notifyActiveExecutionRecovery(tx: object, scope: { spaceId: string; runId: string }) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.activeExecutionRecovery,
    JSON.stringify({ spaceId: scope.spaceId, runId: scope.runId }));
}

export async function notifyLiveRunRecovery(tx: object, scope?: LiveRunRecoveryScope) {
  const hint = scope ? JSON.stringify({ spaceId: scope.spaceId, runId: scope.runId }) : "*";
  for (const queue of [DELIVERY_QUEUES.nativeProcessSessions, DELIVERY_QUEUES.nativeQuestionCancellations,
    DELIVERY_QUEUES.activeExecutionRecovery, DELIVERY_QUEUES.settledNativeProcesses])
    await notifyDeliveryWork(tx, queue, hint);
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.strandedAgentStatus, scope
    ? JSON.stringify({ spaceId: scope.spaceId, agentId: scope.agentId }) : "*");
  await notifyActiveRunSilence(tx, scope);
}

export type LiveResourceRecoveryScope = { spaceId: string; runId?: string; leaseId?: string };

export async function notifyLiveResourceRecovery(tx: object, scope?: LiveResourceRecoveryScope) {
  const hint = scope ? JSON.stringify({ spaceId: scope.spaceId, runId: scope.runId, leaseId: scope.leaseId }) : "*";
  for (const queue of [DELIVERY_QUEUES.orphanActiveLeases, DELIVERY_QUEUES.legacyShutdownSettlement])
    await notifyDeliveryWork(tx, queue, hint);
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.settledNativeProcesses, scope
    ? JSON.stringify({ spaceId: scope.spaceId, runId: scope.runId }) : "*");
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.strandedAgentStatus, scope
    ? JSON.stringify({ spaceId: scope.spaceId }) : "*");
}

export async function notifyStrandedAgentStatus(tx: object, scope: { spaceId: string; agentId: string }) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.strandedAgentStatus,
    JSON.stringify({ spaceId: scope.spaceId, agentId: scope.agentId }));
}
