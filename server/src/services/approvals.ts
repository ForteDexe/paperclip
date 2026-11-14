import { notifyToolReviewChange } from "./tool-review-work-notifications.js";
import { writeApprovalChange } from "./approval-work-notifications.js";
import { approvalResolutionRecords, resolvableApprovalStatuses as resolvableStatuses } from "../lib/approval-records.js";
import { notifyCreateApproved } from "./create-hook.js";

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { approvalComments, approvals } from "@outpost/db";
import { unprocessable } from "../errors.js";
import { redactCurrentUserText } from "../log-redaction.js";
import { createAgentLifecycle } from "./agent-lifecycle.js";

import { instanceSettingsService } from "./instance-settings.js";

export function approvalRecords(db: Db) {
  const instanceSettings = instanceSettingsService(db);
  const { getExistingApproval, resolveApproval } = approvalResolutionRecords(db);

  function redactApprovalComment<T extends { body: string }>(comment: T, censorUsernameInLogs: boolean): T {
    return {
      ...comment,
      body: redactCurrentUserText(comment.body, { enabled: censorUsernameInLogs }),
    };
  }

  return {
    getExistingApproval, resolveApproval,
    list: (spaceId: string, status?: string, readCondition?: SQL<boolean>) => {
      const conditions = [eq(approvals.spaceId, spaceId)];
      if (status) conditions.push(eq(approvals.status, status));
      if (readCondition) conditions.push(readCondition);
      return db.select().from(approvals).where(and(...conditions));
    },

    getById: (id: string) =>
      db
        .select()
        .from(approvals)
        .where(eq(approvals.id, id))
        .then((rows) => rows[0] ?? null),

    findOpenCreationApprovalForAgent: async (spaceId: string, agentId: string) => {
      const rows = await db
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.spaceId, spaceId),
            eq(approvals.type, "create_agent"),
            inArray(approvals.status, resolvableStatuses),
            sql`${approvals.payload} ->> 'agentId' = ${agentId}`,
          ),
        );
      return rows[0] ?? null;
    },

    create: (spaceId: string, data: Omit<typeof approvals.$inferInsert, "spaceId">) =>
      writeApprovalChange(db, spaceId, tx => tx
        .insert(approvals)
        .values({ ...data, spaceId })
        .returning()
        .then((rows) => rows[0])),

    // Cancel an open (pending/revision_requested) approval without an operator
    // decision — e.g. when its paired agent is terminated during duplicate
    // cleanup. Idempotent: a no-op on already-resolved approvals.
    cancel: async (id: string, reason?: string | null) => {
      const now = new Date();
      const [existing] = await db.select({ spaceId: approvals.spaceId }).from(approvals).where(eq(approvals.id, id));
      if (!existing) return null;
      const updated = await writeApprovalChange(db, existing.spaceId, async tx => {
        await notifyToolReviewChange(tx, existing.spaceId);
        return tx.update(approvals)
        .set({
          status: "cancelled",
          decisionNote: reason ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(approvals.id, id), inArray(approvals.status, resolvableStatuses)))
        .returning()
        .then((rows) => rows[0] ?? null);
      }, { approvalId: id });
      return updated;
    },

    requestRevision: async (id: string, decidedByUserId: string, decisionNote?: string | null) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "pending") {
        throw unprocessable("Only pending approvals can request revision");
      }

      const now = new Date();
      return writeApprovalChange(db, existing.spaceId, tx => tx
        .update(approvals)
        .set({
          status: "revision_requested",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]), { approvalId: id });
    },

    resubmit: async (id: string, payload?: Record<string, unknown>) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "revision_requested") {
        throw unprocessable("Only revision requested approvals can be resubmitted");
      }

      const now = new Date();
      return writeApprovalChange(db, existing.spaceId, tx => tx
        .update(approvals)
        .set({
          status: "pending",
          payload: payload ?? existing.payload,
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]), { approvalId: id });
    },

    listComments: async (approvalId: string) => {
      const existing = await getExistingApproval(approvalId);
      const { censorUsernameInLogs } = await instanceSettings.getGeneral();
      return db
        .select()
        .from(approvalComments)
        .where(
          and(
            eq(approvalComments.approvalId, approvalId),
            eq(approvalComments.spaceId, existing.spaceId),
          ),
        )
        .orderBy(asc(approvalComments.createdAt))
        .then((comments) => comments.map((comment) => redactApprovalComment(comment, censorUsernameInLogs)));
    },

    addComment: async (
      approvalId: string,
      body: string,
      actor: { agentId?: string; userId?: string },
    ) => {
      const existing = await getExistingApproval(approvalId);
      const currentUserRedactionOptions = {
        enabled: (await instanceSettings.getGeneral()).censorUsernameInLogs,
      };
      const redactedBody = redactCurrentUserText(body, currentUserRedactionOptions);
      return db
        .insert(approvalComments)
        .values({
          spaceId: existing.spaceId,
          approvalId,
          authorAgentId: actor.agentId ?? null,
          authorUserId: actor.userId ?? null,
          body: redactedBody,
        })
        .returning()
        .then((rows) => redactApprovalComment(rows[0], currentUserRedactionOptions.enabled));
    },
  };
}

export function approvalService(db: Db) {
  const { getExistingApproval, resolveApproval, ...records } = approvalRecords(db);
  async function decideCreate(target: string | { approvalId: string }, status: "approved" | "rejected", userId: string, note?: string | null) {
    const lifecycle = createAgentLifecycle(db);
    const result = await (status === "approved" ? lifecycle.approveCreation : lifecycle.rejectCreation)(target, userId, note);
    if (result?.createApprovedAgentId && result.approval) {
      void notifyCreateApproved(db, { spaceId: result.approval.spaceId, agentId: result.createApprovedAgentId,
        source: "approval", sourceId: result.approval.id, approvedAt: result.approval.decidedAt ?? new Date() }).catch(() => {});
    }
    return result;
  }

  async function decide(id: string, status: "approved" | "rejected", userId: string, note?: string | null) {
    const approval = await getExistingApproval(id);
    if (approval.type === "create_agent") {
      const result = await decideCreate({ approvalId: id }, status, userId, note);
      return { approval: result!.approval!, applied: result!.applied };
    }
    return resolveApproval(id, status, userId, note);
  }
  return { ...records,
    approveCreation: (agentId: string, userId: string, note?: string | null) => decideCreate(agentId, "approved", userId, note),
    rejectCreation: (agentId: string, userId: string, note?: string | null) => decideCreate(agentId, "rejected", userId, note),
    approve: (id: string, userId: string, note?: string | null) => decide(id, "approved", userId, note),
    reject: (id: string, userId: string, note?: string | null) => decide(id, "rejected", userId, note),
  };
}
