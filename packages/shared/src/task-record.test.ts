import { describe, expect, it } from "vitest";
import {
  parseTaskRecordBody,
  renderTaskRecordMarkdown,
  serializeTaskRecord,
  taskRecordSchema,
  type TaskRecord,
} from "./task-record.js";

const record: TaskRecord = {
  version: 2,
  intent: "Build a durable parser.",
  features: [{
    id: "parse_input",
    behavior: "Parse input",
    outcome: "Return normalized | records.",
    state: "testing",
    validation: "Focused parser fixture is running.",
  }],
  constraintsAndNonGoals: ["Do not mutate source files."],
  decisions: [],
  openQuestions: ["Should malformed rows be skipped?"],
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

  it("requires the current structured workflow fields without accepting v1 records", () => {
    const { openQuestions: _questions, ...withoutOpenQuestions } = record;
    expect(taskRecordSchema.safeParse({ ...record, version: 1 }).success).toBe(false);
    expect(taskRecordSchema.safeParse({
      ...record,
      features: record.features.map(({ validation: _validation, ...feature }) => feature),
    }).success).toBe(false);
    expect(taskRecordSchema.safeParse(withoutOpenQuestions).success).toBe(false);
  });

  it("generates a read-only Markdown projection", () => {
    const markdown = renderTaskRecordMarkdown(record, "Parser task");
    expect(markdown).toContain("# Parser task");
    expect(markdown).toContain("| Parse input | Return normalized \\| records. | testing | Focused parser fixture is running. |");
    expect(markdown).toContain("## Open Questions");
    expect(markdown).toContain("- Feature or behavior: Parse input");
    expect(markdown).toContain("## Results and Verification");
  });
});
