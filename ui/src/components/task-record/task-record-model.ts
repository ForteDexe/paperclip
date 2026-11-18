import type { Issue, TaskRecord, TaskRecordFeature, TaskRecordFeatureState } from "@outpost/shared";

export { TASK_RECORD_DOCUMENT_KEY, TASK_RECORD_DOCUMENT_TITLE } from "@outpost/shared";
export type { TaskRecord, TaskRecordFeature, TaskRecordNextStep } from "@outpost/shared";

export function buildTaskRecord(issue: Pick<Issue, "title" | "description">): TaskRecord {
  return {
    version: 1,
    intent: issue.description?.trim() || issue.title.trim() || "Untitled task",
    features: [],
    constraintsAndNonGoals: [],
    decisions: [],
    nextStep: null,
    resultsAndVerification: [],
  };
}

export function taskRecordFeatureStateLabel(state: TaskRecordFeatureState): string {
  switch (state) {
    case "agreed": return "Agreed";
    case "testing": return "Testing";
    case "validated": return "Validated";
    case "implemented": return "Implemented";
    case "skipped_by_agreement": return "Skipped by agreement";
  }
}

export function resolveTaskRecordNextStepFeature(
  record: Pick<TaskRecord, "features" | "nextStep">,
): TaskRecordFeature | undefined {
  if (!record.nextStep) return undefined;
  return record.features.find((feature) => feature.id === record.nextStep!.featureId);
}
