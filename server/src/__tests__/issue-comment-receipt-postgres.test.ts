import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, spaces, createDb, issueComments, issueReferenceMentions, issues } from "@outpost/db";
import { completeIssueCommentReceipt } from "../services/issue-comment-receipt.js";
import { issueReferenceService } from "../services/issue-references.js";
import { issueService } from "../services/issues.js";
import { deleteSpace } from "../services/space-deletion.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;

describePostgres("accepted comment finalization", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("outpost-comment-receipt-");
    db = createDb(database.connectionString);
  }, 30_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
    await database?.cleanup();
  });

  it("rolls back partial references and repairs them once across concurrent retries", async () => {
    const spaceId = randomUUID(), issueId = randomUUID(), targetId = randomUUID(), commentId = randomUUID();
    const prefix = `RCP${spaceId.slice(0, 6).toUpperCase()}`;
    await db.insert(spaces).values({ id: spaceId, name: "Comment receipt recovery", issuePrefix: prefix });
    await db.insert(issues).values([
      { id: issueId, spaceId, title: "Completed task", status: "done", identifier: `${prefix}-1`, issueNumber: 1 },
      { id: targetId, spaceId, title: "Referenced task", identifier: `${prefix}-2`, issueNumber: 2 },
    ]);
    await db.insert(issueComments).values({
      id: commentId, spaceId, issueId, authorType: "user", authorUserId: "local-operator",
      clientRequestId: randomUUID(), body: `See ${prefix}-2`,
    });
    const refs = issueReferenceService(db);
    let fail = true;
    const interrupted = {
      ...refs,
      syncComment: async (...args: Parameters<typeof refs.syncComment>) => {
        await refs.syncComment(...args);
        if (fail) throw new Error("Reference write interrupted before activity");
      },
    };
    const input = {
      spaceId, issueId, commentId,
      activity: () => ({ spaceId, actorType: "user" as const, actorId: "local-operator", action: "issue.comment_added",
        entityType: "issue", entityId: issueId, details: { commentId } }),
    };
    await expect(completeIssueCommentReceipt(db, interrupted, input)).rejects.toThrow("Reference write interrupted");
    expect(await db.select().from(issueReferenceMentions).where(eq(issueReferenceMentions.sourceRecordId, commentId))).toHaveLength(0);
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(0);
    fail = false;
    await Promise.all(Array.from({ length: 3 }, () => completeIssueCommentReceipt(db, interrupted, input)));
    expect(await db.select().from(issueReferenceMentions).where(and(
      eq(issueReferenceMentions.sourceRecordId, commentId), eq(issueReferenceMentions.targetIssueId, targetId),
    ))).toHaveLength(1);
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(1);
    await db.delete(issueReferenceMentions).where(eq(issueReferenceMentions.sourceRecordId, commentId));
    await completeIssueCommentReceipt(db, refs, input);
    expect(await db.select().from(issueReferenceMentions).where(eq(issueReferenceMentions.sourceRecordId, commentId))).toHaveLength(1);
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(1);
    expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0].status).toBe("done");
    await expect(completeIssueCommentReceipt(db, refs, { ...input, spaceId: randomUUID() })).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(1);
  }, 30_000);
  it("completes concurrent cross-task references without a deadlock", async () => {
    const spaceId = randomUUID(), firstId = randomUUID(), secondId = randomUUID();
    const firstCommentId = randomUUID(), secondCommentId = randomUUID();
    const prefix = `RCP${spaceId.slice(0, 6).toUpperCase()}`;
    await db.insert(spaces).values({ id: spaceId, name: "Cross-task comment recovery", issuePrefix: prefix });
    await db.insert(issues).values([
      { id: firstId, spaceId, title: "First task", status: "done", identifier: `${prefix}-1`, issueNumber: 1 },
      { id: secondId, spaceId, title: "Second task", status: "done", identifier: `${prefix}-2`, issueNumber: 2 },
    ]);
    await db.insert(issueComments).values([
      { id: firstCommentId, spaceId, issueId: firstId, authorUserId: "local-operator", body: `See ${prefix}-2` },
      { id: secondCommentId, spaceId, issueId: secondId, authorUserId: "local-operator", body: `See ${prefix}-1` },
    ]);
    const refs = issueReferenceService(db);
    let arrived = 0;
    let release!: () => void;
    const bothLocked = new Promise<void>(resolve => { release = resolve; });
    const synchronized = {
      ...refs,
      syncComment: async (...args: Parameters<typeof refs.syncComment>) => {
        if (++arrived === 2) release();
        await bothLocked;
        await refs.syncComment(...args);
      },
    };
    const results = await Promise.allSettled([[firstId, firstCommentId], [secondId, secondCommentId]].map(([issueId, commentId]) =>
      completeIssueCommentReceipt(db, synchronized, { spaceId, issueId, commentId,
        activity: () => ({ spaceId, actorType: "user", actorId: "local-operator", action: "issue.comment_added",
          entityType: "issue", entityId: issueId, details: { commentId } }),
      })));
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await db.select().from(issueReferenceMentions).where(eq(issueReferenceMentions.spaceId, spaceId))).toHaveLength(2);
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(2);
    expect((await db.select().from(issues).where(eq(issues.spaceId, spaceId))).every(issue => issue.status === "done")).toBe(true);
  }, 30_000);

  it.each(["remove", "tombstone"] as const)("serializes completion with a real %s without a deadlock", async (kind) => {
    const spaceId = randomUUID(), issueId = randomUUID(), commentId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Comment deletion race", issuePrefix: `RCP${spaceId.slice(0, 6).toUpperCase()}` });
    await db.insert(issues).values({ id: issueId, spaceId, title: "Completed task", status: "done" });
    await db.insert(issueComments).values({ id: commentId, spaceId, issueId, authorUserId: "local-operator", body: "Saved comment" });
    await issueService(db).removeComment(randomUUID());
    const monitored = (started: (pid: number) => void) => new Proxy(db, {
      get(target, property) {
        if (property === "transaction") return (callback: (tx: any) => Promise<unknown>) => target.transaction(async tx => {
          const [row] = await tx.execute(sql`select pg_backend_pid() as pid`);
          started(Number(row.pid));
          return callback(tx);
        });
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const waitForLock = async (pid: number) => vi.waitFor(async () => {
      const [state] = await db.execute(sql`select wait_event_type from pg_stat_activity where pid=${pid}`);
      expect(state?.wait_event_type).toBe("Lock");
    }, { timeout: 5_000, interval: 10 });
    let release!: () => void, held!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { held = resolve; });
    const holding = db.transaction(async tx => {
      await tx.select().from(issueComments).where(eq(issueComments.id, commentId)).for("update");
      held();
      await gate;
    });
    const operations: Promise<unknown>[] = [holding];
    try {
      await ready;
      let deleteStarted!: (pid: number) => void;
      const deletePid = new Promise<number>(resolve => { deleteStarted = resolve; });
      const deletingService = issueService(monitored(deleteStarted));
      const deleting = (kind === "remove" ? deletingService.removeComment(commentId)
        : deletingService.tombstoneComment(commentId, { actorType: "user", userId: "local-operator" })).catch(error => error);
      operations.push(deleting);
      await waitForLock(await deletePid);
      let completeStarted!: (pid: number) => void;
      const completePid = new Promise<number>(resolve => { completeStarted = resolve; });
      const completing = completeIssueCommentReceipt(monitored(completeStarted), issueReferenceService(db), {
        spaceId, issueId, commentId,
        activity: () => ({ spaceId, actorType: "user", actorId: "local-operator", action: "issue.comment_added",
          entityType: "issue", entityId: issueId, details: { commentId } }),
      }).catch(error => error);
      operations.push(completing);
      await waitForLock(await completePid);
      release();
      await holding;
      expect(await deleting).toMatchObject({ id: commentId });
      expect(await completing).toMatchObject({ status: 404 });
      expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(0);
      expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0].status).toBe("done");
    } finally {
      release();
      await Promise.allSettled(operations);
    }
  }, 30_000);

  it.each(["task", "space"] as const)("serializes receipt completion with actual %s deletion", async kind => {
    const spaceId = randomUUID(), issueId = randomUUID(), commentId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Task deletion race", issuePrefix: `RCP${spaceId.slice(0, 6).toUpperCase()}` });
    await db.insert(issues).values({ id: issueId, spaceId, title: "Completed task", status: "done" });
    await db.insert(issueComments).values({ id: commentId, spaceId, issueId, authorUserId: "local-operator", body: "Saved comment" });
    let release!: () => void, held!: () => void, receiptStarted!: (pid: number) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { held = resolve; });
    const receiptPid = new Promise<number>(resolve => { receiptStarted = resolve; });
    const wrap = (deleting: boolean) => new Proxy(db, {
      get(target, property) {
        if (property === "transaction") return (callback: (tx: any) => Promise<unknown>) => target.transaction(async tx => {
          if (!deleting) {
            const [row] = await tx.execute(sql`select pg_backend_pid() as pid`);
            receiptStarted(Number(row.pid));
          }
          return callback(new Proxy(tx, {
            get(transaction, method) {
              // Delay the real task DELETE, preserving each service's normal
              // earlier locks (including space deletion's child-row locks).
              if (deleting && method === "delete") return (table: unknown) => {
                const builder = transaction.delete(table as typeof issues);
                if (table !== issues) return builder;
                return { where: (...args: Parameters<typeof builder.where>) => {
                  const query = builder.where(...args);
                  const wait = async () => { held(); await gate; };
                  return kind === "task"
                    ? { returning: async () => { await wait(); return query.returning(); } }
                    : (async () => { await wait(); return query; })();
                } };
              };
              const value = Reflect.get(transaction, method, transaction);
              return typeof value === "function" ? value.bind(transaction) : value;
            },
          }));
        });
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const deleting = (kind === "task" ? issueService(wrap(true)).remove(issueId)
      : deleteSpace(wrap(true), spaceId)).catch(error => error);
    let completing: Promise<unknown> | undefined;
    try {
      await ready;
      completing = completeIssueCommentReceipt(wrap(false), issueReferenceService(db), {
        spaceId, issueId, commentId,
        activity: () => ({ spaceId, actorType: "user", actorId: "local-operator", action: "issue.comment_added",
          entityType: "issue", entityId: issueId, details: { commentId } }),
      }).catch(error => error);
      const pid = await receiptPid;
      await vi.waitFor(async () => {
        const [state] = await db.execute(sql`select wait_event_type from pg_stat_activity where pid=${pid}`);
        expect(state?.wait_event_type).toBe("Lock");
      }, { timeout: 5_000, interval: 10 });
      release();
      expect(await deleting).toMatchObject({ id: kind === "task" ? issueId : spaceId });
      expect(await completing).toMatchObject({ status: 404 });
      expect(await db.select().from(issues).where(eq(issues.id, issueId))).toHaveLength(0);
      expect(await db.select().from(issueComments).where(eq(issueComments.id, commentId))).toHaveLength(0);
      expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(0);
      if (kind === "space") expect(await db.select().from(spaces).where(eq(spaces.id, spaceId))).toHaveLength(0);
    } finally {
      release();
      await Promise.allSettled([deleting, completing]);
    }
  }, 30_000);
});
