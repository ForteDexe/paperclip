import { and, asc, eq, exists, getTableColumns, inArray, notInArray, or, sql } from "drizzle-orm";
import { caseIssueLinks, documents, issueDocuments, issues, type Db } from "@outpost/db";
import { LOW_TRUST_REVIEW_PRESET, SYSTEM_ISSUE_DOCUMENT_KEYS } from "@outpost/shared";
import { authorizationService, issueReadSqlCondition, type AuthorizationActor } from "./authorization.js";

type CaseDocumentDb = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
const MAX_LINKED_TASKS = 500;
const MAX_DOCUMENT_REFERENCES = 200;

/**
 * A case surfaces the owning task's current document metadata, never a copy.
 * Authorization is pushed into the task query, then the canonical batched policy
 * is applied before the document budget. Both queries omit all document bodies.
 */
export async function listCaseTaskDocuments(db: CaseDocumentDb, input: {
  spaceId: string;
  caseId: string;
  workIssueId: string | null;
  actor: AuthorizationActor;
  limit?: number;
  exposeLowTrustRaw?: boolean;
}) {
  const limit = Math.min(MAX_DOCUMENT_REFERENCES, Math.max(1, input.limit ?? MAX_DOCUMENT_REFERENCES));
  const candidates = await db.select({ id: issues.id, identifier: issues.identifier }).from(issues)
    .where(and(eq(issues.spaceId, input.spaceId),
      or(input.workIssueId ? eq(issues.id, input.workIssueId) : undefined,
        exists(db.select({ id: caseIssueLinks.id }).from(caseIssueLinks).where(and(
          eq(caseIssueLinks.spaceId, input.spaceId), eq(caseIssueLinks.caseId, input.caseId),
          eq(caseIssueLinks.issueId, issues.id),
        )))), await issueReadSqlCondition(db, input.actor)))
    .orderBy(sql`case when ${issues.id} = ${input.workIssueId} then 0 else 1 end`, asc(issues.id))
    .limit(MAX_LINKED_TASKS + 1);
  const decisions = await authorizationService(db).decideReads(input.actor, candidates.slice(0, MAX_LINKED_TASKS)
    .map(task => ({ type: "issue" as const, spaceId: input.spaceId, issueId: task.id })));
  const readableTasks = candidates.slice(0, MAX_LINKED_TASKS).filter((_, index) => decisions[index]?.allowed);
  if (!readableTasks.length) return { taskDocuments: [], taskDocumentsOmitted: candidates.length > MAX_LINKED_TASKS };
  const { latestBody: _body, ...metadata } = getTableColumns(documents);
  const allowQuarantined = input.exposeLowTrustRaw ?? input.actor.type === "operator";
  const rows = await db.select({ taskId: issueDocuments.issueId, key: issueDocuments.key, document: metadata })
    .from(issueDocuments)
    .innerJoin(documents, and(eq(documents.id, issueDocuments.documentId), eq(documents.spaceId, input.spaceId)))
    .where(and(eq(issueDocuments.spaceId, input.spaceId), inArray(issueDocuments.issueId, readableTasks.map(task => task.id)),
      notInArray(issueDocuments.key, [...SYSTEM_ISSUE_DOCUMENT_KEYS]),
      allowQuarantined ? undefined : sql`not coalesce(${documents.sourceTrust}->>'preset' = ${LOW_TRUST_REVIEW_PRESET}
        and ${documents.sourceTrust}->>'disposition' = 'quarantined', false)`))
    .orderBy(sql`case when ${issueDocuments.issueId} = ${input.workIssueId} and ${issueDocuments.key} = 'workflow' then 0 else 1 end`,
      sql`case when ${issueDocuments.issueId} = ${input.workIssueId} then 0 else 1 end`, asc(issueDocuments.issueId), asc(issueDocuments.key))
    .limit(limit + 1);
  const tasks = new Map(readableTasks.map(task => [task.id, task]));
  return {
    taskDocuments: rows.slice(0, limit).map(row => ({
      id: `issue:${row.taskId}:${row.key}`,
      sourceKind: "issue" as const,
      taskId: row.taskId,
      taskIdentifier: tasks.get(row.taskId)!.identifier,
      key: row.key,
      scope: row.taskId === input.workIssueId ? "primary" as const : "linked" as const,
      document: row.document,
      readPath: `/api/issues/${row.taskId}/documents/${encodeURIComponent(row.key)}`,
    })),
    taskDocumentsOmitted: rows.length > limit || candidates.length > MAX_LINKED_TASKS,
  };
}
