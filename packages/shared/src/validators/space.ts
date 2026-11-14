import { z } from "zod";
import {
  SPACE_STATUSES,
  ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES,
} from "../constants.js";
import { objectWithoutDefaults } from "./partial.js";

const logoAssetIdSchema = z.string().guid().nullable().optional();
const interactionResolverKindPolicySchema = z.object({
  defaultPolicy: z.enum(ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES).optional(),
  cap: z.enum(ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES).optional(),
}).strict();

export const interactionResolverPolicySchema = z.object({
  suggest_tasks: interactionResolverKindPolicySchema.optional(),
  ask_user_questions: interactionResolverKindPolicySchema.optional(),
  request_confirmation: interactionResolverKindPolicySchema.optional(),
  request_checkbox_confirmation: interactionResolverKindPolicySchema.optional(),
  request_item_verdicts: interactionResolverKindPolicySchema.optional(),
}).strict().default({});

export const createSpaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  workspaceRoot: z.string().min(1).optional(),
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  defaultResponsibleUserId: z.string().min(1).nullable().optional(),
});

export type CreateSpace = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = objectWithoutDefaults(
  createSpaceSchema
    .partial()
    .extend({
      status: z.enum(SPACE_STATUSES).optional(),
      spentMonthlyCents: z.number().int().nonnegative().optional(),
      requireOperatorApprovalForNewAgents: z.boolean().optional(),
      interactionResolverPolicy: interactionResolverPolicySchema.optional(),
      logoAssetId: logoAssetIdSchema,
    }),
);

export type UpdateSpace = z.infer<typeof updateSpaceSchema>;

export const updateSpaceBrandingSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    logoAssetId: logoAssetIdSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined
      || value.description !== undefined
      || value.logoAssetId !== undefined,
    "At least one branding field must be provided",
  );

export type UpdateSpaceBranding = z.infer<typeof updateSpaceBrandingSchema>;
