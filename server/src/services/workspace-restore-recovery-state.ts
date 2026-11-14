import { hasWorkspaceRestoreFailure } from "@outpost/shared";

export const LEGACY_WORKSPACE_RECOVERY_KEY = "workspaceRestoreRecovery";
export const LEGACY_WORKSPACE_RECOVERY_SCHEMA = "outpost.workspace-restore-recovery.v1";
/** Lease metadata that replaces the hold marker once recovery saved the files
 * and returned the warm sandbox to reuse. It grants no recovery authority. */
export const SETTLED_WORKSPACE_RESTORE_HOLD_KEY = "workspaceRestoreRecoverySettled";

export function hasRequiredWorkspaceRecovery(result: Record<string, unknown> | null | undefined): boolean {
  const value = result?.[LEGACY_WORKSPACE_RECOVERY_KEY];
  return hasWorkspaceRestoreFailure(result) && !!value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).schema === LEGACY_WORKSPACE_RECOVERY_SCHEMA;
}



/** Late adapter/projection writes cannot certify recovery or remove its pin. */
export function preserveWorkspaceRestoreRecoveryMetadata(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  return hasRequiredWorkspaceRecovery(current) ? { ...incoming,
    workspaceRestoreFailure: current!.workspaceRestoreFailure,
    workspaceRestoreRecovery: current!.workspaceRestoreRecovery,
  } : incoming;
}
