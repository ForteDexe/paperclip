import { and, asc, eq, isNull, isNotNull, notInArray } from 'drizzle-orm';
import { spaces, projectSkillSources, projectWorkspaces, type Db } from '@outpost/db';

export const MAX_SPACE_PENDING_SKILL_IMPORTS = 100;
export const MAX_PROJECT_PENDING_SKILL_IMPORTS = 20;
export const SKILL_IMPORT_CAPACITY_WAIT = 'Waiting for earlier repository imports to finish.';

/** Call inside the attachment transaction, before locking any binding rows. */
export async function lockSkillImportQueue(db: Db, spaceId: string) {
  await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId)).for('no key update');
  return db.select({ projectId: projectSkillSources.projectId, id: projectSkillSources.id }).from(projectSkillSources)
    .where(and(eq(projectSkillSources.spaceId, spaceId), eq(projectSkillSources.active, true), isNull(projectSkillSources.sourceId)))
    .limit(MAX_SPACE_PENDING_SKILL_IMPORTS);
}

/** Deferred provenance stays durable; free slots admit it without user ceremony. */
export async function admitDeferredSkillImports(db: Db, spaceId: string, now: Date) {
  return db.transaction(async tx => {
    const pending = await lockSkillImportQueue(tx as unknown as Db, spaceId);
    let count = pending.length;
    const perProject = new Map<string, number>();
    for (const row of pending) perProject.set(row.projectId, (perProject.get(row.projectId) ?? 0) + 1);
    if (count >= MAX_SPACE_PENDING_SKILL_IMPORTS) return;
    const fullProjects = [...perProject].filter(([, count]) => count >= MAX_PROJECT_PENDING_SKILL_IMPORTS).map(([id]) => id);
    const waiting = await tx.select({ id: projectSkillSources.id, projectId: projectSkillSources.projectId })
      .from(projectSkillSources).innerJoin(projectWorkspaces, eq(projectWorkspaces.id, projectSkillSources.workspaceId))
      .where(and(eq(projectSkillSources.spaceId, spaceId), eq(projectSkillSources.active, false),
        isNull(projectSkillSources.sourceId), eq(projectSkillSources.status, 'pending'),
        eq(projectSkillSources.lastError, SKILL_IMPORT_CAPACITY_WAIT),
        ...(fullProjects.length ? [notInArray(projectSkillSources.projectId, fullProjects)] : [])))
      .orderBy(asc(projectSkillSources.createdAt)).limit(MAX_SPACE_PENDING_SKILL_IMPORTS);
    for (const row of waiting) {
      if (count >= MAX_SPACE_PENDING_SKILL_IMPORTS) break;
      if ((perProject.get(row.projectId) ?? 0) >= MAX_PROJECT_PENDING_SKILL_IMPORTS) continue;
      await tx.update(projectSkillSources).set({ active: true, lastError: null, nextSyncAt: now })
        .where(and(eq(projectSkillSources.spaceId, spaceId), eq(projectSkillSources.id, row.id),
          isNotNull(projectSkillSources.workspaceId), eq(projectSkillSources.active, false),
          isNull(projectSkillSources.sourceId), eq(projectSkillSources.status, 'pending'),
          eq(projectSkillSources.lastError, SKILL_IMPORT_CAPACITY_WAIT)));
      count++;
      perProject.set(row.projectId, (perProject.get(row.projectId) ?? 0) + 1);
    }
  });
}
