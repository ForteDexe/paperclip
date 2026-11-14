import { notifyIssueRecovery } from "./issue-recovery-notifications.js";
import type { PgInsertValue } from "drizzle-orm/pg-core";
import { issueComments, type Db } from "@outpost/db";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

type WriteDb = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function insertIssueComment(db: WriteDb, input: PgInsertValue<typeof issueComments> & { spaceId: string }) {
  return db.transaction(async tx => {
    await notifyIssueRecovery(tx, { spaceId: input.spaceId,
      issueId: typeof input.issueId === "string" ? input.issueId : undefined });
    return tx.insert(issueComments).values(input).returning();
  });
}
