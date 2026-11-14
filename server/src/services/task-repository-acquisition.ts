import { and, eq, sql } from "drizzle-orm";
import { agents, heartbeatRuns, issues, projects, executionWorkspaces, type Db } from "@outpost/db";
import { forbidden } from "../errors.js";
import { isDeepStrictEqual } from "node:util";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { LOW_TRUST_ISSUE_ANCESTRY_MAX_DEPTH, resolveCoreTrustPreset } from "./trust-preset-resolver.js";
import { measureRunPhase } from "./execution-preparation-timing.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

type TaskRepositoryAgent = Pick<typeof agents.$inferSelect, "id" | "spaceId" | "permissions">;
type TaskRepositoryIssue = Pick<typeof issues.$inferSelect, "id" | "spaceId" | "projectId" | "executionPolicy">;
type TaskRepositoryProject = Pick<typeof projects.$inferSelect, "spaceId" | "executionWorkspacePolicy">;

export const taskRepositoryRunColumns = {
  id: heartbeatRuns.id, spaceId: heartbeatRuns.spaceId, agentId: heartbeatRuns.agentId,
  responsibleUserId: heartbeatRuns.responsibleUserId, nativeIssueId: heartbeatRuns.nativeIssueId, issueId: heartbeatRuns.issueId,
  contextSnapshot: sql<Record<string, unknown>>`jsonb_build_object('issueId', ${heartbeatRuns.contextSnapshot}->'issueId', 'taskId', ${heartbeatRuns.contextSnapshot}->'taskId', 'executionPolicy', ${heartbeatRuns.contextSnapshot}->'executionPolicy')`,
};
type TaskRepositoryRunIdentity = Pick<typeof heartbeatRuns.$inferSelect, "nativeIssueId" | "issueId" | "contextSnapshot">;

export function taskRepositoryResponsibleUserMatches(actorUserId: string | null | undefined, runUserId: string | null) {
  return (actorUserId ?? null) === runUserId || (runUserId === "local-operator" && actorUserId == null);
}

// A wake for another task can coalesce into a running run and replace its context
// task after admission. The immutable task binding still identifies the admitted work.
export function runRetainsIssueIdentity(run: TaskRepositoryRunIdentity, issueId: string) {
  return issueId === (run.nativeIssueId ?? run.contextSnapshot?.issueId ?? run.contextSnapshot?.taskId ?? run.issueId)
    || issueId === (run.nativeIssueId ?? run.issueId);
}

export function requiresAnonymousRepositoryAcquisition(input: {
  spaceId: string;
  issue: TaskRepositoryIssue;
  agent: TaskRepositoryAgent | undefined;
  project: TaskRepositoryProject | undefined;
  workspaceSourceProject: TaskRepositoryProject | undefined;
  run: Pick<typeof heartbeatRuns.$inferSelect, keyof typeof taskRepositoryRunColumns> | undefined;
  agentId: string | null;
  runId: string | null;
  explicitRunId?: string | null;
}) {
  const { spaceId, issue, agent, project, workspaceSourceProject, run, agentId, runId } = input;
  if (agentId && !agent) throw forbidden("Task repository agent is unavailable");
  if (runId && (!run || (input.explicitRunId && run.agentId !== agentId) || !runRetainsIssueIdentity(run, issue.id))) {
    throw forbidden("Task repository run identity is unavailable");
  }
  const trust = resolveCoreTrustPreset({ spaceId, agent, project, workspaceSourceProject, issue,
    run: run ? { spaceId: run.spaceId, executionPolicy: run.contextSnapshot?.executionPolicy } : null });
  if (trust.kind === "denied") throw forbidden(trust.detail);
  return trust.kind === "low_trust_review";
}

export type TaskWorkspaceCreationTrustContext = {
  parentIssueId?: string | null; projectId?: string | null; assigneeAgentId?: string | null; executionPolicy?: unknown;
};

