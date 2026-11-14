import { and, eq } from "drizzle-orm";
import { issues, type Db } from "@outpost/db";
import { Router, type Request } from "express";
import { prepareWorkspaceRepositorySchema, selectTaskWorkspaceSchema } from "@outpost/shared";
import { accessService } from "../services/access.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import { issueReadSqlCondition } from "../services/authorization.js";
import { projectToolContext } from "../services/project-tool-context.js";
import { logActivity } from "../services/activity-log.js";
import { forbidden, notFound } from "../errors.js";
import { assertSpaceAccess, getActorInfo, hasSpaceAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";

export function taskWorkspaceRoutes(db: Db) {
  const router = Router();
  const workspaces = executionWorkspaceService(db);
  async function task(req: Request, write = false) {
    const [issue] = await db.select().from(issues).where(and(eq(issues.id, req.params.id as string), await issueReadSqlCondition(db, req.actor)));
    if (!issue) throw notFound("Task not found");
    if (!hasSpaceAccess(req, issue.spaceId)) throw notFound("Task not found");
    assertSpaceAccess(req, issue.spaceId);
    const decision = await accessService(db).decide({ actor: req.actor, action: write ? "issue:mutate" : "issue:read", resource: {
      type: "issue", spaceId: issue.spaceId, issueId: issue.id,
      status: issue.status, assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId,
    } });
    if (!decision.allowed) throw forbidden("Task workspace is outside this actor's authorization boundary");
    if (write && req.actor.type === "agent") {
      const context = await projectToolContext(db, req.actor, true, "Workspace");
      if (context.issue.id !== issue.id) throw forbidden("Workspace selection is scoped to the current task");
    }
    return issue;
  }
  router.get("/issues/:id/workspace", async (req, res) => {
    const issue = await task(req);
    const view = await workspaces.inspectTaskWorkspace(issue.spaceId, issue.id, req.actor);
    res.json({ ...view, repositories: issue.executionWorkspaceId ? await workspaces.listTaskRepositories(issue.spaceId, issue.executionWorkspaceId) : [], capabilities: { prepareRepository: view.workspace?.providerType === "adapter_managed" ? "unsupported" : "next_normal_admission", selectWorkspace: "next_normal_admission" }, fileLocations: { taskFiles: "workspace", personalInstructionsAndMemory: "AGENT_HOME", providerHome: "runtime_managed" } });
  });
  router.put("/issues/:id/workspace", validate(selectTaskWorkspaceSchema), async (req, res) => {
    const issue = await task(req, true);
    const result = await workspaces.selectTaskWorkspace({ spaceId: issue.spaceId, issueId: issue.id, actor: req.actor, ...req.body });
    const actor = getActorInfo(req);
    await logActivity(db, { spaceId: issue.spaceId, ...actor, action: "issue.workspace.selection_requested", entityType: "issue", entityId: issue.id, details: { selection: req.body.selection, applies: "next_normal_admission" } });
    res.json(result);
  });
  router.post("/issues/:id/workspace/repositories", validate(prepareWorkspaceRepositorySchema), async (req, res) => {
    const issue = await task(req, true);
    res.json(await workspaces.requestTaskRepository({ spaceId: issue.spaceId, issueId: issue.id, actor: req.actor, request: req.body }));
  });
  return router;
}
