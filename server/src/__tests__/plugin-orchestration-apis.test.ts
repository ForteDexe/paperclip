import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  approvals,
  assets,
  spaces,
  spaceMemberships,
  costEvents,
  createDb,
  documents,
  executionWorkspaces,
  heartbeatRunEvents,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issueDocuments,
  issueRelations,
  issueThreadInteractions,
  issues,
  pluginManagedResources,
  plugins,
  projects,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { buildHostServices } from "../services/plugin-host-services.js";
import { heartbeatService } from "../services/heartbeat.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: async () => {},
        subscribe: () => {},
      };
    },
  } as any;
}

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres plugin orchestration API tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("plugin orchestration APIs", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-plugin-orchestration-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  function isHeartbeatRunDependentFkError(error: unknown) {
    const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
    return (
      message.includes("heartbeat_run_events_run_id_heartbeat_runs_id_fk")
      || message.includes("activity_log_run_id_heartbeat_runs_id_fk")
    );
  }

  // A real (fire-and-forget) heartbeat run may still be executing in the
  // background when a test's own createComment-triggered wakeup completes —
  // retry deletion so that race doesn't fail cleanup with an FK violation.
  async function deleteHeartbeatRunsWithDependents() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await db.delete(heartbeatRunEvents);
      await db.delete(activityLog);
      try {
        await db.delete(heartbeatRuns);
        return;
      } catch (error) {
        if (!isHeartbeatRunDependentFkError(error) || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
    // Await every in-flight background heartbeat run to quiescence before the
    // deletes below. A createComment-triggered wakeup dispatches its run
    // fire-and-forget (void heartbeat.wakeup(...)), so a run or wakeup can still
    // write heartbeat_runs and issues rows when teardown starts and would race
    // the deletes. The heartbeat service tracks in-flight run and wakeup
    // promises in module state shared across service instances, so a fresh
    // instance here drains the runs the per-test host services dispatched.
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    await db.delete(costEvents);
    await deleteHeartbeatRunsWithDependents();
    await db.delete(agentWakeupRequests);
    await db.delete(issueRelations);
    await db.delete(issueComments);
    await db.delete(issueThreadInteractions);
    await db.delete(issueAttachments);
    await db.delete(assets);
    await db.delete(approvals);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(pluginManagedResources);
    await db.delete(projects);
    await db.delete(plugins);
    await db.delete(spaceMemberships);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSpaceAndAgent() {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: issuePrefix(spaceId),
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Engineer",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: { command: "true" },
      runtimeConfig: {},
      permissions: {},
    });
    return { spaceId, agentId };
  }

  async function makeLocalRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-plugin-host-folder-"));
    tempRoots.push(root);
    return root;
  }

  it("returns plugin-safe execution workspace metadata scoped to the space", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const otherSpaceId = randomUUID();
    const projectId = randomUUID();
    const workspaceId = randomUUID();
    await db.insert(spaces).values({
      id: otherSpaceId,
      name: "Other",
      issuePrefix: issuePrefix(otherSpaceId),
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Workspaces",
      status: "in_progress",
    });
    await db.insert(executionWorkspaces).values({
      id: workspaceId,
      spaceId,
      projectId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Feature workspace",
      status: "active",
      cwd: "/tmp/outpost-feature",
      repoUrl: "https://example.com/outpost.git",
      baseRef: "main",
      branchName: "feature/workspace",
      providerType: "git_worktree",
      providerRef: "/tmp/outpost-feature",
      metadata: {
        providerMetadata: { sandboxId: "sandbox-1" },
        workspaceRealizationRequest: { hiddenInternal: true },
      },
    });

    const services = buildHostServices(db, "plugin-record-id", "outpost.workspace", createEventBusStub());

    await expect(services.executionWorkspaces.get({ workspaceId, spaceId })).resolves.toMatchObject({
      id: workspaceId,
      spaceId,
      projectId,
      projectWorkspaceId: null,
      path: "/tmp/outpost-feature",
      cwd: "/tmp/outpost-feature",
      repoUrl: "https://example.com/outpost.git",
      baseRef: "main",
      branchName: "feature/workspace",
      providerType: "git_worktree",
      providerMetadata: { sandboxId: "sandbox-1" },
    });
    await expect(services.executionWorkspaces.get({ workspaceId, spaceId: otherSpaceId })).resolves.toBeNull();
  });

  it("creates plugin-origin issues with full orchestration fields and audit activity", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const blockerIssueId = randomUUID();
    const originRunId = randomUUID();
    await db.insert(issues).values({
      id: blockerIssueId,
      spaceId,
      title: "Blocker",
      status: "todo",
      priority: "medium",
      identifier: `${issuePrefix(spaceId)}-blocker`,
    });
    await db.insert(heartbeatRuns).values({
      id: originRunId,
      spaceId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: { issueId: blockerIssueId },
    });


    const services = buildHostServices(db, "plugin-record-id", "outpost.missions", createEventBusStub());
    const issue = await services.issues.create({
      spaceId,
      title: "Plugin child issue",
      status: "todo",
      assigneeAgentId: agentId,
      billingCode: "mission:alpha",
      originId: "mission-alpha",
      blockedByIssueIds: [blockerIssueId],
      actorAgentId: agentId,
      actorRunId: originRunId,
    });

    const [stored] = await db.select().from(issues).where(eq(issues.id, issue.id));
    expect(stored?.originKind).toBe("plugin:outpost.missions");
    expect(stored?.originId).toBe("mission-alpha");
    expect(stored?.billingCode).toBe("mission:alpha");
    expect(stored?.assigneeAgentId).toBe(agentId);
    expect(stored?.createdByAgentId).toBe(agentId);
    expect(stored?.originRunId).toBe(originRunId);

    const [relation] = await db
      .select()
      .from(issueRelations)
      .where(and(eq(issueRelations.issueId, blockerIssueId), eq(issueRelations.relatedIssueId, issue.id)));
    expect(relation?.type).toBe("blocks");

    const activities = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issue.id)));
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: "plugin",
          actorId: "plugin-record-id",
          action: "issue.created",
          agentId,
          details: expect.objectContaining({
            sourcePluginId: "plugin-record-id",
            sourcePluginKey: "outpost.missions",
            initiatingActorType: "agent",
            initiatingActorId: agentId,
            initiatingRunId: originRunId,
          }),
        }),
      ]),
    );
  });

  it("enforces plugin origin namespaces", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const services = buildHostServices(db, "plugin-record-id", "outpost.missions", createEventBusStub());

    const featureIssue = await services.issues.create({
      spaceId,
      title: "Feature issue",
      originKind: "plugin:outpost.missions:feature",
      originId: "mission-alpha:feature-1",
    });
    expect(featureIssue.originKind).toBe("plugin:outpost.missions:feature");

    await expect(
      services.issues.create({
        spaceId,
        title: "Spoofed issue",
        originKind: "plugin:other.plugin:feature",
      }),
    ).rejects.toThrow("Plugin may only use originKind values under plugin:outpost.missions");

    await expect(
      services.issues.update({
        issueId: featureIssue.id,
        spaceId,
        patch: { originKind: "plugin:other.plugin:feature" },
      }),
    ).rejects.toThrow("Plugin may only use originKind values under plugin:outpost.missions");
  });

  it("creates plugin operation issues with the generic operation origin", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const services = buildHostServices(db, "plugin-record-id", "outpost.missions", createEventBusStub());

    const issue = await services.issues.create({
      spaceId,
      title: "Background operation",
      surfaceVisibility: "plugin_operation",
      originId: "mission-alpha:operation-1",
    });

    expect(issue.originKind).toBe("plugin:outpost.missions:operation");
    expect(issue.originId).toBe("mission-alpha:operation-1");
  });

  it("lets bootstrap-style actions initialize required local folders from an empty root", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "outpost.plugin-llm-wiki",
      packageName: "@outpost/plugin-llm-wiki",
      version: "0.1.0",
      manifestJson: {
        id: "outpost.plugin-llm-wiki",
        apiVersion: 1,
        version: "0.1.0",
        displayName: "LLM Wiki",
        description: "Local-file LLM Wiki plugin",
        author: "Outpost",
        categories: ["automation"],
        capabilities: ["local.folders"],
        entrypoints: { worker: "./dist/worker.js" },
        localFolders: [
          {
            folderKey: "wiki-root",
            displayName: "Wiki root",
            access: "readWrite",
            requiredDirectories: ["raw", "wiki", "wiki/concepts", ".outpost"],
            requiredFiles: ["WIKI.md", "AGENTS.md"],
          },
        ],
      },
      status: "ready",
    });
    const root = await makeLocalRoot();
    const services = buildHostServices(
      db,
      pluginId,
      "outpost.plugin-llm-wiki",
      createEventBusStub(),
      undefined,
      {
        manifest: {
          id: "outpost.plugin-llm-wiki",
          apiVersion: 1,
          version: "0.1.0",
          displayName: "LLM Wiki",
          description: "Local-file LLM Wiki plugin",
          author: "Outpost",
          categories: ["automation"],
          capabilities: ["local.folders"],
          entrypoints: { worker: "./dist/worker.js" },
          localFolders: [
            {
              folderKey: "wiki-root",
              displayName: "Wiki root",
              access: "readWrite",
              requiredDirectories: ["raw", "wiki", "wiki/concepts", ".outpost"],
              requiredFiles: ["WIKI.md", "AGENTS.md"],
            },
          ],
        },
      },
    );

    const configured = await services.localFolders.configure({
      spaceId,
      folderKey: "wiki-root",
      path: root,
      access: "readWrite",
      requiredDirectories: ["raw", "wiki", "wiki/concepts", ".outpost"],
      requiredFiles: ["WIKI.md", "AGENTS.md"],
    });
    expect(configured.healthy).toBe(false);
    expect(configured.missingDirectories).toEqual([]);
    expect(configured.missingFiles).toEqual(["WIKI.md", "AGENTS.md"]);

    await fs.rm(path.join(root, "raw"), { recursive: true, force: true });
    await fs.rm(path.join(root, "wiki"), { recursive: true, force: true });
    await expect(services.localFolders.readText({ spaceId, folderKey: "wiki-root", relativePath: "WIKI.md" }))
      .rejects.toThrow("Local folder is not healthy");
    await services.localFolders.writeTextAtomic({
      spaceId,
      folderKey: "wiki-root",
      relativePath: "WIKI.md",
      contents: "# Wiki\n",
    });
    await services.localFolders.writeTextAtomic({
      spaceId,
      folderKey: "wiki-root",
      relativePath: "AGENTS.md",
      contents: "# Agents\n",
    });

    const finalStatus = await services.localFolders.status({ spaceId, folderKey: "wiki-root" });
    expect(finalStatus.healthy).toBe(true);
    await expect(fs.stat(path.join(root, "raw"))).resolves.toMatchObject({});
    await expect(fs.stat(path.join(root, "wiki/concepts"))).resolves.toMatchObject({});
    await expect(fs.readFile(path.join(root, "WIKI.md"), "utf8")).resolves.toBe("# Wiki\n");
  });

  it("rejects worker local-folder access for undeclared manifest keys", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "outpost.local-folders",
      packageName: "@outpost/plugin-local-folders",
      version: "0.1.0",
      manifestJson: {
        id: "outpost.local-folders",
        apiVersion: 1,
        version: "0.1.0",
        displayName: "Local Folders",
        description: "Local folder fixture",
        author: "Outpost",
        categories: ["automation"],
        capabilities: ["local.folders"],
        entrypoints: { worker: "./dist/worker.js" },
        localFolders: [
          {
            folderKey: "content-root",
            displayName: "Content root",
            access: "readWrite",
          },
        ],
      },
      status: "ready",
    });
    const services = buildHostServices(
      db,
      pluginId,
      "outpost.local-folders",
      createEventBusStub(),
      undefined,
      {
        manifest: {
          id: "outpost.local-folders",
          apiVersion: 1,
          version: "0.1.0",
          displayName: "Local Folders",
          description: "Local folder fixture",
          author: "Outpost",
          categories: ["automation"],
          capabilities: ["local.folders"],
          entrypoints: { worker: "./dist/worker.js" },
          localFolders: [
            {
              folderKey: "content-root",
              displayName: "Content root",
              access: "readWrite",
            },
          ],
        },
      },
    );
    await expect(services.localFolders.configure({
      spaceId,
      folderKey: "ssh",
      path: "/tmp",
      access: "read",
    })).rejects.toThrow("Local folder key is not declared");
    await expect(services.localFolders.status({ spaceId, folderKey: "ssh" }))
      .rejects.toThrow("Local folder key is not declared");
    await expect(services.localFolders.readText({ spaceId, folderKey: "ssh", relativePath: "id_rsa" }))
      .rejects.toThrow("Local folder key is not declared");
    await expect(services.localFolders.writeTextAtomic({
      spaceId,
      folderKey: "ssh",
      relativePath: "id_rsa",
      contents: "secret",
    })).rejects.toThrow("Local folder key is not declared");
  });

  it("resolves plugin-managed projects by stable key without overwriting user edits", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "outpost.missions",
      packageName: "@outpost/plugin-missions",
      version: "0.1.0",
      apiVersion: 1,
      categories: ["automation"],
      status: "ready",
      manifestJson: {
        id: "outpost.missions",
        apiVersion: 1,
        version: "0.1.0",
        displayName: "Missions",
        description: "Mission orchestration",
        author: "Outpost",
        categories: ["automation"],
        capabilities: ["projects.managed"],
        entrypoints: { worker: "./dist/worker.js" },
        projects: [{
          projectKey: "operations",
          displayName: "Mission Operations",
          description: "Plugin operation inspection area",
          status: "in_progress",
          color: "#14b8a6",
          settings: { surface: "operations" },
        }],
      },
    });

    const services = buildHostServices(db, pluginId, "outpost.missions", createEventBusStub());
    const missing = await services.projects.getManaged({ spaceId, projectKey: "operations" });
    expect(missing.status).toBe("missing");
    expect(missing.projectId).toBeNull();
    await expect(
      db
        .select()
        .from(pluginManagedResources)
        .where(and(
          eq(pluginManagedResources.spaceId, spaceId),
          eq(pluginManagedResources.pluginId, pluginId),
          eq(pluginManagedResources.resourceKind, "project"),
          eq(pluginManagedResources.resourceKey, "operations"),
        )),
    ).resolves.toHaveLength(0);

    const created = await services.projects.reconcileManaged({ spaceId, projectKey: "operations" });

    expect(created.status).toBe("created");
    expect(created.projectId).toEqual(expect.any(String));
    expect(created.project?.managedByPlugin).toMatchObject({
      pluginId,
      pluginKey: "outpost.missions",
      pluginDisplayName: "Missions",
      resourceKind: "project",
      resourceKey: "operations",
    });

    await db
      .update(projects)
      .set({ name: "Renamed by operator", description: "User-owned text", updatedAt: new Date() })
      .where(eq(projects.id, created.projectId!));
    await db
      .update(plugins)
      .set({
        manifestJson: {
          id: "outpost.missions",
          apiVersion: 1,
          version: "0.2.0",
          displayName: "Missions",
          description: "Mission orchestration",
          author: "Outpost",
          categories: ["automation"],
          capabilities: ["projects.managed"],
          entrypoints: { worker: "./dist/worker.js" },
          projects: [{
            projectKey: "operations",
            displayName: "Upgraded Default Name",
            description: "Upgraded default description",
            status: "planned",
            color: "#f97316",
            settings: { surface: "operations", upgraded: true },
          }],
        },
        updatedAt: new Date(),
      })
      .where(eq(plugins.id, pluginId));

    const resolved = await services.projects.reconcileManaged({ spaceId, projectKey: "operations" });

    expect(resolved.status).toBe("resolved");
    expect(resolved.projectId).toBe(created.projectId);
    expect(resolved.project?.name).toBe("Renamed by operator");
    expect(resolved.project?.description).toBe("User-owned text");
    expect(resolved.project?.managedByPlugin?.defaultsJson).toMatchObject({
      displayName: "Upgraded Default Name",
      settings: { upgraded: true },
    });
  });

  it("asserts checkout ownership for run-scoped plugin actions", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: { issueId },
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Checked out issue",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
      executionRunId: runId,
    });

    const services = buildHostServices(db, "plugin-record-id", "outpost.missions", createEventBusStub());
    await expect(
      services.issues.assertCheckoutOwner({
        issueId,
        spaceId,
        actorAgentId: agentId,
        actorRunId: runId,
      }),
    ).resolves.toMatchObject({
      issueId,
      status: "in_progress",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
    });
  });

  it("refuses plugin wakeups for issues with unresolved blockers", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const blockerIssueId = randomUUID();
    const blockedIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: blockerIssueId,
        spaceId,
        title: "Unresolved blocker",
        status: "todo",
        priority: "medium",
      },
      {
        id: blockedIssueId,
        spaceId,
        title: "Blocked issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
      },
    ]);
    await db.insert(issueRelations).values({
      spaceId,
      issueId: blockerIssueId,
      relatedIssueId: blockedIssueId,
      type: "blocks",
    });

    const services = buildHostServices(db, "plugin-record-id", "outpost.missions", createEventBusStub());
    await expect(
      services.issues.requestWakeup({
        issueId: blockedIssueId,
        spaceId,
        reason: "mission_advance",
      }),
    ).rejects.toThrow("Issue is blocked by unresolved blockers");
  });

  it("narrows orchestration cost summaries by subtree and billing code", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const rootIssueId = randomUUID();
    const childIssueId = randomUUID();
    const unrelatedIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: rootIssueId,
        spaceId,
        title: "Root mission",
        status: "todo",
        priority: "medium",
        billingCode: "mission:alpha",
      },
      {
        id: childIssueId,
        spaceId,
        parentId: rootIssueId,
        title: "Child mission",
        status: "todo",
        priority: "medium",
        billingCode: "mission:alpha",
      },
      {
        id: unrelatedIssueId,
        spaceId,
        title: "Different mission",
        status: "todo",
        priority: "medium",
        billingCode: "mission:alpha",
      },
    ]);
    await db.insert(costEvents).values([
      {
        spaceId,
        agentId,
        issueId: rootIssueId,
        billingCode: "mission:alpha",
        provider: "test",
        model: "unit",
        inputTokens: 10,
        cachedInputTokens: 1,
        outputTokens: 2,
        costCents: 100,
        occurredAt: new Date(),
      },
      {
        spaceId,
        agentId,
        issueId: childIssueId,
        billingCode: "mission:alpha",
        provider: "test",
        model: "unit",
        inputTokens: 20,
        cachedInputTokens: 2,
        outputTokens: 4,
        costCents: 200,
        occurredAt: new Date(),
      },
      {
        spaceId,
        agentId,
        issueId: childIssueId,
        billingCode: "mission:beta",
        provider: "test",
        model: "unit",
        inputTokens: 30,
        cachedInputTokens: 3,
        outputTokens: 6,
        costCents: 300,
        occurredAt: new Date(),
      },
      {
        spaceId,
        agentId,
        issueId: unrelatedIssueId,
        billingCode: "mission:alpha",
        provider: "test",
        model: "unit",
        inputTokens: 40,
        cachedInputTokens: 4,
        outputTokens: 8,
        costCents: 400,
        occurredAt: new Date(),
      },
    ]);

    const services = buildHostServices(db, "plugin-record-id", "outpost.missions", createEventBusStub());
    const summary = await services.issues.getOrchestrationSummary({
      spaceId,
      issueId: rootIssueId,
      includeSubtree: true,
    });

    expect(new Set(summary.subtreeIssueIds)).toEqual(new Set([rootIssueId, childIssueId]));
    expect(summary.costs).toMatchObject({
      billingCode: "mission:alpha",
      costCents: 300,
      inputTokens: 30,
      cachedInputTokens: 3,
      outputTokens: 6,
    });
  });

  it("rejects a human-attributed plugin comment when actorUserId is not an active space member", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Needs human input",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.issues.createComment({
        issueId,
        spaceId,
        body: "Here's my answer",
        actorUserId: randomUUID(),
      }),
    ).rejects.toThrow("is not an active human member of this space");

    await expect(db.select().from(agentWakeupRequests)).resolves.toHaveLength(0);
  });

  it("rejects a human-attributed plugin comment when actorUserId is a viewer-role (read-only) member", async () => {
    // LOOA-648: a viewer is a real active member but is read-only in the web
    // app (routes/authz.ts "Viewer access is read-only"). Attributing a comment
    // to them is a write the paired user could not make interactively.
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const viewerUserId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: viewerUserId, status: "active", membershipRole: "viewer",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, title: "Needs human input", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });

    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.issues.createComment({ issueId, spaceId, body: "Here's my answer", actorUserId: viewerUserId }),
    ).rejects.toThrow("viewer (read-only) access");

    // No comment persisted, no assignee woken.
    await expect(db.select().from(agentWakeupRequests)).resolves.toHaveLength(0);
    const comments = await services.issues.listComments({ issueId, spaceId });
    expect(comments).toHaveLength(0);
  });

  it("creates a human-attributed plugin comment and wakes the issue's assignee", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const humanUserId = randomUUID();
    const issueId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "user",
      principalId: humanUserId,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Needs human input",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    // Cap concurrency at 1 and pre-seed a running run so enqueueWakeup's
    // queued-run bookkeeping is exercised without startNextQueuedRunForAgent
    // going on to actually claim/execute the new run — that path spins up
    // real environment/adapter orchestration this test has no business
    // depending on (and which races the test's own db teardown).
    await db.update(agents).set({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
    await db.insert(heartbeatRuns).values({
      spaceId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: {},
    });

    const services = buildHostServices(
      db,
      "plugin-record-id",
      "outpost.gateway",
      createEventBusStub(),
      undefined,
      { heartbeatRuntimeEnv: {} },
    );
    const comment = await services.issues.createComment({
      issueId,
      spaceId,
      body: "Here's my answer",
      actorUserId: humanUserId,
    });

    expect(comment).toMatchObject({
      authorType: "user",
      authorUserId: humanUserId,
      authorAgentId: null,
      body: "Here's my answer",
    });

    const [wakeupRequest] = await db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.spaceId, spaceId), eq(agentWakeupRequests.agentId, agentId)));
    expect(wakeupRequest).toMatchObject({
      reason: "issue_commented",
      requestedByActorType: "user",
      requestedByActorId: humanUserId,
    });
    expect(wakeupRequest?.status).toBe("queued");
    expect(wakeupRequest?.runId).toEqual(expect.any(String));

    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, wakeupRequest!.runId!));
    expect(run).toMatchObject({ agentId, spaceId, status: "queued" });
  });

  it("skips the assignee wakeup when the issue is cancelled concurrently with the comment being written", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const humanUserId = randomUUID();
    const issueId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "user",
      principalId: humanUserId,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Needs human input",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());

    // Hold a row lock on the issue so createComment's own `UPDATE issues SET
    // updated_at` (inside addComment) blocks until this transaction commits a
    // concurrent cancellation. That deterministically reproduces "another
    // request closes the issue while the comment is being written" — the
    // race Greptile flagged on the pre-insert `issue` snapshot — without
    // relying on timing luck for the outcome, only for scheduling.
    const lockAndCancelPromise = db.transaction(async (tx) => {
      await tx.select().from(issues).where(eq(issues.id, issueId)).for("update");
      await new Promise((resolve) => setTimeout(resolve, 50));
      await tx.update(issues).set({ status: "cancelled" }).where(eq(issues.id, issueId));
    });

    const commentPromise = services.issues.createComment({
      issueId,
      spaceId,
      body: "Here's my answer",
      actorUserId: humanUserId,
    });

    const [comment] = await Promise.all([commentPromise, lockAndCancelPromise]);

    expect(comment).toMatchObject({
      authorType: "user",
      authorUserId: humanUserId,
      body: "Here's my answer",
    });
    await expect(db.select().from(agentWakeupRequests)).resolves.toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // LOOA-641 — interactions.respond / approvals.decide impersonation surface.
  // The host must independently re-verify the paired user's active membership
  // at apply time and never trust the plugin-supplied identity.
  // ---------------------------------------------------------------------------

  async function seedInteraction(
    spaceId: string,
    issueId: string,
    overrides: Partial<typeof issueThreadInteractions.$inferInsert> = {},
  ) {
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      spaceId,
      issueId,
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "wake_assignee",
      payload: { version: 1, prompt: "Proceed?" } as never,
      ...overrides,
    });
    return interactionId;
  }

  it("respondInteraction fails closed when actorUserId is omitted", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(spaceId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.issues.respondInteraction({ issueId, interactionId, spaceId, action: "accept" }),
    ).rejects.toThrow("actorUserId is required");
  });

  it("respondInteraction rejects an actorUserId that is not an active space member", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(spaceId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.issues.respondInteraction({
        issueId, interactionId, spaceId, action: "accept", actorUserId: randomUUID(),
      }),
    ).rejects.toThrow("is not an active human member of this space");

    // The interaction must remain pending — no resolution was applied.
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row?.status).toBe("pending");
  });

  it("respondInteraction rejects a viewer-role active member and leaves the interaction pending", async () => {
    // LOOA-648: viewers are read-only operator members (routes/authz.ts). A plugin
    // holding issue.interactions.respond must not resolve an interaction on
    // their behalf — that is a write the viewer is 403'd on in the web app.
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const viewerUserId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: viewerUserId, status: "active", membershipRole: "viewer",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(spaceId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.issues.respondInteraction({
        issueId, interactionId, spaceId, action: "accept", actorUserId: viewerUserId,
      }),
    ).rejects.toThrow("viewer (read-only) access");

    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row?.status).toBe("pending");
  });

  it("respondInteraction applies for a non-viewer human role (operator)", async () => {
    // LOOA-648 regression: owner/admin/operator must still pass the write bar.
    // Issue has no assignee so the continuation wakeup is a no-op — this
    // isolates the membership check from run orchestration.
    const { spaceId } = await seedSpaceAndAgent();
    const operatorUserId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: operatorUserId, status: "active", membershipRole: "operator",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, title: "Decision", status: "in_review", priority: "medium",
    });
    const interactionId = await seedInteraction(spaceId, issueId);
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    const result = await services.issues.respondInteraction({
      issueId, interactionId, spaceId, action: "accept", actorUserId: operatorUserId,
    });
    expect(result.applied).toBe(true);
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(row?.status).toBe("accepted");
  });

  it.each(["accept", "reject"] as const)(
    "respondInteraction rejects %s after the issue closes",
    async (action) => {
      const { spaceId } = await seedSpaceAndAgent();
      const operatorUserId = randomUUID();
      await db.insert(spaceMemberships).values({
        spaceId,
        principalType: "user",
        principalId: operatorUserId,
        status: "active",
        membershipRole: "operator",
      });
      const issueId = randomUUID();
      await db.insert(issues).values({
        id: issueId,
        spaceId,
        title: "Closed decision",
        status: "done",
        priority: "medium",
      });
      const interactionId = await seedInteraction(spaceId, issueId);
      const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());

      await expect(services.issues.respondInteraction({
        issueId,
        interactionId,
        spaceId,
        action,
        actorUserId: operatorUserId,
      })).rejects.toThrow("Interaction is no longer actionable because the issue is closed");

      const [row] = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interactionId));
      expect(row?.status).toBe("pending");
    },
  );

  it("respondInteraction converges (applied:false) when the interaction is already resolved", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const humanUserId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: humanUserId, status: "active", membershipRole: "owner",
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, title: "Decision", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const interactionId = await seedInteraction(spaceId, issueId, { status: "rejected" });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    const result = await services.issues.respondInteraction({
      issueId, interactionId, spaceId, action: "accept", actorUserId: humanUserId,
    });
    expect(result.applied).toBe(false);
    expect(result.interaction).toMatchObject({ id: interactionId, status: "rejected" });
  });

  it("approvals.decide fails closed when actorUserId is omitted", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, spaceId, type: "request_operator_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.approvals.decide({ approvalId, spaceId, action: "approve" }),
    ).rejects.toThrow("actorUserId is required");
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("pending");
  });

  it("approvals.decide rejects an actorUserId that is not an active space member", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, spaceId, type: "request_operator_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.approvals.decide({ approvalId, spaceId, action: "approve", actorUserId: randomUUID() }),
    ).rejects.toThrow("is not an active human member of this space");
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("pending");
  });

  it("approvals.decide rejects a viewer-role active member and leaves the approval pending", async () => {
    // LOOA-648: the exploit at the heart of the review — a plugin holding
    // approvals.respond decides an approval for a viewer who is 403'd in the
    // web UI. The host must reject the viewer before applying the decision.
    const { spaceId } = await seedSpaceAndAgent();
    const viewerUserId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: viewerUserId, status: "active", membershipRole: "viewer",
    });
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, spaceId, type: "request_operator_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.approvals.decide({ approvalId, spaceId, action: "approve", actorUserId: viewerUserId }),
    ).rejects.toThrow("viewer (read-only) access");
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("pending");
  });

  it("approvals.decide applies for a non-viewer human role (admin)", async () => {
    // LOOA-648 regression: owner/admin/operator must still pass the write bar.
    const { spaceId } = await seedSpaceAndAgent();
    const adminUserId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: adminUserId, status: "active", membershipRole: "admin",
    });
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId, spaceId, type: "request_operator_approval", status: "pending", payload: { title: "Ship it" },
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    const result = await services.approvals.decide({
      approvalId, spaceId, action: "approve", actorUserId: adminUserId,
    });
    expect(result.applied).toBe(true);
    expect(result.approval).toMatchObject({ id: approvalId, status: "approved", decidedByUserId: adminUserId });
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("approved");
  });

  it("approvals.decide applies for an active member and redacts secret payload fields", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const humanUserId = randomUUID();
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: humanUserId, status: "active", membershipRole: "owner",
    });
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId,
      spaceId,
      type: "request_operator_approval",
      status: "pending",
      payload: { title: "Ship it", botToken: "xoxb-super-secret" },
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    const result = await services.approvals.decide({
      approvalId, spaceId, action: "approve", actorUserId: humanUserId, decisionNote: "lgtm",
    });
    expect(result.applied).toBe(true);
    expect(result.approval).toMatchObject({ id: approvalId, status: "approved", decidedByUserId: humanUserId });
    // Bridge output must be redacted the same way the web app redacts approvals.
    expect(result.approval.payload.title).toBe("Ship it");
    expect(result.approval.payload.botToken).toBe("***REDACTED***");

    // Persisted row is decided; the raw stored secret is untouched (redaction is
    // an output transform, not a mutation).
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row?.status).toBe("approved");
  });

  it("approvals.list redacts payloads and is space-scoped", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const otherSpace = randomUUID();
    await db.insert(spaces).values({
      id: otherSpace, name: "Other", issuePrefix: issuePrefix(otherSpace), requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(approvals).values({
      id: randomUUID(), spaceId, type: "request_operator_approval", status: "pending",
      payload: { title: "Mine", accessToken: "sekret" },
    });
    await db.insert(approvals).values({
      id: randomUUID(), spaceId: otherSpace, type: "request_operator_approval", status: "pending",
      payload: { title: "Theirs" },
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    const rows = await services.approvals.list({ spaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.title).toBe("Mine");
    expect(rows[0]!.payload.accessToken).toBe("***REDACTED***");
  });

  it("getAttachmentContent returns null for a cross-space attachment id", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const otherSpace = randomUUID();
    await db.insert(spaces).values({
      id: otherSpace, name: "Other", issuePrefix: issuePrefix(otherSpace), requireOperatorApprovalForNewAgents: false,
    });
    const otherIssueId = randomUUID();
    await db.insert(issues).values({
      id: otherIssueId, spaceId: otherSpace, title: "Theirs", status: "todo", priority: "medium",
    });
    const assetId = randomUUID();
    await db.insert(assets).values({
      id: assetId, spaceId: otherSpace, provider: "local_disk", objectKey: "k", contentType: "image/png",
      byteSize: 10, sha256: "abc",
    });
    const attachmentId = randomUUID();
    await db.insert(issueAttachments).values({
      id: attachmentId, spaceId: otherSpace, issueId: otherIssueId, assetId,
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    // Requested under our own space: the cross-space id must be invisible.
    void agentId;
    const content = await services.issues.getAttachmentContent({ attachmentId, spaceId });
    expect(content).toBeNull();
  });

  it("getAttachmentContent refuses an over-cap attachment", async () => {
    const { spaceId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, title: "Has asset", status: "todo", priority: "medium",
    });
    const assetId = randomUUID();
    await db.insert(assets).values({
      id: assetId, spaceId, provider: "local_disk", objectKey: "k", contentType: "image/png",
      byteSize: 5_000_000, sha256: "abc",
    });
    const attachmentId = randomUUID();
    await db.insert(issueAttachments).values({
      id: attachmentId, spaceId, issueId, assetId,
    });
    const services = buildHostServices(db, "plugin-record-id", "outpost.gateway", createEventBusStub());
    await expect(
      services.issues.getAttachmentContent({ attachmentId, spaceId, maxBytes: 1_000_000 }),
    ).rejects.toThrow("over the");
  });

  // PAP-16091 / PAP-16050: a plugin is a non-member principal. Every issue-read
  // path the host exposes (which a Slack notifier/digest plugin would fan out
  // to shared channels) must apply the canonical visibility predicate so private
  // issue content and relationship metadata never reach non-members.
  describe("non-member plugin issue-read privacy (PAP-16091)", () => {
    let previousMode: string | undefined;
    beforeEach(() => {
      previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
});
    afterEach(() => {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
    });

    async function seedOpenAndPrivate() {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const openIssueId = randomUUID();
      const privateIssueId = randomUUID();
      await db.insert(issues).values([
        { id: openIssueId, spaceId, title: "Public status", status: "todo", priority: "medium", visibility: "open" },
        { id: privateIssueId, spaceId, title: "Confidential HR matter", status: "todo", priority: "medium", visibility: "private" },
      ]);
      return { spaceId, agentId, openIssueId, privateIssueId };
    }

    it("omits private issues from issues.list", async () => {
      const { spaceId, openIssueId, privateIssueId } = await seedOpenAndPrivate();
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      const listed = await services.issues.list({ spaceId });
      const ids = listed.map((issue) => issue.id);
      expect(ids).toContain(openIssueId);
      expect(ids).not.toContain(privateIssueId);
    });

    it("returns null from issues.get for a private issue", async () => {
      const { spaceId, openIssueId, privateIssueId } = await seedOpenAndPrivate();
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(services.issues.get({ issueId: privateIssueId, spaceId })).resolves.toBeNull();
      // Sanity: the same path still returns readable (open) issues.
      await expect(services.issues.get({ issueId: openIssueId, spaceId })).resolves.toMatchObject({ id: openIssueId });
    });

    it("returns no comments from issues.listComments for a private issue", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      await db.insert(issueComments).values({
        id: randomUUID(), spaceId, issueId: privateIssueId, body: "secret decision rationale",
      });
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(services.issues.listComments({ issueId: privateIssueId, spaceId })).resolves.toEqual([]);
    });

    it("returns no attachments from issues.listAttachments for a private issue", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      const assetId = randomUUID();
      await db.insert(assets).values({
        id: assetId, spaceId, provider: "local_disk", objectKey: "secret", contentType: "image/png", byteSize: 10, sha256: "z",
      });
      await db.insert(issueAttachments).values({ id: randomUUID(), spaceId, issueId: privateIssueId, assetId });
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(services.issues.listAttachments({ issueId: privateIssueId, spaceId })).resolves.toEqual([]);
    });

    it("returns null from issues.getAttachmentContent for a private issue's attachment", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      const assetId = randomUUID();
      await db.insert(assets).values({
        id: assetId, spaceId, provider: "local_disk", objectKey: "secret2", contentType: "text/plain", byteSize: 4, sha256: "y",
      });
      const attachmentId = randomUUID();
      await db.insert(issueAttachments).values({ id: attachmentId, spaceId, issueId: privateIssueId, assetId });
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(
        services.issues.getAttachmentContent({ attachmentId, spaceId, maxBytes: 1_000_000 }),
      ).resolves.toBeNull();
    });

    it("excludes a private descendant and redacts private blocker edges in getOrchestrationSummary", async () => {
      const { spaceId } = await seedSpaceAndAgent();
      const rootId = randomUUID();
      const publicChildId = randomUUID();
      const privateChildId = randomUUID();
      const privateBlockerId = randomUUID();
      await db.insert(issues).values([
        { id: rootId, spaceId, title: "Root", status: "todo", priority: "medium", visibility: "open" },
        { id: publicChildId, spaceId, parentId: rootId, title: "Public child", status: "todo", priority: "medium", visibility: "open" },
        { id: privateChildId, spaceId, parentId: rootId, title: "Private child", status: "todo", priority: "medium", visibility: "private" },
        { id: privateBlockerId, spaceId, title: "Private blocker", status: "todo", priority: "medium", visibility: "private" },
      ]);
      // privateBlocker blocks the public root -> root.blockedBy includes it pre-redaction.
      await db.insert(issueRelations).values({
        spaceId, issueId: privateBlockerId, relatedIssueId: rootId, type: "blocks",
      });

      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      const summary = await services.issues.getOrchestrationSummary({ spaceId, issueId: rootId, includeSubtree: true });

      // Private descendant never enters the subtree.
      expect(new Set(summary.subtreeIssueIds)).toEqual(new Set([rootId, publicChildId]));
      // No relation edge anywhere references the private blocker or private child.
      const edgeIds = new Set<string>();
      for (const relation of Object.values(summary.relations)) {
        for (const edge of [...relation.blockedBy, ...relation.blocks]) edgeIds.add(edge.id);
      }
      expect(edgeIds.has(privateBlockerId)).toBe(false);
      expect(edgeIds.has(privateChildId)).toBe(false);
    });

    it("reports a private root issue as not-found from getOrchestrationSummary", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(
        services.issues.getOrchestrationSummary({ spaceId, issueId: privateIssueId, includeSubtree: true }),
      ).rejects.toThrow("Issue not found");
    });

    async function seedIssueDocument(spaceId: string, issueId: string, key: string, body: string) {
      const documentId = randomUUID();
      await db.insert(documents).values({ id: documentId, spaceId, latestBody: body, format: "markdown" });
      await db.insert(issueDocuments).values({ id: randomUUID(), spaceId, issueId, documentId, key });
      return documentId;
    }

    it("throws not-found from issues.getRelations for a private issue", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(
        services.issues.getRelations({ issueId: privateIssueId, spaceId }),
      ).rejects.toThrow("Issue not found");
    });

    it("redacts a private blocker edge from issues.getRelations on a public issue", async () => {
      const { spaceId, openIssueId, privateIssueId } = await seedOpenAndPrivate();
      // privateIssue blocks the open issue -> open.blockedBy would name it pre-redaction.
      await db.insert(issueRelations).values({
        spaceId, issueId: privateIssueId, relatedIssueId: openIssueId, type: "blocks",
      });
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      const relations = await services.issues.getRelations({ issueId: openIssueId, spaceId });
      const edgeIds = [...relations.blockedBy, ...relations.blocks].map((edge) => edge.id);
      expect(edgeIds).not.toContain(privateIssueId);
    });

    it("reports a private root issue as not-found from issues.getSubtree", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(
        services.issues.getSubtree({ issueId: privateIssueId, spaceId }),
      ).rejects.toThrow("Issue not found");
    });

    it("excludes a private child and its documents from issues.getSubtree on an open root", async () => {
      const { spaceId } = await seedSpaceAndAgent();
      const rootId = randomUUID();
      const publicChildId = randomUUID();
      const privateChildId = randomUUID();
      await db.insert(issues).values([
        { id: rootId, spaceId, title: "Root", status: "todo", priority: "medium", visibility: "open" },
        { id: publicChildId, spaceId, parentId: rootId, title: "Public child", status: "todo", priority: "medium", visibility: "open" },
        { id: privateChildId, spaceId, parentId: rootId, title: "Private child", status: "todo", priority: "medium", visibility: "private" },
      ]);
      // A document on the private child would surface in the subtree summary pre-fix.
      await seedIssueDocument(spaceId, privateChildId, "plan", "confidential subtree plan");

      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      const subtree = await services.issues.getSubtree({
        issueId: rootId, spaceId, includeDocuments: true, includeRelations: true,
      });
      expect(new Set(subtree.issueIds)).toEqual(new Set([rootId, publicChildId]));
      expect(subtree.issues.map((issue) => issue.id)).not.toContain(privateChildId);
      expect(Object.keys(subtree.documents ?? {})).not.toContain(privateChildId);
    });

    it("returns no interactions from issues.listInteractions for a private issue", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      await db.insert(issueThreadInteractions).values({
        id: randomUUID(), spaceId, issueId: privateIssueId, kind: "request_confirmation",
        payload: { version: 1, prompt: "Confirm confidential action?" } as any,
      });
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(services.issues.listInteractions({ issueId: privateIssueId, spaceId })).resolves.toEqual([]);
    });

    it("throws not-found from issueDocuments.list for a private issue", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      await seedIssueDocument(spaceId, privateIssueId, "plan", "confidential plan body");
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(
        services.issueDocuments.list({ issueId: privateIssueId, spaceId }),
      ).rejects.toThrow("Issue not found");
    });

    it("throws not-found from issueDocuments.get for a private issue", async () => {
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      await seedIssueDocument(spaceId, privateIssueId, "plan", "confidential plan body");
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      await expect(
        services.issueDocuments.get({ issueId: privateIssueId, spaceId, key: "plan" }),
      ).rejects.toThrow("Issue not found");
    });

    it("is pass-through when privacy mode is off (enforce flip is the single switch)", async () => {
      process.env.OUTPOST_ISSUE_PRIVACY_MODE = "off";
      const { spaceId, privateIssueId } = await seedOpenAndPrivate();
      const services = buildHostServices(db, "plugin-record-id", "outpost.slack-digest", createEventBusStub());
      const ids = (await services.issues.list({ spaceId })).map((issue) => issue.id);
      expect(ids).toContain(privateIssueId);
      await expect(services.issues.get({ issueId: privateIssueId, spaceId })).resolves.toMatchObject({ id: privateIssueId });
    });
  });
});
