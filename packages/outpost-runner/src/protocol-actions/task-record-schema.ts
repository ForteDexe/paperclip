import type { OutpostJsonSchema } from "../catalog/semantic-action-types.js";

const textItem: OutpostJsonSchema = { type: "string", minLength: 1, maxLength: 20_000 };
const featureId: OutpostJsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: "^[a-z0-9][a-z0-9_-]*$",
};

export const taskRecordInputSchema: OutpostJsonSchema = {
  type: ["object", "null"],
  description: "Structured Task Record. Use stable feature IDs so Next Step remains linked when behavior text changes.",
  properties: {
    version: { const: 1 },
    intent: textItem,
    features: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          id: featureId,
          behavior: { type: "string", minLength: 1, maxLength: 500 },
          outcome: textItem,
          state: { enum: ["agreed", "testing", "validated", "implemented", "skipped_by_agreement"] },
        },
        required: ["id", "behavior", "outcome", "state"],
        additionalProperties: false,
      },
    },
    constraintsAndNonGoals: { type: "array", maxItems: 100, items: textItem },
    decisions: { type: "array", maxItems: 100, items: textItem },
    nextStep: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            featureId,
            comment: { type: ["string", "null"], maxLength: 4_000 },
          },
          required: ["featureId"],
          additionalProperties: false,
        },
      ],
    },
    resultsAndVerification: { type: "array", maxItems: 100, items: textItem },
  },
  required: ["version", "intent", "features", "constraintsAndNonGoals", "decisions", "nextStep", "resultsAndVerification"],
  additionalProperties: false,
};
