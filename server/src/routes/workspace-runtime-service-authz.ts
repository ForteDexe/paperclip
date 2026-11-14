import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { agents, heartbeatRuns, issues, principalPermissionGrants, projects } from "@outpost/db";
import { isUuidLike } from "@outpost/shared";
import type { Request } from "express";
import { forbidden, notFound } from "../errors.js";
import { assertSpaceAccess, hasSpaceAccess } from "./authz.js";
import { parseProjectExecutionWorkspacePolicy } from "../services/execution-workspace-policy.js";
import { isLowTrustRuntimeManagementAllowed } from "../services/low-trust-runtime-containment.js";
import { resolveCoreTrustPreset, type TrustPresetResolution } from "../services/trust-preset-resolver.js";
import { WORKSPACE_RUNTIME_ELIGIBLE_ISSUE_STATUSES } from "../services/workspace-runtime-leases.js";
import { readObject } from "../lib/objects.js";

const WORKSPACE_RUNTIME_ELIGIBLE_ISSUE_STATUS_LIST: string[] = [...WORKSPACE_RUNTIME_ELIGIBLE_ISSUE_STATUSES];

/**
 * Identity of the actor authorized to drive a workspace runtime control, resolved once
 * so the durable runtime lease and the authorization decision agree on who is calling.
 */
export type WorkspaceRuntimeControlAuthorization = {
  actorType: string;
  agentId: string | null;
  runId: string | null;
  issueId: string | null;
};

function readRunIssueId(context: Record<string, unknown> | null) {
  const directIssueId = context?.issueId;
  if (typeof directIssueId === "string" && isUuidLike(directIssueId)) return directIssueId;
  const outpostIssue = readObject(context?.outpostIssue);
  const nestedIssueId = outpostIssue?.id;
  return typeof nestedIssueId === "string" && isUuidLike(nestedIssueId) ? nestedIssueId : null;
}

async function listReportingSubtreeAgentIds(db: Db, spaceId: string, actorAgentId: string) {
  const spaceAgents = await db
    .select({
      id: agents.id,
      leadAgentId: agents.leadAgentId,
    })
    .from(agents)
    .where(and(eq(agents.spaceId, spaceId), ne(agents.status, "terminated")));

  const agentsByLead = new Map<string, string[]>();
  for (const agent of spaceAgents) {
    if (!agent.leadAgentId) continue;
    const reports = agentsByLead.get(agent.leadAgentId) ?? [];
    reports.push(agent.id);
    agentsByLead.set(agent.leadAgentId, reports);
  }

  const visited = new Set<string>([actorAgentId]);
  const queue = [actorAgentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const reports = agentsByLead.get(current) ?? [];
    for (const reportId of reports) {
      if (visited.has(reportId)) continue;
      visited.add(reportId);
      queue.push(reportId);
    }
  }

  return [...visited];
}

