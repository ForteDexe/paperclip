import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPlanTaskThroughUi, createTaskFromPromptThroughUi } from "../runner-e2e/plan-task-ui.js";

test("planning fixture creates the exact assignment through the current composer without providers", async ({ page, request }) => {
  const spaceResponse = await request.post("/api/spaces", { data: { name: `Planning setup ${randomUUID()}` } });
  expect(spaceResponse.ok()).toBe(true);
  const space = await spaceResponse.json();
  try {
    let lead: { id: string; name: string } | undefined;
    for (const name of ["A Different Owner", "Planning Fixture Lead"]) {
      const response = await request.post(`/api/spaces/${space.id}/agents`, { data: {
        name, role: "general", adapterType: "process", adapterConfig: { command: "false" },
        runtimeConfig: { heartbeat: { enabled: false } },
      } });
      expect(response.ok()).toBe(true);
      const agent = await response.json();
      expect((await request.post(`/api/agents/${agent.id}/pause`)).ok()).toBe(true);
      lead = agent;
    }
    const prompt = "Plan the work briefly, then carry it out. Verify a sample order and save the requested result.";
    const created = await createPlanTaskThroughUi({ page, spaceId: space.id, issuePrefix: space.issuePrefix,
      agentName: lead!.name, prompt });
    const issue = await (await request.get(`/api/issues/${created.id}`)).json();
    expect(issue).toMatchObject({ spaceId: space.id, assigneeAgentId: lead!.id, description: prompt, workMode: "standard" });
    const runs = await request.get(`/api/spaces/${space.id}/heartbeat-runs?limit=100`);
    expect(runs.ok()).toBe(true);
    expect(await runs.json()).toEqual([]);
  } finally {
    expect((await request.delete(`/api/spaces/${space.id}`)).ok()).toBe(true);
  }
});


test("everyday fixture preserves prompt, selected project and assignee without providers", async ({ page, request }) => {
  const spaceResponse = await request.post("/api/spaces", { data: { name: `Everyday setup ${randomUUID()}` } });
  expect(spaceResponse.ok()).toBe(true);
  const space = await spaceResponse.json();
  try {
    let lead: { id: string; name: string } | undefined;
    for (const name of ["A Different Owner", "Everyday Fixture Lead"]) {
      const response = await request.post(`/api/spaces/${space.id}/agents`, { data: {
        name, role: "general", adapterType: "process", adapterConfig: { command: "false" },
        runtimeConfig: { heartbeat: { enabled: false } },
      } });
      expect(response.ok()).toBe(true);
      lead = await response.json();
      expect((await request.post(`/api/agents/${lead!.id}/pause`)).ok()).toBe(true);
    }
    let project: { id: string; name: string } | undefined;
    for (const name of ["A Different Project", "Everyday Fixture Project"]) {
      const response = await request.post(`/api/spaces/${space.id}/projects`, { data: { name } });
      expect(response.ok()).toBe(true);
      project = await response.json();
    }
    const prompt = "Delegate the implementation to an engineer, review its delivered files, and finish after the revised result is ready.";
    const created = await createTaskFromPromptThroughUi({ page, spaceId: space.id, issuePrefix: space.issuePrefix,
      agentName: lead!.name, projectName: project!.name, prompt });
    const issue = await (await request.get(`/api/issues/${created.id}`)).json();
    expect(issue).toMatchObject({ id: created.id, spaceId: space.id, assigneeAgentId: lead!.id,
      projectId: project!.id, description: prompt, workMode: "standard" });
    const runs = await request.get(`/api/spaces/${space.id}/heartbeat-runs?limit=100`);
    expect(runs.ok()).toBe(true);
    expect(await runs.json()).toEqual([]);
  } finally {
    expect((await request.delete(`/api/spaces/${space.id}`)).ok()).toBe(true);
  }
});
