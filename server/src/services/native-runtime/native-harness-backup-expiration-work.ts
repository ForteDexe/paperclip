import type { Db } from "@outpost/db";
import { logger } from "../../middleware/logger.js";
import type { createDeliveryWorkCoordinator } from "../delivery-work-coordinator.js";
import { DELIVERY_QUEUES } from "../delivery-work-notifications.js";
import { nativeHarnessBackupScopeHint, onNativeHarnessBackupChange, type NativeHarnessBackupExpirationScope } from "../native-harness-backup-expiration-notifications.js";
import { onRetainedNativeSessionCleanupRelease } from "../retained-native-session-cleanup-notifications.js";
import { registerScopedDeadlineWork } from "../scoped-deadline-work.js";
import { nativeHarnessBackupExpirationService, type NativeHarnessBackupDependencies, type NativeHarnessBackupExpirationOptions } from "./native-harness-backup-expiration.js";

type Dependencies = { spaceId: string; agentId: string; sessionId: string; runIds: Set<string>; issueIds: Set<string>; leaseIds: Set<string> };
type Entry = { id: string; spaceId: string; agentId: string; dueAt: number; dependencies: Dependencies };
type Reference = "space" | "agent" | "session" | "run" | "issue" | "lease";

export function registerNativeHarnessBackupExpirationWork(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>, db: Db,
  options: NativeHarnessBackupExpirationOptions, canRun: () => boolean,
) {
  const service = nativeHarnessBackupExpirationService(db, { ...options, duty: "backups" });
  const cursors = new Map<string, string>();
  const sources = new Map<string, Dependencies>();
  const index = new Map<string, Set<string>>();
  const key = (spaceId: string, kind: Reference, id = "") => JSON.stringify([spaceId, kind, id]);
  const sessionKey = (agentId: string, sessionId: string) => JSON.stringify([agentId, sessionId]);
  function references(source: Dependencies) {
    return [key(source.spaceId, "space"), key(source.spaceId, "agent", source.agentId),
      key(source.spaceId, "session", sessionKey(source.agentId, source.sessionId)),
      ...[...source.runIds].map(id => key(source.spaceId, "run", id)),
      ...[...source.issueIds].map(id => key(source.spaceId, "issue", id)),
      ...[...source.leaseIds].map(id => key(source.spaceId, "lease", id))];
  }
  function add(reference: string, id: string) {
    let roots = index.get(reference);
    if (!roots) { roots = new Set(); index.set(reference, roots); }
    roots.add(id);
  }
  function remember(id: string, current?: NativeHarnessBackupDependencies) {
    const previous = sources.get(id);
    if (previous) for (const reference of references(previous)) {
      const roots = index.get(reference)!;
      roots.delete(id); if (!roots.size) index.delete(reference);
    }
    if (!current) { sources.delete(id); return undefined; }
    const source = { spaceId: current.spaceId, agentId: current.agentId,
      sessionId: current.sessionId, runIds: new Set(current.runIds), issueIds: new Set(current.issueIds), leaseIds: new Set(current.leaseIds) };
    sources.set(id, source);
    for (const reference of references(source)) add(reference, id);
    return source;
  }
  function selected(scope: NativeHarnessBackupExpirationScope): Set<string> {
    if (scope.scopeDigest) return new Set([scope.scopeDigest]);
    const reference = scope.leaseId ? key(scope.spaceId, "lease", scope.leaseId)
      : scope.runId ? key(scope.spaceId, "run", scope.runId)
      : scope.sessionId && scope.agentId ? key(scope.spaceId, "session", sessionKey(scope.agentId, scope.sessionId))
      : scope.issueId ? key(scope.spaceId, "issue", scope.issueId)
      : scope.agentId ? key(scope.spaceId, "agent", scope.agentId) : key(scope.spaceId, "space");
    return new Set(index.get(reference) ?? []);
  }
  async function discoverReferences(scope: NativeHarnessBackupExpirationScope) {
    if (scope.scopeDigest || (!scope.runId && !scope.leaseId)) return;
    const resolved = await service.resolveBackupScope(scope);
    const roots = selected(scope);
    if (resolved.scopeDigest) roots.add(resolved.scopeDigest);
    const related = resolved.sessionId && resolved.agentId
      ? selected({ spaceId: scope.spaceId, sessionId: resolved.sessionId, agentId: resolved.agentId })
      : resolved.issueId ? selected({ spaceId: scope.spaceId, issueId: resolved.issueId }) : [];
    for (const id of related) roots.add(id);
    for (const id of roots) {
      const source = sources.get(id);
      if (!source || source.spaceId !== scope.spaceId) continue;
      if (scope.runId) { source.runIds.add(scope.runId); add(key(scope.spaceId, "run", scope.runId), id); }
      if (scope.leaseId) { source.leaseIds.add(scope.leaseId); add(key(scope.spaceId, "lease", scope.leaseId), id); }
    }
  }
  async function reconcile(id: string): Promise<Entry | null> {
    const source = await service.reconcileBackup(id);
    const dependencies = remember(id, source?.dependencies);
    return source && dependencies && source.dueAt !== null ? { ...source, dependencies, dueAt: source.dueAt } : null;
  }
  function matches(entry: Entry, scope?: NativeHarnessBackupExpirationScope) {
    if (!scope) return true;
    if (entry.spaceId !== scope.spaceId) return false;
    if (scope.scopeDigest) return entry.id === scope.scopeDigest;
    if (scope.leaseId) return entry.dependencies.leaseIds.has(scope.leaseId);
    if (scope.runId) return entry.dependencies.runIds.has(scope.runId);
    if (scope.sessionId) return entry.dependencies.sessionId === scope.sessionId
      && (!scope.agentId || entry.agentId === scope.agentId);
    if (scope.issueId) return entry.dependencies.issueIds.has(scope.issueId);
    return !scope.agentId || entry.agentId === scope.agentId;
  }
  const worker = registerScopedDeadlineWork(coordinator, {
    queue: DELIVERY_QUEUES.nativeHarnessBackupExpiration, batchSize: options.maxRemovals ?? 25,
    decodeScope: (hint: string): NativeHarnessBackupExpirationScope | undefined => hint === "*" ? undefined : JSON.parse(hint),
    matches,
    load: async (scope, signal) => {
      const hint = scope ? nativeHarnessBackupScopeHint(scope) : "*";
      if (scope && !cursors.has(hint)) await discoverReferences(scope);
      const limit = options.maxEntries ?? 100;
      const indexed = scope ? [...selected(scope)].filter(id => !cursors.get(hint) || id > cursors.get(hint)!).sort() : null;
      const page = indexed ? { names: indexed.slice(0, limit), complete: indexed.length <= limit }
        : await service.backupScopes(cursors.get(hint), limit);
      const rows: Entry[] = [];
      for (const name of page.names) {
        if (signal?.aborted || !canRun()) throw new Error("Backup expiration discovery paused");
        const entry = await reconcile(name);
        if (entry && (!scope || entry.spaceId === scope.spaceId)) rows.push(entry);
      }
      if (page.complete) cursors.delete(hint); else cursors.set(hint, page.names.at(-1)!);
      return { rows, complete: page.complete };
    },
    check: async (entry, signal) => {
      if (signal?.aborted || !canRun()) throw new Error("Backup expiration paused");
      const current = await reconcile(entry.id);
      if (!current || current.spaceId !== entry.spaceId) return null;
      if (current.dueAt > Date.now()) return current;
      const result = await service.expireBackup(entry.id);
      if (result.candidates || result.failed) logger.info({ ...result, dryRun: options.dryRun ?? false }, "native harness backup expiration");
      if (options.dryRun) return null;
      const remaining = await reconcile(entry.id);
      if (!remaining) return null;
      if (result.skipped.session_active) throw new Error("Backup session is active");
      return remaining;
    },
  }, canRun);
  const unsubscribe = onNativeHarnessBackupChange(db, scope => worker.invalidate(nativeHarnessBackupScopeHint(scope)));
  const release = onRetainedNativeSessionCleanupRelease(db, (_scope, source) => worker.invalidate(nativeHarnessBackupScopeHint(source)));
  return { ...worker, async stop() { unsubscribe(); release(); await worker.stop(); } };
}
