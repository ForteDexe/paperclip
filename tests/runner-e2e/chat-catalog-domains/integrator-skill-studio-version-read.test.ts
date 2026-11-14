import { expect, it, vi } from "vitest";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
const captured = vi.hoisted(() => ({ observation: {} as Record<string, unknown> }));
vi.mock("./integrator-support.js", async original => ({ ...await original<typeof import("./integrator-support.js")>(), observeInternal: async () => captured.observation }));
import { integratorSkillStudioCases } from "./integrator-skill-studio.js";
it("actual Studio observer reads immutable detail instead of treating the documented summary as content", async () => {
  const skill = { id: "skill", spaceId: "space", currentVersionId: "revision", markdown: "Saved exact skill bytes" };
  const summary = { id: "revision", spaceId: "space", spaceSkillId: "skill", revisionNumber: 1, authorAgentId: "ceo", authorUserId: null, fileInventory: [{ path: "SKILL.md", kind: "markdown" }] };
  const detail = { ...summary, fileInventory: [{ path: "SKILL.md", kind: "markdown", content: skill.markdown }] };
  const run = { id: "test", spaceId: "space", skillId: "skill", skillVersionId: "revision", skillVersion: summary };
  captured.observation = { scenarioId: "skills.studio-test", spaceId: "space", leadId: "ceo", reply: "Saved", state: { skill }, tasks: [], projects: [], goals: [], runs: [], humanQueries: [], links: [], activity: [] };
  const calls: string[] = [];
  const ctx = { input: { fixtures: { space: { id: "space" } }, api: { get: async (path: string) => {
    calls.push(path);
    if (path.endsWith("/test-runs/test")) return run;
    if (path.endsWith("/test-runs")) return [{ id: "test" }];
    if (path.endsWith("/versions/revision")) return detail;
    if (path.endsWith("/versions")) return [summary];
    if (path.endsWith("/skills/skill")) return skill;
    if (path.includes("/comments?")) return [];
    throw Error("Unexpected owned read");
  } } }, issue: () => ({ id: "source" }) } as unknown as ChatCatalogContext;
  const actual = await integratorSkillStudioCases[0]!.observe(ctx, { skill });
  expect(calls).toContain("/api/spaces/space/skills/skill/versions/revision");
  expect(actual).toMatchObject({ studioRuns: [{ skillVersion: summary }], pinnedVersions: { test: detail }, sourceIssueId: "source" });
  expect(summary.fileInventory[0]).not.toHaveProperty("content");
});
