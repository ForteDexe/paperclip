import { describe, expect, it } from "vitest";
import {
  buildTaskRecord,
  resolveTaskRecordNextStepFeature,
  taskRecordFeatureStateLabel,
} from "./task-record-model";

describe("task record model", () => {
  it("builds structured initial fields from the task", () => {
    expect(buildTaskRecord({
      title: "Preview texel density",
      description: "Show a checkerboard preview.",
    })).toEqual({
      version: 1,
      intent: "Show a checkerboard preview.",
      features: [],
      constraintsAndNonGoals: [],
      decisions: [],
      nextStep: null,
      resultsAndVerification: [],
    });
  });

  it("resolves Next Step by stable feature id after a behavior rename", () => {
    const record = buildTaskRecord({ title: "Parser", description: "Parse files." });
    record.features = [{
      id: "parse_input",
      behavior: "Parse renamed input",
      outcome: "Return normalized records.",
      state: "testing",
    }];
    record.nextStep = { featureId: "parse_input", comment: "Run the focused test." };
    expect(resolveTaskRecordNextStepFeature(record)?.behavior).toBe("Parse renamed input");
  });

  it("maps stored feature states to presentation labels", () => {
    expect(taskRecordFeatureStateLabel("skipped_by_agreement")).toBe("Skipped by agreement");
  });
});
