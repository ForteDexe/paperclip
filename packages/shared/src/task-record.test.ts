import { describe, expect, it } from "vitest";
import {
  parseTaskRecordBody,
  renderTaskRecordMarkdown,
  serializeTaskRecord,
  taskRecordSchema,
  type TaskRecord,
} from "./task-record.js";

const record: TaskRecord = {
  version: 1,
  intent: "Build a durable parser.",
  features: [{
    id: "parse_input",
    behavior: "Parse input",
    outcome: "Return normalized | records.",
    state: "testing",
  }],
  constraintsAndNonGoals: ["Do not mutate source files."],
  decisions: [],
  nextStep: { featureId: "parse_input", comment: "Run the focused test." },
  resultsAndVerification: ["Parser fixture passes."],
};

describe("task record", () => {
  it("round-trips structured fields without Markdown parsing", () => {
    expect(parseTaskRecordBody(serializeTaskRecord(record))).toEqual(record);
  });

  it("requires a next step to reference an existing feature", () => {
    expect(taskRecordSchema.safeParse({
      ...record,
      nextStep: { featureId: "missing" },
    }).success).toBe(false);
  });

  it("generates a read-only Markdown projection", () => {
    const markdown = renderTaskRecordMarkdown(record, "Parser task");
    expect(markdown).toContain("# Parser task");
    expect(markdown).toContain("| Parse input | Return normalized \\| records. | testing |");
    expect(markdown).toContain("- Feature or behavior: Parse input");
    expect(markdown).toContain("## Results and Verification");
  });
});
