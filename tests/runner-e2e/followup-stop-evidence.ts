import type { RunnerApi } from "./api.js";

type Row = Record<string, any>;
export function followupStopApiState(phase: string, issue: Row | null | undefined, runs: Row[]) {
  return { capturePhase: phase,
    issue: issue ? { id: issue.id, spaceId: issue.spaceId, status: issue.status, executionRunId: issue.executionRunId,
      executionWorkspaceId: issue.executionWorkspaceId } : null,
    runs: runs.map(run => ({ id: run.id, spaceId: run.spaceId, agentId: run.agentId, issueId: run.issueId, nativeIssueId: run.nativeIssueId, contextIssueId: run.contextSnapshot?.issueId,
      status: run.status, nativePhase: run.nativePhase, runtimeMode: run.runtimeMode, startedAt: run.startedAt, finishedAt: run.finishedAt })) };
}

export async function captureFollowupStopFailureApiState(input: {
  api: RunnerApi; spaceId: string; agentId: string; issueId: string | undefined;
  evidence(name: string, value: unknown): Promise<void>;
}) {
  if (!input.issueId) return null;
  const [issue, listed] = await Promise.all([
    input.api.get<Row>(`/api/issues/${input.issueId}`),
    input.api.get<Row[]>(`/api/spaces/${input.spaceId}/heartbeat-runs?agentId=${input.agentId}&limit=20`),
  ]);
  const runs = await Promise.all(listed.map(run => input.api.get<Row>(`/api/heartbeat-runs/${run.id}`)));
  await input.evidence("api-state.json", followupStopApiState("failure", issue, runs));
  return { issue, runs };
}
