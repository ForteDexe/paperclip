import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, agentWakeupRequests, activityLog, authUsers, spaces, spaceMemberships, createDb,
  executionWorkspaces, heartbeatRuns, issues, projects, projectWorkspaces, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@outpost/db";
import { registerAgentProjectAccessRoutes } from "../routes/agent-project-access.js";
import { errorHandler } from "../middleware/error-handler.js";
import { assertTaskWorkspaceExecutionAccess, assertTaskWorkspaceSourceProjectAccess } from "../services/task-workspace-access.js";
import { taskInterruptionPresentation } from "../services/task-interruption-presentation.js";
import { ProjectAccessDeniedError } from "../services/project-access-denial.js";
import { issueService } from "../services/issues.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("additive project access", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    const external = process.env.OUTPOST_TEST_DATABASE_URL;
    if (external) db = createDb(external);
    else { database = await startEmbeddedPostgresTestDatabase("agent-project-access-"); db = createDb(database.connectionString); }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  async function seed() {
    const spaceId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Project access", issuePrefix: `A${spaceId.slice(0, 6)}` });
    const selected = await db.insert(projects).values(["Existing", "Needed", "Third"].map(name => ({ spaceId, name }))).returning();
    const permissions = { canCreateAgents: false, canCreateSkills: false, trustPreset: "low_trust_review",
      authorizationPolicy: { reviewPreset: { id: "low_trust_review", version: 1, rawOutputDisposition: "quarantine" },
        customPolicy: { preserve: true }, trustBoundary: { mode: "low_trust_review", spaceId,
          projectIds: [selected[0]!.id], issueIds: [issueId], allowedToolClasses: ["git.read"], allowedSecretBindingIds: [] } } };
    await db.insert(agents).values({ id: agentId, spaceId, name: "Reviewer", adapterType: "process", status: "idle", permissions });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "agent", principalId: agentId, membershipRole: "member", status: "active" });
    const [issue] = await db.insert(issues).values({ id: issueId, spaceId, title: "Saved message", status: "blocked", assigneeAgentId: agentId, projectId: selected[1]!.id }).returning();
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, issueId, status: "failed", errorCode: "setup_failed",
      error: "Project is outside this low-trust boundary.", contextSnapshot: { issueId } });
    return { spaceId, agentId, issue: issue!, runId, selected, permissions };
  }
  function app(actor: express.Request["actor"]) {
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = actor; next(); });
    registerAgentProjectAccessRoutes(app, db); app.use(errorHandler); return app;
  }
  const operator = { type: "operator" as const, source: "local_implicit" as const };

  it("keeps a historical denial blocked after the task moves to an allowed project but retains its source", async () => {
    const f = await seed();
    const [source] = await db.insert(projectWorkspaces).values({ spaceId: f.spaceId, projectId: f.selected[1]!.id,
      name: "Original repository", cwd: "/tmp/project-access-original" }).returning();
    await db.update(issues).set({ projectWorkspaceId: source!.id,
      workspaceSelection: { version: 1, source: "project", selection: {
        kind: "configured_source", projectWorkspaceId: source!.id, mode: "managed_isolated",
      } } }).where(eq(issues.id, f.issue.id));
    const moved = await issueService(db).update(f.issue.id, { projectId: f.selected[0]!.id });
    expect(moved).toMatchObject({ projectId: f.selected[0]!.id, projectWorkspaceId: source!.id });
    const actor = { type: "agent" as const, source: "agent_key" as const, agentId: f.agentId, spaceId: f.spaceId };
    await expect(assertTaskWorkspaceExecutionAccess(db, actor, f.spaceId, { issueId: f.issue.id }))
      .rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(await taskInterruptionPresentation(db, moved!)).toMatchObject({
      canRetry: false, userAction: "project_access", projectAccess: { ready: false, projectId: null },
    });
    expect((await request(app(operator)).post(`/agents/${f.agentId}/project-access`)
      .send({ projectIds: [f.selected[1]!.id] })).status).toBe(200);
    expect(await taskInterruptionPresentation(db, moved!)).toMatchObject({ canRetry: true, projectAccess: { ready: true } });
    await expect(assertTaskWorkspaceExecutionAccess(db, actor, f.spaceId, { issueId: f.issue.id })).resolves.toBeDefined();
  });

  it.each(["applied", "pending"] as const)("rechecks the selected source after an %s repair instead of the old denied project", async repair => {
    const f = await seed();
    const [source] = await db.insert(projectWorkspaces).values({ spaceId: f.spaceId, projectId: f.selected[0]!.id,
      name: "Allowed repository", cwd: "/tmp/project-access-allowed" }).returning();
    await db.update(heartbeatRuns).set({ errorCode: "project_access_denied", error: null,
      resultJson: { projectAccessDenied: { projectId: f.selected[1]!.id } } }).where(eq(heartbeatRuns.id, f.runId));
    const moved = await issueService(db).update(f.issue.id, { projectId: f.selected[0]!.id });
    if (repair === "applied") {
      await issueService(db).update(f.issue.id, { projectWorkspaceId: source!.id, workspaceSelectionActor: operator });
    } else {
      await executionWorkspaceService(db).selectTaskWorkspace({ spaceId: f.spaceId, issueId: f.issue.id, actor: operator,
        selection: { kind: "configured_source", projectWorkspaceId: source!.id, mode: "managed_isolated" },
        expectedBindingRevision: 0, requestKey: randomUUID() });
    }
    expect(await taskInterruptionPresentation(db, moved!)).toMatchObject({ canRetry: true, projectAccess: { ready: true } });
    // The original denied source was not granted, and presentation creates no execution.
    expect((await db.select().from(agents).where(eq(agents.id, f.agentId)))[0]!.permissions).toEqual(f.permissions);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, f.spaceId))).toHaveLength(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.spaceId, f.spaceId))).toHaveLength(1);
    if (repair === "pending") {
      await db.update(issues).set({ workspaceBindingRevision: 2 }).where(eq(issues.id, f.issue.id));
      const stale = await taskInterruptionPresentation(db, moved!);
      expect(stale).toMatchObject({ state: "failed", canRetry: false, userAction: null });
      expect(stale).not.toHaveProperty("projectAccess");
    }
  });

  it("keeps a pending existing selection blocked if its workspace is archived before retry", async () => {
    const f = await seed();
    const task = await issueService(db).update(f.issue.id, { projectId: f.selected[0]!.id });
    const [workspace] = await db.insert(executionWorkspaces).values({ spaceId: f.spaceId,
      projectId: f.selected[0]!.id, name: "Selected files", cwd: "/tmp/project-access-selected",
      mode: "isolated_workspace", strategyType: "git_worktree" }).returning();
    const service = executionWorkspaceService(db);
    await service.selectTaskWorkspace({ spaceId: f.spaceId, issueId: f.issue.id, actor: operator,
      selection: { kind: "existing", workspaceId: workspace!.id }, expectedBindingRevision: 0, requestKey: randomUUID() });
    expect(await taskInterruptionPresentation(db, task!)).toMatchObject({ canRetry: true, projectAccess: { ready: true } });
    expect(await service.archiveWorkspaceUnderLifecycleLock({ id: workspace!.id, patch: {}, closedAt: new Date() }))
      .toMatchObject({ outcome: "archived" });
    await expect(service.applyPendingTaskWorkspaceSelection({ spaceId: f.spaceId, issueId: f.issue.id,
      runId: f.runId, actor: { type: "agent", source: "agent_key", agentId: f.agentId, spaceId: f.spaceId } }))
      .rejects.toThrow("Workspace is unavailable or inaccessible");
    const archived = await taskInterruptionPresentation(db, task!);
    expect(archived).toMatchObject({ state: "failed", canRetry: false, userAction: null });
    expect(archived).not.toHaveProperty("projectAccess");
  });

  it.each(["denied_project", "foreign_space"] as const)("retains the %s gate on a bound workspace even when its source is allowed", async boundary => {
    const f = await seed(), foreign = boundary === "foreign_space" ? await seed() : null;
    const [source] = await db.insert(projectWorkspaces).values({ spaceId: f.spaceId, projectId: f.selected[0]!.id,
      name: "Allowed source", cwd: "/tmp/project-access-source" }).returning();
    const [workspace] = await db.insert(executionWorkspaces).values({ spaceId: foreign?.spaceId ?? f.spaceId,
      projectId: foreign?.selected[0]!.id ?? f.selected[1]!.id, projectWorkspaceId: foreign ? null : source!.id,
      name: "Retained files", cwd: "/tmp/project-access-bound", mode: "isolated_workspace", strategyType: "git_worktree" }).returning();
    const [task] = await db.update(issues).set({ projectId: f.selected[0]!.id, projectWorkspaceId: source!.id,
      executionWorkspaceId: workspace!.id }).where(eq(issues.id, f.issue.id)).returning();
    const blocked = await taskInterruptionPresentation(db, task!);
    if (boundary === "denied_project") {
      expect(blocked).toMatchObject({ canRetry: false,
        userAction: "project_access", projectAccess: { ready: false, projectId: null } });
    } else {
      expect(blocked).toMatchObject({ state: "failed", canRetry: false, userAction: null });
      expect(blocked).not.toHaveProperty("projectAccess");
    }
  });

  it("preserves containment, audits concurrent additions, and changes the persisted denial into an explicit retry", async () => {
    const f = await seed();
    const actor = { type: "agent" as const, source: "agent_key" as const, agentId: f.agentId, spaceId: f.spaceId };
    await expect(assertTaskWorkspaceSourceProjectAccess(db, actor, f.spaceId, f.selected[1]!.id)).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(await taskInterruptionPresentation(db, f.issue)).toMatchObject({ userAction: "project_access", canRetry: false });
    const api = app(operator);
    const results = await Promise.all(f.selected.slice(1).map(project => request(api).post(`/agents/${f.agentId}/project-access`).send({ projectIds: [project.id] })));
    expect(results.map(result => result.status)).toEqual([200, 200]);
    const [saved] = await db.select().from(agents).where(eq(agents.id, f.agentId));
    expect(saved!.permissions).toEqual({ ...f.permissions, authorizationPolicy: { ...f.permissions.authorizationPolicy,
      trustBoundary: { ...f.permissions.authorizationPolicy.trustBoundary, projectIds: expect.arrayContaining(f.selected.map(project => project.id)) } } });
    expect((saved!.permissions as typeof f.permissions).authorizationPolicy.trustBoundary.projectIds).toHaveLength(3);
    await expect(assertTaskWorkspaceSourceProjectAccess(db, actor, f.spaceId, f.selected[1]!.id)).resolves.toBeUndefined();
    expect(await taskInterruptionPresentation(db, f.issue)).toMatchObject({ canRetry: true, projectAccess: { ready: true } });
    const again = await request(api).post(`/agents/${f.agentId}/project-access`).send({ projectIds: [f.selected[1]!.id] });
    expect(again.status).toBe(200);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.spaceId, f.spaceId), eq(activityLog.action, "agent.project_access_added")))).toHaveLength(2);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, f.spaceId))).toHaveLength(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.spaceId, f.spaceId))).toHaveLength(1);
  });

  it("rejects foreign projects, agent self-grants, unknown policy fields, and pending-approval agents", async () => {
    const f = await seed(), other = await seed(), api = app(operator);
    expect((await request(api).post(`/agents/${f.agentId}/project-access`).send({ projectIds: [other.selected[1]!.id] })).status).toBe(404);
    expect((await request(api).post(`/agents/${f.agentId}/project-access`).send({ projectIds: [f.selected[1]!.id], trustPreset: "standard" })).status).toBe(400);
    expect((await request(app({ type: "agent", agentId: f.agentId, spaceId: f.spaceId, source: "agent_key" }))
      .post(`/agents/${f.agentId}/project-access`).send({ projectIds: [f.selected[1]!.id] })).status).toBe(403);
    await db.update(agents).set({ status: "pending_approval" }).where(eq(agents.id, f.agentId));
    expect((await request(api).post(`/agents/${f.agentId}/project-access`).send({ projectIds: [f.selected[1]!.id] })).status).toBe(409);
    const [saved] = await db.select().from(agents).where(eq(agents.id, f.agentId)); expect(saved!.permissions).toEqual(f.permissions);
  });

  it.each(["standard", "root_issue"])("rechecks actual project authority after a %s repair and acknowledges an accepted retry", async repair => {
    const f = await seed();
    const permissions = repair === "standard" ? { canCreateAgents: false, trustPreset: "standard", authorizationPolicy: {} }
      : { ...f.permissions, authorizationPolicy: { ...f.permissions.authorizationPolicy,
        trustBoundary: { ...f.permissions.authorizationPolicy.trustBoundary, rootIssueId: f.issue.id } } };
    await db.update(agents).set({ permissions }).where(eq(agents.id, f.agentId));
    expect(await taskInterruptionPresentation(db, f.issue)).toMatchObject({ canRetry: true, projectAccess: { ready: true } });
    await db.insert(agentWakeupRequests).values({ spaceId: f.spaceId, agentId: f.agentId,
      source: "on_demand", status: "deferred_issue_execution", requestedByActorType: "user", payload: { issueId: f.issue.id } });
    const accepted = await taskInterruptionPresentation(db, f.issue);
    expect(accepted).toMatchObject({ state: "working", canRetry: false });
    expect(accepted).not.toHaveProperty("projectAccess");
    // Current project policy remains authoritative even after agent access changes.
    await db.update(projects).set({ executionWorkspacePolicy: { trustPreset: "low_trust_review", authorizationPolicy: {
      trustBoundary: { mode: "low_trust_review", spaceId: f.spaceId, projectIds: [f.selected[0]!.id] },
    } } }).where(eq(projects.id, f.selected[1]!.id));
    if (repair === "standard") expect(await taskInterruptionPresentation(db, f.issue))
      .toMatchObject({ canRetry: false, userAction: "project_access" });
  });

  it("shows read-only access to viewers and denies their saves and cross-space reads", async () => {
    const f = await seed(), other = await seed(), userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Viewer", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(spaceMemberships).values({ spaceId: f.spaceId, principalType: "user", principalId: userId, membershipRole: "viewer", status: "active" });
    const api = app({ type: "operator", source: "session", userId, spaceIds: [f.spaceId], memberships: [{ spaceId: f.spaceId, membershipRole: "viewer", status: "active" }] });
    expect((await request(api).get(`/agents/${f.agentId}/project-access`)).body).toMatchObject({ canManage: false });
    expect((await request(api).post(`/agents/${f.agentId}/project-access`).send({ projectIds: [f.selected[1]!.id] })).status).toBe(403);
    expect((await request(api).get(`/agents/${other.agentId}/project-access`)).status).toBe(404);
  });

  it("runs a private task in its owner's personal project without granting that project", async () => {
    const spaceId = randomUUID(), agentId = randomUUID(), ownerId = `owner-${randomUUID()}`;
    await db.insert(spaces).values({ id: spaceId, name: "Personal private tasks", issuePrefix: `P${spaceId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Default agent", adapterType: "process", status: "idle" });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "agent", principalId: agentId, membershipRole: "member", status: "active" });
    const [personal, shared] = await db.insert(projects).values([
      { spaceId, name: "My private tasks", visibility: "private", personalOwnerUserId: ownerId, privacyOwnerUserId: ownerId },
      { spaceId, name: "Private team project", visibility: "private", privacyOwnerUserId: ownerId },
    ]).returning();
    const task = async (projectId: string) => (await db.insert(issues).values({ spaceId, title: "Private chat", status: "todo",
      assigneeAgentId: agentId, projectId, visibility: "private", responsibleUserId: ownerId }).returning())[0]!;
    const actor = { type: "agent" as const, source: "agent_key" as const, agentId, spaceId };
    const personalTask = await task(personal!.id);
    await db.update(issues).set({ privacyRootIssueId: personalTask.id }).where(eq(issues.id, personalTask.id));

    // The agent can work the task it was given; the personal project stays unreadable.
    await expect(assertTaskWorkspaceExecutionAccess(db, actor, spaceId, { issueId: personalTask.id })).resolves.toMatchObject({ task: { id: personalTask.id } });
    await expect(assertTaskWorkspaceSourceProjectAccess(db, actor, spaceId, personal!.id)).rejects.toThrow(/not an access member/);

    // An execution workspace from the personal project is not a bare container.
    const [ownerFiles] = await db.insert(executionWorkspaces).values({ spaceId, projectId: personal!.id, name: "Owner workspace",
      cwd: "/tmp/personal-owner-workspace", mode: "isolated_workspace", strategyType: "git_worktree" }).returning();
    await db.update(issues).set({ executionWorkspaceId: ownerFiles!.id }).where(eq(issues.id, personalTask.id));
    await expect(assertTaskWorkspaceExecutionAccess(db, actor, spaceId, { issueId: personalTask.id, workspaceId: ownerFiles!.id }))
      .rejects.toThrow(/not an access member/);
    await db.update(issues).set({ executionWorkspaceId: null }).where(eq(issues.id, personalTask.id));

    // A shared private project, or a personal project that provides files, still needs membership.
    const sharedTask = await task(shared!.id);
    await db.update(issues).set({ privacyRootIssueId: sharedTask.id }).where(eq(issues.id, sharedTask.id));
    await expect(assertTaskWorkspaceExecutionAccess(db, actor, spaceId, { issueId: sharedTask.id })).rejects.toThrow(/not an access member/);
    await db.insert(projectWorkspaces).values({ spaceId, projectId: personal!.id, name: "Owner files", cwd: "/tmp/personal-owner-files" });
    await expect(assertTaskWorkspaceExecutionAccess(db, actor, spaceId, { issueId: personalTask.id })).rejects.toThrow(/not an access member/);
  });
});
