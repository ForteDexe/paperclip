import { and, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  documentRevisions,
  documents,
  feedbackVotes,
  issueComments,
  issueDocuments,
  issues,
} from "@outpost/db";
import type { FeedbackTargetType, FeedbackVoteValue } from "@outpost/shared";
import { notFound, unprocessable } from "../errors.js";

const publicVoteColumns = {
  id: feedbackVotes.id,
  companyId: feedbackVotes.companyId,
  issueId: feedbackVotes.issueId,
  targetType: feedbackVotes.targetType,
  targetId: feedbackVotes.targetId,
  authorUserId: feedbackVotes.authorUserId,
  vote: feedbackVotes.vote,
  reason: feedbackVotes.reason,
  createdAt: feedbackVotes.createdAt,
  updatedAt: feedbackVotes.updatedAt,
};

function normalizeReason(vote: FeedbackVoteValue, reason: string | null | undefined) {
  if (vote !== "down") return null;
  const normalized = reason?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function assertAgentAuthoredTarget(
  db: Pick<Db, "select">,
  input: {
    companyId: string;
    issueId: string;
    targetType: FeedbackTargetType;
    targetId: string;
  },
) {
  if (input.targetType === "issue_comment") {
    const target = await db
      .select({
        companyId: issueComments.companyId,
        issueId: issueComments.issueId,
        authorAgentId: issueComments.authorAgentId,
        deletedAt: issueComments.deletedAt,
      })
      .from(issueComments)
      .where(eq(issueComments.id, input.targetId))
      .then((rows) => rows[0] ?? null);

    if (
      !target ||
      target.companyId !== input.companyId ||
      target.issueId !== input.issueId ||
      target.deletedAt
    ) {
      throw notFound("Feedback target not found");
    }
    if (!target.authorAgentId) {
      throw unprocessable("Feedback voting is only available on agent-authored issue comments");
    }
    return;
  }

  if (input.targetType === "issue_document_revision") {
    const target = await db
      .select({
        companyId: documentRevisions.companyId,
        authorAgentId: documentRevisions.createdByAgentId,
        issueId: issueDocuments.issueId,
      })
      .from(documentRevisions)
      .innerJoin(documents, eq(documentRevisions.documentId, documents.id))
      .innerJoin(issueDocuments, eq(issueDocuments.documentId, documents.id))
      .where(eq(documentRevisions.id, input.targetId))
      .then(
        (rows) =>
          rows.find(
            (row) =>
              row.companyId === input.companyId && row.issueId === input.issueId,
          ) ?? null,
      );

    if (!target) throw notFound("Feedback target not found");
    if (!target.authorAgentId) {
      throw unprocessable(
        "Feedback voting is only available on agent-authored document revisions",
      );
    }
    return;
  }

  throw unprocessable("Unsupported feedback target type");
}

/**
 * Local-only quality feedback for agent-authored task output.
 *
 * Outpost does not upload feedback, collect execution traces, or maintain a
 * delivery queue. Legacy export tables remain in the database solely so old
 * installations can migrate without losing historical rows.
 */
export function feedbackService(db: Db) {
  return {
    listIssueVotesForUser: async (issueId: string, authorUserId: string) =>
      db
        .select(publicVoteColumns)
        .from(feedbackVotes)
        .where(
          and(
            eq(feedbackVotes.issueId, issueId),
            eq(feedbackVotes.authorUserId, authorUserId),
          ),
        ),

    saveIssueVote: async (input: {
      issueId: string;
      targetType: FeedbackTargetType;
      targetId: string;
      vote: FeedbackVoteValue;
      authorUserId: string;
      reason?: string | null;
    }) =>
      db.transaction(async (tx) => {
        const issue = await tx
          .select({ id: issues.id, companyId: issues.companyId })
          .from(issues)
          .where(eq(issues.id, input.issueId))
          .then((rows) => rows[0] ?? null);
        if (!issue) throw notFound("Issue not found");

        await assertAgentAuthoredTarget(tx, {
          companyId: issue.companyId,
          issueId: issue.id,
          targetType: input.targetType,
          targetId: input.targetId,
        });

        const now = new Date();
        const reason = normalizeReason(input.vote, input.reason);
        const [savedVote] = await tx
          .insert(feedbackVotes)
          .values({
            companyId: issue.companyId,
            issueId: issue.id,
            targetType: input.targetType,
            targetId: input.targetId,
            authorUserId: input.authorUserId,
            vote: input.vote,
            reason,
            sharedWithLabs: false,
            sharedAt: null,
            consentVersion: null,
            redactionSummary: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              feedbackVotes.companyId,
              feedbackVotes.targetType,
              feedbackVotes.targetId,
              feedbackVotes.authorUserId,
            ],
            set: {
              vote: input.vote,
              reason,
              sharedWithLabs: false,
              sharedAt: null,
              consentVersion: null,
              redactionSummary: null,
              updatedAt: now,
            },
          })
          .returning(publicVoteColumns);

        return savedVote;
      }),
  };
}
