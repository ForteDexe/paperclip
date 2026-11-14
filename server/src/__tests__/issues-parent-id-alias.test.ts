import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect, it } from "vitest";
import { issues } from "@outpost/db";
import { issueRoutes } from "../routes/issues.js";
import {
  describeEmbeddedPostgres,
  resetSpaceIssueFixtures,
  routeApp,
  seedSpaceWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("issue list parentIssueId query alias", () => {
  const ctx = useEmbeddedPostgres("outpost-issues-parent-id-alias-", {
    resetEach: resetSpaceIssueFixtures,
  });

  async function seed() {
    const space = await seedSpaceWithBoardAccess(ctx.db, "Parent alias");
    const spaceId = space.spaceId;
    const parentId = randomUUID();
    const otherParentId = randomUUID();
    const childId = randomUUID();
    const blockedChildId = randomUUID();

    await ctx.db.insert(issues).values([
      { id: parentId, spaceId, title: "Parent", status: "todo", priority: "medium" },
      { id: otherParentId, spaceId, title: "Other parent", status: "todo", priority: "medium" },
    ]);
    await ctx.db.insert(issues).values([
      { id: childId, spaceId, title: "Child", status: "todo", priority: "medium", parentId },
      { id: blockedChildId, spaceId, title: "Blocked child", status: "blocked", priority: "medium", parentId },
      {
        id: randomUUID(),
        spaceId,
        title: "Other child",
        status: "todo",
        priority: "medium",
        parentId: otherParentId,
      },
      {
        id: randomUUID(),
        spaceId,
        title: "Blocked other child",
        status: "blocked",
        priority: "medium",
        parentId: otherParentId,
      },
    ]);

    return { ...space, parentId, otherParentId, childId, blockedChildId };
  }

  type Seeded = Awaited<ReturnType<typeof seed>>;

  function appFor(seeded: Seeded) {
    return routeApp(ctx.db, seeded.actor, issueRoutes);
  }

  async function listIds(seeded: Seeded, query: Record<string, string>) {
    const res = await request(appFor(seeded))
      .get(`/api/spaces/${seeded.spaceId}/issues`)
      .query(query)
      .expect(200);
    return (res.body as { id: string }[]).map((issue) => issue.id).sort();
  }

  async function blockedCount(seeded: Seeded, query: Record<string, string>) {
    const res = await request(appFor(seeded))
      .get(`/api/spaces/${seeded.spaceId}/issues/count`)
      .query({ attention: "blocked", ...query })
      .expect(200);
    return res.body as { count: number };
  }

  function childrenOfParent(seeded: Seeded) {
    return [seeded.childId, seeded.blockedChildId].sort();
  }

  it("filters children by ?parentId=", async () => {
    const seeded = await seed();
    expect(await listIds(seeded, { parentId: seeded.parentId })).toEqual(childrenOfParent(seeded));
  });

  it("filters children by ?parentIssueId=", async () => {
    const seeded = await seed();
    expect(await listIds(seeded, { parentIssueId: seeded.parentId })).toEqual(childrenOfParent(seeded));
  });

  it("prefers ?parentId= when both spellings are present", async () => {
    const seeded = await seed();
    const ids = await listIds(seeded, {
      parentId: seeded.parentId,
      parentIssueId: seeded.otherParentId,
    });
    expect(ids).toEqual(childrenOfParent(seeded));
  });

  it("returns the whole space list when neither spelling is present", async () => {
    const seeded = await seed();
    expect(await listIds(seeded, {})).toHaveLength(6);
  });

  it("filters the blocked count by ?parentIssueId=", async () => {
    const seeded = await seed();
    expect(await blockedCount(seeded, { parentIssueId: seeded.parentId })).toEqual({ count: 1 });
  });

  it("returns the same blocked count for both spellings", async () => {
    const seeded = await seed();
    const byShortForm = await blockedCount(seeded, { parentId: seeded.parentId });
    const byAlias = await blockedCount(seeded, { parentIssueId: seeded.parentId });
    expect(byAlias).toEqual(byShortForm);
  });
});