async function assertAgentCanManageRuntimeServicesForWorkspace(
  db: Db,
  req: Request,
  input: {
    spaceId: string;
    projectWorkspaceId?: string | null;
    executionWorkspaceId?: string | null;
    sourceIssueId?: string | null;
  },
): Promise<{ runIssueId: string | null }> {
  if (req.actor.type !== "agent" || !req.actor.agentId) {
    throw forbidden("Agent authentication required");
  }

  const actorAgent = await db
    .select({
      id: agents.id,
      spaceId: agents.spaceId,
      role: agents.role,
      permissions: agents.permissions,
    })
    .from(agents)
    .where(eq(agents.id, req.actor.agentId))
    .then((rows) => rows[0] ?? null);

  if (!actorAgent || actorAgent.spaceId !== input.spaceId) {
    throw forbidden("Agent key cannot access another space");
  }

  const actorRun = req.actor.runId
    ? await db
        .select({
          spaceId: heartbeatRuns.spaceId,
          agentId: heartbeatRuns.agentId,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        })
        .from(heartbeatRuns)
        .where(and(
          eq(heartbeatRuns.id, req.actor.runId),
          eq(heartbeatRuns.spaceId, input.spaceId),
          eq(heartbeatRuns.agentId, actorAgent.id),
        ))
        .then((rows) => rows[0] ?? null)
    : null;
  const runContext = readObject(actorRun?.contextSnapshot);
  const runExecutionPolicy = readObject(runContext?.executionPolicy);

  const actorRuntimeTrust = assertLowTrustCanManageRuntimeForActor({
    spaceId: input.spaceId,
    actorAgent,
    runExecutionPolicy,
  });

  const runIssueId = readRunIssueId(runContext);

  const hasRuntimeGrant = await db.select({ id: principalPermissionGrants.id })
    .from(principalPermissionGrants)
    .where(and(
      eq(principalPermissionGrants.spaceId, input.spaceId),
      eq(principalPermissionGrants.principalType, "agent"),
      eq(principalPermissionGrants.principalId, actorAgent.id),
      eq(principalPermissionGrants.permissionKey, "tools:manage_runtime"),
    ))
    .then((rows) => rows.length > 0);

  if (hasRuntimeGrant && actorRuntimeTrust.kind === "standard") {
    return { runIssueId };
  }

  const runScopedIssue = runIssueId
    ? await db
        .select({
          id: issues.id,
          spaceId: issues.spaceId,
          projectId: issues.projectId,
          executionPolicy: issues.executionPolicy,
          projectExecutionWorkspacePolicy: projects.executionWorkspacePolicy,
        })
        .from(issues)
        .leftJoin(projects, and(eq(projects.id, issues.projectId), eq(projects.spaceId, issues.spaceId)))
        .where(and(
          eq(issues.id, runIssueId),
          eq(issues.spaceId, input.spaceId),
        ))
        .then((rows) => rows[0] ?? null)
    : null;

  if (runScopedIssue) {
    assertLowTrustCanManageRuntimeForIssue({
      actorAgent,
      issue: runScopedIssue,
      projectExecutionWorkspacePolicy: runScopedIssue.projectExecutionWorkspacePolicy,
      runExecutionPolicy,
    });
  }

  const workspaceScopeConditions = [
    input.projectWorkspaceId ? eq(issues.projectWorkspaceId, input.projectWorkspaceId) : null,
    input.executionWorkspaceId ? eq(issues.executionWorkspaceId, input.executionWorkspaceId) : null,
    input.sourceIssueId ? eq(issues.id, input.sourceIssueId) : null,
  ].filter((condition): condition is NonNullable<typeof condition> => condition !== null);

  if (workspaceScopeConditions.length === 0) {
    throw forbidden("Missing permission to manage workspace runtime services");
  }

  const workspaceScopeCondition = workspaceScopeConditions.length === 1
    ? workspaceScopeConditions[0]!
    : or(...workspaceScopeConditions);

  const linkedScopeIssues = await db
    .select({
      id: issues.id,
      spaceId: issues.spaceId,
      projectId: issues.projectId,
      executionPolicy: issues.executionPolicy,
      projectExecutionWorkspacePolicy: projects.executionWorkspacePolicy,
    })
    .from(issues)
    .leftJoin(projects, and(eq(projects.id, issues.projectId), eq(projects.spaceId, issues.spaceId)))
    .where(and(
      eq(issues.spaceId, input.spaceId),
      isNull(issues.hiddenAt),
      inArray(issues.status, WORKSPACE_RUNTIME_ELIGIBLE_ISSUE_STATUS_LIST),
      workspaceScopeCondition,
    ));

  for (const linkedScopeIssue of linkedScopeIssues) {
    assertLowTrustCanManageRuntimeForIssue({
      actorAgent,
      issue: linkedScopeIssue,
      projectExecutionWorkspacePolicy: linkedScopeIssue.projectExecutionWorkspacePolicy,
      runExecutionPolicy,
    });
  }

  if (hasRuntimeGrant) {
    return { runIssueId };
  }

  const eligibleAgentIds = await listReportingSubtreeAgentIds(db, input.spaceId, actorAgent.id);
  const linkedIssue = await db
    .select({
      id: issues.id,
      spaceId: issues.spaceId,
      projectId: issues.projectId,
      executionPolicy: issues.executionPolicy,
      projectExecutionWorkspacePolicy: projects.executionWorkspacePolicy,
    })
    .from(issues)
    .leftJoin(projects, and(eq(projects.id, issues.projectId), eq(projects.spaceId, issues.spaceId)))
    .where(and(
      eq(issues.spaceId, input.spaceId),
      isNull(issues.hiddenAt),
      inArray(issues.status, WORKSPACE_RUNTIME_ELIGIBLE_ISSUE_STATUS_LIST),
      inArray(issues.assigneeAgentId, eligibleAgentIds),
      workspaceScopeCondition,
    ))
    .then((rows) => rows[0] ?? null);

  if (linkedIssue) {
    assertLowTrustCanManageRuntimeForIssue({
      actorAgent,
      issue: linkedIssue,
      projectExecutionWorkspacePolicy: linkedIssue.projectExecutionWorkspacePolicy,
      runExecutionPolicy,
    });
    return { runIssueId };
  }

  throw forbidden("Missing permission to manage workspace runtime services");
}

