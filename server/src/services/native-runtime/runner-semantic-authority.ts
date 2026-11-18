import { fastResponseHistoryBody } from "@outpost/shared";
import { readTaskQuestionContext } from "../issue-question-context.js";
import { isConversation } from "../agent-conversations.js";
import {
  isLowTrustQuarantined,
  resolveActorSourceTrustForIssue,
  sanitizeQuarantinedCommentForHigherTrust,
} from "../source-trust.js";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@outpost/db";
import {
  agents,
  documentRevisions,
  documents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issues,
} from "@outpost/db";
import {
  OutpostSemanticDispatcher,
  type OutpostJsonValue,
  type OutpostSemanticActionBinding,
  type OutpostSemanticActionId,
  type OutpostSemanticAuthorizationRecord,
  type OutpostSemanticRunContext,
  type OutpostSemanticToolCall,
  type OutpostSemanticToolDefinition,
  type OutpostSemanticToolResult,
} from "../../vendor/outpost-runner/index.js";

export interface OutpostRunnerSemanticBinding {
  readonly spaceId: string;
  readonly issueId: string;
  readonly runId: string;
  readonly agentId: string;
}

const READ_OPERATION_IDS = [
  "get_task_context",
  "get_task_history",
  "list_documents",
  "read_document",
  "list_document_revisions",
] as const satisfies readonly OutpostSemanticActionId[];

type BoundContext = {
  readonly run: typeof heartbeatRuns.$inferSelect;
  readonly issue: typeof issues.$inferSelect;
  readonly agent: typeof agents.$inferSelect;
};

function boundedLimit(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(value, 200))
    : 50;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new Error("outpost_runner_semantic_input_invalid");
  }
  return value;
}

function jsonValue(value: unknown): OutpostJsonValue {
  return JSON.parse(JSON.stringify(value)) as OutpostJsonValue;
}

function activeAgentStatus(status: string): "active" | "inactive" {
  return ["paused", "terminated", "pending_approval", "error"].includes(status)
    ? "inactive"
    : "active";
}

/**
 * Run-scoped semantic authority for the hidden native coordinator.
 * This first server slice binds only same-task read operations. A catalog
 * entry remains undiscoverable until a later PR adds its guarded binding.
 */
export class OutpostRunnerSemanticAuthority {
  readonly #db: Db;
  readonly #binding: OutpostRunnerSemanticBinding;
  readonly #dispatcher: OutpostSemanticDispatcher;

