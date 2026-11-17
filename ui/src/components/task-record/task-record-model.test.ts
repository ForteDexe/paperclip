import { describe, expect, it } from "vitest";
import { buildTaskRecord, parseTaskRecord, parseTaskRecordFeatures } from "./task-record-model";

describe("task record model", () => {
  it("seeds the living record from the task", () => {
    const record = buildTaskRecord({ title: "Preview texel density", description: "Show a checkerboard preview." });
    expect(record).toContain("# Preview texel density");
    expect(record).toContain("## Intent\nShow a checkerboard preview.");
    expect(record).toContain("## Decisions");
    expect(record).toContain("## Evidence and Results");
    expect(record).not.toContain("## Review Timeline");
    expect(record).toContain("| Feature or behavior | Agreed outcome | State | Evidence |");
  });

  it("parses ordered sections without damaging Markdown tables", () => {
    const sections = parseTaskRecord("# Work\n\n## Intent\nShip it.\n\n## Status\n| State | Evidence |\n| --- | --- |\n| Testing | shot.png |");
    expect(sections).toEqual([
      { heading: "Intent", body: "Ship it." },
      { heading: "Status", body: "| State | Evidence |\n| --- | --- |\n| Testing | shot.png |" },
    ]);
  });

  it("parses agent-maintained feature rows", () => {
    const features = parseTaskRecordFeatures(`## Features and Behaviors
| Feature or behavior | Agreed outcome | Agent state | Confirmation | Evidence |
| --- | --- | --- | --- | --- |
| Preview | Shows a checkerboard | Implemented | ☑ | shot.png |
| Toggle | Preserves the setting | Testing | ☐ | test log |
`);
    expect(features).toEqual([
      { behavior: "Preview", outcome: "Shows a checkerboard", agentState: "Implemented", evidence: "shot.png" },
      { behavior: "Toggle", outcome: "Preserves the setting", agentState: "Testing", evidence: "test log" },
    ]);
  });

  it("keeps evidence from the earlier four-column prototype", () => {
    expect(parseTaskRecordFeatures(`## Features and Behaviors
| Feature or behavior | Agreed outcome | State | Evidence |
| --- | --- | --- | --- |
| Preview | Shows a checkerboard | Testing | old-shot.png |
`)).toEqual([
      { behavior: "Preview", outcome: "Shows a checkerboard", agentState: "Testing", evidence: "old-shot.png" },
    ]);
  });
});
