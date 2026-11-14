import { expect, type Page } from "@playwright/test";
import { createTaskThroughUi, withBrowserEvent } from "../user-actions.js";
import { projectContextEvidencePasses, type ProjectContextObservation } from "./project-context-evidence.js";
import { openProjectTaskThroughList, reopenProjectThroughList } from "./project-context-readback.js";
import { JourneyError, type JourneyContext, type JourneyEvidence, type TargetSession } from "./types.js";

/** The toolbar action was renamed from "Add Project" to "Create project"; accept both deployed labels. */
export function newProjectButton(page: Page) {
  return page.getByRole("button", { name: /^(?:Add Project|Create project)$/ }).first();
}

export async function projectTaskContext(context: JourneyContext, session: TargetSession, campaignId: string, evidence: JourneyEvidence) {
  const { page, api, space } = context;
  const projectName = `Journey QA project ${campaignId}`;
  const taskTitle = `Journey QA project task ${campaignId}`;
  const prompt = `Keep this task assigned to me in ${projectName}. I will review it myself.`;
  const journeyId = "project-task-context" as const;
  await page.goto(`${api.origin}/${space.issuePrefix}/projects`);
  await newProjectButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill(projectName);
  await session.own({ kind: "project", name: projectName, journeyId });
  const response = await withBrowserEvent(
    () => page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/spaces/${space.id}/projects`),
    () => dialog.getByRole("button", { name: "Create project", exact: true }).click());
  if (response.status() !== 201) throw new JourneyError("failed", "project_ui_creation_failed");
  const createdProject = await response.json();
  if (typeof createdProject.id !== "string" || !createdProject.id || createdProject.spaceId !== space.id || createdProject.name !== projectName) {
    throw new JourneyError("failed", "project_ui_creation_mismatch");
  }
  await session.own({ kind: "project", name: projectName, id: createdProject.id, journeyId });
  await expect(dialog).not.toBeVisible();
  const projectRoute = `/api/projects/${createdProject.id}`;
  const projectBeforeReload = await api.get<ProjectContextObservation["projectBeforeReload"]>(projectRoute);
  const task = await createTaskThroughUi({ page, origin: api.origin, issuePrefix: space.issuePrefix,
    agentName: "Me", title: taskTitle, prompt, workMode: "standard", projectName, requireExplicitTitle: true,
    beforeDispatch: () => session.own({ kind: "issue", name: taskTitle, journeyId }) });
  await session.own({ kind: "issue", name: taskTitle, id: task.issueId, journeyId });
  const taskRoute = `/api/issues/${task.issueId}`;
  const taskBeforeReload = await api.get<ProjectContextObservation["taskBeforeReload"]>(taskRoute);
  const runsBeforeReload = await api.get<unknown[]>(`${taskRoute}/runs`);

  // Open the project from its list, then open its task from that project's Tasks view.
  await reopenProjectThroughList({ page, origin: api.origin, issuePrefix: space.issuePrefix, projectName,
    projectRef: projectBeforeReload.urlKey ?? createdProject.id });
  const projectTasks = await api.get<ProjectContextObservation["projectTasks"]>(`/api/spaces/${space.id}/issues?projectId=${createdProject.id}&limit=100&offset=0`);
  await openProjectTaskThroughList({ page, origin: api.origin, issuePrefix: space.issuePrefix, projectName, taskTitle, prompt,
    taskRef: taskBeforeReload.identifier ?? task.issueId });
  const observed: ProjectContextObservation = {
    spaceId: space.id, userId: context.user.id, projectId: createdProject.id, projectName,
    taskId: task.issueId, taskTitle, prompt, projectBeforeReload, taskBeforeReload, projectTasks, runsBeforeReload,
    projectAfterReload: await api.get(projectRoute), taskAfterReload: await api.get(taskRoute), runsAfterReload: await api.get(`${taskRoute}/runs`),
  };
  if (!projectContextEvidencePasses(observed)) throw new JourneyError("failed", "project_task_context_mismatch");
  evidence.checks.push(...["browser-created-project-persisted", "browser-created-project-task-persisted",
    "project-task-association-reloaded", "project-task-context-visible", "no-agent-work"].map(id => ({ id, passed: true })));
}
