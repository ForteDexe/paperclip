import express from "express";
import type { Db } from "@outpost/db";
import request from "supertest";
import { describe, it } from "vitest";

import { errorHandler } from "../middleware/index.js";
import { managedAgentProfileRoutes } from "../routes/managed-agent-profiles.js";
import { remoteAgentProfileRoutes } from "../routes/remote-agent-profiles.js";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_SPACE_ID = "10000000-0000-4000-8000-000000000002";

const unusedDb = new Proxy({}, {
  get() {
    throw new Error("authorization failure unexpectedly accessed the database");
  },
}) as unknown as Db;

function createApp(actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", managedAgentProfileRoutes(unusedDb));
  app.use("/api", remoteAgentProfileRoutes(unusedDb));
  app.use(errorHandler);
  return app;
}

function operatorActor(role: "operator" | "viewer"): Express.Request["actor"] {
  return {
    type: "operator",
    source: "session",
    userId: `${role}-1`,
    userName: null,
    userEmail: null,
    isInstanceAdmin: false,
    spaceIds: [SPACE_ID],
    memberships: [{ spaceId: SPACE_ID, membershipRole: role, status: "active" }],
  };
}

describe("managed provider profile route authorization", () => {
  it("does not allow an operator member to enumerate another space's profiles", async () => {
    const app = createApp(operatorActor("operator"));

    await request(app)
      .get(`/api/spaces/${OTHER_SPACE_ID}/managed-agent-profiles`)
      .expect(403);
    await request(app)
      .get(`/api/spaces/${OTHER_SPACE_ID}/remote-agent-profiles`)
      .expect(403);
  });

  it("keeps profile management operator-only", async () => {
    const app = createApp({
      type: "agent",
      source: "agent_key",
      agentId: "agent-1",
      spaceId: SPACE_ID,
    });

    await request(app)
      .get(`/api/spaces/${SPACE_ID}/managed-agent-profiles`)
      .expect(403);
    await request(app)
      .get(`/api/spaces/${SPACE_ID}/remote-agent-profiles`)
      .expect(403);
  });

  it("allows viewer reads but blocks viewer writes before profile storage", async () => {
    const app = createApp(operatorActor("viewer"));

    await request(app)
      .post(`/api/spaces/${SPACE_ID}/managed-agent-profiles`)
      .send({})
      .expect(403);
    await request(app)
      .post(`/api/spaces/${SPACE_ID}/remote-agent-profiles`)
      .send({})
      .expect(403);
  });

  it("does not let operator enablement substitute for qualification evidence", async () => {
    const app = createApp(operatorActor("operator"));

    await request(app)
      .post(`/api/spaces/${SPACE_ID}/managed-agent-profiles`)
      .send({
        profileKey: "managed",
        displayName: "Managed",
        anthropicAgentId: "agent-1",
        agentVersion: "1",
        environmentId: "environment-1",
        defaultModel: "claude-sonnet-5",
        defaultMaxListCostUsd: 1,
        apiKeySecretId: "20000000-0000-4000-8000-000000000002",
        enabled: true,
        retentionAcknowledged: true,
        qualification: {},
      })
      .expect(422);

    await request(app)
      .post(`/api/spaces/${SPACE_ID}/remote-agent-profiles`)
      .send({
        profileKey: "agentcore",
        displayName: "AgentCore",
        service: "aws_bedrock_agentcore_harness",
        configuration: {
          region: "us-east-1",
          accountId: "123456789012",
          harnessArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:harness/example",
          harnessVersion: "1",
          endpointArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:endpoint/example",
          endpointQualifier: "outpost",
          agentRuntimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/example",
          memoryArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/example",
          memoryId: "memory-example",
          invocationRoleArn: "arn:aws:iam::123456789012:role/outpost-runner",
          contextBucket: "outpost-runner-context",
          contextPrefix: "profiles/example",
          contextKmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/example",
          qualificationRevision: "aws-agentcore-harness-context-v2",
          defaultModel: "global.anthropic.claude-sonnet-4-6",
          eventExpiryDays: 90,
        },
        enabled: true,
        retentionAcknowledged: true,
        qualification: { suite: "operator-says-pass" },
      })
      .expect(422);
  });

  it("routes Claude profiles only through the executable managed profile store", async () => {
    const app = createApp(operatorActor("operator"));

    await request(app)
      .post(`/api/spaces/${SPACE_ID}/remote-agent-profiles`)
      .send({
        profileKey: "wrong-store",
        displayName: "Wrong Store",
        service: "anthropic_managed_agents",
        configuration: {},
      })
      .expect(422);
  });

  it("rejects obsolete AgentCore credential references before profile storage", async () => {
    const app = createApp(operatorActor("operator"));

    await request(app)
      .post(`/api/spaces/${SPACE_ID}/remote-agent-profiles`)
      .send({
        profileKey: "agentcore",
        displayName: "AgentCore",
        service: "aws_bedrock_agentcore_harness",
        configuration: {},
        credentialSecretId: "20000000-0000-4000-8000-000000000002",
      })
      .expect(422);
  });
});
