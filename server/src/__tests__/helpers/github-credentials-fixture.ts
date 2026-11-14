import { randomUUID } from "node:crypto";
import { agents, spaces, spaceMemberships, spaceSecrets, connectionGrants, heartbeatRuns, issueComments, issues, toolApplications, toolConnectionInstalls, toolConnections, userSecretDefinitions, type Db } from "@outpost/db";
import { initializeRunIdentity, reserveSteeredIdentity, reconcileSteeredIdentity } from "../../services/run-identity.js";

export function githubCredentialsFixture(getDb: () => Db) {
  async function seed() {
    const db = getDb();
    const spaceId = randomUUID(),
      agentId = randomUUID(),
      runId = randomUUID(),
      issueId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: spaceId,
      issuePrefix: spaceId.slice(0, 8),
    });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Shared",
      role: "engineer",
      adapterType: "codex_local",
    });
    await db
      .insert(issues)
      .values({ id: issueId, spaceId, title: "Identity test" });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "running",
      contextSnapshot: { issueId },
    });
    await db.insert(spaceMemberships).values(
      ["A", "B"].map((principalId) => ({
        spaceId,
        principalType: "user",
        principalId,
        status: "active",
        membershipRole: "member",
      })),
    );
    await initializeRunIdentity(db, {
      spaceId,
      runId,
      responsibleUserId: "A",
      cause: "instruction",
    });
    return { spaceId, agentId, runId, issueId };
  }
  async function grant(
    input: Awaited<ReturnType<typeof seed>>,
    user: string,
    dedicated = false,
  ) {
    const db = getDb();
    const applicationId = randomUUID(),
      connectionId = randomUUID(),
      secretId = randomUUID(),
      definitionId = randomUUID(),
      id = randomUUID();
    await db.insert(toolApplications).values({
      id: applicationId,
      spaceId: input.spaceId,
      name: applicationId,
      type: "mcp_http",
    });
    await db.insert(toolConnections).values({
      id: connectionId,
      spaceId: input.spaceId,
      applicationId,
      name: connectionId,
      uid: connectionId,
      transport: "mcp_remote",
      status: "active",
      enabled: true,
      credentialPolicy: dedicated ? "per_agent" : "per_user",
      config: { sourceTemplateKey: "github" },
    });
    await db.insert(toolConnectionInstalls).values({
      spaceId: input.spaceId,
      connectionId,
      targetType: "agent",
      targetId: input.agentId,
    });
    if (!dedicated)
      await db.insert(userSecretDefinitions).values({
        id: definitionId,
        spaceId: input.spaceId,
        key: definitionId,
        name: "Test GitHub",
      });
    await db.insert(spaceSecrets).values({
      id: secretId,
      spaceId: input.spaceId,
      key: secretId,
      name: `Test token ${secretId}`,
      scope: dedicated ? "space" : "user",
      ownerUserId: dedicated ? null : user,
      userSecretDefinitionId: dedicated ? null : definitionId,
    });
    await db.insert(connectionGrants).values({
      id,
      spaceId: input.spaceId,
      connectionId,
      kind: dedicated ? "agent" : "user",
      subjectUserId: dedicated ? null : user,
      subjectAgentId: dedicated ? input.agentId : null,
      status: "active",
      credentialSecretRefs: [
        {
          secretId,
          configPath: "oauth.access_token",
          versionSelector: "latest",
        },
      ],
      providerTenant: {
        github: {
          userId: user,
          login: user,
          installationCount: 1,
          repositoryCount: 1,
          repositorySelection: "selected",
          installationIds: ["1"],
          installationOwnerLogins: [user],
        },
      },
    });
    return { id, connectionId, secretId, definitionId };
  }
  async function switchTo(
    input: Awaited<ReturnType<typeof seed>>,
    user: string,
  ) {
    const db = getDb();
    const id = randomUUID();
    await db.insert(issueComments).values({
      id,
      spaceId: input.spaceId,
      issueId: input.issueId,
      authorUserId: user,
      body: "Next instruction",
    });
    const context = await reserveSteeredIdentity(db, {
      ...input,
      messageId: id,
    });
    await reconcileSteeredIdentity(db, context!);
  }
  return { seed, grant, switchTo };
}
