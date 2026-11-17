import type { Issue } from "@outpost/shared";
export { TASK_RECORD_DOCUMENT_KEY, TASK_RECORD_DOCUMENT_TITLE } from "@outpost/shared";

export interface TaskRecordSection {
  heading: string;
  body: string;
}

export interface TaskRecordFeature {
  behavior: string;
  outcome: string;
  agentState: string;
}

export interface TaskRecordNextStep {
  behavior: string;
  comment: string;
}

export function buildTaskRecord(issue: Pick<Issue, "title" | "description">): string {
  const description = issue.description?.trim() || "Describe the outcome this task should produce.";
  return `# ${issue.title.trim() || "Untitled task"}

## Intent
${description}

## Features and Behaviors
| Feature or behavior | Agreed outcome | State |
| --- | --- | --- |
| Initial scope | Refine this with the agent during the first turns. | Agreed |

## Constraints and Non-Goals
- None recorded yet.

## Next Step
- Feature or behavior: Initial scope
- Comment: Define the next concrete action.
`;
}

export function parseTaskRecord(markdown: string): TaskRecordSection[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const matches = [...normalized.matchAll(/^##\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? normalized.length;
    return {
      heading: match[1]!.trim(),
      body: normalized.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

function tableCells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function parseTaskRecordFeatures(markdown: string): TaskRecordFeature[] {
  const section = parseTaskRecord(markdown).find((candidate) => candidate.heading.toLowerCase() === "features and behaviors");
  if (!section) return [];
  const rows = section.body.split("\n").filter((line) => /^\s*\|/.test(line));
  if (rows.length < 3) return [];
  if (rows.some((row) => tableCells(row).length !== 3)) return [];
  return rows.slice(2).flatMap((row) => {
    const cells = tableCells(row);
    const [behavior, outcome, agentState] = cells;
    if (!behavior) return [];
    return [{
      behavior,
      outcome: outcome ?? "",
      agentState: agentState ?? "",
    }];
  });
}

function listFieldValue(body: string, field: string): string {
  const expected = field.toLowerCase();
  for (const line of body.split("\n")) {
    const content = line.trim().replace(/^-\s*/, "");
    const separator = content.indexOf(":");
    if (separator < 0) continue;
    if (content.slice(0, separator).trim().toLowerCase() !== expected) continue;
    return content.slice(separator + 1).trim();
  }
  return "";
}

export function parseTaskRecordNextStep(markdown: string): TaskRecordNextStep | null {
  const section = parseTaskRecord(markdown).find((candidate) => candidate.heading.toLowerCase() === "next step");
  if (!section) return null;
  const behavior = listFieldValue(section.body, "Feature or behavior");
  if (!behavior) return null;
  return {
    behavior,
    comment: listFieldValue(section.body, "Comment"),
  };
}

export function resolveTaskRecordNextStepFeature(
  nextStep: TaskRecordNextStep | null,
  features: TaskRecordFeature[],
): TaskRecordFeature | undefined {
  if (!nextStep) return undefined;
  const behavior = nextStep.behavior.toLowerCase();
  return features.find((feature) => feature.behavior.toLowerCase() === behavior);
}
