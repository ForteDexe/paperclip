import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { authUsers, spaces, spaceMemberships, instanceUserRoles } from "@outpost/db";
import { readBoardBootstrap } from "@outpost/shared";
import { expect, it } from "vitest";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { authRoutes } from "../routes/auth.js";
import { describeEmbeddedPostgres, useEmbeddedPostgres } from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("authenticated operator bootstrap", () => {
  const ctx = useEmbeddedPostgres("operator-bootstrap-");

  it("uses the authenticated account and current memberships, including for instance admins", async () => {
    const userId = `bootstrap-${randomUUID()}`, spaceId = randomUUID(), foreignId = randomUUID();
    const now = new Date();
    await ctx.db.insert(authUsers).values({ id: userId, name: "Bootstrap user", email: `${userId}@example.com`, emailVerified: true, createdAt: now, updatedAt: now });
    await ctx.db.insert(spaces).values([
      { id: spaceId, name: "Accessible", issuePrefix: `A${spaceId.slice(0, 7)}` },
      { id: foreignId, name: "Directory only", issuePrefix: `B${foreignId.slice(0, 7)}` },
    ]);
    const [membership] = await ctx.db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active",
    }).returning();
    await ctx.db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    const app = express();
    app.use(actorMiddleware(ctx.db, { deploymentMode: "authenticated", resolveSession: async () => ({
      session: { id: "bootstrap-session", userId }, user: { id: userId, name: "Bootstrap user", email: `${userId}@example.com` },
    }) }));
    app.use("/api/auth", authRoutes(ctx.db));
    app.use(errorHandler);

    const first = await request(app).get(`/api/auth/get-session?userId=foreign-user&spaceId=${foreignId}`).expect(200);
    expect(first.body.user.id).toBe(userId);
    expect(first.body.operatorBootstrap.userId).toBe(userId);
    expect(first.body.operatorBootstrap.spaces.map((value: { id: string }) => value.id)).toEqual([spaceId]);
    expect(first.body.operatorBootstrap.operatorAccess).toEqual({ userId, isInstanceAdmin: true, spaceIds: [spaceId] });
    expect(readBoardBootstrap(first.body.operatorBootstrap, userId)?.spaces[0]?.id).toBe(spaceId);
    expect(first.headers["cache-control"]).toBe("private, no-store");

    await ctx.db.update(spaceMemberships).set({ status: "archived" }).where(eq(spaceMemberships.id, membership!.id));
    await ctx.db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, userId));
    const revoked = await request(app).get("/api/auth/get-session").expect(200);
    expect(revoked.body.operatorBootstrap.spaces).toEqual([]);
    expect(revoked.body.operatorBootstrap.operatorAccess).toEqual({ userId, isInstanceAdmin: false, spaceIds: [] });
  });
});
