import { DELIVERY_QUEUES, notifyDeliveryWork } from './delivery-work-notifications.js';
import type { createDeliveryWorkCoordinator } from './delivery-work-coordinator.js';
import type { DeadlineReconciliationSnapshot } from './deadline-reconciliation.js';
import { lockProjectRootMutation } from './projects.js';
import { reserveInitialSkillWork, settleInitialSkillWork } from './skill-source-import-budget.js';
import { admitDeferredSkillImports, lockSkillImportQueue, SKILL_IMPORT_CAPACITY_WAIT } from './skill-source-import-queue.js';
import { randomUUID } from 'node:crypto';
import { skillSourceRetryAt } from './skill-source-retry.js';
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { activityLog, agents, authUsers, heartbeatRuns, spaces, spaceMemberships, spaceSkillSources, spaceSkillSourceEntries,
  projectSkillSources, projectWorkspaces, projects, type Db } from '@outpost/db';
import type { ProjectSkillRepository } from '@outpost/shared';
import { authorizationService, type AuthorizationActor } from './authorization.js';
import { skillSourceGitHubReader } from './skill-source-github-access.js';
import { skillSourceService, type SkillSourceContext } from './skill-sources.js';
import { scanGitHubSkillsWithPackageFallback } from './github-skill-source.js';
import { spaceSkillPolicyService } from './space-skill-policy.js';
import { persistActivity, publishActivity } from './activity-log.js';
import type { ActivityPublication } from './activity-log.js';
import { currentSkillActor, skillAccessService } from './skill-access.js';
import { enqueueProjectSkillSource, projectSkillRepository, projectSkillSetupIdentity } from './project-skill-source-bindings.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { loadConfig } from '../config.js';

export const SKILL_SOURCE_REFRESH_MS = 5 * 60_000;
type Setup = { spaceId: string; refreshUserId: string | null; refreshAgentId: string | null;
  refreshLocalTrusted: boolean; refreshGrantId: string | null; connectionId: string | null };

export async function projectSkillRepositories(db: Db, spaceId: string, actor: AuthorizationActor): Promise<ProjectSkillRepository[]> {
  const rows = await db.select({ workspace: projectWorkspaces, project: projects }).from(projectWorkspaces)
    .innerJoin(projects, and(eq(projects.id, projectWorkspaces.projectId), eq(projects.spaceId, spaceId)))
    .where(eq(projectWorkspaces.spaceId, spaceId)).orderBy(asc(projects.name), asc(projectWorkspaces.name));
  const bindings = await db.select().from(projectSkillSources).where(eq(projectSkillSources.spaceId, spaceId));
  const removed = new Set((await db.select({ id: spaceSkillSources.id }).from(spaceSkillSources)
    .where(and(eq(spaceSkillSources.spaceId, spaceId), sql`${spaceSkillSources.removedAt} is not null`))).map(source => source.id));
  const allowed = new Map<string, boolean>();
  const access = authorizationService(db);
  const result: ProjectSkillRepository[] = [];
  for (const { workspace, project } of rows) {
    const repo = projectSkillRepository(workspace);
    if (!repo) continue;
    if (!allowed.has(project.id)) allowed.set(project.id, (await access.decide({ actor, action: 'project:read',
      resource: { type: 'project', spaceId, projectId: project.id } })).allowed);
    if (!allowed.get(project.id)) continue;
    const binding = bindings.find(item => (item.active || (!item.sourceId && item.lastError !== null)) && item.workspaceId === workspace.id && item.repositoryUrl === repo.repositoryUrl && item.trackingRef === repo.trackingRef);
    result.push({ projectId: project.id, projectName: project.name, projectVisibility: project.visibility as 'open' | 'private',
      workspaceId: workspace.id, ...repo, bindingId: binding?.id ?? null, sourceId: binding?.sourceId && !removed.has(binding.sourceId) ? binding.sourceId : null,
      status: binding?.sourceId && removed.has(binding.sourceId) ? 'available' : binding?.status ?? 'available', lastError: binding?.lastError ?? null,
      ...(binding?.status === 'pending' ? { importState: binding.leaseToken && binding.leaseExpiresAt && binding.leaseExpiresAt > new Date() ? 'importing' as const : 'queued' as const } : {}) });
  }
  return result;
}

