import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { expect, it } from "vitest";
import { activityLog, agents, authUsers, issues } from "@outpost/db";
import { issueRoutes } from "../routes/issues.js";
import { deriveIssueUserContext, issueService } from "../services/issues.js";
import { describeEmbeddedPostgres, resetSpaceIssueFixtures, routeApp, seedSpaceWithOperatorAccess, useEmbeddedPostgres } from "./helpers/route-test-harness.js";

// list() adds the user's read fields when a user filter is present. The
// declared return type collapses that union to the base row.
type IssueRowForUser = Awaited<ReturnType<ReturnType<typeof issueService>["list"]>>[number] & ReturnType<typeof deriveIssueUserContext>;

describeEmbeddedPostgres("human assignee unread comments", () => {
  const ctx = useEmbeddedPostgres("outpost-assignee-unread-", {
    resetEach: async db => {
      await db.delete(activityLog);
      await db.delete(issues);
      await db.delete(agents);
      await resetSpaceIssueFixtures(db);
      await db.delete(authUsers);
    },
  });

  it.each([false, true])("keeps another human's real comment unread through recency updates (prior read: %s)", async priorRead => {
    const { spaceId, userId, actor } = await seedSpaceWithOperatorAccess(ctx.db, "Assigned human task");
    const otherSpace = await seedSpaceWithOperatorAccess(ctx.db, "Unrelated space");
    const svc = issueService(ctx.db), app = routeApp(ctx.db, actor, issueRoutes);
    const issue = await svc.create(spaceId, {
      title: "Human inbox comment", status: "in_progress", createdByUserId: userId, assigneeUserId: userId,
    });
    if (priorRead) await request(app).post(`/api/issues/${issue.id}/read`).send({}).expect(200);
    const comment = await svc.addComment(issue.id, "Another human supplied an update", { userId: `author-${randomUUID()}` });
    const [afterComment] = await ctx.db.select().from(issues).where(eq(issues.id, issue.id));
    // Exercise the real insert and recency update. No historical timestamps or
    // mocked comment state hide the ordering that used to clear unread status.
    expect(afterComment!.updatedAt.getTime()).toBeGreaterThanOrEqual(new Date(comment.createdAt).getTime());
    const path = `/api/spaces/${spaceId}/issues`;
    const expectUnread = async (unread: boolean) => {
      for (const projection of ["", "&view=rows", "&view=index"]) {
        const result = await request(app).get(`${path}?q=${encodeURIComponent(issue.title)}&touchedByUserId=me&limit=100${projection}`).expect(200);
        expect(result.body).toHaveLength(1);
        expect(result.body[0].isUnreadForMe).toBe(unread);
        const filtered = await request(app).get(`${path}?q=${encodeURIComponent(issue.title)}&unreadForUserId=me&limit=100${projection}`).expect(200);
        expect(filtered.body.map((row: { id: string }) => row.id)).toEqual(unread ? [issue.id] : []);
      }
      expect(await svc.countUnreadTouchedByUser(spaceId, userId)).toBe(unread ? 1 : 0);
      expect(await svc.unreadInboxIssueIds(spaceId, userId, sql<boolean>`true`)).toEqual(unread ? [issue.id] : []);
    };
    await expectUnread(true);
    // Legacy compact responses have a short TTL. Check their SQL projection
    // once; immediate mutation readback belongs to ordinary/rows/index.
    const compact = await request(app).get(`${path}?q=${encodeURIComponent(issue.title)}&touchedByUserId=me&view=compact`).expect(200);
    expect(compact.body[0].isUnreadForMe).toBe(true);
    const derived = deriveIssueUserContext(afterComment!, userId, {
      myLastCommentAt: null, myLastReadAt: null, lastExternalCommentAt: comment.createdAt,
    });
    expect(derived.isUnreadForMe).toBe(true);
    await request(app).post(`/api/issues/${issue.id}/read`).send({}).expect(200);
    await expectUnread(false);
    await request(app).delete(`/api/issues/${issue.id}/read`).expect(200);
    await expectUnread(true);
    await svc.addComment(issue.id, "I have read this update", { userId });
    await expectUnread(false);
    await request(app).get(`/api/spaces/${otherSpace.spaceId}/issues?unreadForUserId=me`).expect(403);
    expect(await svc.countUnreadTouchedByUser(otherSpace.spaceId, userId)).toBe(0);
  });

  it("shows existing comments as unread when a task is subsequently assigned to a human", async () => {
    const { spaceId, userId, actor } = await seedSpaceWithOperatorAccess(ctx.db, "New assignment");
    const svc = issueService(ctx.db), app = routeApp(ctx.db, actor, issueRoutes);
    const issue = await svc.create(spaceId, { title: "Assigned after discussion", status: "backlog" });
    await svc.addComment(issue.id, "Context written before assignment", { userId: `author-${randomUUID()}` });
    await request(app).patch(`/api/issues/${issue.id}`).send({ assigneeUserId: userId, status: "in_progress" }).expect(200);
    const result = await request(app).get(`/api/spaces/${spaceId}/issues?q=${encodeURIComponent(issue.title)}&unreadForUserId=me`).expect(200);
    expect(result.body.map((row: { id: string }) => row.id)).toEqual([issue.id]);
    expect(result.body[0].isUnreadForMe).toBe(true);
    await request(app).post(`/api/issues/${issue.id}/read`).send({}).expect(200);
    expect(await svc.countUnreadTouchedByUser(spaceId, userId)).toBe(0);
  });

  it("excludes deleted external comments but retains the historical touch from a deleted own reply", async () => {
    const { spaceId, userId } = await seedSpaceWithOperatorAccess(ctx.db, "Deleted comment controls");
    const svc = issueService(ctx.db);
    const issue = await svc.create(spaceId, {
      title: "Deleted inbox activity", status: "in_progress", assigneeUserId: userId,
    });
    const authorId = `author-${randomUUID()}`;
    const first = await svc.addComment(issue.id, "Keep this live update", { userId: authorId });
    const second = await svc.addComment(issue.id, "Remove this later update", { userId: authorId });
    const observation = async () => {
      const [row] = await svc.list(spaceId, { touchedByUserId: userId }) as IssueRowForUser[];
      return { row, count: await svc.countUnreadTouchedByUser(spaceId, userId) };
    };
    await svc.tombstoneComment(second.id, { actorType: "user", userId });
    expect((await observation()).count).toBe(1);
    expect((await observation()).row!.lastExternalCommentAt).toEqual(new Date(first.createdAt));
    await svc.tombstoneComment(first.id, { actorType: "user", userId });
    const removed = await observation();
    expect(removed.count).toBe(0);
    expect(removed.row!.isUnreadForMe).toBe(false);
    expect(removed.row!.lastExternalCommentAt).toBeNull();
    await svc.addComment(issue.id, "New live activity", { userId: authorId });
    expect((await observation()).count).toBe(1);
    const ownReply = await svc.addComment(issue.id, "I saw the live update", { userId });
    expect((await observation()).count).toBe(0);
    await svc.tombstoneComment(ownReply.id, { actorType: "user", userId });
    const seen = await observation();
    expect(seen.count).toBe(0);
    expect(seen.row!.isUnreadForMe).toBe(false);
    expect(seen.row!.myLastTouchAt).toEqual(new Date(ownReply.createdAt));
  });

});
