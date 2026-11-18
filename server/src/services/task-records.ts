import type { Db } from "@outpost/db";
import {
  TASK_RECORD_DOCUMENT_KEY,
  TASK_RECORD_DOCUMENT_TITLE,
  parseTaskRecordBody,
  renderTaskRecordMarkdown,
  serializeTaskRecord,
  taskRecordSchema,
  type TaskRecord,
  type TaskRecordDocument,
} from "@outpost/shared";
import { documentService } from "./documents.js";

type TaskRecordWriter = {
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
};

function toTaskRecordDocument(
  document: Awaited<ReturnType<ReturnType<typeof documentService>["getIssueDocumentByKey"]>>,
): TaskRecordDocument | null {
  if (!document || document.format !== "task_record" || typeof document.body !== "string") return null;
  const record = parseTaskRecordBody(document.body);
  if (!record) return null;
  const { body: _body, ...summary } = document;
  return { ...summary, format: "task_record", record };
}

export function taskRecordService(db: Db) {
  return {
    get: async (issueId: string) => toTaskRecordDocument(
      await documentService(db).getIssueDocumentByKey(issueId, TASK_RECORD_DOCUMENT_KEY),
    ),

    upsert: async (input: {
      issueId: string;
      record: TaskRecord;
      baseRevisionId: string | null;
      changeSummary?: string | null;
      writer?: TaskRecordWriter;
      sourceTrust?: Parameters<ReturnType<typeof documentService>["upsertIssueDocument"]>[0]["sourceTrust"];
      initialTaskCreation?: boolean;
    }) => {
      const record = taskRecordSchema.parse(input.record);
      const saved = await documentService(db).upsertIssueDocument({
        issueId: input.issueId,
        key: TASK_RECORD_DOCUMENT_KEY,
        title: TASK_RECORD_DOCUMENT_TITLE,
        format: "task_record",
        body: serializeTaskRecord(record),
        baseRevisionId: input.baseRevisionId,
        changeSummary: input.changeSummary ?? null,
        createdByAgentId: input.writer?.agentId ?? null,
        createdByUserId: input.writer?.userId ?? null,
        createdByRunId: input.writer?.runId ?? null,
        sourceTrust: input.sourceTrust,
      }, { initialTaskCreation: input.initialTaskCreation });
      const document = toTaskRecordDocument(saved.document);
      if (!document) throw new Error("task_record_persistence_invalid");
      return { ...saved, document };
    },

    renderMarkdown: (record: TaskRecord, title?: string) =>
      renderTaskRecordMarkdown(record, title),
  };
}