export async function adoptProjectSkillRepository(db: Db, spaceId: string, workspaceId: string, authorize: SkillSourceContext['authorize']) {
  const actor = currentSkillActor();
  if (!actor) throw forbidden('Authentication required');
  const [workspace] = await db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.spaceId, spaceId), eq(projectWorkspaces.id, workspaceId)));
  if (!workspace || !(await authorizationService(db).decide({ actor, action: 'project:read', resource: { type: 'project', spaceId, projectId: workspace.projectId } })).allowed) throw notFound('Project repository not found');
  const repository = projectSkillRepository(workspace);
  if (!repository) throw notFound('Project repository not found');
  await authorize('skills.import', { sourceType: 'git', sourceLocator: repository.repositoryUrl });
  return db.transaction(async tx => {
    const database = tx as unknown as Db;
    // Follow the editor: root provenance, project, workspace, then queue/binding.
    const project = await lockProjectRootMutation(tx, workspace.projectId);
    if (!project || project.spaceId !== spaceId) throw notFound('Project repository not found');
    const [currentWorkspace] = await tx.select().from(projectWorkspaces).where(and(
      eq(projectWorkspaces.spaceId, spaceId), eq(projectWorkspaces.projectId, project.id), eq(projectWorkspaces.id, workspaceId))).for('update');
    if (!currentWorkspace) throw notFound('Project repository not found');
    const currentRepository = projectSkillRepository(currentWorkspace);
    if (!currentRepository || currentRepository.repositoryUrl !== repository.repositoryUrl || currentRepository.trackingRef !== repository.trackingRef) {
      throw conflict('Project repository changed. Reload Sources and try again.');
    }
    if (!(await authorizationService(database).decide({ actor, action: 'project:read', resource: { type: 'project', spaceId, projectId: project.id } })).allowed) throw notFound('Project repository not found');
    // Capture the setup before the space queue, consistently with attachment.
    const setup = await projectSkillSetupIdentity(database, spaceId);
    await lockSkillImportQueue(database, spaceId);
    const [previous] = await tx.select({ bindingId: projectSkillSources.id, removedAt: spaceSkillSources.removedAt })
      .from(projectSkillSources).innerJoin(spaceSkillSources, eq(spaceSkillSources.id, projectSkillSources.sourceId))
      .where(and(eq(projectSkillSources.spaceId, spaceId), eq(projectSkillSources.workspaceId, workspace.id),
        eq(projectSkillSources.repositoryUrl, repository.repositoryUrl), eq(projectSkillSources.trackingRef, repository.trackingRef)))
      .for('update');
    if (previous?.removedAt) {
      // Retain the original project's access provenance, but free this workspace
      // for a new tracking identity. Never attach new readers to retained copies.
      await tx.update(projectSkillSources).set({ workspaceId: null, active: false })
        .where(eq(projectSkillSources.id, previous.bindingId));
    }
    const binding = await enqueueProjectSkillSource(database, currentWorkspace, setup);
    if (!binding) throw notFound('Project repository not found');
    if (!binding.sourceId) await tx.update(projectSkillSources).set({ status: 'pending', nextSyncAt: new Date(), failureCount: 0, lastError: binding.lastError === SKILL_IMPORT_CAPACITY_WAIT ? SKILL_IMPORT_CAPACITY_WAIT : null,
      ...setup,
    }).where(eq(projectSkillSources.id, binding.id));
    const { publication } = await persistActivity(database, { spaceId, actorType: actor.type === 'agent' ? 'agent' : 'user',
      actorId: actor.agentId ?? actor.userId ?? 'operator', agentId: actor.agentId, runId: actor.runId,
      action: 'project.skills_import_requested', entityType: 'project', entityId: workspace.projectId, details: { workspaceId, bindingId: binding.id } });
    // Publish only after the transaction completes (caller's route refreshes query state).
    return { bindingId: binding.id, publication };
  });
}