  constructor(db: Db, binding: OutpostRunnerSemanticBinding) {
    this.#db = db;
    this.#binding = structuredClone(binding);
    this.#dispatcher = new OutpostSemanticDispatcher({
      contextProvider: (runId) => this.#context(runId),
      bindings: READ_OPERATION_IDS.map((operationId) =>
        this.#readBinding(operationId),
      ),
    });
  }

  listAlwaysAvailableTools(): Promise<
    readonly OutpostSemanticToolDefinition[]
  > {
    return this.#dispatcher.listAlwaysAvailableTools(this.#binding.runId);
  }

  dispatch(
    call: Omit<OutpostSemanticToolCall, "runId">,
  ): Promise<OutpostSemanticToolResult> {
    return this.#dispatcher.dispatch({ ...call, runId: this.#binding.runId });
  }

  authorizationRecords(): readonly OutpostSemanticAuthorizationRecord[] {
    return this.#dispatcher.authorizationRecords();
  }

  #readBinding(
    operationId: (typeof READ_OPERATION_IDS)[number],
  ): OutpostSemanticActionBinding {
    return {
      operationId,
      execute: async (invocation) => {
        const context = await this.#loadBoundContext();
        this.#assertActiveContext(context, true);
        const input = invocation.input;
        switch (operationId) {
          case "get_task_context":
            return {
              value: jsonValue({
                space: { id: this.#binding.spaceId },
                actor: {
                  id: context.agent.id,
                  name: context.agent.name,
                  role: context.agent.role,
                  title: context.agent.title,
                  capabilities: context.agent.capabilities,
                },
                taskQuestionContext: await readTaskQuestionContext(this.#db, {
                  ...this.#binding, conversationMode: isConversation(context.issue),
                }),
                activeTask: {
                  id: context.issue.id,
                  identifier: context.issue.identifier,
                  title: context.issue.title,
                  description: context.issue.description,
                  status: context.issue.status,
                  statusVersion: context.issue.statusVersion,
                  priority: context.issue.priority,
                  workMode: context.issue.workMode,
                  runIntent: context.issue.runIntent,
                  parentId: context.issue.parentId,
                  projectId: context.issue.projectId,
                  goalId: context.issue.goalId,
                },
                run: {
                  id: context.run.id,
                  status: context.run.status,
                  invocationSource: context.run.invocationSource,
                },
              }),
              references: [{ kind: "task", id: context.issue.id }],
            };
          case "get_task_history": {
            const rows = await this.#db
              .select({
                id: issueComments.id,
                body: issueComments.body,
                origin: issueComments.origin,
                sourceTrust: issueComments.sourceTrust,
                authorAgentId: issueComments.authorAgentId,
                authorUserId: issueComments.authorUserId,
                createdAt: issueComments.createdAt,
              })
              .from(issueComments)
              .where(
                and(
                  eq(issueComments.spaceId, this.#binding.spaceId),
                  eq(issueComments.issueId, this.#binding.issueId),
                  isNull(issueComments.deletedAt),
                ),
              )
              .orderBy(desc(issueComments.createdAt))
              .limit(boundedLimit(input.limit));
            const readerSourceTrust = await resolveActorSourceTrustForIssue({
              db: this.#db,
              issue: context.issue,
              actor: { actorType: "agent", actorId: context.agent.id, agentId: context.agent.id, runId: context.run.id },
            });
            const comments = rows.reverse().map(row => {
              const comment = isLowTrustQuarantined(readerSourceTrust)
                ? row
                : sanitizeQuarantinedCommentForHigherTrust(row);
              return { ...comment, body: fastResponseHistoryBody(comment) };
            });
            return {
              value: jsonValue({ comments }),
              references: [{ kind: "task", id: context.issue.id }],
            };
          }
          case "list_documents": {
            const rows = await this.#db
              .select({
                key: issueDocuments.key,
                id: documents.id,
                title: documents.title,
                format: documents.format,
                latestRevisionId: documents.latestRevisionId,
                latestRevisionNumber: documents.latestRevisionNumber,
                lockedAt: documents.lockedAt,
                updatedAt: documents.updatedAt,
              })
              .from(issueDocuments)
              .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
              .where(
                and(
                  eq(issueDocuments.spaceId, this.#binding.spaceId),
                  eq(issueDocuments.issueId, this.#binding.issueId),
                  eq(documents.spaceId, this.#binding.spaceId),
                ),
              );
            return {
              value: jsonValue({ documents: rows }),
              references: rows.map((row) => ({
                kind: "document_revision" as const,
                id: row.latestRevisionId ?? row.id,
              })),
            };
          }
          case "read_document": {
            const key = requiredString(input.key);
            const [row] = await this.#db
              .select({
                key: issueDocuments.key,
                id: documents.id,
                title: documents.title,
                format: documents.format,
                body: documents.latestBody,
                latestRevisionId: documents.latestRevisionId,
                latestRevisionNumber: documents.latestRevisionNumber,
                lockedAt: documents.lockedAt,
                updatedAt: documents.updatedAt,
              })
              .from(issueDocuments)
              .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
              .where(
                and(
                  eq(issueDocuments.spaceId, this.#binding.spaceId),
                  eq(issueDocuments.issueId, this.#binding.issueId),
                  eq(issueDocuments.key, key),
                  eq(documents.spaceId, this.#binding.spaceId),
                ),
              )
              .limit(1);
            if (!row) throw new Error("outpost_runner_document_not_found");
            return {
              value: jsonValue({ document: row }),
              references: [
                {
                  kind: "document_revision",
                  id: row.latestRevisionId ?? row.id,
                },
              ],
            };
          }
          case "list_document_revisions": {
            const key = requiredString(input.key);
            const rows = await this.#db
              .select({
                id: documentRevisions.id,
                revisionNumber: documentRevisions.revisionNumber,
                title: documentRevisions.title,
                format: documentRevisions.format,
                body: documentRevisions.body,
                changeSummary: documentRevisions.changeSummary,
                createdByAgentId: documentRevisions.createdByAgentId,
                createdByUserId: documentRevisions.createdByUserId,
                createdAt: documentRevisions.createdAt,
              })
              .from(issueDocuments)
              .innerJoin(
                documentRevisions,
                eq(documentRevisions.documentId, issueDocuments.documentId),
              )
              .where(
                and(
                  eq(issueDocuments.spaceId, this.#binding.spaceId),
                  eq(issueDocuments.issueId, this.#binding.issueId),
                  eq(issueDocuments.key, key),
                  eq(documentRevisions.spaceId, this.#binding.spaceId),
                ),
              )
              .orderBy(desc(documentRevisions.revisionNumber))
              .limit(boundedLimit(input.limit));
            return {
              value: jsonValue({ revisions: rows }),
              references: rows.map((row) => ({
                kind: "document_revision" as const,
                id: row.id,
              })),
            };
          }
        }
      },
    };
  }

  async #context(requestedRunId: string): Promise<OutpostSemanticRunContext> {
    if (requestedRunId !== this.#binding.runId) {
      throw new Error("outpost_runner_semantic_run_mismatch");
    }
    const context = await this.#loadBoundContext();
    this.#assertActiveContext(context, false);
    return {
      runId: context.run.id,
      spaceId: context.run.spaceId,
      actor: {
        id: context.agent.id,
        spaceId: context.agent.spaceId,
        status: activeAgentStatus(context.agent.status),
        role: context.agent.role,
        claims: [],
      },
      activeTask: {
        id: context.issue.id,
        spaceId: context.issue.spaceId,
        assigneeActorId: context.issue.assigneeAgentId,
        executionRunId: context.issue.executionRunId,
        status: context.issue.status,
        workMode: context.issue
          .workMode as OutpostSemanticRunContext["activeTask"]["workMode"],
      },
      delegatedClaims: [],
    };
  }

  async #loadBoundContext(): Promise<BoundContext> {
    const [row] = await this.#db
      .select({ run: heartbeatRuns, issue: issues, agent: agents })
      .from(heartbeatRuns)
      .innerJoin(
        issues,
        and(
          eq(issues.id, heartbeatRuns.nativeIssueId),
          eq(issues.spaceId, heartbeatRuns.spaceId),
        ),
      )
      .innerJoin(
        agents,
        and(
          eq(agents.id, heartbeatRuns.agentId),
          eq(agents.spaceId, heartbeatRuns.spaceId),
        ),
      )
      .where(
        and(
          eq(heartbeatRuns.id, this.#binding.runId),
          eq(heartbeatRuns.spaceId, this.#binding.spaceId),
          eq(heartbeatRuns.agentId, this.#binding.agentId),
          eq(heartbeatRuns.nativeIssueId, this.#binding.issueId),
          eq(heartbeatRuns.runtimeMode, "native"),
        ),
      )
      .limit(1);
    if (!row) throw new Error("outpost_runner_semantic_binding_not_found");
    return row;
  }

  #assertActiveContext(context: BoundContext, requireOwnership: boolean): void {
    if (
      !["queued", "running"].includes(context.run.status) ||
      activeAgentStatus(context.agent.status) !== "active" ||
      (requireOwnership &&
        (context.issue.assigneeAgentId !== this.#binding.agentId ||
          context.issue.executionRunId !== this.#binding.runId))
    ) {
      throw new Error("outpost_runner_semantic_binding_inactive");
    }
  }
}
