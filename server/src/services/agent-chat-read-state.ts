import { and, eq, inArray, sql } from "drizzle-orm";
import { issueComments, issueReadStates, type Db } from "@outpost/db";

export async function withConversationReadState<T extends { id: string }>(db: Db, spaceId: string, userId: string, conversations: T[]) {
  if (!conversations.length) return [] as Array<T & { isUnreadForMe: boolean; unreadMessageCount: number; lastExternalCommentAt: Date | null }>;
  const rows = await db.select({
    issueId: issueComments.issueId,
    latest: sql<Date>`max(${issueComments.createdAt})`,
    unreadMessageCount: sql<number>`count(*) filter (where ${issueComments.createdAt} > coalesce(${issueReadStates.lastReadAt}, to_timestamp(0)))`.mapWith(Number),
  }).from(issueComments).leftJoin(issueReadStates, and(
    eq(issueReadStates.spaceId, spaceId), eq(issueReadStates.issueId, issueComments.issueId), eq(issueReadStates.userId, userId),
  )).where(and(eq(issueComments.spaceId, spaceId), inArray(issueComments.issueId, conversations.map(chat => chat.id)),
    sql`${issueComments.deletedAt} is null`, sql`${issueComments.authorAgentId} is not null`,
    sql`${issueComments.authorType} is distinct from 'system'`,
    sql`${issueComments.presentation} ->> 'kind' is distinct from 'system_notice'`,
    eq(issueComments.origin, "comment"),
  )).groupBy(issueComments.issueId);
  const byId = new Map(rows.map(row => [row.issueId, row]));
  return conversations.map(chat => ({ ...chat, isUnreadForMe: (byId.get(chat.id)?.unreadMessageCount ?? 0) > 0,
    unreadMessageCount: byId.get(chat.id)?.unreadMessageCount ?? 0,
    lastExternalCommentAt: byId.get(chat.id)?.latest ?? null }));
}
