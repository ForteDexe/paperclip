import type { issueService } from "../../issues.js";
import { mirrorSlackBoardComment } from "../../slack-operator-messages.js";
import { assertSlackBoardWorkAllowed } from "../../slack-operator-resume.js";
import { and, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { chatPublications, issues } from "@outpost/db";
import { conflict, notFound } from "../../../errors.js";
import type { DbTransaction } from "../runtime-types.js";
import type { chatConversations } from "@outpost/db";
type OperatorSendInput = { conversation: typeof chatConversations.$inferSelect; comment: Awaited<ReturnType<ReturnType<typeof issueService>["addComment"]>>; idempotencyKey: string; endpointId: string; conversationId: string; attachmentIds: string[] };
export async function stageSlackBoardSend(tx: DbTransaction, input: OperatorSendInput) {
  const { conversation, comment, idempotencyKey, endpointId, conversationId, attachmentIds } = input;
  const [issue] = await tx.select().from(issues).where(and(eq(issues.id, conversation.issueId), eq(issues.spaceId, conversation.spaceId)));
  if (!issue) throw notFound("Task not found");
  await assertSlackBoardWorkAllowed(tx as unknown as Db, issue);
  await mirrorSlackBoardComment(tx, comment, { publicationKey: idempotencyKey, wakeAgent: true, endpointId, conversationId, attachmentIds });
  const [created] = await tx.select().from(chatPublications).where(and(eq(chatPublications.spaceId, conversation.spaceId), eq(chatPublications.idempotencyKey, idempotencyKey)));
  if (!created) throw conflict("This Slack task is no longer assigned to the connected agent");
  return created;
}
