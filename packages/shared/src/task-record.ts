import { z } from "zod";

export const TASK_RECORD_FEATURE_STATES = [
  "agreed",
  "testing",
  "validated",
  "implemented",
  "skipped_by_agreement",
] as const;

export const taskRecordFeatureStateSchema = z.enum(TASK_RECORD_FEATURE_STATES);

const taskRecordItemIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, numbers, _ or -");

export const taskRecordFeatureSchema = z.object({
  id: taskRecordItemIdSchema,
  behavior: z.string().trim().min(1).max(500),
  outcome: z.string().trim().min(1).max(20_000),
  state: taskRecordFeatureStateSchema,
  validation: z.string().trim().min(1).max(20_000).nullable(),
}).strict();

export const taskRecordNextStepSchema = z.object({
  featureId: taskRecordItemIdSchema,
  comment: z.string().trim().max(4_000).nullable().optional(),
}).strict();

const recordTextItemSchema = z.string().trim().min(1).max(20_000);

export const taskRecordSchema = z.object({
  version: z.literal(2),
  intent: z.string().trim().min(1).max(20_000),
  features: z.array(taskRecordFeatureSchema).max(100),
  constraintsAndNonGoals: z.array(recordTextItemSchema).max(100),
  decisions: z.array(recordTextItemSchema).max(100),
  openQuestions: z.array(recordTextItemSchema).max(100),
  nextStep: taskRecordNextStepSchema.nullable(),
  resultsAndVerification: z.array(recordTextItemSchema).max(100),
}).strict().superRefine((record, ctx) => {
  const featureIds = new Set<string>();
  for (const [index, feature] of record.features.entries()) {
    if (featureIds.has(feature.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Feature ids must be unique",
        path: ["features", index, "id"],
      });
    }
    featureIds.add(feature.id);
  }
  if (record.nextStep && !featureIds.has(record.nextStep.featureId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Next step must reference an existing feature",
      path: ["nextStep", "featureId"],
    });
  }
});

export const upsertTaskRecordSchema = z.object({
  record: taskRecordSchema,
  baseRevisionId: z.string().guid().nullable(),
  changeSummary: z.string().trim().max(500).nullable().optional(),
}).strict();

export type TaskRecordFeatureState = z.infer<typeof taskRecordFeatureStateSchema>;
export type TaskRecordFeature = z.infer<typeof taskRecordFeatureSchema>;
export type TaskRecordNextStep = z.infer<typeof taskRecordNextStepSchema>;
export type TaskRecord = z.infer<typeof taskRecordSchema>;
export type UpsertTaskRecord = z.infer<typeof upsertTaskRecordSchema>;

export function parseTaskRecordBody(body: string): TaskRecord | null {
  try {
    const parsed = taskRecordSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeTaskRecord(record: TaskRecord): string {
  return JSON.stringify(taskRecordSchema.parse(record));
}

function tableCell(value: string): string {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function bulletSection(title: string, items: string[]): string[] {
  return items.length > 0
    ? [`## ${title}`, "", ...items.map((item) => `- ${item}`)]
    : [];
}

export function renderTaskRecordMarkdown(record: TaskRecord, title = "Task Record"): string {
  const parsed = taskRecordSchema.parse(record);
  const sections: string[] = [
    `# ${title}`,
    "",
    "## Intent",
    "",
    parsed.intent,
  ];

  if (parsed.features.length > 0) {
    sections.push(
      "",
      "## Features and Behaviors",
      "",
      "| Feature or behavior | Agreed outcome | State | Validation |",
      "| --- | --- | --- | --- |",
      ...parsed.features.map((feature) =>
        `| ${tableCell(feature.behavior)} | ${tableCell(feature.outcome)} | ${feature.state} | ${tableCell(feature.validation ?? "")} |`),
    );
  }

  for (const section of [
    bulletSection("Constraints and Non-Goals", parsed.constraintsAndNonGoals),
    bulletSection("Decisions", parsed.decisions),
    bulletSection("Open Questions", parsed.openQuestions),
  ]) {
    if (section.length > 0) sections.push("", ...section);
  }

  if (parsed.nextStep) {
    const feature = parsed.features.find((candidate) => candidate.id === parsed.nextStep!.featureId)!;
    sections.push(
      "",
      "## Next Step",
      "",
      `- Feature or behavior: ${feature.behavior}`,
      ...(parsed.nextStep.comment ? [`- Comment: ${parsed.nextStep.comment}`] : []),
    );
  }

  const results = bulletSection("Results and Verification", parsed.resultsAndVerification);
  if (results.length > 0) sections.push("", ...results);
  return `${sections.join("\n")}\n`;
}
