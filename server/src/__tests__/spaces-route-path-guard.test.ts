import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { spaceRoutes } from "../routes/spaces.js";

vi.mock("../services/index.js", () => ({
  spaceService: () => ({
    list: vi.fn(),
    stats: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  }),
  spacePortabilityService: () => ({
    exportBundle: vi.fn(),
    previewExport: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  spaceArtifactsService: () => ({
    list: vi.fn(),
  }),
  accessService: () => ({
    canUser: vi.fn(),
    ensureMembership: vi.fn(),
  }),
  budgetService: () => ({
    upsertPolicy: vi.fn(),
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  instanceSettingsService: () => ({
    getExperimental: vi.fn(),
  }),
  logActivity: vi.fn(),
}));

describe("space routes malformed issue path guard", () => {
  it("returns a clear error when spaceId is missing for issues list path", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "agent",
        agentId: "agent-1",
        spaceId: "space-1",
        source: "agent_key",
      };
      next();
    });
    app.use("/api/spaces", spaceRoutes({} as any));

    const res = await request(app).get("/api/spaces/issues");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing spaceId in path. Use /api/spaces/{spaceId}/issues.",
    });
  });
});
