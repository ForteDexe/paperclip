import { and, eq, isNull, sql } from "drizzle-orm";
import { assets, chatConversations, chatEndpoints, chatPublications, chatTeamsFileTransfers, issueAttachments, issueComments, type Db } from "@outpost/db";
import { isUuidLike, type ChatProvider } from "@outpost/shared";

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ContinuingTeamsFileTransfer = {
  transferId: string;
  publicationId: string;
  version: number;
  phase: "consent_unknown" | "file_info_unknown";
};

type TeamsFileTransferSourceInput = {
  spaceId: string;
  agentId: string;
  issueId: string;
  failedRunId: string;
  provider: ChatProvider;
  publication?: boolean;
  retryActionId?: string;
  runId?: string;
  continuingTransfer: ContinuingTeamsFileTransfer;
};

// A selector proves only this transfer's source. The caller must still verify
// the committed result and complete original source batch in this transaction.
export async function continuingTeamsFilePublication(
  tx: DbOrTransaction,
  input: TeamsFileTransferSourceInput,
  failedChatRetryDenied: () => Error,
): Promise<string> {
  const { provider, continuingTransfer } = input;
  if (
    input.publication !== true ||
    input.retryActionId !== undefined ||
    input.runId !== undefined ||
    provider !== "microsoft-teams" ||
    !continuingTransfer ||
    !isUuidLike(continuingTransfer.transferId) ||
    !isUuidLike(continuingTransfer.publicationId) ||
    !Number.isSafeInteger(continuingTransfer.version) ||
    continuingTransfer.version < 1 ||
    !["consent_unknown", "file_info_unknown"].includes(
      continuingTransfer.phase,
    )
  )
    throw failedChatRetryDenied();
  // The caller supplies a selector only. Independently prove the exact
  // unknown publication is this native run's own selected file, not a
  // sibling effect or another actor/generation. All ordinary source and
  // committed-result authorization below still runs unchanged.
  const [continuing] = await tx
    .select({
      publicationId: chatPublications.id,
      attemptId: chatTeamsFileTransfers.attemptId,
      attemptExpiresAt: chatTeamsFileTransfers.attemptExpiresAt,
    })
    .from(chatTeamsFileTransfers)
    .innerJoin(
      chatPublications,
      and(
        eq(chatPublications.id, chatTeamsFileTransfers.publicationId),
        eq(chatPublications.spaceId, chatTeamsFileTransfers.spaceId),
        eq(chatPublications.endpointId, chatTeamsFileTransfers.endpointId),
        eq(
          chatPublications.conversationId,
          chatTeamsFileTransfers.conversationId,
        ),
        eq(chatPublications.issueId, chatTeamsFileTransfers.issueId),
        eq(chatPublications.commentId, chatTeamsFileTransfers.commentId),
        eq(chatPublications.state, "delivery_unknown"),
        sql`${chatPublications.payload}->'attachmentIds' = jsonb_build_array(${chatTeamsFileTransfers.attachmentId}::text)`,
      ),
    )
    .innerJoin(
      chatEndpoints,
      and(
        eq(chatEndpoints.id, chatTeamsFileTransfers.endpointId),
        eq(chatEndpoints.spaceId, input.spaceId),
        eq(chatEndpoints.provider, "microsoft-teams"),
      ),
    )
    .innerJoin(
      chatConversations,
      and(
        eq(chatConversations.id, chatTeamsFileTransfers.conversationId),
        eq(chatConversations.spaceId, input.spaceId),
        eq(chatConversations.endpointId, chatTeamsFileTransfers.endpointId),
        eq(chatConversations.issueId, input.issueId),
        eq(
          chatConversations.sessionGeneration,
          chatTeamsFileTransfers.conversationGeneration,
        ),
      ),
    )
    .innerJoin(
      issueComments,
      and(
        eq(issueComments.id, chatTeamsFileTransfers.commentId),
        eq(issueComments.spaceId, input.spaceId),
        eq(issueComments.issueId, input.issueId),
        eq(issueComments.createdByRunId, input.failedRunId),
        eq(issueComments.authorAgentId, input.agentId),
        isNull(issueComments.deletedAt),
      ),
    )
    .innerJoin(
      issueAttachments,
      and(
        eq(issueAttachments.id, chatTeamsFileTransfers.attachmentId),
        eq(issueAttachments.spaceId, input.spaceId),
        eq(issueAttachments.issueId, input.issueId),
        eq(issueAttachments.issueCommentId, issueComments.id),
        eq(issueAttachments.originatingRunId, input.failedRunId),
      ),
    )
    .innerJoin(
      assets,
      and(
        eq(assets.id, issueAttachments.assetId),
        eq(assets.spaceId, input.spaceId),
        eq(assets.sha256, chatTeamsFileTransfers.sha256),
        eq(assets.byteSize, chatTeamsFileTransfers.byteSize),
      ),
    )
    .where(
      and(
        eq(chatTeamsFileTransfers.spaceId, input.spaceId),
        eq(chatTeamsFileTransfers.issueId, input.issueId),
        eq(chatTeamsFileTransfers.id, continuingTransfer.transferId),
        eq(
          chatTeamsFileTransfers.publicationId,
          continuingTransfer.publicationId,
        ),
        eq(chatTeamsFileTransfers.version, continuingTransfer.version),
        eq(chatTeamsFileTransfers.phase, continuingTransfer.phase),
      ),
    )
    .for("share", { noWait: true });
  if (
    !continuing ||
    (continuing.attemptId &&
      (!continuing.attemptExpiresAt ||
        continuing.attemptExpiresAt > new Date()))
  )
    throw failedChatRetryDenied();
  return continuing.publicationId;
}
