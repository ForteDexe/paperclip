import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  spaces,
  createDb,
  executionWorkspaces,
  heartbeatRuns,
  issues,
  projectWorkspaces,
  principalPermissionGrants,
  projects,
} from "@outpost/db";
import { LOW_TRUST_REVIEW_PRESET } from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  assertCanManageExecutionWorkspaceRuntimeServices,
  assertCanManageProjectWorkspaceRuntimeServices,
} from "../routes/workspace-runtime-service-authz.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres workspace runtime auth tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("workspace runtime service authz helper", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-workspace-runtime-authz-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(heartbeatRuns);
    await db.delete(principalPermissionGrants);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSpace() {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: `PAP-${spaceId.slice(0, 8)}`,
      requireOperatorApprovalForNewAgents: false,
    });
    return spaceId;
  }

  async function seedProjectWorkspace(spaceId: string) {
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Workspace authz",
      status: "in_progress",
    });
    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary",
      sourceType: "local_path",
      cwd: "/tmp/outpost-authz-project",
      isPrimary: true,
    });
    return { projectId, projectWorkspaceId };
  }

  async function seedExecutionWorkspace(spaceId: string, projectId: string, projectWorkspaceId: string) {
    const executionWorkspaceId = randomUUID();
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Execution workspace",
      status: "active",
      providerType: "local_fs",
      cwd: "/tmp/outpost-authz-execution",
    });
    return executionWorkspaceId;
  }

  async function seedAgent(
    spaceId: string,
    input: { role?: string; leadAgentId?: string | null; name?: string } = {},
  ) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: input.name ?? "Agent",
      role: input.role ?? "engineer",
      leadAgentId: input.leadAgentId ?? null,
    });
    return agentId;
  }

  it("allows operator actors to manage project workspace runtime services", async () => {
    const spaceId = await seedSpace();
    const { projectWorkspaceId } = await seedProjectWorkspace(spaceId);

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "operator",
        userId: "operator-1",
        spaceIds: [spaceId],
        source: "session",
        isInstanceAdmin: false,
      },
    } as any, {
      spaceId,
      projectWorkspaceId,
    })).resolves.toBeUndefined();
  });

  it("allows explicitly granted agents to manage any project workspace runtime services", async () => {
    const spaceId = await seedSpace();
    const { projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const leadAgentId = await seedAgent(spaceId, { role: "lead", name: "Default agent" });
    await db.insert(principalPermissionGrants).values({
      spaceId,
      principalType: "agent",
      principalId: leadAgentId,
      permissionKey: "tools:manage_runtime",
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: leadAgentId,
        spaceId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      projectWorkspaceId,
    })).resolves.toBeUndefined();
  });

  it("rejects low-trust Default agent runtime service mutations unless runtime.manage is granted", async () => {
    const spaceId = await seedSpace();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const leadAgentId = await seedAgent(spaceId, { role: "lead", name: "Default agent" });
    await db
      .update(agents)
      .set({
        permissions: {
          trustPreset: LOW_TRUST_REVIEW_PRESET,
          authorizationPolicy: {
            trustBoundary: {
              mode: LOW_TRUST_REVIEW_PRESET,
              spaceId,
              projectIds: [projectId],
            },
          },
        },
      })
      .where(eq(agents.id, leadAgentId));

    await db.insert(issues).values({
      id: randomUUID(),
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Low-trust workspace",
      status: "todo",
      priority: "medium",
      assigneeAgentId: leadAgentId,
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: leadAgentId,
        spaceId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      projectWorkspaceId,
    })).rejects.toMatchObject({
      status: 403,
      message: "Low-trust runs cannot manage workspace runtime services unless the boundary grants runtime.manage",
    });
  });

  it("does not let a legacy Default agent title bypass low-trust workspace policy", async () => {
    const spaceId = await seedSpace();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const leadAgentId = await seedAgent(spaceId, { role: "lead", name: "Default agent" });

    await db.insert(issues).values({
      id: randomUUID(),
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Issue-scoped low-trust workspace",
      status: "todo",
      priority: "medium",
      assigneeAgentId: leadAgentId,
      executionPolicy: {
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            spaceId,
            projectIds: [projectId],
          },
        },
      },
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: leadAgentId,
        spaceId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      projectWorkspaceId,
    })).rejects.toMatchObject({
      status: 403,
      message: "Low-trust runs cannot manage workspace runtime services unless the boundary grants runtime.manage",
    });
  });

  it("rejects runtime service mutations when only the run policy is low-trust without runtime.manage", async () => {
    const spaceId = await seedSpace();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const leadAgentId = await seedAgent(spaceId, { role: "lead", name: "Default agent" });
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Run-scoped low-trust workspace",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: leadAgentId,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: leadAgentId,
      status: "running",
      contextSnapshot: {
        issueId,
        executionPolicy: {
          authorizationPolicy: {
            trustBoundary: {
              mode: LOW_TRUST_REVIEW_PRESET,
              spaceId,
              projectIds: [projectId],
            },
          },
        },
      },
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: leadAgentId,
        spaceId,
        runId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      projectWorkspaceId,
    })).rejects.toMatchObject({
      status: 403,
      message: "Low-trust runs cannot manage workspace runtime services unless the boundary grants runtime.manage",
    });
  });

  it("allows agents with a non-terminal assigned issue in the target project workspace", async () => {
    const spaceId = await seedSpace();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const agentId = await seedAgent(spaceId, { name: "Engineer" });

    await db.insert(issues).values({
      id: randomUUID(),
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Use this workspace",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId,
        spaceId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      projectWorkspaceId,
    })).resolves.toBeUndefined();
  });

  it("allows managers to manage execution workspace runtime services for their reporting subtree", async () => {
    const spaceId = await seedSpace();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const executionWorkspaceId = await seedExecutionWorkspace(spaceId, projectId, projectWorkspaceId);
    const leadAgentId = await seedAgent(spaceId, { role: "engineering_lead", name: "Manager" });
    const reportId = await seedAgent(spaceId, { leadAgentId: leadAgentId, name: "Report" });

    await db.insert(issues).values({
      id: randomUUID(),
      spaceId,
      projectId,
      projectWorkspaceId,
      executionWorkspaceId,
      title: "Use execution workspace",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: reportId,
    });

    await expect(assertCanManageExecutionWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: leadAgentId,
        spaceId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      executionWorkspaceId,
    })).resolves.toMatchObject({
      actorType: "agent",
      agentId: leadAgentId,
      issueId: null,
    });
  });

  it("rejects unrelated same-space agents without matching workspace assignments", async () => {
    const spaceId = await seedSpace();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const executionWorkspaceId = await seedExecutionWorkspace(spaceId, projectId, projectWorkspaceId);
    const assignedAgentId = await seedAgent(spaceId, { name: "Assigned" });
    const unrelatedAgentId = await seedAgent(spaceId, { name: "Unrelated" });

    await db.insert(issues).values({
      id: randomUUID(),
      spaceId,
      projectId,
      projectWorkspaceId,
      executionWorkspaceId,
      title: "Assigned issue",
      status: "todo",
      priority: "medium",
      assigneeAgentId: assignedAgentId,
    });

    await expect(assertCanManageExecutionWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: unrelatedAgentId,
        spaceId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      executionWorkspaceId,
    })).rejects.toMatchObject({
      status: 403,
      message: "Missing permission to manage workspace runtime services",
    });
  });

  it("rejects completed workspace assignments so stale issues do not keep access alive", async () => {
    const spaceId = await seedSpace();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(spaceId);
    const agentId = await seedAgent(spaceId, { name: "Engineer" });

    await db.insert(issues).values({
      id: randomUUID(),
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Completed issue",
      status: "done",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId,
        spaceId,
        source: "agent_key",
      },
    } as any, {
      spaceId,
      projectWorkspaceId,
    })).rejects.toMatchObject({
      status: 403,
      message: "Missing permission to manage workspace runtime services",
    });
  });
});
