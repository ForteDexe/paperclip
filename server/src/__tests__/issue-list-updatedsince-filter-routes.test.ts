import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spaces, spaceMemberships, createDb, issues, principalPermissionGrants } from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue list route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issue list routes updatedSince filter", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issue-list-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(spaceId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "operator",
        userId: "cloud-user-1",
        spaceIds: [spaceId],
        memberships: [{ spaceId, membershipRole: "owner", status: "active" }],
        source: "cloud_tenant",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  function uniqueIssuePrefix() {
    return `P${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  }

  async function seedCloudTenantMember(spaceId: string) {
    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "user",
      principalId: "cloud-user-1",
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      spaceId,
      principalId: "cloud-user-1",
      membershipRole: "owner",
      grantedByUserId: null,
    });
  }

  it("returns 0 issues when updatedSince is in the future", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Existing issue",
      status: "todo",
      priority: "medium",
    });

    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ updatedSince: futureDate, limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only issues updated after a past updatedSince timestamp", async () => {
    const spaceId = randomUUID();
    const staleIssueId = randomUUID();
    const freshIssueId = randomUUID();
    const since = new Date("2026-07-01T00:00:00.000Z");
    const staleUpdatedAt = new Date("2026-06-30T00:00:00.000Z");
    const freshUpdatedAt = new Date("2026-07-02T00:00:00.000Z");

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);
    await db.insert(issues).values([
      {
        id: staleIssueId,
        spaceId,
        title: "Stale issue",
        status: "todo",
        priority: "medium",
        updatedAt: staleUpdatedAt,
      },
      {
        id: freshIssueId,
        spaceId,
        title: "Fresh issue",
        status: "todo",
        priority: "medium",
        updatedAt: freshUpdatedAt,
      },
    ]);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ updatedSince: since.toISOString(), limit: "20" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.map((issue: { id: string }) => issue.id)).toEqual([freshIssueId]);
  });

  it("returns 400 for a malformed updatedSince timestamp", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: uniqueIssuePrefix(),
      requireOperatorApprovalForNewAgents: false,
    });
    await seedCloudTenantMember(spaceId);

    const app = createApp(spaceId);
    const res = await request(app)
      .get(`/api/spaces/${spaceId}/issues`)
      .query({ updatedSince: "not-a-date", limit: "20" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "updatedSince must be a valid ISO 8601 timestamp when provided",
    });
  });
});
