import { describe, expect, it } from "vitest";
import {
  buildTaskRecord,
  parseTaskRecord,
  parseTaskRecordFeatures,
  parseTaskRecordNextStep,
  resolveTaskRecordNextStepFeature,
} from "./task-record-model";

describe("task record model", () => {
  it("seeds the living record from the task", () => {
    const record = buildTaskRecord({ title: "Preview texel density", description: "Show a checkerboard preview." });
    expect(record).toContain("# Preview texel density");
    expect(record).toContain("## Intent\nShow a checkerboard preview.");
    expect(record).not.toContain("## Decisions");
    expect(record).not.toContain("## Status");
    expect(record).not.toContain("## Open Questions");
    expect(record).not.toContain("Evidence");
    expect(record).not.toContain("## Review Timeline");
    expect(record).toContain("| Feature or behavior | Agreed outcome | State |");
    expect(record).toContain("## Next Step\n- Feature or behavior: Initial scope\n- Comment: Define the next concrete action.");
  });

  it("parses ordered sections without damaging Markdown tables", () => {
    const sections = parseTaskRecord("# Work\n\n## Intent\nShip it.\n\n## Notes\n| State | Note |\n| --- | --- |\n| Testing | Waiting on the focused test. |");
    expect(sections).toEqual([
      { heading: "Intent", body: "Ship it." },
      { heading: "Notes", body: "| State | Note |\n| --- | --- |\n| Testing | Waiting on the focused test. |" },
    ]);
  });

  it("parses agent-maintained feature rows", () => {
    const features = parseTaskRecordFeatures(`## Features and Behaviors
| Feature or behavior | Agreed outcome | State |
| --- | --- | --- |
| Preview | Shows a checkerboard | Implemented |
| Toggle | Preserves the setting | Testing |
`);
    expect(features).toEqual([
      { behavior: "Preview", outcome: "Shows a checkerboard", agentState: "Implemented" },
      { behavior: "Toggle", outcome: "Preserves the setting", agentState: "Testing" },
    ]);
  });

  it("rejects obsolete feature table shapes", () => {
    expect(parseTaskRecordFeatures(`## Features and Behaviors
| Feature or behavior | Agreed outcome | State | Evidence |
| --- | --- | --- | --- |
| Preview | Shows a checkerboard | Testing | old-shot.png |
`)).toEqual([]);
  });

  it("anchors the next step to a feature and derives its state", () => {
    const markdown = `## Features and Behaviors
| Feature or behavior | Agreed outcome | State |
| --- | --- | --- |
| Preview | Shows a checkerboard | Testing |

## Next Step
- Feature or behavior: Preview
- Comment: Verify the reopened preview keeps the chosen scale.
`;
    const features = parseTaskRecordFeatures(markdown);
    const nextStep = parseTaskRecordNextStep(markdown);

    expect(nextStep).toEqual({
      behavior: "Preview",
      comment: "Verify the reopened preview keeps the chosen scale.",
    });
    expect(resolveTaskRecordNextStepFeature(nextStep, features)?.agentState).toBe("Testing");
  });

  it("allows an anchored next step without a comment", () => {
    expect(parseTaskRecordNextStep(`## Next Step
- Feature or behavior: Preview
`)).toEqual({ behavior: "Preview", comment: "" });
  });
});