function assertLowTrustCanManageRuntimeForActor(input: {
  spaceId: string;
  actorAgent: {
    id: string;
    spaceId: string;
    permissions: unknown;
  };
  runExecutionPolicy?: unknown;
}): TrustPresetResolution {
  const resolution = resolveCoreTrustPreset({
    spaceId: input.spaceId,
    agent: {
      spaceId: input.actorAgent.spaceId,
      permissions: input.actorAgent.permissions,
    },
    run: input.runExecutionPolicy
      ? {
          spaceId: input.spaceId,
          executionPolicy: input.runExecutionPolicy,
        }
      : null,
  });
  if (resolution.kind === "denied") {
    throw forbidden(`Low-trust runtime service access denied: ${resolution.detail}`);
  }
  if (resolution.kind !== "low_trust_review") return resolution;
  if (isLowTrustRuntimeManagementAllowed(resolution)) return resolution;
  throw forbidden("Low-trust runs cannot manage workspace runtime services unless the boundary grants runtime.manage");
}

function assertLowTrustCanManageRuntimeForIssue(input: {
  actorAgent: {
    id: string;
    spaceId: string;
    permissions: unknown;
  };
  issue: {
    id: string;
    spaceId: string;
    projectId: string | null;
    executionPolicy: unknown;
  };
  projectExecutionWorkspacePolicy: unknown;
  runExecutionPolicy?: unknown;
}) {
  const resolution = resolveCoreTrustPreset({
    spaceId: input.issue.spaceId,
    agent: {
      spaceId: input.actorAgent.spaceId,
      permissions: input.actorAgent.permissions,
    },
    project: input.issue.projectId
      ? {
          spaceId: input.issue.spaceId,
          executionWorkspacePolicy: parseProjectExecutionWorkspacePolicy(input.projectExecutionWorkspacePolicy),
        }
      : null,
    issue: {
      spaceId: input.issue.spaceId,
      executionPolicy: input.issue.executionPolicy,
    },
    run: input.runExecutionPolicy
      ? {
          spaceId: input.issue.spaceId,
          executionPolicy: input.runExecutionPolicy,
        }
      : null,
  });
  if (resolution.kind === "denied") {
    throw forbidden(`Low-trust runtime service access denied: ${resolution.detail}`);
  }
  if (resolution.kind !== "low_trust_review") return;
  if (isLowTrustRuntimeManagementAllowed(resolution)) return;
  throw forbidden("Low-trust runs cannot manage workspace runtime services unless the boundary grants runtime.manage");
}

export async function assertCanManageProjectWorkspaceRuntimeServices(
  db: Db,
  req: Request,
  input: {
    spaceId: string;
    projectWorkspaceId: string;
  },
) {
  if (!hasSpaceAccess(req, input.spaceId)) {
    throw notFound("Project workspace not found");
  }
  assertSpaceAccess(req, input.spaceId);
  if (req.actor.type === "operator") return;
  await assertAgentCanManageRuntimeServicesForWorkspace(db, req, input);
}

export async function assertCanManageExecutionWorkspaceRuntimeServices(
  db: Db,
  req: Request,
  input: {
    spaceId: string;
    executionWorkspaceId: string;
    sourceIssueId?: string | null;
  },
): Promise<WorkspaceRuntimeControlAuthorization> {
  if (!hasSpaceAccess(req, input.spaceId)) {
    throw notFound("Execution workspace not found");
  }
  assertSpaceAccess(req, input.spaceId);
  if (req.actor.type === "operator") {
    return { actorType: "operator", agentId: null, runId: null, issueId: null };
  }
  const { runIssueId } = await assertAgentCanManageRuntimeServicesForWorkspace(db, req, input);
  return {
    actorType: req.actor.type,
    agentId: req.actor.agentId ?? null,
    runId: req.actor.runId ?? null,
    issueId: runIssueId,
  };
}