export async function assertSelectedWorkspaceTrust(db: Db | DbTransaction, input: {
  spaceId: string; sourceProjectId: string | null; actor: AuthorizationActor;
  issueId?: string | null; sourceWorkspaceId?: string | null; assigneeAgentId?: string | null; taskCreation?: TaskWorkspaceCreationTrustContext;
}) {
  if (!input.sourceProjectId) return;
  const [selectedSource] = await measureRunPhase("workspace.access.trust.project_read", async () => db.select({ id: projects.id, spaceId: projects.spaceId,
    executionWorkspacePolicy: projects.executionWorkspacePolicy }).from(projects).where(and(
      eq(projects.spaceId, input.spaceId), eq(projects.id, input.sourceProjectId!))));
  if (!selectedSource) throw forbidden("Selected workspace source project is unavailable");
  if (resolveCoreTrustPreset({ spaceId: input.spaceId, workspaceSourceProject: selectedSource }).kind === "standard") return;
  const incompatible = () => forbidden("Selected workspace source trust is incompatible with the task's execution policy");
  const runId = input.actor.runId;
  const [run] = runId ? await db.select(taskRepositoryRunColumns).from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.spaceId, input.spaceId))) : [];
  const creation = !input.issueId && input.actor.type === "agent" && runId ? input.taskCreation : undefined;
  const runIssueId = run?.nativeIssueId ?? run?.contextSnapshot?.issueId ?? run?.contextSnapshot?.taskId ?? run?.issueId;
  const issueId = input.issueId ?? (creation && typeof runIssueId === "string" ? runIssueId : null);
  const [issue] = issueId ? await db.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.spaceId, input.spaceId))) : [];
  const agentId = input.actor.type === "agent" ? input.actor.agentId : issue?.assigneeAgentId ?? input.assigneeAgentId;
  const [agent] = agentId ? await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.spaceId, input.spaceId))) : [];
  const [project] = issue?.projectId ? await db.select().from(projects).where(and(eq(projects.id, issue.projectId), eq(projects.spaceId, input.spaceId))) : [];
  const workspaceId = input.sourceWorkspaceId === undefined ? issue?.executionWorkspaceId : input.sourceWorkspaceId;
  const [workspace] = workspaceId ? await db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, workspaceId), eq(executionWorkspaces.spaceId, input.spaceId))) : [];
  const [source] = workspace?.projectId ? await db.select().from(projects).where(and(eq(projects.id, workspace.projectId), eq(projects.spaceId, input.spaceId))) : [];
  if ((agentId && !agent) || (runId && (!run || run.agentId !== agentId || !issue || !runRetainsIssueIdentity(run, issue.id)))) throw incompatible();
  const retainedPolicy = run?.contextSnapshot?.executionPolicy;
  const current = resolveCoreTrustPreset({ spaceId: input.spaceId, agent, project, workspaceSourceProject: source, issue,
    run: run ? { spaceId: input.spaceId, executionPolicy: retainedPolicy } : null });
  const selected = run
    ? resolveCoreTrustPreset({ spaceId: input.spaceId, run: { spaceId: input.spaceId, executionPolicy: retainedPolicy } })
    : current;
  if (selected.kind !== "low_trust_review" || current.kind !== "low_trust_review"
    || !isDeepStrictEqual(selected.boundary, current.boundary)) throw incompatible();
  if (creation) {
    if (!taskRepositoryResponsibleUserMatches(input.actor.onBehalfOfUserId, run!.responsibleUserId)) throw incompatible();
    let parentId = creation.parentIssueId;
    const ancestors: Array<typeof issues.$inferSelect> = [];
    for (let depth = 0; parentId && depth < LOW_TRUST_ISSUE_ANCESTRY_MAX_DEPTH; depth++) {
      const [parent] = await db.select().from(issues).where(and(eq(issues.id, parentId), eq(issues.spaceId, input.spaceId)));
      if (!parent || ancestors.some(ancestor => ancestor.id === parent.id)) throw incompatible();
      ancestors.push(parent);
      if (parent.id === issue!.id) break;
      parentId = parent.parentId;
    }
    if (ancestors.at(-1)?.id !== issue!.id) throw incompatible();
    const decision = await authorizationService(db).decide({ actor: input.actor, action: "issue:mutate",
      resource: { type: "issue", spaceId: input.spaceId, parentIssueId: creation.parentIssueId,
        projectId: creation.projectId, assigneeAgentId: creation.assigneeAgentId } });
    if (!decision.allowed) throw incompatible();
    const [childAgent] = creation.assigneeAgentId ? await db.select().from(agents).where(and(
      eq(agents.id, creation.assigneeAgentId), eq(agents.spaceId, input.spaceId))) : [];
    if (creation.assigneeAgentId && !childAgent) throw incompatible();
    for (const candidate of [...ancestors, { spaceId: input.spaceId, projectId: creation.projectId,
      executionPolicy: creation.executionPolicy }]) {
      const [candidateProject] = candidate.projectId ? await db.select().from(projects).where(and(
        eq(projects.id, candidate.projectId), eq(projects.spaceId, input.spaceId))) : [];
      if (candidate.projectId && !candidateProject) throw incompatible();
      const prospective = resolveCoreTrustPreset({ spaceId: input.spaceId,
        agent: "id" in candidate ? agent : childAgent, project: candidateProject, workspaceSourceProject: source,
        issue: candidate, run: { spaceId: input.spaceId, executionPolicy: retainedPolicy } });
      if (prospective.kind !== "low_trust_review" || !isDeepStrictEqual(prospective.boundary, selected.boundary)) throw incompatible();
    }
  }
  const selectedPolicy = { trustPreset: selected.preset, authorizationPolicy: {
    trustPreset: selected.preset, trustBoundary: selected.boundary,
  } };
  const combined = resolveCoreTrustPreset({ spaceId: input.spaceId, workspaceSourceProject: selectedSource,
    run: { spaceId: input.spaceId, executionPolicy: selectedPolicy } });
  if (combined.kind !== "low_trust_review" || !isDeepStrictEqual(combined.boundary, selected.boundary)) throw incompatible();
}
