import { z } from "zod";

export const SPACE_ARTIFACTS_DEFAULT_LIMIT = 30;
export const SPACE_ARTIFACTS_MAX_LIMIT = 100;
export const SPACE_ARTIFACTS_MAX_QUERY_LENGTH = 160;

export const spaceArtifactSourceSchema = z.enum(["document", "attachment", "work_product"]);

export const spaceArtifactMediaKindSchema = z.enum(["image", "video", "text", "document", "file", "empty"]);

export const spaceArtifactGroupBySchema = z.enum(["none", "task", "parent_task"]);

export const spaceArtifactsQuerySchema = z.object({
  kind: z.enum(["image", "video", "text", "document", "file", "all"]).optional().default("all"),
  projectId: z.string().guid().optional(),
  /** Only artifacts attributed to this agent (the `createdByAgent` on each result). */
  agentId: z.string().guid().optional(),
  q: z.string().trim().max(SPACE_ARTIFACTS_MAX_QUERY_LENGTH).optional(),
  groupBy: spaceArtifactGroupBySchema.optional().default("none"),
  groupIssueId: z.string().guid().optional(),
  starred: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean(),
  ).optional().default(false),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SPACE_ARTIFACTS_MAX_LIMIT)
    .optional()
    .default(SPACE_ARTIFACTS_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

export const spaceArtifactSchema = z.object({
  id: z.string().min(1),
  source: spaceArtifactSourceSchema,
  mediaKind: spaceArtifactMediaKindSchema,
  title: z.string(),
  previewText: z.string().nullable(),
  contentType: z.string().nullable(),
  contentPath: z.string().nullable(),
  openPath: z.string().nullable(),
  downloadPath: z.string().nullable(),
  issue: z.object({
    id: z.string().guid(),
    identifier: z.string(),
    title: z.string(),
  }),
  project: z.object({
    id: z.string().guid(),
    name: z.string(),
  }).nullable(),
  createdByAgent: z.object({
    id: z.string().guid(),
    name: z.string(),
  }).nullable(),
  updatedAt: z.string().datetime(),
  href: z.string().min(1),
});

export const spaceArtifactGroupSchema = z.object({
  id: z.string().min(1),
  groupBy: spaceArtifactGroupBySchema.exclude(["none"]),
  issue: z.object({
    id: z.string().guid(),
    identifier: z.string(),
    title: z.string(),
  }),
  title: z.string(),
  count: z.number().int().min(0),
  mediaKinds: z.array(spaceArtifactMediaKindSchema),
  previewArtifacts: z.array(spaceArtifactSchema),
  updatedAt: z.string().datetime(),
  href: z.string().min(1),
});

export const spaceArtifactsResponseSchema = z.object({
  artifacts: z.array(spaceArtifactSchema),
  groups: z.array(spaceArtifactGroupSchema).optional(),
  selectedGroup: spaceArtifactGroupSchema.nullable().optional(),
  nextCursor: z.string().nullable(),
});

export type SpaceArtifactsQuery = z.infer<typeof spaceArtifactsQuerySchema>;
