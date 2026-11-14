import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { activityLog, spaceSkills, spaceSkillSources, projectSkillSources, projects, type Db } from '@outpost/db';
import { authorizationService, projectReadSqlCondition, type AuthorizationActor } from './authorization.js';
import { notFound } from '../errors.js';

// Carries the authenticated identity through shared services, including native API dispatch.
// Background operations must install their stored, revalidated setup identity explicitly.
const actors = new AsyncLocalStorage<AuthorizationActor>();
export const currentSkillActor = () => actors.getStore();
export function withSkillActor<T>(actor: AuthorizationActor, operation: () => T): T {
  return actors.run(actor, operation);
}
export const skillAccessRequestContext: RequestHandler = (req, _res, next) => withSkillActor(req.actor, next);

export function skillAccessService(db: Db, actor = currentSkillActor()) {
  function canReadSpace(spaceId: string) {
    return actor?.type !== 'none' && !(actor?.type === 'agent' && actor.spaceId !== spaceId)
      && !(actor?.type === 'operator' && actor.spaceIds && !actor.spaceIds.includes(spaceId)
        && actor.source !== 'local_implicit' && !actor.isInstanceAdmin);
  }
  async function projectIds(spaceId: string, sourceId?: string) {
    const bindings = await db.select({ sourceId: projectSkillSources.sourceId, projectId: projectSkillSources.projectId })
      .from(projectSkillSources).where(and(eq(projectSkillSources.spaceId, spaceId), isNotNull(projectSkillSources.sourceId),
        ...(sourceId ? [eq(projectSkillSources.sourceId, sourceId)] : [])));
    if (!actor) return bindings;
    const access = authorizationService(db);
    const ids = [...new Set(bindings.map(binding => binding.projectId))];
    const decisions = await access.decideReads(actor, ids.map(projectId => ({ type: 'project', spaceId, projectId })));
    const allowed = new Set(ids.filter((_, index) => decisions[index]?.allowed));
    return bindings.filter(binding => allowed.has(binding.projectId));
  }
  async function visibleSourceIds(spaceId: string) {
    if (!canReadSpace(spaceId)) return [];
    if (!actor) return null;
    const sources = await db.select({ id: spaceSkillSources.id, scope: spaceSkillSources.accessScope })
      .from(spaceSkillSources).where(eq(spaceSkillSources.spaceId, spaceId));
    const permitted = new Set((await projectIds(spaceId)).map(binding => binding.sourceId));
    return sources.filter(source => source.scope === 'space' || permitted.has(source.id)).map(source => source.id);
  }
  async function condition(spaceId: string) {
    if (!canReadSpace(spaceId)) return sql`false`;
    const ids = await visibleSourceIds(spaceId);
    if (ids === null) return sql`true`;
    return or(isNull(spaceSkills.accessSourceId), ids.length ? inArray(spaceSkills.accessSourceId, ids) : sql`false`)!;
  }
  async function assertSkill(spaceId: string, skillId: string) {
    const [row] = await db.select({ id: spaceSkills.id }).from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.id, skillId), await condition(spaceId)));
    if (!row) throw notFound('Skill not found');
  }
  async function assertSource(spaceId: string, sourceId: string) {
    const ids = await visibleSourceIds(spaceId);
    if (ids !== null && !ids.includes(sourceId)) throw notFound('Skill source not found');
  }
  async function activityCondition(spaceId: string) {
    if (!actor) return sql<boolean>`true`;
    const ids = await visibleSourceIds(spaceId);
    const skillCondition = await condition(spaceId);
    const projectCondition = await projectReadSqlCondition(db, actor);
    return sql<boolean>`(
      (${activityLog.entityType} != 'space_skill' or exists (
        select 1 from ${spaceSkills} where ${spaceSkills.spaceId} = ${spaceId}
          and ${spaceSkills.id}::text = ${activityLog.entityId} and ${skillCondition}))
      and (${activityLog.entityType} != 'space_skill_source' or ${ids?.length ? inArray(activityLog.entityId, ids) : sql`false`})
      and (${activityLog.entityType} != 'project' or exists (
        select 1 from ${projects} where ${projects.spaceId} = ${spaceId}
          and ${projects.id}::text = ${activityLog.entityId} and ${projectCondition})))`;
  }
  return { canReadSpace, condition, projectIds, visibleSourceIds, assertSkill, assertSource, activityCondition };
}

/** Independent editable forks retain the originating project set at creation.
 * Membership/visibility remain dynamic; later repository attachments grant no access.
 */
export async function retainProjectSkillAccess(db: Db, spaceId: string, sourceId: string | null | undefined) {
  if (!sourceId) return null;
  return db.transaction(async tx => {
    const [source] = await tx.select().from(spaceSkillSources).where(and(
      eq(spaceSkillSources.spaceId, spaceId), eq(spaceSkillSources.id, sourceId)));
    if (!source || source.removedAt || source.accessScope !== 'projects') return sourceId;
    const origins = await tx.select({ projectId: projectSkillSources.projectId }).from(projectSkillSources)
      .where(and(eq(projectSkillSources.spaceId, spaceId), eq(projectSkillSources.sourceId, sourceId)));
    const id = randomUUID();
    await tx.insert(spaceSkillSources).values({ id, spaceId, repositoryId: source.repositoryId,
      repositoryUrl: source.repositoryUrl, fullName: source.fullName, trackingRef: source.trackingRef,
      accessScope: 'projects', removedAt: new Date(), enabled: false, automaticUpdates: false });
    const projectIds = [...new Set(origins.map(origin => origin.projectId))];
    if (projectIds.length) await tx.insert(projectSkillSources).values(projectIds.map(projectId => ({
      spaceId, projectId, sourceId: id, repositoryUrl: source.repositoryUrl, trackingRef: source.trackingRef,
      active: false, status: 'ready' as const,
    })));
    return id;
  });
}
