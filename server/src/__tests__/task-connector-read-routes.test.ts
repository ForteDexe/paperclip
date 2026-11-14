import express from "express";
import request from "supertest";
import { spaceMemberships, instanceUserRoles, issues, type Db } from "@outpost/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { chatChannelRoutes } from "../routes/chat-channels.js";
import { emailRoutes } from "../routes/email.js";
import type { ChatChannelService } from "../services/chat-channels.js";
import type { EmailChannelService } from "../services/email-channels.js";

const spaceId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const operatorActor: Express.Request["actor"] = {
  type: "operator",
  source: "session",
  userId: "test-operator-user",
  spaceIds: [spaceId],
};
const chat = { getIssueBinding: vi.fn(), get: vi.fn() };
const email = { authorizeRead: vi.fn(), thread: vi.fn() };

function app(actor = operatorActor) {
  const instance = express();
  instance.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  // Supply the resource and active membership that the management read guard
  // now resolves. Connector service behavior stays isolated in this unit suite.
  const db = { select: () => ({ from: (table: unknown) => {
    const rows = table === issues ? [{ id: issueId, spaceId, projectId: null }]
      : table === spaceMemberships ? [{ spaceId, principalType: "user", principalId: operatorActor.userId, membershipRole: "operator", status: "active" }]
      : table === instanceUserRoles ? []
      : null;
    if (!rows) throw new Error("Unexpected resource query in task read fixture");
    return { where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) };
  } }) } as unknown as Db;
  instance.use("/api", chatChannelRoutes(db, {
    service: chat as unknown as ChatChannelService,
    heartbeat: { wakeup: vi.fn() },
  }));
  instance.use("/api", emailRoutes(db, email as unknown as EmailChannelService));
  instance.use(errorHandler);
  return instance;
}

beforeEach(() => {
  vi.resetAllMocks();
  chat.getIssueBinding.mockResolvedValue(null);
  email.authorizeRead.mockResolvedValue(undefined);
  email.thread.mockResolvedValue(null);
});

describe("task connector read routes", () => {
  it.each([`chat:${issueId}`, "undefined", "not-a-uuid", ` ${issueId} `])(
    "rejects invalid task ID %s before reading either connector",
    async (invalidId) => {
      const server = app();
      const encodedId = encodeURIComponent(invalidId);
      await request(server).get(`/api/issues/${encodedId}/chat-binding`).expect(400);
      await request(server).get(`/api/spaces/${spaceId}/email/tasks/${encodedId}`).expect(400);
      expect(chat.getIssueBinding).not.toHaveBeenCalled();
      expect(email.authorizeRead).not.toHaveBeenCalled();
      expect(email.thread).not.toHaveBeenCalled();
    },
  );

  it("retains normal task reads and email authorization", async () => {
    const server = app();
    await request(server).get(`/api/issues/${issueId}/chat-binding`).expect(200, "null");
    await request(server).get(`/api/spaces/${spaceId}/email/tasks/${issueId}`).expect(200, "null");
    expect(chat.getIssueBinding).toHaveBeenCalledWith(issueId);
    expect(email.authorizeRead).toHaveBeenCalledWith(spaceId, issueId, {
      userId: operatorActor.userId,
      localImplicit: false,
    });
    expect(email.thread).toHaveBeenCalledWith(spaceId, issueId);
  });

  it.each([issueId, `chat:${issueId}`])("retains authentication checks for %s", async (id) => {
    const server = app({ type: "none", source: "none" });
    await request(server).get(`/api/issues/${id}/chat-binding`).expect(401);
    await request(server).get(`/api/spaces/${spaceId}/email/tasks/${id}`).expect(401);
    expect(chat.getIssueBinding).not.toHaveBeenCalled();
    expect(email.authorizeRead).not.toHaveBeenCalled();
    expect(email.thread).not.toHaveBeenCalled();
  });

  it("retains space isolation for task bindings", async () => {
    const binding = { endpointId: "test-endpoint" };
    chat.getIssueBinding.mockResolvedValue(binding);
    chat.get.mockResolvedValue({ spaceId });
    await request(app()).get(`/api/issues/${issueId}/chat-binding`).expect(200, binding);
    chat.get.mockResolvedValue({ spaceId: "other-space" });
    await request(app()).get(`/api/issues/${issueId}/chat-binding`).expect(404);
  });

  it.each([issueId, `chat:${issueId}`])("retains space isolation for email task %s", async (id) => {
    await request(app({ ...operatorActor, spaceIds: [] }))
      .get(`/api/spaces/${spaceId}/email/tasks/${id}`).expect(403);
    expect(email.authorizeRead).not.toHaveBeenCalled();
    expect(email.thread).not.toHaveBeenCalled();
  });
});
