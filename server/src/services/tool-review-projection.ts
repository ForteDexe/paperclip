import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { issueThreadInteractions, toolActionRequests, toolInvocations, type Db } from "@outpost/db";
import { TOOL_APPROVAL_CONNECTION_REQUIRED } from "./tool-approval-connection.js";

export function toolReviewProjectionService(db: Db, reflect: (input: {
  actionRequestId: string;
  status: "approved" | "executed" | "failed" | "expired" | "cancelled";
  errorCode: string | null;
  errorMessage: string | null;
  resultSummary: string | null;
}) => Promise<void>) {
  const mismatch = or(and(
    inArray(toolActionRequests.status, ["executed", "failed", "expired", "cancelled"]),
    sql`coalesce(${issueThreadInteractions.result}->'toolAction'->>'status', '') <> case when ${toolActionRequests.status} = 'cancelled' then 'expired' else ${toolActionRequests.status} end`,
  ), and(eq(toolActionRequests.status, "approved"), eq(toolInvocations.errorCode, TOOL_APPROVAL_CONNECTION_REQUIRED),
    or(sql`coalesce(${issueThreadInteractions.result}->'toolAction'->>'status', '') <> 'approved'`,
      sql`coalesce(${issueThreadInteractions.result}->'toolAction'->>'errorCode', '') <> ${TOOL_APPROVAL_CONNECTION_REQUIRED}`)));
  const candidates = (spaceId?: string, cursor?: string) => db
    .select({ request: toolActionRequests, invocation: toolInvocations })
    .from(toolActionRequests)
    .innerJoin(issueThreadInteractions, eq(issueThreadInteractions.id, toolActionRequests.interactionId))
    .innerJoin(toolInvocations, eq(toolInvocations.id, toolActionRequests.invocationId))
    .where(and(mismatch, spaceId ? eq(toolActionRequests.spaceId, spaceId) : undefined,
      cursor ? gt(toolActionRequests.id, cursor) : undefined))
    .orderBy(asc(toolActionRequests.id));

  const continuations = new Map<string, string>();
  return {
    async spaces(spaceId?: string) {
      const rows = await db.select({ spaceId: toolActionRequests.spaceId }).from(toolActionRequests)
        .innerJoin(issueThreadInteractions, eq(issueThreadInteractions.id, toolActionRequests.interactionId))
        .innerJoin(toolInvocations, eq(toolInvocations.id, toolActionRequests.invocationId))
        .where(and(mismatch, spaceId ? eq(toolActionRequests.spaceId, spaceId) : undefined))
        .groupBy(toolActionRequests.spaceId);
      const pending = new Set(rows.map(row => row.spaceId));
      for (const scope of continuations.keys()) {
        if (spaceId && scope !== spaceId) continue;
        if (scope === "*" ? rows.length === 0 : !pending.has(scope)) continuations.delete(scope);
      }
      return rows;
    },
    async sweep(spaceId?: string, options: {
      maxRows?: number;
      signal?: AbortSignal;
      shouldContinue?: () => boolean;
    } = {}) {
      const maxRows = options.maxRows ?? Infinity;
      const scope = spaceId ?? "*";
      let cursor = maxRows === Infinity ? undefined : continuations.get(scope);
      const resumed = cursor !== undefined;
      let scanned = 0, completed = false;
      const canContinue = () => !options.signal?.aborted && (options.shouldContinue?.() ?? true);
      const failures: unknown[] = [];
      while (scanned < maxRows && canContinue()) {
        const pageSize = Math.min(100, maxRows - scanned);
        const rows = await candidates(spaceId, cursor).limit(pageSize);
        for (const { request, invocation } of rows) {
          if (!canContinue()) break;
          try {
            await reflect({ actionRequestId: request.id,
              status: request.status as "approved" | "executed" | "failed" | "expired" | "cancelled",
              errorCode: invocation.errorCode, errorMessage: invocation.errorMessage,
              resultSummary: invocation.resultSummary?.summary ?? null });
          } catch (error) { failures.push(error); }
          scanned++;
          cursor = request.id;
        }
        if (!canContinue()) break;
        if (rows.length < pageSize) { completed = true; break; }
      }
      if (maxRows !== Infinity) {
        if (completed) continuations.delete(scope);
        else if (cursor) continuations.set(scope, cursor);
      }
      if (failures.length) throw new AggregateError(failures, "Tool review projection repair failed");
      return { scanned, truncated: !completed,
        retry: !completed || ((scanned > 0 || resumed) && (await candidates(spaceId).limit(1)).length > 0) };
    },
  };
}
