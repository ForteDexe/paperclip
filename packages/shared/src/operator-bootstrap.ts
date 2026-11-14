import { z } from "zod";
import { SPACE_STATUSES, PAUSE_REASONS } from "./constants.js";
import { interactionResolverPolicySchema } from "./validators/space.js";
import type { OperatorBootstrap } from "./types/operator-bootstrap.js";
import type { Space } from "./types/space.js";

const spaceSnapshotSchema: z.ZodType<Space> = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  workspaceRoot: z.string().nullable(),
  status: z.enum(SPACE_STATUSES),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  pausedAt: z.coerce.date().nullable(),
  issuePrefix: z.string().min(1),
  issueCounter: z.number(),
  budgetMonthlyCents: z.number(),
  spentMonthlyCents: z.number(),
  defaultResponsibleUserId: z.string().nullable(),
  defaultAgentId: z.string().nullable(),
  requireOperatorApprovalForNewAgents: z.boolean(),
  interactionResolverPolicy: interactionResolverPolicySchema,
  feedbackDataSharingEnabled: z.boolean(),
  feedbackDataSharingConsentAt: z.coerce.date().nullable(),
  feedbackDataSharingConsentByUserId: z.string().nullable(),
  feedbackDataSharingTermsVersion: z.string().nullable(),
  logoAssetId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const bootstrapSchema: z.ZodType<OperatorBootstrap> = z.object({
  userId: z.string().min(1),
  spaces: z.array(spaceSnapshotSchema),
  operatorAccess: z.object({
    userId: z.string().min(1),
    isInstanceAdmin: z.boolean(),
    spaceIds: z.array(z.string().min(1)),
  }),
});

/** An unusable optional projection falls back to the existing authenticated reads. */
export function readOperatorBootstrap(value: unknown, userId: string): OperatorBootstrap | undefined {
  const parsed = bootstrapSchema.safeParse(value);
  return parsed.success && parsed.data.userId === userId && parsed.data.operatorAccess.userId === userId
    ? parsed.data
    : undefined;
}