function setupActor(setup: Setup): AuthorizationActor {
  return setup.refreshAgentId ? { type: 'agent', agentId: setup.refreshAgentId, spaceId: setup.spaceId,
    onBehalfOfUserId: setup.refreshUserId === 'local-operator' ? null : setup.refreshUserId, source: 'agent_key' }
    : { type: 'operator', userId: setup.refreshUserId, source: setup.refreshLocalTrusted ? 'local_implicit' : 'session', spaceIds: [setup.spaceId] };
}
export async function skillSourceSetupContext(db: Db, setup: Setup): Promise<SkillSourceContext> {
  if (!setup.refreshUserId && !setup.refreshLocalTrusted) throw forbidden('Choose a GitHub connection to enable automatic updates.');
  if (!setup.refreshLocalTrusted) {
    const [member] = await db.select({ id: spaceMemberships.id }).from(spaceMemberships)
      .innerJoin(authUsers, eq(authUsers.id, spaceMemberships.principalId)).where(and(
      eq(spaceMemberships.spaceId, setup.spaceId), eq(spaceMemberships.principalType, 'user'),
      eq(spaceMemberships.principalId, setup.refreshUserId!), eq(spaceMemberships.status, 'active')));
    if (!member) throw forbidden('The person who connected this source no longer has space access. Choose another GitHub connection.');
  }
  if (setup.refreshAgentId) {
    const [agent] = await db.select({ status: agents.status }).from(agents).where(and(eq(agents.spaceId, setup.spaceId), eq(agents.id, setup.refreshAgentId)));
    if (!agent || agent.status === 'terminated') throw forbidden('The agent who connected this source is unavailable. Choose a GitHub connection.');
  }
  if (setup.refreshAgentId && (!setup.connectionId || !setup.refreshGrantId)) throw forbidden('Choose a GitHub connection to authorize this agent-created repository.');
  const readerActor: AuthorizationActor = { type: 'operator', userId: setup.refreshUserId,
    source: setup.refreshLocalTrusted ? 'local_implicit' : 'session', spaceIds: [setup.spaceId] };
  const actor = setupActor(setup);
  const access = authorizationService(db), policies = spaceSkillPolicyService(db);
  const principal = setup.refreshAgentId ? await policies.resolveAgentPrincipal(setup.spaceId, setup.refreshAgentId)
    : { type: 'operator' as const, id: setup.refreshUserId ?? 'operator', role: 'operator' };
  const readers = new Map<string, ReturnType<typeof skillSourceGitHubReader>>();
  const publications: ActivityPublication[] = [];
  return {
    actor: { type: 'system', userId: setup.refreshUserId, agentId: setup.refreshAgentId },
    setup: { userId: setup.refreshUserId, agentId: setup.refreshAgentId, localTrusted: setup.refreshLocalTrusted, grantId: setup.refreshGrantId },
    read: connectionId => {
      const key = connectionId ?? '';
      for (const reader of readers.values()) if (reader.connectionId && reader.connectionId === connectionId) return reader;
      if (!readers.has(key)) readers.set(key, skillSourceGitHubReader(db, setup.spaceId, readerActor as Parameters<typeof skillSourceGitHubReader>[2], connectionId, { grantId: setup.refreshGrantId }));
      return readers.get(key)!;
    },
    authorize: async (action, resource) => {
      const platform = await access.decide({ actor, action: 'skill_config:update', resource: { type: 'space', spaceId: setup.spaceId } });
      if (!platform.allowed && !['deny_no_grant', 'deny_missing_consent', 'deny_missing_grant'].includes(platform.reason)) throw forbidden('Automatic skill updates are unavailable for the setup identity.');
      if (resource.skillId) await skillAccessService(db, actor).assertSkill(setup.spaceId, resource.skillId);
      const decision = await policies.evaluate({ spaceId: setup.spaceId, principal, action, resource });
      if (!decision.allowed) throw forbidden('Automatic skill updates are denied by space policy.');
    },
    audit: async (tx, sourceId, action, details) => {
      const { publication } = await persistActivity(tx as unknown as Db, { spaceId: setup.spaceId, actorType: 'system', actorId: 'skill-source-sync',
        agentId: setup.refreshAgentId, action, entityType: 'space_skill_source', entityId: sourceId,
        details: { ...details, refreshUserId: setup.refreshUserId } });
      publications.push(publication);
    },
    publishCommittedActivity: () => { for (const publication of publications.splice(0)) publishActivity(publication); },
  };
}

