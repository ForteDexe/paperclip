import { and, eq, isNull } from "drizzle-orm";
import {
  documentRevisions,
  documents,
  issueDocuments,
  issues,
  type Db,
} from "@outpost/db";
import {
  TASK_RECORD_DOCUMENT_KEY,
  parseTaskRecordBody,
  renderTaskRecordMarkdown,
} from "@outpost/shared";
import { redactQuarantinedBodyForHigherTrust } from "./source-trust.js";

async function getTaskDocumentContext(input: {
  db: Db;
  spaceId: string;
  issueId: string;
  approvedRevisionId?: string | null;
  exposeLowTrustRaw?: boolean;
}, key: string) {
  const { db, spaceId, issueId } = input;
  const document = await db
    .select({
      documentId: documents.id,
      revisionId: documentRevisions.id,
      revisionNumber: documentRevisions.revisionNumber,
      format: documentRevisions.format,
      body: documentRevisions.body,
      sourceTrust: documents.sourceTrust,
    })
    .from(issueDocuments)
    .innerJoin(issues, eq(issues.id, issueDocuments.issueId))
    .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
    .innerJoin(
      documentRevisions,
      and(
        eq(documentRevisions.documentId, documents.id),
        input.approvedRevisionId
          ? eq(documentRevisions.id, input.approvedRevisionId)
          : eq(documentRevisions.id, documents.latestRevisionId),
      ),
    )
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.spaceId, spaceId),
        eq(issueDocuments.spaceId, spaceId),
        eq(documents.spaceId, spaceId),
        eq(documentRevisions.spaceId, spaceId),
        eq(issueDocuments.key, key),
        isNull(issues.conversationAgentId),
      ),
    )
    .then((rows) => rows[0] ?? null);
  return document && !input.exposeLowTrustRaw
    ? redactQuarantinedBodyForHigherTrust(document)
    : document;
}

/** Read the task's durable plan before constructing any provider's assignment. */
export async function getTaskPlanContext(input: {
  db: Db;
  spaceId: string;
  issueId: string;
  approvedRevisionId?: string | null;
  exposeLowTrustRaw?: boolean;
}) {
  return getTaskDocumentContext(input, "plan");
}

/** Read the task's living Task Record before constructing any provider's assignment. */
export async function getTaskRecordContext(input: {
  db: Db;
  spaceId: string;
  issueId: string;
  exposeLowTrustRaw?: boolean;
}) {
  const document = await getTaskDocumentContext(input, TASK_RECORD_DOCUMENT_KEY);
  if (!document || document.format !== "task_record") return null;
  const record = parseTaskRecordBody(document.body);
  return record
    ? { ...document, body: renderTaskRecordMarkdown(record) }
    : null;
}
