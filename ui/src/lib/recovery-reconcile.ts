import type { IssueRecoveryAction } from "@outpost/shared";
import type { CurrentOperatorAccess } from "../api/access";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Best-effort client mirror of the backend `runtime:manage` gate that the break-glass override
 * reconcile (`POST /execution-workspaces/:id/reconcile-branch` in `override` mode) actually
 * enforces. The server re-checks `runtime:manage` for every reconcile and is authoritative, so
 * this is defense-in-depth: it hides the "reconcile anyway" affordance from viewers rather than
 * showing a button that always 403s. For human users, `runtime:manage` grants on the
 * same non-viewer, active-membership condition as recovery resolution (see
 * `server/src/services/authorization.ts`), so the shape matches; per-permission-key overrides
 * are not surfaced to the client and remain the server's call.
 */
export function canOperatorManageRuntime(
  spaceId: string | null | undefined,
  operatorAccess: CurrentOperatorAccess | undefined,
) {
  if (!spaceId || !operatorAccess) return false;
  if (operatorAccess.source === "local_implicit" || operatorAccess.isInstanceAdmin) return true;
  if (!operatorAccess.memberships || operatorAccess.memberships.length === 0) {
    return operatorAccess.spaceIds.includes(spaceId);
  }

  const membership = operatorAccess.memberships.find(
    (item) => item.spaceId === spaceId && item.status === "active",
  );
  if (!membership) return false;
  return membership.membershipRole !== "viewer" && membership.membershipRole !== null;
}

/** Client affordance for operator task mutations; the server rechecks issue access. */
export const canOperatorResolveRecoveryAction = canOperatorManageRuntime;

/** Client mirror of `runtime:confirm_owner_stop`: space owners and administrators,
 * the trusted local operator, or an instance administrator. The server is authoritative. */
export function canOperatorConfirmOwnerStop(
  spaceId: string | null | undefined,
  operatorAccess: CurrentOperatorAccess | undefined,
) {
  if (!spaceId || !operatorAccess) return false;
  if (operatorAccess.source === "local_implicit" || operatorAccess.isInstanceAdmin) return true;
  const membership = operatorAccess.memberships?.find(
    (item) => item.spaceId === spaceId && item.status === "active",
  );
  return membership?.membershipRole === "owner" || membership?.membershipRole === "admin";
}

/** Classifies the native export hold, independently of source or actor readiness. */
export function isRetainedWorkspaceExportCause(cause: unknown): boolean {
  return cause === "native_workspace_sync_out_retry_exhausted" || cause === "native_workspace_sync_out_unrecoverable";
}

/**
 * The execution workspace a reconcile action should target. The recovery card is rendered from a
 * specific `workspace_validation` recovery action whose evidence pins the workspace that diverged;
 * that workspace — not the page-level `issue.executionWorkspaceId` — is the authoritative target.
 * The page-level id can drift (e.g. a re-issue rebinds the issue to a new workspace) while the card
 * still shows the older action, so we prefer the action's evidence and only fall back to the
 * page-level id when the evidence carries no workspace reference.
 *
 * The branch-incoherence failure (the one that renders the reconcile-forward / break-glass actions)
 * records the workspace under `persistedExecutionWorkspaceId`; the not-reusable failure records it
 * under `executionWorkspaceId`. We accept either key so both divergence shapes pin correctly.
 */
export function readRecoveryReconcileWorkspaceId(
  action: IssueRecoveryAction | null | undefined,
): string | null {
  if (!action || action.kind !== "workspace_validation") return null;
  const workspaceValidation = asRecord(action.evidence?.workspaceValidation);
  if (!workspaceValidation) return null;
  const persisted = workspaceValidation.persistedExecutionWorkspaceId;
  if (typeof persisted === "string" && persisted.length > 0) return persisted;
  const executionWorkspaceId = workspaceValidation.executionWorkspaceId;
  if (typeof executionWorkspaceId === "string" && executionWorkspaceId.length > 0) {
    return executionWorkspaceId;
  }
  return null;
}
