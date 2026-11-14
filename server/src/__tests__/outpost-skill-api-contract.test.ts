import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listPaperclipSkillEntries } from "@outpost/adapter-utils/server-utils";
import {
  checkoutIssueSchema,
  createGoalSchema,
  createIssueSchema,
  createIssueThreadInteractionSchema,
  updateIssueSchema,
  upsertIssueDocumentSchema,
} from "@outpost/shared";
import {
  createCaseSchema,
  createIssueLinkSchema,
  upsertCaseDocumentSchema,
} from "../routes/cases-schemas.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function jsonExample(relativePath: string, heading: string): unknown {
  const markdown = readFileSync(path.join(repoRoot, relativePath), "utf8");
  const headingAt = markdown.indexOf(heading);
  if (headingAt < 0) throw new Error(`Missing heading ${heading} in ${relativePath}`);
  const match = markdown.slice(headingAt).match(/```json\s*([\s\S]*?)```/);
  if (!match?.[1]) throw new Error(`Missing JSON example after ${heading} in ${relativePath}`);
  return JSON.parse(match[1]);
}

describe("focused Outpost skill API examples", () => {
  it("discovers the six focused skills as bundled runtime capabilities", async () => {
    const entries = await listPaperclipSkillEntries(here, [path.join(repoRoot, "skills")]);
    const keys = entries.map((entry) => entry.key);

    expect(keys).toEqual(expect.arrayContaining([
      "paperclipai/paperclip/outpost-task",
      "paperclipai/paperclip/outpost-decision",
      "paperclipai/paperclip/outpost-artifact",
      "paperclipai/paperclip/outpost-case",
      "paperclipai/paperclip/outpost-north-star",
      "paperclipai/paperclip/outpost-delegation",
    ]));
    expect(keys).not.toContain("paperclipai/paperclip/paperclip");
  });

  it("keeps the task update example accepted by the task API", () => {
    expect(updateIssueSchema.parse(jsonExample(
      "skills/outpost-task/references/api-reference.md",
      "## Updates and comments",
    ))).toMatchObject({ status: "in_progress" });
    expect(checkoutIssueSchema.parse({
      agentId: "00000000-0000-4000-8000-000000000001",
      expectedStatuses: ["todo", "backlog", "in_progress"],
    })).toBeTruthy();
  });

  it("keeps both Decision examples accepted by the interaction API", () => {
    const file = "skills/outpost-decision/references/api-reference.md";
    expect(createIssueThreadInteractionSchema.parse(jsonExample(file, "## Yes/no confirmation")))
      .toMatchObject({ kind: "request_confirmation", continuationPolicy: "wake_assignee" });
    expect(createIssueThreadInteractionSchema.parse(jsonExample(file, "## Questions")))
      .toMatchObject({ kind: "ask_user_questions", continuationPolicy: "wake_assignee" });
  });

  it("keeps Case create, link, and document examples accepted", () => {
    const file = "skills/outpost-case/references/api-reference.md";
    expect(createCaseSchema.parse(jsonExample(file, "## Create or upsert")))
      .toMatchObject({ caseType: "recurring_bug", status: "in_progress" });
    expect(createIssueLinkSchema.parse(jsonExample(file, "## Link the current task")))
      .toMatchObject({ role: "work" });
    expect(upsertCaseDocumentSchema.parse(jsonExample(file, "## Durable findings")))
      .toMatchObject({ format: "markdown" });
  });

  it("keeps the North Star create example accepted", () => {
    expect(createGoalSchema.parse(jsonExample(
      "skills/outpost-north-star/references/api-reference.md",
      "Create example:",
    ))).toMatchObject({ level: "company", status: "active" });
  });

  it("keeps the delegation create example accepted", () => {
    expect(createIssueSchema.parse(jsonExample(
      "skills/outpost-delegation/references/api-reference.md",
      "Create the assigned child:",
    ))).toMatchObject({ status: "todo", priority: "medium" });
  });

  it("keeps the task-document example accepted", () => {
    expect(upsertIssueDocumentSchema.parse(jsonExample(
      "skills/outpost-task/references/task-documents.md",
      "## Create",
    ))).toMatchObject({ format: "markdown", baseRevisionId: null });
  });
});

