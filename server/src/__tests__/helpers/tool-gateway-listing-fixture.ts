import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  agents, spaces, createDb, heartbeatRuns, issues, principalPermissionGrants,
  projects, toolApplications, toolCatalogEntries, toolConnections, toolPolicies,
  toolProfileBindings, toolProfileEntries, toolProfiles,
} from "@outpost/db";
import { createToolGatewayService } from "../../services/tool-gateway.js";

type Db = ReturnType<typeof createDb>;

// Real run snapshots carry the task text several times over; a policy check
// must read only the context ids out of it.
const LARGE_TASK_TEXT = "Task description. ".repeat(12_000);

/** A second handle on the same connection pool that records every statement. */
export function recordingDb(db: Db) {
  const statements: string[] = [];
  const statementParams: unknown[][] = [];
  const recorded = drizzle(db.$client, {
    schema: db._.fullSchema,
    logger: {
      logQuery: (query: string, params: unknown[]) => {
        statements.push(query);
        statementParams.push(params);
      },
    },
  }) as unknown as Db;
  return { db: recorded, statements, statementParams };
}

export async function createListingFixture(
  db: Db,
  toolCount: number,
  options: { broadBindings?: boolean; connectionCount?: number } = {},
) {
  const space = await db.insert(spaces).values({
    name: `Listing ${randomUUID()}`,
    issuePrefix: `LM${randomUUID().slice(0, 6).toUpperCase()}`,
  }).returning().then((rows) => rows[0]!);
  const agent = await db.insert(agents).values({
    spaceId: space.id,
    name: `Listing Agent ${randomUUID()}`,
    role: "engineer",
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  }).returning().then((rows) => rows[0]!);
  const project = await db.insert(projects).values({
    spaceId: space.id,
    name: `Listing Project ${randomUUID()}`,
  }).returning().then((rows) => rows[0]!);
  const issue = await db.insert(issues).values({
    spaceId: space.id,
    projectId: project.id,
    title: "Listing work",
    status: "in_progress",
    assigneeAgentId: agent.id,
  }).returning().then((rows) => rows[0]!);
  const run = await db.insert(heartbeatRuns).values({
    spaceId: space.id,
    agentId: agent.id,
    invocationSource: "assignment",
    status: "running",
    contextSnapshot: { issueId: issue.id, projectId: project.id, taskMarkdown: LARGE_TASK_TEXT },
    resultJson: { summary: LARGE_TASK_TEXT },
  }).returning().then((rows) => rows[0]!);
  const application = await db.insert(toolApplications).values({
    spaceId: space.id,
    applicationKey: `listing-${randomUUID().slice(0, 8)}`,
    name: `Listing MCP ${randomUUID()}`,
    type: "mcp_http",
    status: "active",
  }).returning().then((rows) => rows[0]!);
  const connection = await db.insert(toolConnections).values({
    spaceId: space.id,
    applicationId: application.id,
    name: "Listing connection",
    uid: `test/${randomUUID()}`,
    transport: "mcp_remote",
    status: "active",
    enabled: true,
    healthStatus: "ok",
    credentialPolicy: "shared",
    config: { url: "https://8.8.8.8/mcp", notes: "connection config ".repeat(500) },
  }).returning().then((rows) => rows[0]!);
  const entries = await db.insert(toolCatalogEntries).values(
    Array.from({ length: toolCount }, (_, index) => ({
      spaceId: space.id,
      applicationId: application.id,
      connectionId: connection.id,
      entryKind: "tool" as const,
      name: `tool_${String(index).padStart(4, "0")}`,
      toolName: `tool_${String(index).padStart(4, "0")}`,
      description: `Fixture tool ${index}`,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Query text. ".repeat(40) } },
      },
      riskLevel: index % 3 === 0 ? "write" as const : "read" as const,
      isReadOnly: index % 3 !== 0,
      isWrite: index % 3 === 0,
      status: "active" as const,
      versionHash: randomUUID(),
      schemaHash: randomUUID(),
    })),
  ).returning();

  for (let i = 1; i < (options.connectionCount ?? 1); i += 1) {
    const extra = await db.insert(toolConnections).values({
      spaceId: space.id, applicationId: application.id, name: `Listing connection ${i}`,
      uid: `test/${randomUUID()}`, transport: "mcp_remote", status: "active", enabled: true,
      healthStatus: "ok", config: { url: "https://8.8.8.8/mcp" },
    }).returning().then((rows) => rows[0]!);
    const ids = entries.filter((_, index) => index % (options.connectionCount ?? 1) === i).map((entry) => entry.id);
    if (ids.length > 0) await db.update(toolCatalogEntries).set({ connectionId: extra.id }).where(inArray(toolCatalogEntries.id, ids));
  }

  // The gateway profile allows every tool except one excluded entry. The
  // space and agent bindings lose to the narrower gateway binding.
  const gatewayProfile = await db.insert(toolProfiles).values({
    spaceId: space.id,
    profileKey: `gateway-${randomUUID()}`,
    name: `Gateway profile ${randomUUID()}`,
    defaultAction: "allow",
  }).returning().then((rows) => rows[0]!);
  await db.insert(toolProfileEntries).values({
    spaceId: space.id,
    profileId: gatewayProfile.id,
    selectorType: "catalog_entry",
    catalogEntryId: entries[1]!.id,
    effect: "exclude",
  });
  const broadProfile = await db.insert(toolProfiles).values({
    spaceId: space.id,
    profileKey: `broad-${randomUUID()}`,
    name: `Broad profile ${randomUUID()}`,
    defaultAction: "deny",
  }).returning().then((rows) => rows[0]!);
  if (options.broadBindings !== false) {
    await db.insert(toolProfileBindings).values([
      { spaceId: space.id, profileId: broadProfile.id, targetType: "space", targetId: space.id },
      { spaceId: space.id, profileId: broadProfile.id, targetType: "agent", targetId: agent.id },
    ]);
  }
  await db.insert(toolPolicies).values([
    {
      spaceId: space.id,
      name: `Block one tool ${randomUUID()}`,
      policyType: "block",
      priority: 10,
      selectors: { catalogEntryId: entries[2]!.id },
    },
    {
      spaceId: space.id,
      name: `Review writes ${randomUUID()}`,
      policyType: "require_approval",
      priority: 20,
      selectors: { riskLevel: "write" },
    },
  ]);
  // A grant for another connection: the listing reads it, but it allows nothing here.
  await db.insert(principalPermissionGrants).values({
    spaceId: space.id,
    principalType: "agent",
    principalId: agent.id,
    permissionKey: "tools:use",
    scope: { connectionId: randomUUID() },
  });

  const setupGateway = createToolGatewayService(db);
  const namedGateway = await setupGateway.createNamedGateway({
    spaceId: space.id,
    body: { name: `Listing gateway ${randomUUID().slice(0, 8)}`, profileId: gatewayProfile.id },
  });
  const token = await setupGateway.createNamedGatewayToken({
    spaceId: space.id,
    gatewayId: namedGateway.id,
    body: {
      name: "Run token",
      subjectType: "heartbeat_run",
      subjectId: run.id,
      clientLabel: "codex",
      ownerNote: "",
    },
  });
  return { space, agent, project, issue, run, application, connection, entries, namedGateway, token };
}