export function skillSourceSyncService(db: Db, options: { context?: (setup: Setup) => Promise<SkillSourceContext> } = {}) {
  const contextFor = options.context ?? (setup => skillSourceSetupContext(db, setup));
  const sources = skillSourceService(db);
  let running: Promise<{ imported: number; checked: number }> | null = null;
  const shutdown = new AbortController();
  const reconciliationId = randomUUID();
  let revision = 0, requested = 0, completed = -1, manual = 0;
  let started = false, reconciling = false;
  let requestReconciliation: (() => void) | undefined;
  const reconciliationSnapshot = (): DeadlineReconciliationSnapshot => ({ revision: `${reconciliationId}:${revision}`,
    reconciled: started && !shutdown.signal.aborted && !reconciling && !running && manual === 0 && requested === completed });

  async function recoverSetup(source: typeof spaceSkillSources.$inferSelect) {
    if (source.refreshUserId || source.refreshLocalTrusted || source.refreshAgentId) return source;
    const installed = await db.select({ id: spaceSkillSourceEntries.skillId }).from(spaceSkillSourceEntries)
      .where(and(eq(spaceSkillSourceEntries.spaceId, source.spaceId), eq(spaceSkillSourceEntries.sourceId, source.id)));
    const skillIds = installed.map(entry => entry.id).filter((id): id is string => Boolean(id));
    const [event] = await db.select().from(activityLog).where(and(eq(activityLog.spaceId, source.spaceId),
      or(eq(activityLog.actorType, 'user'), and(eq(activityLog.actorType, 'agent'), isNotNull(activityLog.runId))),
      inArray(activityLog.action, ['space.skill_source_refreshed', 'space.skill_imported', 'space.skills_imported']),
      or(eq(activityLog.entityId, source.id), ...(skillIds.length ? [inArray(activityLog.entityId, skillIds)] : []))))
      .orderBy(asc(activityLog.createdAt)).limit(1);
    if (!event || !event.actorId || event.actorId === 'operator') return source;
    let userId = event.actorId;
    if (event.actorType === 'agent') {
      const [run] = await db.select({ userId: heartbeatRuns.responsibleUserId }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.spaceId, source.spaceId), eq(heartbeatRuns.id, event.runId!),
        eq(heartbeatRuns.agentId, event.agentId ?? event.actorId)));
      if (!run?.userId) return source;
      userId = run.userId;
    }
    if (!userId) return source;
    const localTrusted = userId === 'local-operator' && loadConfig().deploymentMode === 'local_trusted';
    const [updated] = await db.update(spaceSkillSources).set({ refreshUserId: userId,
      refreshAgentId: event.actorType === 'agent' ? event.agentId ?? event.actorId : null,
      refreshLocalTrusted: localTrusted,
    }).where(and(eq(spaceSkillSources.id, source.id), isNull(spaceSkillSources.refreshUserId))).returning();
    return updated ?? (await db.select().from(spaceSkillSources).where(eq(spaceSkillSources.id, source.id)))[0]!;
  }

  async function importBinding(binding: typeof projectSkillSources.$inferSelect, now: Date) {
    const token = randomUUID();
    const [claimed] = await db.update(projectSkillSources).set({ leaseToken: token, leaseExpiresAt: new Date(now.getTime() + 10 * 60_000) })
      .where(and(eq(projectSkillSources.id, binding.id), eq(projectSkillSources.active, true), isNull(projectSkillSources.sourceId),
        or(isNull(projectSkillSources.leaseToken), lte(projectSkillSources.leaseExpiresAt, now)))).returning();
    if (!claimed) return false;
    try {
      if (!options.context) {
        const actor = setupActor(binding);
        if (!(await authorizationService(db).decide({ actor, action: 'project:read', resource: { type: 'project', spaceId: binding.spaceId, projectId: binding.projectId } })).allowed) throw forbidden('Project access changed. Choose an authorized GitHub connection to retry.');
      }
      const context = await contextFor(binding);
      await context.authorize('skills.import', { sourceType: 'git', sourceLocator: binding.repositoryUrl });
      await reserveInitialSkillWork(db, binding, token, now);
      const reader = context.read(binding.connectionId);
      const scan = await scanGitHubSkillsWithPackageFallback({ repositoryUrl: binding.repositoryUrl, trackingRef: binding.trackingRef, packageMode: 'repository' }, reader, { signal: shutdown.signal });
      const [existing] = await db.select().from(spaceSkillSources).where(and(eq(spaceSkillSources.spaceId, binding.spaceId),
        eq(spaceSkillSources.repositoryUrl, scan.repositoryUrl), eq(spaceSkillSources.trackingRef, binding.trackingRef), isNull(spaceSkillSources.removedAt)));
      let sourceId: string;
      if (existing) {
        await context.authorize('skills.import', { sourceType: 'git', sourceLocator: existing.repositoryUrl });
        sourceId = existing.id;
      } else {
        try {
          const result = await sources.create(binding.spaceId, { repositoryUrl: scan.repositoryUrl, trackingRef: binding.trackingRef,
            commitSha: scan.commitSha, packageMode: scan.packageMode, selectedPaths: scan.candidates.map(candidate => candidate.path),
            connectionId: scan.connectionId ?? binding.connectionId }, { ...context, signal: shutdown.signal, projectBindingId: binding.id, projectBindingLeaseToken: token }, scan);
          sourceId = result.source.id;
        } catch (error) {
          if (!(error instanceof Error && 'status' in error && error.status === 409)) throw error;
          const [concurrent] = await db.select().from(spaceSkillSources).where(and(eq(spaceSkillSources.spaceId, binding.spaceId), eq(spaceSkillSources.repositoryUrl, scan.repositoryUrl), eq(spaceSkillSources.trackingRef, binding.trackingRef), isNull(spaceSkillSources.removedAt)));
          if (!concurrent) throw error;
          sourceId = concurrent.id;
        }
      }
      return await db.transaction(async tx => {
        // Removal locks the source before its bindings. Follow the same order
        // and recheck provenance while that lock prevents concurrent removal.
        const [source] = await tx.select().from(spaceSkillSources).where(and(
          eq(spaceSkillSources.spaceId, binding.spaceId), eq(spaceSkillSources.id, sourceId))).for('update');
        if (!source || source.removedAt) throw conflict('Source was removed during import. Retry to start independent tracking.');
        if (source.trackingRef !== binding.trackingRef || source.repositoryUrl.toLowerCase() !== scan.repositoryUrl.toLowerCase()
          || (source.repositoryId && source.repositoryId !== scan.repositoryId)) {
          throw conflict('Source repository or branch changed during import. Retry from Skills.');
        }
        const linked = await tx.update(projectSkillSources).set({ sourceId, status: 'ready', lastError: null, failureCount: 0, leaseToken: null, leaseExpiresAt: null })
          .where(and(eq(projectSkillSources.id, binding.id), eq(projectSkillSources.spaceId, binding.spaceId),
            eq(projectSkillSources.active, true), eq(projectSkillSources.leaseToken, token))).returning({ id: projectSkillSources.id });
        if (linked.length) await settleInitialSkillWork(tx as unknown as Db, binding.spaceId, scan.packageMode === 'skills' || scan.repositorySubset ? {} : scan);
        return linked.length > 0;
      });
    } catch (error) {
      const message = shutdown.signal.aborted ? binding.lastError : error instanceof Error && 'status' in error ? error.message : 'Skill import failed. Retry from Skills.';
      await db.update(projectSkillSources).set({ status: shutdown.signal.aborted ? 'pending' : 'error', lastError: message, leaseToken: null, leaseExpiresAt: null,
        ...(error instanceof Error && 'status' in error && error.status === 403 ? { active: false } : {}),
        failureCount: shutdown.signal.aborted ? binding.failureCount : binding.failureCount + 1, nextSyncAt: shutdown.signal.aborted ? now : skillSourceRetryAt(error, binding.failureCount, now) })
        .where(and(eq(projectSkillSources.id, binding.id), eq(projectSkillSources.leaseToken, token)));
      return false;
    }
  }

  async function sweep(now: Date) {
    const activeSpaces = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.status, 'active'));
    const ids = activeSpaces.map(space => space.id);
    if (!ids.length) return { imported: 0, checked: 0 };
    for (const id of ids) await admitDeferredSkillImports(db, id, now);
    const pending = await db.select().from(projectSkillSources).where(and(inArray(projectSkillSources.spaceId, ids),
      eq(projectSkillSources.active, true), isNull(projectSkillSources.sourceId), lte(projectSkillSources.nextSyncAt, now),
      or(isNull(projectSkillSources.leaseToken), lte(projectSkillSources.leaseExpiresAt, now))))
      .orderBy(asc(projectSkillSources.nextSyncAt)).limit(10);
    let imported = 0, checked = 0;
    for (const binding of pending) { if (shutdown.signal.aborted) break; if (await importBinding(binding, now)) imported++; }
    const due = await db.select().from(spaceSkillSources).where(and(inArray(spaceSkillSources.spaceId, ids),
      eq(spaceSkillSources.enabled, true), eq(spaceSkillSources.automaticUpdates, true), lte(spaceSkillSources.nextSyncAt, now),
      or(isNull(spaceSkillSources.leaseToken), lte(spaceSkillSources.leaseExpiresAt, now)),
      or(eq(spaceSkillSources.accessScope, 'space'), sql`exists (select 1 from ${projectSkillSources} b where b.source_id = ${spaceSkillSources.id} and b.space_id = ${spaceSkillSources.spaceId} and b.active)`)))
      .orderBy(asc(spaceSkillSources.nextSyncAt)).limit(10);
    for (const entry of due) {
      if (shutdown.signal.aborted) break;
      const source = await recoverSetup(entry);
      try {
        const context = await contextFor(source);
        if (!options.context) {
          try { await skillAccessService(db, setupActor(source)).assertSource(source.spaceId, source.id); }
          catch (error) {
            if (!(error instanceof Error && 'status' in error && error.status === 404)) throw error;
            throw forbidden('The person who connected this source no longer has project access. Choose another GitHub connection.');
          }
        }
        await sources.refresh(source.spaceId, source.id, context, undefined, undefined, { checkCommit: true, automatic: true, now, signal: shutdown.signal });
        checked++;
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 409) continue;
        // Failures in context or policy authorization precede the refresh lease.
        // Compare the attempt and revision so another worker's result wins.
        if (!shutdown.signal.aborted) {
          await db.update(spaceSkillSources).set({ lastError: error instanceof Error && 'status' in error ? error.message : 'Automatic update failed. The installed skills were kept.',
            failureCount: source.failureCount + 1, nextSyncAt: skillSourceRetryAt(error, source.failureCount, now), lastAttemptAt: now })
            .where(and(eq(spaceSkillSources.id, source.id), eq(spaceSkillSources.revision, source.revision),
              eq(spaceSkillSources.failureCount, source.failureCount),
              source.lastAttemptAt ? eq(spaceSkillSources.lastAttemptAt, source.lastAttemptAt) : isNull(spaceSkillSources.lastAttemptAt),
              or(isNull(spaceSkillSources.leaseToken), lte(spaceSkillSources.leaseExpiresAt, now))));
        }
      }
    }
    for (const id of ids) await admitDeferredSkillImports(db, id, new Date());
    return { imported, checked };
  }
  async function performRefreshSource(spaceId: string, sourceId: string, initiator: SkillSourceContext) {
    const [source] = await db.select().from(spaceSkillSources).where(and(eq(spaceSkillSources.spaceId, spaceId), eq(spaceSkillSources.id, sourceId)));
    if (!source) throw notFound('Skill source not found');
    await initiator.authorize('skills.update', { sourceType: 'git', sourceLocator: source.repositoryUrl });
    if (!source.refreshUserId && !source.refreshLocalTrusted) return sources.refresh(spaceId, sourceId, initiator);
    const setup = await contextFor(source);
    if (!options.context) {
      try { await skillAccessService(db, setupActor(source)).assertSource(spaceId, sourceId); }
      catch (error) {
        if (!(error instanceof Error && 'status' in error && error.status === 404)) throw error;
        throw forbidden('The person who connected this source no longer has project access. Choose another GitHub connection.');
      }
    }
    return sources.refresh(spaceId, sourceId, { ...setup, actor: initiator.actor,
      publishCommittedActivity: initiator.publishCommittedActivity,
      authorize: async (action, resource) => { await initiator.authorize(action, resource); await setup.authorize(action, resource); },
      audit: async (tx, id, action, details) => initiator.audit(tx, id, action, { ...details, refreshUserId: source.refreshUserId }),
    });
  }
  function tick(now = new Date()) {
    if (shutdown.signal.aborted) return Promise.resolve({ imported: 0, checked: 0 });
    if (running) return running;
    revision++;
    requested++;
    running = sweep(now).finally(() => {
      running = null; revision++;
      if (!reconciling) requestReconciliation?.();
    });
    return running;
  }
  function start(coordinator: Pick<ReturnType<typeof createDeliveryWorkCoordinator>, 'register'>) {
    started = true; revision++;
    let nextDeadline: number | null = null;
    const registration = coordinator.register(DELIVERY_QUEUES.skillSourceSync, {
      retryMs: 5_000,
      pausePassiveMaintenance: true,
      onSettled: () => { requested++; revision++; },
      onStop: () => { started = false; revision++; requestReconciliation = undefined; },
      async run() {
        reconciling = true; revision++;
        try {
          const pending = tick();
          const generation = requested;
          await pending;
          const [row] = await db.execute<{ next_at: string | Date | null }>(sql`
            SELECT min(at) AS next_at FROM (
              SELECT greatest(b.next_sync_at, CASE WHEN b.lease_token IS NOT NULL THEN b.lease_expires_at END) AS at
              FROM project_skill_sources b JOIN spaces c ON c.id = b.space_id
              WHERE c.status = 'active' AND b.active AND b.source_id IS NULL
              UNION ALL
              SELECT greatest(s.next_sync_at, CASE WHEN s.lease_token IS NOT NULL THEN s.lease_expires_at END) AS at
              FROM space_skill_sources s JOIN spaces c ON c.id = s.space_id
              WHERE c.status = 'active' AND s.enabled AND s.automatic_updates
                AND (s.access_scope = 'space' OR EXISTS (
                  SELECT 1 FROM project_skill_sources b WHERE b.source_id = s.id AND b.space_id = s.space_id AND b.active))
            ) deadlines`);
          if (!row || row.next_at === undefined) throw new Error('Skill sync deadline query returned no result');
          nextDeadline = row.next_at === null ? null : new Date(row.next_at).getTime();
          if (nextDeadline !== null) {
            if (!Number.isFinite(nextDeadline)) throw new Error('Invalid skill sync deadline');
            if (nextDeadline <= Date.now()) nextDeadline = Date.now() + 5_000;
          }
          completed = generation;
        } finally { reconciling = false; revision++; }
      },
      hasPending: async () => false,
      nextRunAt: () => completed !== requested ? Date.now() + 5_000 : nextDeadline,
    });
    requestReconciliation = registration.wake;
    return registration;
  }
  async function refreshSource(spaceId: string, sourceId: string, initiator: SkillSourceContext) {
    manual++; requested++; revision++;
    try { return await performRefreshSource(spaceId, sourceId, initiator); }
    finally { manual--; revision++; requestReconciliation?.(); }
  }
  return { tick, start, refreshSource, reconciliationSnapshot,
    stop: async () => { revision++; shutdown.abort(); await running; } };
}
