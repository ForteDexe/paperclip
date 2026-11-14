import { updateWorkspacePreferenceSchema } from "@outpost/shared";
import { MUSE_ASSET_VERSION, museStopBoundarySchema, museDetectorCleanupAttestationSchema, createGrokInvitationSchema, configureGrokRoutineSchema, verifyGrokRoutineSchema, recoverGrokRoutineSchema, pairGrokBindingSchema, stopGrokWorkSchema, retryGrokDeliverySchema, updateFastResponseSchema } from "@outpost/shared";
import { slackTestMessageSchema, slackTestMessageResultSchema, slackManagerAuthorizationSchema, slackSetupOptionsSchema, slackManagedProvisionSchema, slackManagedResultSchema, slackRegistrationSchema, slackSetupActionSchema, slackInstallAuthorizationSchema, slackRegistrationStateSchema, slackAppConfigurationSchema, slackAvatarStateSchema, slackAccountStateSchema } from "@outpost/shared";
import { experimentalApiMetadata } from "./experimental-api-metadata.js";
import { ATTENTION_SOURCE_KINDS } from "@outpost/shared";
import { agentCaseHandoffSchema, caseWorkflowDocumentTextSchema, doneCaseHandoffSchema, createWorkflowSchema, updateWorkflowSchema, listWorkflowsSchema, readWorkflowQuerySchema } from "@outpost/shared";
import {
  experimentalApiDocs,
  experimentalApiPaths,
  experimentalApiQueries,
} from "./experimental-api-paths.js";
import { Router } from "express";
import { subscriptionPriceSchema, mergeSubscriptionsSchema } from "@outpost/shared";
import { z } from "zod";
import { getHiddenSettings } from "../services/settings-visibility.js";
import {
  gitHubRepositoryPageQuerySchema,
  toggleAllGitHubRepositoriesSchema,
  createAiConnectionSchema,
  updateDecisionModelSchema,
  updatePromptInjectionPreventionSchema,
  aiConnectionPoolConfigSchema,
  aiConnectionLoginIntentSchema,
  localAiConnectionSchema,
  localAiLoginStartSchema,
  browserCodeSchema,
  emailEndpointSetupSchema,
  emailConnectionSchema,
  emailAddressCheckSchema,
  emailSendSchema,
  browserUseControlSchema,
  browserUseSettingsSchema,
  browserUseViewportSchema,
  browserUseViewerSchema,
  startVoiceSessionSchema, voiceCallbackPreferenceSchema, voicePhoneConfigurationSchema, voiceInboundDecisionSchema, VOICE_SESSION_STATES,
  slackToolCallSchema,
  slackSearchConfigSchema,
  // Agent
  submitAgentCommentarySchema,
  sendChatMessageSchema,
  markIssueReadSchema,
  agentCommentaryQuerySchema,
  AGENT_PALETTE_IDS,
  AGENT_AVATAR_SIZES,
  CHARACTER_STATES,
  agentAppearanceSchema,
  setAgentAvatarSchema,
  createAgentSchema,
  createAgentCreationSchema,
  updateAgentSchema,
  updateDefaultAgentSchema,
  updateAgentPermissionsSchema,
  updateAgentPermissionGrantSchema,
  updateAgentInteractionPermissionsSchema,
  agentInteractionPermissionsSchema,
  addAgentProjectAccessSchema,
  updateAgentInstructionsPathSchema,
  updateAgentInstructionsBundleSchema,
  upsertAgentInstructionsFileSchema,
  restoreAgentInstructionSchema,
  resolveAgentInstructionCandidateSchema,
  createAgentKeySchema,
  builtInAgentEmptyMutationSchema,
  builtInAgentProvisionSchema,
  generateSummarySlotSchema,
  writeSummarySlotSchema,
  createStatusCardSchema,
  patchStatusCardSchema,
  refreshStatusCardSchema,
  writeStatusCardQuerySchema,
  writeStatusCardSummarySchema,
  wakeAgentSchema,
  resetAgentSessionSchema,
  agentSkillSyncSchema,
  testAdapterEnvironmentSchema,
  qualifyAgentRunnerSchema,
  // Issue
  createIssueSchema,
  setIssueTitleSchema,
  updateIssueSchema,
  stalledReviewDecisionSchema,
  createIssueLabelSchema,
  addIssueCommentSchema,
  checkoutIssueSchema,
  linkIssueApprovalSchema,
  createIssueWorkProductSchema,
  updateIssueWorkProductSchema,
  issueDocumentKeySchema,
  upsertIssueDocumentSchema,
  restoreIssueDocumentRevisionSchema,
  upsertIssueFeedbackVoteSchema,
  upsertIssueWatchdogSchema,
  runnerGoalActionRequestSchema,
  selectTaskWorkspaceSchema,
  prepareWorkspaceRepositorySchema,
  // Project
  createProjectSchema,
  updateProjectSchema,
  addProjectAccessMemberSchema,
  createProjectWorkspaceSchema,
  updateProjectWorkspaceSchema,
  // Space
  createSpaceSchema,
  updateSpaceSchema,
  updateSpaceBrandingSchema,
  spaceArtifactsQuerySchema,
  spaceArtifactsResponseSchema,
  // Decisions
  addDecisionQueueItemSchema,
  createDecisionQueueSchema,
  createDecisionArchiveProposalSchema,
  decisionAttentionSourceKindSchema,
  decisionInputsSchema,
  decisionOptionsSchema,
  removeDecisionQueueItemSchema,
  updateDecisionQueueSchema,
  updateDecisionTriageSchema,
  updateDecisionRetentionSchema,
  // Routine
  createRoutineSchema,
  updateRoutineSchema,
  createRoutineTriggerSchema,
  updateRoutineTriggerSchema,
  rotateRoutineTriggerSecretSchema,
  runRoutineSchema,
  // Folders
  createFolderSchema,
  ensureMySkillFolderSchema,
  folderKindSchema,
  moveFolderItemSchema,
  moveFolderSchema,
  updateFolderSchema,
  // Goal
  createGoalSchema,
  updateGoalSchema,
  // Secret
  createSecretSchema,
  updateSecretSchema,
  rotateSecretSchema,
  rotateUserSecretValueSchema,
  createUserSecretDefinitionSchema,
  updateUserSecretDefinitionSchema,
  createUserSecretValueSchema,
  updateUserSecretValueSchema,
  // Approval
  createApprovalSchema,
  resolveApprovalSchema,
  requestApprovalRevisionSchema,
  resubmitApprovalSchema,
  addApprovalCommentSchema,
  // Cost / budget
  createCostEventSchema,
  createFinanceEventSchema,
  updateBudgetSchema,
  upsertBudgetPolicySchema,
  resolveBudgetIncidentSchema,
  repairAccountingSchema,
  retryAccountingSchema,
  importBillingInvoiceSchema,
  importProviderCostsSchema,
  adjustCostSchema,
  // Sidebar
  upsertSidebarOrderPreferenceSchema,
  // Announcements
  announcementIdSchema,
  announcementSchema,
  dismissAnnouncementSchema,
  // Execution workspaces
  reconcileExecutionWorkspaceBranchSchema,
  updateExecutionWorkspaceSchema,
  workspaceOverviewQuerySchema,
  workspaceRuntimeControlTargetSchema,
  // Environments
  createEnvironmentSchema,
  cancelEnvironmentCustomImageSetupSessionSchema,
  createEnvironmentCustomImageTerminalSessionTokenSchema,
  environmentCustomImageSetupSessionSchema,
  environmentCustomImageTerminalSessionTokenSchema,
  environmentCustomImageTemplateSchema,
  finishEnvironmentCustomImageSetupSessionSchema,
  relinkEnvironmentCustomImageTemplateSchema,
  updateEnvironmentSchema,
  probeEnvironmentConfigSchema,
  startEnvironmentCustomImageSetupSessionSchema,
  // Space skills
  skillSourceDiscoverySchema,
  skillSourcePreviewSchema,
  skillSourceCreateSchema,
  skillSourceSelectionSchema,
  skillSourceSettingsSchema,
  skillSourceBranchesQuerySchema,
  projectSkillSourceAdoptSchema,
  spaceSkillCreateSchema,
  spaceSkillFileDeleteSchema,
  spaceSkillFileUpdateSchema,
  spaceSkillImportSchema,
  spaceSkillProjectBrowseRequestSchema,
  spaceSkillProjectBrowseResultSchema,
  spaceSkillProjectScanRequestSchema,
  spaceSkillProjectScanResultSchema,
  spaceSkillRenameResultSchema,
  spaceSkillRenameSchema,
  spaceSkillTestInputCreateSchema,
  spaceSkillTestInputUpdateSchema,
  spaceSkillTestRunCreateSchema,
  spaceSkillTestRunListQuerySchema,
  spaceSkillTestRunTemplateCreateSchema,
  spaceSkillTestRunTemplateUpdateSchema,
  evaluateSkillPolicySchema,
  replaceSkillPolicySchema,
  updateInboxAgentPolicySchema,
  // Issue tree
  createIssueTreeHoldSchema,
  previewIssueTreeControlSchema,
  releaseIssueTreeHoldSchema,
  // Issue interactions
  createIssueThreadInteractionSchema,
  createChildIssueSchema,
  acceptIssueThreadInteractionSchema,
  resolveConfirmationFromCommentSchema,
  rejectIssueThreadInteractionSchema,
  respondIssueThreadInteractionSchema,
  skipIssueThreadInteractionSchema,
  submitIssueThreadInteractionVerdictsSchema,
  withdrawIssueThreadInteractionSchema,
  // Auth / profile
  // Space portability (legacy routes)
  spacePortabilityExportSchema,
  spacePortabilityPreviewSchema,
  spacePortabilityImportSchema,
  // Access / membership
  acceptInviteSchema,
  createSpaceInviteSchema,
  createOpenClawInvitePromptSchema,
  claimJoinRequestApiKeySchema,
  createCliAuthChallengeSchema,
  resolveCliAuthChallengeSchema,
  createOperatorApiKeySchema,
  updateSpaceMemberSchema,
  updateSpaceMemberWithPermissionsSchema,
  archiveSpaceMemberSchema,
  updateMemberPermissionsSchema,
  updateUserSpaceAccessSchema,
  // Instance settings
  patchInstanceGeneralSettingsSchema,
  patchInstanceExperimentalSettingsSchema,
  patchInstanceSettingsSchema,
  startTaskDrainRequestSchema,
  // Resource memberships
  updateDocumentResourceMembershipSchema,
  updateResourceMembershipSchema,
  // Document annotations
  createDocumentAnnotationCommentSchema,
  createDocumentAnnotationThreadSchema,
  updateDocumentAnnotationThreadSchema,
  // Issue recovery and decomposition
  createAcceptedPlanDecompositionSchema,
  resolveIssueRecoveryActionSchema,
  recoverWorkspaceSchema,
  taskRetrySchema,
  retryWorkspaceExportSchema,
  reconstructWorkspaceSchema,
  resumeWorkspaceFinalizationSchema,
  confirmNativeControllerStoppedSchema,
  confirmOwnerGoneSchema,
  confirmRunStoppedSchema,
  cancelIssueThreadInteractionSchema,
  // Secret provider configs and remote import
  createSecretProviderConfigSchema,
  updateSecretProviderConfigSchema,
  secretProviderConfigDiscoveryPreviewSchema,
  remoteSecretImportPreviewSchema,
  remoteSecretImportSchema,
  workspaceFileAvailabilityRequestSchema,
  workspaceFileAvailabilityResponseSchema,
  workspaceFileListQuerySchema,
  workspaceFileResourceQuerySchema,
  // Tool access
  connectToolAppSchema,
  configureRailwaySshSchema,
  createToolApplicationSchema,
  updateToolApplicationSchema,
  createToolConnectionSchema,
  createConnectionGrantDelegationSchema,
  connectionTokenRequestSchema,
  startConnectionAuthorizationSchema,
  createToolStdioCommandTemplateSchema,
  disableToolStdioCommandTemplateSchema,
  finalizeOAuthAccessSchema,
  finishToolAppSchema,
  reconnectToolAppSchema,
  startToolOAuthSchema,
  updateToolConnectionSchema,
  putToolConnectionInstallsSchema,
  toolConnectionTestCallSchema,
  createToolPolicySchema,
  duplicateToolPolicySchema,
  createToolProfileBindingForProfileSchema,
  createToolProfileEntryForProfileSchema,
  createToolProfileWithEntriesSchema,
  deleteToolProfileSchema,
  duplicateToolProfileSchema,
  reorderToolPoliciesSchema,
  reviewToolProfileNewToolsSchema,
  updateToolPolicySchema,
  updateToolProfileEntrySchema,
  updateToolProfileWithEntriesSchema,
  createToolTrustRuleFromActionRequestSchema,
  revokeToolTrustRuleSchema,
  unbindToolProfileBindingSchema,
  importMcpJsonSchema,
  mcpConsentSchema,
  toolPolicyTestRequestSchema,
  createToolMcpGatewaySchema,
  completeConnectionIntentSchema,
  connectionIntentPayloadSchema,
  connectionRequestInputSchema,
  connectionsSearchInputSchema,
  declineConnectionIntentSchema,
  startClaudeSetupTokenSessionRequestSchema,
  submitBrowserCodeRequestSchema,
  claudeSetupTokenSessionResponseSchema,
  claudeSetupTokenSessionPromptSchema,
  claudeSetupTokenSessionOwnerResponseSchema,
  claudeSetupTokenCompletionResponseSchema,
  claudeOAuthTokenStatusResponseSchema,
  startAdapterAuthSessionRequestSchema,
  // Chat channels
  githubChatConfigurationSchema,
  githubReviewAssessmentSchema,
  updateGitHubChatConfigurationSchema,
  chatDeliveryStateSchema,
  chatEndpointStatusSchema,
  chatIdentityLinkStatusSchema,
  chatProviderSchema,
  CHAT_FILE_TRANSFER_PHASES,
  chatPublicationStateSchema,
  chatResourceAvailabilitySchema,
  configureChatEndpointSchema,
  confirmChatIdentityLinkSchema,
  createChatEndpointSchema,
  createChatIdentityLinkIntentSchema,
  inspectPhotonProjectSchema,
  photonProjectIdSchema,
  photonLineIdSchema,
  publishChatPublicationSchema,
  resolveChatActionSchema,
  resolveChatPublicationSchema,
  replaceChatEndpointResourcesSchema,
  updateChatEndpointSchema,
} from "@outpost/shared";
import { aggregatorAppsSyncSchema, aggregatorAppsRefreshSchema, arcadeDiscoverySetupSchema } from "@outpost/shared/aggregator-apps";
import { composioAppsSyncSchema, composioAppsRefreshSchema, composioAppSetupSchema, composioAppAccountSchema } from "@outpost/shared/composio-app-setup";
import {
  SPACE_IMPORT_TRANSFERS_API_PATH,
  spaceImportTransferDeclarationSchema,
} from "@outpost/shared/space-import-transfer";

type JsonSchema = Record<string, unknown>;
type OpenApiResponse = Record<string, unknown>;
type OpenApiPathRegistration = {
  method: string;
  path: string;
  request?: {
    params?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    headers?: z.ZodTypeAny;
    body?: {
      content: Record<string, { schema: unknown }>;
      required?: boolean;
    };
  };
  responses?: Record<string, OpenApiResponse>;
  [key: string]: unknown;
};

// Zod 4 stores each schema definition on `_def` with a lowercase `type`
// discriminator and moves the wrapped members onto that def. This loose view
// lets the converter read those members, because Zod 4 does not export a
// public type for every internal def shape.
type ZodDefAny = Record<string, unknown> & { type: string };

const zodDef = (schema: z.ZodTypeAny): ZodDefAny =>
  schema._def as unknown as ZodDefAny;
const zodTypeName = (schema: z.ZodTypeAny): string => zodDef(schema).type;

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = zodDef(schema);
  if (
    def.type === "optional" ||
    def.type === "default" ||
    def.type === "catch"
  ) {
    return unwrapSchema(def.innerType as z.ZodTypeAny);
  }
  // A `.transform()` or `.pipe()` becomes a pipe. Read the input schema so the
  // published contract describes the value a client sends.
  if (def.type === "pipe") {
    return unwrapSchema(def.in as z.ZodTypeAny);
  }
  return schema;
}

function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  const def = zodDef(schema);
  if (
    def.type === "optional" ||
    def.type === "default" ||
    def.type === "catch"
  ) {
    return true;
  }
  if (def.type === "pipe") {
    return isOptionalSchema(def.in as z.ZodTypeAny);
  }
  if (def.type === "nullable") {
    return isOptionalSchema(def.innerType as z.ZodTypeAny);
  }
  return false;
}

// Zod 4 stores each check as an object with a `_zod.def` that carries a `check`
// name and the check members. Read that def to describe the constraint.
function checkDef(check: unknown): Record<string, unknown> | undefined {
  return (check as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
}

function applyStringChecks(
  jsonSchema: JsonSchema,
  checks: ReadonlyArray<unknown>,
) {
  for (const check of checks) {
    const def = checkDef(check);
    if (!def) continue;
    if (def.check === "min_length") jsonSchema.minLength = def.minimum;
    else if (def.check === "max_length") jsonSchema.maxLength = def.maximum;
    else if (def.check === "string_format") {
      if (def.format === "email") jsonSchema.format = "email";
      else if (def.format === "url") jsonSchema.format = "uri";
      // Zod 3 `.uuid()` maps to `.guid()` in zod 4 to keep the loose UUID
      // format. Publish both as the OpenAPI `uuid` format so the spec does not
      // change.
      else if (def.format === "uuid" || def.format === "guid")
        jsonSchema.format = "uuid";
      else if (def.format === "datetime") jsonSchema.format = "date-time";
      // Zod 4 stores a `.regex()` pattern as a `RegExp`; publish its source.
      else if (def.format === "regex") {
        if (def.pattern instanceof RegExp)
          jsonSchema.pattern = def.pattern.source;
        else if (typeof def.pattern === "string")
          jsonSchema.pattern = def.pattern;
      }
    }
  }
}

function applyNumberChecks(
  jsonSchema: JsonSchema,
  checks: ReadonlyArray<unknown>,
) {
  for (const check of checks) {
    const def = checkDef(check);
    if (!def) continue;
    // `.int()` records a number-format check such as `safeint`.
    if (def.check === "number_format") {
      if (typeof def.format === "string" && def.format.includes("int")) {
        jsonSchema.type = "integer";
      }
    } else if (def.check === "greater_than") {
      jsonSchema.minimum = def.value;
      if (!def.inclusive) jsonSchema.exclusiveMinimum = true;
    } else if (def.check === "less_than") {
      jsonSchema.maximum = def.value;
      if (!def.inclusive) jsonSchema.exclusiveMaximum = true;
    }
  }
}

function zodToOpenApiSchema(schema: z.ZodTypeAny): JsonSchema {
  const unwrapped = unwrapSchema(schema);
  const def = zodDef(unwrapped);
  const typeName = def.type;

  if (typeName === "string") {
    const jsonSchema: JsonSchema = { type: "string" };
    applyStringChecks(jsonSchema, (def.checks as unknown[]) ?? []);
    return jsonSchema;
  }

  if (typeName === "number") {
    const jsonSchema: JsonSchema = { type: "number" };
    applyNumberChecks(jsonSchema, (def.checks as unknown[]) ?? []);
    return jsonSchema;
  }

  if (typeName === "boolean") return { type: "boolean" };
  if (typeName === "date") return { type: "string", format: "date-time" };
  if (typeName === "any" || typeName === "unknown") return {};

  if (typeName === "literal") {
    const values = def.values as unknown[];
    return { type: typeof values[0], enum: values };
  }

  // Zod 4 merges string enums and native enums into one `enum` type and stores
  // the members on `entries`. A pure string enum keeps `type: "string"`; a
  // native enum can hold numbers, so it publishes the values without a type.
  if (typeName === "enum") {
    const values = Array.from(
      new Set(
        Object.values(def.entries as Record<string, unknown>).filter(
          (value) => typeof value === "string" || typeof value === "number",
        ),
      ),
    );
    if (values.every((value) => typeof value === "string")) {
      return { type: "string", enum: values };
    }
    return { enum: values };
  }

  if (typeName === "array") {
    return {
      type: "array",
      items: zodToOpenApiSchema(def.element as z.ZodTypeAny),
    };
  }

  if (typeName === "record") {
    return {
      type: "object",
      additionalProperties: zodToOpenApiSchema(def.valueType as z.ZodTypeAny),
    };
  }

  if (typeName === "nullable") {
    return {
      ...zodToOpenApiSchema(def.innerType as z.ZodTypeAny),
      nullable: true,
    };
  }

  // Zod 4 represents a plain union and a discriminated union as one `union`
  // type with the members on `options`.
  if (typeName === "union") {
    return {
      oneOf: (def.options as z.ZodTypeAny[]).map((option) =>
        zodToOpenApiSchema(option),
      ),
    };
  }

  if (typeName === "intersection") {
    return {
      allOf: [
        zodToOpenApiSchema(def.left as z.ZodTypeAny),
        zodToOpenApiSchema(def.right as z.ZodTypeAny),
      ],
    };
  }

  if (typeName === "object") {
    const shape = def.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToOpenApiSchema(value);
      if (!isOptionalSchema(value)) required.push(key);
    }
    const jsonSchema: JsonSchema = { type: "object", properties };
    if (required.length > 0) jsonSchema.required = required;
    // A `.strict()` Zod object forbids an unknown key. Zod 4 records that as a
    // `never` catchall. Publish the constraint as `additionalProperties: false`,
    // so a client, a gateway, or a handler that treats the contract as
    // authoritative rejects an extra property too.
    const catchall = def.catchall as z.ZodTypeAny | undefined;
    if (catchall && zodDef(catchall).type === "never") {
      jsonSchema.additionalProperties = false;
    }
    return jsonSchema;
  }

  return {};
}

function normalizeContent(content: Record<string, { schema: unknown }>) {
  return Object.fromEntries(
    Object.entries(content).map(([contentType, media]) => [
      contentType,
      {
        ...media,
        schema: isZodSchema(media.schema)
          ? zodToOpenApiSchema(media.schema)
          : media.schema,
      },
    ]),
  );
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return Boolean(
    value &&
    typeof value === "object" &&
    "_def" in value &&
    typeof (value as z.ZodTypeAny).safeParse === "function",
  );
}

function normalizeResponses(responses: Record<string, OpenApiResponse> = {}) {
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      const content = response.content as
        Record<string, { schema: unknown }> | undefined;
      return [
        status,
        content
          ? {
              ...response,
              content: normalizeContent(content),
            }
          : response,
      ];
    }),
  );
}

function parametersFromSchema(
  schema: z.ZodTypeAny,
  location: "path" | "query" | "header",
) {
  const objectSchema = unwrapSchema(schema);
  if (zodTypeName(objectSchema) !== "object") return [];
  const shape = zodDef(objectSchema).shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape).map(([name, value]) => ({
    name,
    in: location,
    required: location === "path" ? true : !isOptionalSchema(value),
    schema: zodToOpenApiSchema(value),
  }));
}

class OpenAPIRegistry {
  private readonly schemas: Record<string, JsonSchema> = {};
  private readonly paths: Array<OpenApiPathRegistration> = [];

  register(name: string, schema: z.ZodTypeAny) {
    this.schemas[name] = zodToOpenApiSchema(schema);
    return { $ref: `#/components/schemas/${name}` };
  }

  registerPath(pathRegistration: OpenApiPathRegistration) {
    this.paths.push(pathRegistration);
  }

  buildPaths() {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const { method, path, request, responses, ...operation } of this
      .paths) {
      const normalizedOperation: Record<string, unknown> = {
        ...operation,
        responses: normalizeResponses(responses),
      };
      if (request?.params) {
        normalizedOperation.parameters = parametersFromSchema(
          request.params,
          "path",
        );
      }
      if (request?.query) {
        normalizedOperation.parameters = [
          ...((normalizedOperation.parameters as unknown[]) ?? []),
          ...parametersFromSchema(request.query, "query"),
        ];
      }
      if (request?.headers) {
        normalizedOperation.parameters = [
          ...((normalizedOperation.parameters as unknown[]) ?? []),
          ...parametersFromSchema(request.headers, "header"),
        ];
      }
      if (request?.body) {
        normalizedOperation.requestBody = {
          ...request.body,
          content: normalizeContent(request.body.content),
        };
      }
      paths[path] ??= {};
      paths[path][method] = normalizedOperation;
    }
    return paths;
  }

  buildComponents() {
    return { schemas: this.schemas };
  }
}

const registry = new OpenAPIRegistry();

// ─── Common schemas ──────────────────────────────────────────────────────────

// Match the route's isUuidLike check without its whitespace trimming. Spell
// out both cases because OpenAPI patterns do not carry RegExp flags.
const heartbeatRunIdParamSchema = z.string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/)
  .describe("Heartbeat run UUID; malformed values return 400");

const cliAuthChallengeIdParamSchema = z.string().trim()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/)
  .describe("CLI auth challenge UUID; malformed values return 400");

const ErrorSchema = registry.register("Error", z.object({ error: z.string() }));

const responses = {
  ok: (schema: z.ZodTypeAny = z.record(z.string(), z.unknown())) => ({
    description: "Success",
    content: { "application/json": { schema } },
  }),
  noContent: { description: "No content" },
  badRequest: {
    description: "Bad request",
    content: { "application/json": { schema: ErrorSchema } },
  },
  unauthorized: {
    description: "Unauthorized",
    content: { "application/json": { schema: ErrorSchema } },
  },
  forbidden: {
    description: "Forbidden",
    content: { "application/json": { schema: ErrorSchema } },
  },
  notFound: {
    description: "Not found",
    content: { "application/json": { schema: ErrorSchema } },
  },
  conflict: {
    description: "Conflict",
    content: { "application/json": { schema: ErrorSchema } },
  },
  payloadTooLarge: {
    description: "Payload too large",
    content: { "application/json": { schema: ErrorSchema } },
  },
  unsupportedMediaType: {
    description: "Unsupported media type",
    content: { "application/json": { schema: ErrorSchema } },
  },
  unprocessable: {
    description: "Unprocessable entity",
    content: { "application/json": { schema: ErrorSchema } },
  },
  serverError: {
    description: "Internal server error",
    content: { "application/json": { schema: ErrorSchema } },
  },
  tooManyRequests: {
    description: "Too many requests",
    content: { "application/json": { schema: ErrorSchema } },
  },
};

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { "application/json": { schema } },
  required: true as const,
});

// The space import + preview routes accept the inline JSON body or the raw
// space package as a compressed zip upload. Document both content types: the
// JSON variant keeps its zod schema; the multipart variant carries the zip in a
// `package` file field plus the other import fields as a JSON `meta` field.
const importRequestBody = (schema: z.ZodTypeAny) => ({
  content: {
    "application/json": { schema },
    "multipart/form-data": {
      schema: {
        type: "object",
        properties: {
          package: {
            type: "string",
            format: "binary",
            description: "The space package as a compressed .zip.",
          },
          meta: {
            type: "string",
            description:
              "JSON-encoded import fields (include, target, collisionStrategy, and, for " +
              "the apply route, nameOverrides / selectedFiles / adapterOverrides / " +
              "pauseAutomations). A `source` here is ignored — the source is the zip.",
          },
        },
        required: ["package"],
      },
    },
    "application/zip": {
      schema: { type: "string", format: "binary" },
    },
  },
  required: true as const,
});

const r = responses;

const externalObjectSummariesBodySchema = z
  .object({
    issueIds: z.array(z.string().guid()).max(1000),
  })
  .strict();

const refreshExternalObjectsBodySchema = z
  .object({
    objectIds: z.array(z.string().guid()).max(50).optional(),
  })
  .strict();

// Chat-channel response contracts live here until the shared package exposes
// response validators. Request bodies and enum vocabularies deliberately reuse
// the shared validators used by the handlers, so the public API cannot drift
// from provider, lifecycle, or mutation inputs.
const chatAdapterCapabilitiesResponseSchema = z
  .object({
    threads: z.boolean(),
    directMessages: z.boolean(),
    nativeStreaming: z.boolean(),
    messageEdits: z.boolean(),
    messageDeletes: z.boolean(),
    reactions: z.boolean(),
    files: z.boolean(),
    cards: z.boolean(),
    actions: z.boolean(),
    modals: z.boolean(),
    slashCommands: z.boolean(),
    ephemeralMessages: z.boolean(),
    proactiveDirectMessages: z.boolean(),
  })
  .strict();

const chatEndpointSetupResponseSchema = z
  .object({
    step: z.enum(["choose_agent", "provider_setup", "test", "complete"]),
    slackSetupMethod: z.enum(["managed", "automatic", "manual", "existing"]).optional(),
    slackRegistration: slackRegistrationStateSchema.optional(),
    slackManagerError: z.string().optional(),
    slackAvatar: slackAvatarStateSchema.optional(),
    slackAccount: slackAccountStateSchema.optional(),
    slackOAuthCallbackUri: z.string().nullable().optional(),
    slackApp: slackAppConfigurationSchema.optional(),
    testStartedAt: z.string().datetime().nullable().optional(),
    authorizationUrl: z.string().nullable().optional(),
    providerUrl: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    webhookUrl: z.string().nullable().optional(),
    messagingEndpoint: z.string().nullable().optional(),
    webhookVerifiedAt: z.string().datetime().nullable().optional(),
    credentialRotationId: z.string().uuid().nullable().optional(),
    webhookSecretConfigured: z.boolean().optional(),
    callbackSurfaces: z
      .object({
        events: z.object({
          status: z.enum(["current", "stale", "unverified"]),
          observedAt: z.string().datetime().nullable().optional(),
        }),
        interactivity: z.object({
          status: z.enum(["current", "stale", "unverified"]),
          observedAt: z.string().datetime().nullable().optional(),
        }),
        slashCommands: z.object({
          status: z.enum(["current", "stale", "unverified"]),
          observedAt: z.string().datetime().nullable().optional(),
        }),
      })
      .strict()
      .optional(),
    callbacksNeedUpdate: z.boolean().optional(),
  })
  .strict();

const chatEndpointSetupSecretResponseSchema = z
  .object({ webhookSecret: z.string().length(64), credentialRotationId: z.uuid() })
  .strict();

const chatEndpointCredentialHandoffSchema = z.object({
  status: z.literal("needs_user_action"),
  interactionId: z.string().uuid().nullable(),
  endpointId: z.string().uuid(),
  connectionId: z.string().uuid(),
  requiredUserAction: z.object({
    kind: z.literal("enter_credentials"),
    userId: z.string(),
    resource: z.object({ type: z.literal("chat_endpoint"), id: z.string().uuid(), spaceId: z.string().uuid() }),
    setupPath: z.string(),
    reason: z.string(),
    continuation: z.string(),
  }),
});

const chatEndpointResponseSchema = z
  .object({
    id: z.string().uuid(),
    spaceId: z.string().uuid(),
    connectionId: z.string().uuid(),
    publicationMode: z.enum(["automatic", "explicit"]),
    externalExecutionPolicy: z.enum(["restricted", "agent"]),
    provider: chatProviderSchema,
    publicId: z.string(),
    status: chatEndpointStatusSchema,
    deploymentMode: z.enum(["direct", "relay"]),
    assignedAgentId: z.string().uuid(),
    assignedAgentName: z.string().nullable(),
    sponsorUserId: z.string().nullable(),
    providerAccountId: z.string().nullable(),
    providerAccountLabel: z.string().nullable(),
    botExternalId: z.string().nullable(),
    photonAllocation: z.enum(["dedicated", "shared"]).optional(),
    botUsername: z.string().nullable(),
    botLabel: z.string().nullable(),
    botAvatarUrl: z.string().nullable(),
    allowDirectMessages: z.boolean(),
    allowGroupChats: z.boolean(),
    allowUnlinkedPeople: z.boolean(),
    replyMode: z.literal("subscribed"),
    capabilities: chatAdapterCapabilitiesResponseSchema,
    setup: chatEndpointSetupResponseSchema,
    healthMessage: z.string().nullable(),
    lastError: z.string().nullable(),
    lastActivityAt: z.string().datetime().nullable(),
    lastPublicationAt: z.string().datetime().nullable(),
    activatedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const chatEndpointResourceResponseSchema = z
  .object({
    id: z.string().uuid(),
    spaceId: z.string().uuid(),
    endpointId: z.string().uuid(),
    type: z.string(),
    providerResourceId: z.string(),
    parentProviderResourceId: z.string().nullable(),
    label: z.string(),
    detail: z.string().nullable(),
    providerUrl: z.string().nullable(),
    availability: chatResourceAvailabilitySchema,
    enabled: z.boolean(),
    metadata: z.record(z.string(), z.unknown()),
    participants: z.array(z.string()).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const chatPrincipalLinkResponseSchema = z
  .object({
    id: z.string().uuid(),
    principalId: z.string().uuid(),
    externalLabel: z.string(),
    externalDetail: z.string(),
    outpostUserId: z.string().nullable(),
    outpostUserLabel: z.string().nullable(),
    outpostUserImage: z.string().nullable(),
    status: chatIdentityLinkStatusSchema,
  })
  .strict();

const chatIdentityLinkIntentResponseSchema = z
  .object({
    confirmationUrl: z.string(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const chatIdentityLinkPreviewResponseSchema = z
  .object({
    selfService: z.boolean().optional(),
    canConfirm: z.boolean().optional(),
    endpointId: z.string().uuid(),
    spaceId: z.string().uuid(),
    spaceName: z.string(),
    spacePrefix: z.string(),
    provider: chatProviderSchema,
    providerAccountLabel: z.string().nullable(),
    botLabel: z.string().nullable(),
    externalLabel: z.string(),
    externalDetail: z.string(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const chatIdentityLinkConfirmationResponseSchema = z
  .object({
    ok: z.literal(true),
    endpointId: z.string().uuid(),
  })
  .strict();

const chatConversationResponseSchema = z
  .object({
    id: z.string().uuid(),
    spaceId: z.string().uuid(),
    endpointId: z.string().uuid(),
    resourceId: z.string().uuid().nullable(),
    issueId: z.string().uuid(),
    issueIdentifier: z.string().nullable(),
    issueTitle: z.string().nullable(),
    externalConversationId: z.string(),
    externalThreadId: z.string(),
    sessionGeneration: z.number().int().positive(),
    externalLabel: z.string(),
    externalUrl: z.string().nullable(),
    isDirectMessage: z.boolean(),
    state: z.enum([
      "active",
      "waiting",
      "completed",
      "unavailable",
      "endpoint_removed",
    ]),
    lastPublicationStatus: chatPublicationStateSchema.nullable(),
    lastActivityAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const chatFileTransferResponseSchema = z
  .object({
    provider: z.literal("microsoft-teams"),
    phase: z.enum(CHAT_FILE_TRANSFER_PHASES),
    filename: z.string().min(1).max(255),
    expiresAt: z.string().datetime().nullable().optional(),
    version: z.number().int().positive(),
  })
  .strict();

const chatActivityResponseSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["delivery", "publication", "action", "health", "repair"]),
    actionType: z
      .enum([
        "slash_task_start",
        "provider_effect",
        "github_webhook_ingress",
        "slack_session_sync",
        "slack_session_stop",
      ])
      .optional(),
    status: z.union([
      chatDeliveryStateSchema,
      chatPublicationStateSchema,
      z.string(),
    ]),
    summary: z.string(),
    detail: z.string().nullable(),
    createdAt: z.string().datetime(),
    replayable: z.boolean(),
    resolutionActions: z.array(
      z.enum(["mark_delivered", "retry_anyway", "cancel"]),
    ),
    fileTransfer: chatFileTransferResponseSchema.optional(),
  })
  .strict();

const safeExternalChatCardResponseSchema = z
  .object({
    schema: z.literal("outpost.chat.card.v1"),
    kind: z.enum(["status", "question", "confirmation"]),
    title: z.string(),
    body: z.string().optional(),
    actions: z
      .array(
        z.union([
          z
            .object({
              type: z.literal("callback"),
              actionId: z.string(),
              label: z.string(),
              style: z.enum(["default", "primary", "danger"]).optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("link"),
              label: z.string(),
              url: z.string().url(),
            })
            .strict(),
        ]),
      )
      .optional(),
  })
  .strict();

const safeChatPublicationPayloadResponseSchema = z
  .object({
    text: z.string(),
    attachmentIds: z.array(z.string().uuid()).optional(),
    interactionId: z.string().uuid().optional(),
    card: safeExternalChatCardResponseSchema.optional(),
    progressState: z
      .enum([
        "queued",
        "working",
        "waiting_for_input",
        "approval_needed",
        "completed",
        "failed",
      ])
      .optional(),
  })
  .strict();

const chatPublicationResponseSchema = z
  .object({
    id: z.string().uuid(),
    spaceId: z.string().uuid(),
    endpointId: z.string().uuid(),
    conversationId: z.string().uuid(),
    issueId: z.string().uuid(),
    commentId: z.string().uuid().nullable(),
    idempotencyKey: z.string(),
    payload: safeChatPublicationPayloadResponseSchema,
    state: chatPublicationStateSchema,
    fileTransfer: chatFileTransferResponseSchema.optional(),
    providerMessageId: z.string().nullable(),
    providerUrl: z.string().nullable(),
    attempts: z.number().int().nonnegative(),
    redactedError: z.string().nullable(),
    nextAttemptAt: z.string().datetime().nullable(),
    publishedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const externalChannelBindingResponseSchema = z
  .object({
    endpointId: z.string().uuid(),
    provider: chatProviderSchema,
    botLabel: z.string().nullable(),
    externalLabel: z.string(),
    externalUrl: z.string().nullable(),
    conversationId: z.string().uuid(),
    publicationState: chatPublicationStateSchema.nullable(),
    assignedAgentLocked: z.literal(true),
  })
  .strict();

// The route enforces the shared strict request schema. The route spine
// injects the adapter type from the path, so the client body never carries
// it; derive the documented body from the shared schema and omit that field,
// so the documented body cannot drift from the route again.
const startAdapterLoginSessionSchema =
  startAdapterAuthSessionRequestSchema.omit({
    adapterType: true,
  });

const environmentCustomImageSpaceQuerySchema = z
  .object({
    spaceId: z.string().optional(),
  })
  .strict();

const disableEnvironmentCustomImageTemplateQuerySchema =
  environmentCustomImageSpaceQuerySchema.extend({
    deleteProviderTemplate: z.enum(["true", "false"]).optional(),
  });

const environmentCustomImageOverviewSchema = z
  .object({
    activeTemplate: environmentCustomImageTemplateSchema.nullable(),
    activeSession: environmentCustomImageSetupSessionSchema.nullable(),
    latestSession: environmentCustomImageSetupSessionSchema.nullable(),
  })
  .strict();

const environmentCustomImageSetupSessionResultSchema = z
  .object({
    session: environmentCustomImageSetupSessionSchema,
    connectionPayload: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

const environmentCustomImageSetupSessionFinishResultSchema =
  environmentCustomImageSetupSessionResultSchema.extend({
    template: environmentCustomImageTemplateSchema,
  });

const environmentCustomImageTemplateRollbackResultSchema = z
  .object({
    activeTemplate: environmentCustomImageTemplateSchema,
    supersededTemplate: environmentCustomImageTemplateSchema,
  })
  .strict();

const environmentCustomImageTemplateRelinkResultSchema = z
  .object({
    template: environmentCustomImageTemplateSchema,
    classification: z.enum(["knob_only", "boot_source_drift", "unclassified"]),
  })
  .strict();

const workTimelineQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    userId: z.string().optional(),
    goalId: z.string().guid().optional(),
    projectId: z.string().guid().optional(),
    issueId: z.string().guid().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })
  .strict();

const workTimelineResponseSchema = z
  .object({
    actors: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(["agent", "user", "system", "plugin"]),
          name: z.string(),
          avatar: z.string().nullable().optional(),
        })
        .strict(),
    ),
    spans: z.array(
      z
        .object({
          actorId: z.string(),
          laneHint: z.string().nullable(),
          runId: z.string(),
          issueId: z.string(),
          issueIdentifier: z.string().nullable(),
          start: z.string(),
          end: z.string().nullable(),
          status: z.string(),
          retryOfRunId: z.string().nullable().optional(),
          continuationAttempt: z.number().optional(),
          invocationSource: z.string().nullable().optional(),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          actorId: z.string(),
          kind: z.enum([
            "created",
            "commented",
            "approved",
            "delegated",
            "assigned",
            "unassigned",
          ]),
          issueId: z.string(),
          at: z.string(),
        })
        .strict(),
    ),
    edges: z.array(
      z
        .object({
          fromActorId: z.string(),
          toActorId: z.string(),
          issueId: z.string(),
          at: z.string(),
          kind: z.enum(["delegation", "assignment", "mention"]),
        })
        .strict(),
    ),
    pagination: z
      .object({
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative(),
        totalIssues: z.number().int().nonnegative(),
        hasMore: z.boolean(),
      })
      .strict(),
    window: z
      .object({
        from: z.string(),
        to: z.string(),
        capped: z.boolean(),
      })
      .strict(),
  })
  .strict();

function paramsSchemaFromPath(
  routePath: string,
): z.ZodObject<z.ZodRawShape> | undefined {
  const names = [...routePath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
    (match) => match[1],
  );
  if (names.length === 0) return undefined;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const name of names) {
    shape[name] = z.string();
  }
  return z.object(shape);
}

function registerCurrentRoute(input: {
  "x-outpost-transport"?: "rest" | "protocol";
  "x-outpost-connection-management"?: string;
  method: string;
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  responses?: Record<string, OpenApiResponse>;
}) {
  const params = paramsSchemaFromPath(input.path);
  const request =
    params || input.query || input.body
      ? {
          ...(params ? { params } : {}),
          ...(input.query ? { query: input.query } : {}),
          ...(input.body ? { body: jsonBody(input.body) } : {}),
        }
      : undefined;
  registry.registerPath({
    method: input.method,
    path: input.path,
    ...(input["x-outpost-transport"] ? { "x-outpost-transport": input["x-outpost-transport"], "x-outpost-connection-management": input["x-outpost-connection-management"] } : {}),
    tags: input.tags,
    summary: input.summary,
    ...(input.description ? { description: input.description } : {}),
    ...(request ? { request } : {}),
    responses: input.responses ?? {
      200: r.ok(),
      400: r.badRequest,
      401: r.unauthorized,
      404: r.notFound,
    },
  });
}

type OpenApiAuthLevel =
  | "public"
  | "agent_run"
  | "agent_heartbeat"
  | "runtime_tools"
  | "authenticated"
  | "operator"
  | "instance_admin";

const OPERATOR_SESSION_AUTH_SCHEME = "OperatorSessionAuth";
const OPERATOR_API_KEY_AUTH_SCHEME = "OperatorApiKeyAuth";
const AGENT_BEARER_AUTH_SCHEME = "AgentBearerAuth";
const AGENT_RUN_AUTH_SCHEME = "AgentRunAuth";
const RUNTIME_TOOLS_BEARER_AUTH_SCHEME = "RuntimeToolsBearerAuth";

function securityRequirement(name: string): Record<string, string[]> {
  return { [name]: [] };
}

const OPERATOR_SECURITY: Array<Record<string, string[]>> = [
  securityRequirement(OPERATOR_SESSION_AUTH_SCHEME),
  securityRequirement(OPERATOR_API_KEY_AUTH_SCHEME),
];

const AUTHENTICATED_SECURITY: Array<Record<string, string[]>> = [
  ...OPERATOR_SECURITY,
  securityRequirement(AGENT_BEARER_AUTH_SCHEME),
];

const RUNTIME_TOOLS_SECURITY: Array<Record<string, string[]>> = [
  securityRequirement(RUNTIME_TOOLS_BEARER_AUTH_SCHEME),
];

const RUNTIME_TOOLS_OPERATIONS = new Set([
  "POST /runtime-tools/github/credentials",
  "GET /mcp/runtime-tools",
  "POST /mcp/runtime-tools",
  "POST /runtime-tools/connections/search",
  "POST /runtime-tools/connections/request",
]);

const PUBLIC_OPERATIONS = new Set([
  "GET /api/agent-avatars/{version}/{palette}/{file}",
  "GET /api/health",
  "GET /api/liveness",
  "HEAD /api/liveness",
  "GET /api/ready",
  "HEAD /api/ready",
  "GET /api/openapi.json",
  "GET /api/operator-claim/{token}",
  "POST /api/cli-auth/challenges",
  "GET /api/cli-auth/challenges/{id}",
  "POST /api/cli-auth/challenges/{id}/cancel",
  "GET /api/invites/{token}",
  "GET /api/invites/{token}/logo",
  "GET /api/invites/{token}/onboarding",
  "GET /api/invites/{token}/onboarding.txt",
  "GET /api/invites/{token}/skills/index",
  "GET /api/invites/{token}/skills/{skillName}",
  "GET /api/invites/{token}/test-resolution",
  "POST /api/invites/{token}/accept",
  "POST /api/join-requests/{requestId}/claim-api-key",
  "GET /mcp/gateways/{gatewayPublicId}",
  "POST /mcp/gateways/{gatewayPublicId}",
  "GET /api/tool-gateway/gateways/{gatewayId}/mcp",
  "POST /api/tool-gateway/gateways/{gatewayId}/mcp",
]);

const OPERATOR_ONLY_PREFIXES = [
  "/api/spaces/{spaceId}/accounting/",
  "/api/announcements/",
  "/api/auth/",
  "/api/admin/",
  "/api/plugins",
  "/api/instance/",
];

const browserUseOperations = [
  ["get", "/api/issues/{issueId}/browsers", "List authorized task browsers", undefined],
  ["get", "/api/issues/{issueId}/browsers/{browserId}/viewer", "Get a private live browser viewer", undefined],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/presence", "Renew visible browser presence", undefined],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/control", "Control a task browser", browserUseControlSchema],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/viewport", "Set the browser viewport", browserUseViewportSchema],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/viewport/release", "Release viewport ownership", browserUseViewerSchema],
  ["get", "/api/spaces/{spaceId}/browser-use-cloud/grants/{grantId}/profiles", "List available browser profiles", undefined],
  ["get", "/api/spaces/{spaceId}/browser-use-cloud/grants/{grantId}/settings", "Read browser credential settings", undefined],
  ["put", "/api/spaces/{spaceId}/browser-use-cloud/grants/{grantId}/settings", "Update browser credential settings", browserUseSettingsSchema],
] as const;

const OPERATOR_ONLY_OPERATIONS = new Set([
  "PATCH /api/agents/{id}/permission-grants",
  // Budget changes are operator-only (assertOperator in routes/costs.ts).
  "POST /api/spaces/{spaceId}/budgets/policies",
  "POST /api/spaces/{spaceId}/budget-incidents/{incidentId}/resolve",
  "PATCH /api/spaces/{spaceId}/budgets",
  "PATCH /api/agents/{agentId}/budgets",
  // Approval decisions are operator-only (assertOperator in routes/approvals.ts).
  "POST /api/approvals/{id}/approve",
  "POST /api/approvals/{id}/reject",
  "GET /api/agents/{id}/project-access",
  "POST /api/agents/{id}/project-access",
  "GET /api/issues/{id}/pending-questions",
  "GET /api/issues/{id}/decision-receipts",
  "GET /api/issues/{id}/chat-handoffs",
  "GET /api/spaces/{spaceId}/attention/history",
  "GET /api/spaces/{spaceId}/attention/summary",
  "GET /api/spaces/{spaceId}/attention/tasks",
  "POST /api/issues/{id}/interactions/{interactionId}/dismiss",
  "POST /api/issues/{id}/retry",
  "GET /api/spaces/{spaceId}/prompt-injection-prevention",
  "PUT /api/spaces/{spaceId}/prompt-injection-prevention",
  "GET /api/spaces/{spaceId}/prompt-injection-prevention/models",
  "POST /api/spaces/{spaceId}/prompt-injection-prevention/test",
  "POST /api/chat-endpoints/{endpointId}/conversations/{conversationId}/publications",
  "POST /api/chat-endpoints/{endpointId}/publications/{publicationId}/replay",
  "POST /api/chat-endpoints/{endpointId}/deliveries/{deliveryId}/replay",
  "GET /api/spaces/{spaceId}/fast-response",
  "PUT /api/spaces/{spaceId}/fast-response",
  "GET /api/spaces/{spaceId}/fast-response/models",
  "GET /api/spaces/{spaceId}/fast-response/availability",
  "POST /api/spaces/{spaceId}/fast-response/test",
  "GET /api/spaces/{spaceId}/decision-model",
  "PUT /api/spaces/{spaceId}/decision-model",
  "POST /api/spaces/{spaceId}/decision-model/test",
  ...browserUseOperations.map(([method, path]) => `${method.toUpperCase()} ${path}`),
  "POST /api/spaces/{spaceId}/ai-connections/local/attempts/{sessionId}/code",

  "GET /api/spaces/{spaceId}/project-repositories",
  "PUT /api/projects/{id}/repositories",
  "GET /api/projects/{id}/git-authorization",
  "PUT /api/projects/{id}/git-authorization",
  "DELETE /api/issues/{id}/documents/{key}",
  "GET /api/spaces/{spaceId}/decisions",
  "GET /api/cloud/stacks",
  "GET /api/spaces",
  "POST /api/spaces",
  "GET /api/spaces/stats",
  "GET /api/spaces/issues",
  "GET /api/spaces/import/jobs/{jobId}",
  "POST /api/operator-claim/{token}/claim",
  "GET /api/cli-auth/me",
  "POST /api/spaces/{spaceId}/openclaw/invite-prompt",
  "PATCH /api/spaces/{spaceId}/members/{memberId}",
  "PATCH /api/spaces/{spaceId}/members/{memberId}/role-and-grants",
  "POST /api/spaces/{spaceId}/members/{memberId}/archive",
  "PATCH /api/spaces/{spaceId}/members/{memberId}/permissions",
  "GET /api/spaces/{spaceId}/user-directory",
  "GET /api/spaces/{spaceId}/managed-agent-profiles",
  "POST /api/spaces/{spaceId}/managed-agent-profiles",
  "GET /api/spaces/{spaceId}/remote-agent-profiles",
  "POST /api/spaces/{spaceId}/remote-agent-profiles",
  "POST /api/execution-workspaces/{id}/reconcile-branch",
  "POST /api/execution-workspaces/{id}/login-handoff",
  "GET /api/operator-api-keys",
  "POST /api/operator-api-keys",
  "DELETE /api/operator-api-keys/{keyId}",
  "POST /api/bootstrap/claim",
  "GET /api/spaces/{spaceId}/resource-memberships/me",
  "GET /api/workspace-preferences/me",
  "PUT /api/spaces/{spaceId}/workspace-preferences/me",
  "GET /api/spaces/{spaceId}/default-agent/me",
  "PUT /api/spaces/{spaceId}/default-agent/me",
  "PUT /api/spaces/{spaceId}/resource-memberships/me/agents/{agentId}",
  "PUT /api/spaces/{spaceId}/resource-memberships/me/documents/{documentId}",
  "PUT /api/spaces/{spaceId}/resource-memberships/me/projects/{projectId}",
  "POST /api/projects/{id}/access-members",
  "DELETE /api/projects/{id}/access-members/{memberId}",
  "GET /api/spaces/{spaceId}/secret-provider-configs",
  "POST /api/spaces/{spaceId}/secret-provider-configs",
  "GET /api/spaces/{spaceId}/secret-providers/health",
  "POST /api/spaces/{spaceId}/secret-provider-configs/discovery/preview",
  "GET /api/secret-provider-configs/{id}",
  "PATCH /api/secret-provider-configs/{id}",
  "DELETE /api/secret-provider-configs/{id}",
  "POST /api/secret-provider-configs/{id}/default",
  "POST /api/secret-provider-configs/{id}/health",
  "GET /api/spaces/{spaceId}/user-secret-definitions",
  "POST /api/spaces/{spaceId}/user-secret-definitions",
  "PATCH /api/spaces/{spaceId}/user-secret-definitions/{definitionId}",
  "DELETE /api/spaces/{spaceId}/user-secret-definitions/{definitionId}",
  "GET /api/spaces/{spaceId}/user-secret-definitions/{definitionId}/coverage",
  "GET /api/spaces/{spaceId}/me/user-secrets",
  "POST /api/spaces/{spaceId}/me/user-secrets",
  "PATCH /api/spaces/{spaceId}/me/user-secrets/{secretId}",
  "POST /api/spaces/{spaceId}/me/user-secrets/{secretId}/rotate",
  "DELETE /api/spaces/{spaceId}/me/user-secrets/{secretId}",
  "POST /api/spaces/{spaceId}/secrets/remote-import",
  "POST /api/spaces/{spaceId}/secrets/remote-import/preview",
  "GET /api/secrets/{id}/usage",
  "GET /api/secrets/{id}/access-events",
  "POST /api/health/dev-server/restart",
  "POST /api/issues/{issueId}/file-resources/availability",
  "GET /api/issues/{issueId}/file-resources/content",
  "GET /api/issues/{issueId}/file-resources/list",
  "GET /api/issues/{issueId}/file-resources/resolve",
  "POST /api/issues/{id}/interactions/{interactionId}/accept",
  "POST /api/issues/{id}/interactions/{interactionId}/reject",
  "POST /api/issues/{id}/interactions/{interactionId}/respond",
  "POST /api/issues/{id}/interactions/{interactionId}/skip",
  "POST /api/issues/{id}/interactions/{interactionId}/withdraw",
  "POST /api/spaces/{spaceId}/tools/examples/{id}/smoke",
  "POST /api/agents/me/connections/{connectionId}/token",
  "GET /api/tools/oauth/callback",
  "GET /api/tools/vercel-connect/callback",
  "GET /api/connection-intents/{interactionId}/setup-options",
  "POST /api/connection-intents/{interactionId}/phase",
  "POST /api/connection-intents/{interactionId}/complete",
  "POST /api/agents/{id}/connection-intents/{interactionId}/adopt",
  "POST /api/connection-intents/{interactionId}/decline",
  "POST /api/spaces/{spaceId}/tools/action-requests/{actionRequestId}/trust-rule",
  "GET /api/spaces/{spaceId}/tools/stdio-templates",
  "POST /api/spaces/{spaceId}/tools/stdio-templates",
  "POST /api/spaces/{spaceId}/tools/stdio-templates/{templateId}/disable",
  "POST /api/spaces/{spaceId}/tools/mcp/import-json",
  "POST /api/tool-gateway/action-requests/{id}/approve",
  "POST /api/tool-gateway/action-requests/{id}/decline",
  "POST /api/spaces/{spaceId}/email/deliveries/{publicationId}/resolve",
  // Chat endpoints expose provider credentials, identity mappings, access
  // policy, and replay controls. Every mounted handler asserts an operator actor;
  // keep the generated security contract equally restrictive.
  "GET /api/slack/search/callback",
  "GET /api/spaces/{spaceId}/slack/endpoints/{endpointId}/capabilities",
  "GET /api/spaces/{spaceId}/slack/endpoints/{endpointId}/search",
  "PUT /api/spaces/{spaceId}/slack/endpoints/{endpointId}/search",
  "POST /api/spaces/{spaceId}/slack/endpoints/{endpointId}/search/connect",
  "DELETE /api/spaces/{spaceId}/slack/endpoints/{endpointId}/search",
  "POST /api/chat-endpoints/{endpointId}/github/identity",
  "POST /api/chat-endpoints/{endpointId}/github/identity/confirm",
  "POST /api/chat-identity-links/confirm",
  "GET /api/chat-identity-links/preview",
  "POST /api/chat-identity-links/request-access",
  "POST /api/chat-endpoints/{endpointId}/publications/{publicationId}/resolve",
  "POST /api/chat-endpoints/{endpointId}/actions/{actionId}/resolve",
  // Task-tree pause, cancel and resume controls are operator-only (assertOperator in routes/issue-tree-control.ts).
  "GET /api/issues/{id}/tree-control/state",
  "POST /api/issues/{id}/tree-control/preview",
  "GET /api/issues/{id}/tree-holds",
  "POST /api/issues/{id}/tree-holds",
  "GET /api/issues/{id}/tree-holds/{holdId}",
  "POST /api/issues/{id}/tree-holds/{holdId}/release",
]);

const INSTANCE_ADMIN_OPERATIONS = new Set([
  "POST /api/spaces",
  "POST /api/plugins/install",
  "POST /api/instance/database-backups",
  "POST /api/admin/users/{userId}/promote-instance-admin",
  "POST /api/admin/users/{userId}/demote-instance-admin",
  "PUT /api/admin/users/{userId}/space-access",
]);

const CREATED_OPERATIONS = new Set([
  "POST /api/adapters/install",
  "POST /api/spaces/{spaceId}/agent-creations",
  "POST /api/spaces/{spaceId}/agents",
  "POST /api/agents/{id}/keys",
  "POST /api/spaces/{spaceId}/approvals",
  "POST /api/approvals/{id}/comments",
  "POST /api/spaces/{spaceId}/assets/images",
  "POST /api/spaces/{spaceId}/logo",
  "POST /api/spaces/{spaceId}/onboarding-seed",
  "POST /api/cli-auth/challenges",
  "POST /api/operator-api-keys",
  "POST /api/spaces",
  "POST /api/spaces/{spaceId}/invites",
  "POST /api/spaces/{spaceId}/openclaw/invite-prompt",
  "POST /api/spaces/{spaceId}/cost-events",
  "POST /api/spaces/{spaceId}/finance-events",
  "POST /api/spaces/{spaceId}/secret-provider-configs",
  "POST /api/spaces/{spaceId}/environments",
  "POST /api/environments/{environmentId}/custom-image-setup-sessions",
  "POST /api/spaces/{spaceId}/goals",
  "POST /api/spaces/{spaceId}/labels",
  "POST /api/issues/{id}/documents/{key}/annotations",
  "POST /api/issues/{id}/documents/{key}/annotations/{threadId}/comments",
  "POST /api/routines/{id}/description/annotations",
  "POST /api/routines/{id}/description/annotations/{threadId}/comments",
  "POST /api/issues/{id}/work-products",
  "POST /api/issues/{id}/low-trust/promotions",
  "POST /api/issues/{id}/approvals",
  "POST /api/spaces/{spaceId}/issues",
  "POST /api/issues/{id}/children",
  "POST /api/issues/{id}/interactions",
  "POST /api/issues/{id}/comments",
  "POST /api/spaces/{spaceId}/issues/{issueId}/attachments",
  "POST /api/spaces/{spaceId}/projects",
  "POST /api/projects/{id}/access-members",
  "POST /api/projects/{id}/workspaces",
  "POST /api/spaces/{spaceId}/routines",
  "POST /api/spaces/{spaceId}/folders",
  "POST /api/spaces/{spaceId}/folders/ensure-my",
  "POST /api/routines/{id}/triggers",
  "POST /api/spaces/{spaceId}/secrets",
  "POST /api/spaces/{spaceId}/user-secret-definitions",
  "POST /api/spaces/{spaceId}/me/user-secrets",
  "POST /api/spaces/{spaceId}/skills",
  "POST /api/spaces/{spaceId}/skills/import",
  "POST /api/join-requests/{requestId}/claim-api-key",
  "POST /api/admin/users/{userId}/promote-instance-admin",
  "POST /api/plugins/install",
  "POST /api/instance/database-backups",
  "POST /api/spaces/{spaceId}/tools/action-requests/{actionRequestId}/trust-rule",
  "POST /api/tool-gateway/sessions",
]);

const ACCEPTED_OPERATIONS = new Set([
  "POST /api/spaces/{spaceId}/email/send",
  "POST /api/spaces/import",
  "POST /api/health/dev-server/restart",
  "POST /api/invites/{token}/accept",
]);

const FORBIDDEN_RESPONSE = {
  description: "Forbidden",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
};

function operationKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

function isVoiceSessionOperation(path: string) { return /^\/api\/spaces\/\{spaceId\}\/voice-(sessions|callbacks|phone|history)(?:\/|$)/.test(path); }

function isOperatorOnlyOperation(method: string, path: string) {
  if (isVoiceSessionOperation(path)) return true;
  const key = operationKey(method, path);
  if (OPERATOR_ONLY_OPERATIONS.has(key)) return true;
  return OPERATOR_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function resolveOperationAuthLevel(
  method: string,
  path: string,
): OpenApiAuthLevel {
  const key = operationKey(method, path);
  if (key === "GET /api/mcp/requests/{id}" || key === "GET /api/mcp/device"
      || key === "POST /api/mcp/requests/{id}/dot-pairing"
      || key === "POST /api/mcp/requests/{id}/dot-pairing/preview"
      || key === "GET /api/dot-mcp/requests/{id}"
      || key === "POST /api/dot-mcp/requests/{id}/dot-pairing"
      || key === "POST /api/dot-mcp/requests/{id}/dot-pairing/preview") return "public";
  if (path === "/api/mcp/setup" || path === "/api/mcp/device/consent" || path.startsWith("/api/mcp/requests/") || path.startsWith("/api/mcp/connections")) return "operator";
  if (/^\/api\/spaces\/\{spaceId\}\/agents\/\{agentId\}\/dot-binding(?:\/event-test)?$/.test(path)) return "operator";
  if (path === "/api/spaces/{spaceId}/dot-invitations") return "operator";
  if (path === "/api/spaces/{spaceId}/muse-invitations"
      || /^\/api\/spaces\/\{spaceId\}\/agents\/\{agentId\}\/muse-binding(?:\/(?:verify|revoke|attest-stop|attest-detector-cleanup|qualification))?$/.test(path)) return "operator";
  if (path === "/api/spaces/{spaceId}/grok-invitations"
      || /^\/api\/spaces\/\{spaceId\}\/agents\/\{agentId\}\/grok-binding(?:\/(?:routine|verify|retry|stop|recover))?$/.test(path)) return "operator";
  if (PUBLIC_OPERATIONS.has(key)) return "public";
  if (key === "POST /api/spaces/{spaceId}/agent-commentary") return "agent_heartbeat";
  if (key === "POST /api/agents/me/chat/messages") return "agent_heartbeat";
  // Agents may read their own commentary, or all of it with commentary:view; the routes enforce that.
  if (method.toUpperCase() === "GET" && path.startsWith("/api/spaces/{spaceId}/agent-commentary")) return "authenticated";
  if (key === "POST /api/mcp/project-tools" || key === "POST /api/spaces/{spaceId}/slack/tasks/{issueId}/tools") return "agent_run";
  if (RUNTIME_TOOLS_OPERATIONS.has(key)) return "runtime_tools";
  if (INSTANCE_ADMIN_OPERATIONS.has(key)) return "instance_admin";
  if (
    isOperatorOnlyOperation(method, path) ||
    experimentalApiMetadata[`${method.toUpperCase()} ${path}`]?.operatorOnly
  )
    return "operator";
  return "authenticated";
}

function applyOperationStatusOverride(
  operation: Record<string, unknown>,
  fromStatus: string,
  toStatus: string,
) {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses || !responses[fromStatus] || responses[toStatus]) return;
  responses[toStatus] = responses[fromStatus];
  delete responses[fromStatus];
}

function applyDocumentFixups(document: any): any {
  document.components ??= {};
  document.components.securitySchemes = {
    [OPERATOR_SESSION_AUTH_SCHEME]: {
      type: "apiKey",
      in: "cookie",
      name: "outpost_session",
      description:
        "Operator session cookie in authenticated mode. Outpost uses Better Auth; cookie transport may vary by deployment.",
    },
    [OPERATOR_API_KEY_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Operator API Key",
      description:
        "Operator API key presented in the Authorization bearer header.",
    },
    [AGENT_BEARER_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Agent API Key or Agent JWT",
      description:
        "Agent API key or Outpost-issued local agent JWT presented in the Authorization bearer header.",
    },
    [RUNTIME_TOOLS_BEARER_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Heartbeat-bound runtime tools token",
      description:
        "Scoped token bound to an active heartbeat run and presented in the Authorization bearer header. The GitHub credential endpoint requires the distinct github_credentials scope.",
    },
    [AGENT_RUN_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Task-bound agent JWT",
      description: "Outpost-issued JWT bound to an active task run. Agent API keys, operator sessions, and connection-only tokens are rejected.",
    },
  };
  document.security = AUTHENTICATED_SECURITY;

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(
      pathItem as Record<string, any>,
    )) {
      const authLevel = operation["x-outpost-connection-management"] ? "authenticated" : resolveOperationAuthLevel(method, path);
      if (authLevel === "public") {
        operation.security = [];
      } else if (authLevel === "agent_run") {
        operation.security = [securityRequirement(AGENT_RUN_AUTH_SCHEME)];
      } else if (authLevel === "agent_heartbeat") {
        operation.security = [securityRequirement(AGENT_BEARER_AUTH_SCHEME)];
      } else if (authLevel === "runtime_tools") {
        operation.security = RUNTIME_TOOLS_SECURITY;
      } else if (authLevel === "authenticated") {
        operation.security = AUTHENTICATED_SECURITY;
      } else {
        operation.security = OPERATOR_SECURITY;
      }

      operation["x-outpost-authorization"] =
        authLevel === "instance_admin"
          ? { actor: "operator", instanceAdmin: true }
          : authLevel === "operator"
            ? { actor: "operator" }
            : authLevel === "agent_run"
              ? { actor: "agent", heartbeatBound: true, taskBound: true }
            : authLevel === "agent_heartbeat"
              ? { actor: "agent", heartbeatBound: true }
            : authLevel === "runtime_tools"
              ? { actor: "runtime_tools", heartbeatBound: true }
              : authLevel === "authenticated"
                ? { actor: "operator_or_agent" }
                : { actor: "public" };

      if (isVoiceSessionOperation(path)) {
        operation.security = [{[OPERATOR_SESSION_AUTH_SCHEME]: []}];
        operation["x-outpost-authorization"] = {actor: "operator", sessionBound: true};
      }

      const key = operationKey(method, path);
      if (authLevel !== "public") {
        const responses = (operation.responses ??= {}) as Record<
          string,
          unknown
        >;
        if (!responses["403"]) {
          responses["403"] = FORBIDDEN_RESPONSE;
        }
      }
      if (CREATED_OPERATIONS.has(key)) {
        applyOperationStatusOverride(operation, "200", "201");
      }
      if (ACCEPTED_OPERATIONS.has(key)) {
        applyOperationStatusOverride(operation, "200", "202");
      }
    }
  }

  return document;
}

// ─── Health ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/liveness",
  tags: ["health"],
  summary: "Process startup status without database access",
  description: "Runs before actor/session resolution. Reports only in-memory startup recovery and the public build commit. Use /api/health for explicit database readiness or signed bootstrap. No workspace identity or control authority is granted.",
  responses: {
    200: r.ok(z.object({ status: z.literal("ok"), commit: z.string().nullable() }).strict()),
    503: { description: "Startup recovery is not complete", content: {
      "application/json": { schema: z.object({ status: z.literal("starting"), commit: z.string().nullable() }).strict() },
    } },
  },
});

registry.registerPath({
  method: "head",
  path: "/api/liveness",
  tags: ["health"],
  summary: "Process startup status without a response body",
  responses: { 200: { description: "Process startup recovery is complete" }, 503: { description: "Startup recovery is not complete" } },
});

registry.registerPath({
  method: "get",
  path: "/api/ready",
  tags: ["health"],
  summary: "Deployment readiness without database access",
  description: "Public in-memory admission status after startup dependencies and recovery have been verified. Returns 503 immediately during shutdown. Responses are not cached; an unavailable server supplies Retry-After: 1.",
  responses: {
    200: r.ok(z.object({ status: z.literal("ready") }).strict()),
    503: { description: "Starting, recovering, or draining", content: {
      "application/json": { schema: z.object({ status: z.enum(["starting", "recovering", "draining"]) }).strict() },
    } },
  },
});
registry.registerPath({
  method: "head", path: "/api/ready", tags: ["health"],
  summary: "Deployment readiness without a response body",
  responses: { 200: { description: "Ready to receive traffic" }, 503: { description: "Starting, recovering, or draining" } },
});

// Shared by the healthy and database-unreachable responses: full details
// (including serverInfo) ride only on operator/agent-actor responses.
const healthServerInfoSchema = z
  .object({
    processStartedAt: z.string().datetime(),
    git: z.union([
      z
        .object({
          available: z.literal(true),
          fullSha: z.string(),
          shortSha: z.string(),
          branchName: z.string().nullable(),
          subject: z.string(),
          committedAt: z.string().datetime().nullable(),
          localChanges: z.union([
            z
              .object({
                available: z.literal(true),
                hasLocalChanges: z.boolean(),
                stagedFileCount: z.number().int().nonnegative(),
                unstagedFileCount: z.number().int().nonnegative(),
                untrackedFileCount: z.number().int().nonnegative(),
              })
              .strict(),
            z
              .object({
                available: z.literal(false),
                unavailableReason: z.enum(["git_status_unavailable"]),
              })
              .strict(),
          ]),
        })
        .strict(),
      z
        .object({
          available: z.literal(false),
          unavailableReason: z.enum([
            "git_unavailable",
            "invalid_git_metadata",
          ]),
        })
        .strict(),
    ]),
  })
  .strict();

registry.registerPath({
  method: "get",
  path: "/api/health",
  tags: ["health"],
  summary: "Health check",
  responses: {
    200: r.ok(
      z.object({
        status: z.enum(["ok", "unhealthy"]),
        version: z.string().optional(),
        // Running build commit (full git SHA), or null when git metadata is
        // unavailable. Present on every response shape, including redacted ones.
        commit: z.string().nullable(),
        deploymentMode: z.string().optional(),
        cloud: z
          .object({
            managed: z.literal(true),
            managedBy: z.literal("outpost-cloud"),
            stackSlug: z.string().nullable(),
            stackDisplayName: z.string().optional(),
            cloudBaseUrl: z.string().nullable(),
          })
          .strict()
          .optional(),
        bootstrapStatus: z.enum(["ready", "bootstrap_pending"]).optional(),
        bootstrapInviteActive: z.boolean().optional(),
        databaseBackup: z
          .object({
            enabled: z.boolean(),
            status: z.enum(["ok", "warning"]),
            backupDir: z.string().optional(),
            maxAgeHours: z.number().optional(),
            latestBackup: z
              .object({
                name: z.string(),
                path: z.string(),
                mtime: z.string().datetime(),
                ageHours: z.number(),
                sizeBytes: z.number(),
              })
              .nullable()
              .optional(),
            lastFailure: z
              .object({
                path: z.string(),
                mtime: z.string().datetime(),
                message: z.string(),
              })
              .nullable()
              .optional(),
            warnings: z.array(
              z.object({
                code: z.enum([
                  "database_backup_check_failed",
                  "database_backup_last_failure",
                  "database_backup_missing",
                  "database_backup_stale",
                ]),
                message: z.string(),
              }),
            ),
          })
          .optional(),
        warnings: z
          .array(
            z.object({
              code: z.string(),
              message: z.string(),
            }),
          )
          .optional(),
        serverInfo: healthServerInfoSchema.optional(),
      }),
    ),
    // The database-unreachable body still carries version and commit so
    // deployment tooling can verify the running build during an outage;
    // serverInfo rides only on full-details (operator/agent) responses.
    503: {
      description: "Service unavailable",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("unhealthy"),
            version: z.string(),
            serverVersion: z.string(),
            commit: z.string().nullable(),
            error: z.literal("database_unreachable"),
            serverInfo: healthServerInfoSchema.optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/access-grants",
  tags: ["issues"],
  summary: "Grant a user or agent access to a private issue subtree",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(z.object({
      subjectType: z.enum(["user", "agent"]),
      subjectId: z.string().min(1),
    }).strict()),
  },
  responses: {
    200: r.ok(),
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/openapi.json",
  tags: ["health"],
  summary: "Get the generated OpenAPI document",
  responses: { 200: r.ok() },
});

// ─── Spaces ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/cloud/stacks",
  tags: ["cloud"],
  summary: "List the current Cloud tenant user's stacks",
  responses: {
    200: r.ok(),
    403: r.forbidden,
    404: r.notFound,
    502: r.serverError,
    503: r.serverError,
    500: r.serverError,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces",
  tags: ["spaces"],
  summary: "List spaces",
  description:
    "Requires an operator user. Instance admins can list the full directory; scope=accessible limits the list to spaces the caller can enter.",
  request: {
    query: z.object({ scope: z.enum(["accessible"]).optional() }),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces",
  tags: ["spaces"],
  summary: "Create a space",
  request: { body: jsonBody(createSpaceSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/stats",
  tags: ["spaces"],
  summary: "Outpost stats",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}",
  tags: ["spaces"],
  summary: "Get a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/artifacts",
  tags: ["spaces"],
  summary: "List space artifacts",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: spaceArtifactsQuerySchema,
  },
  responses: {
    200: {
      description: "Outpost artifact projection",
      content: {
        "application/json": {
          schema: spaceArtifactsResponseSchema,
        },
      },
    },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/timeline",
  tags: ["spaces"],
  summary: "Get space work timeline",
  description: "Read-only space-scoped progress history for a requested time window. Inspect visible work spans and saved ownership or delegation events, then follow source issue activity for recorded actors and status transitions. Comments and run outcomes alone do not establish who reassigned work or why it paused. A failed verification command can occur within a successful run. Preserve the requested window, source links and task visibility boundaries.",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: workTimelineQuerySchema,
  },
  responses: {
    200: r.ok(workTimelineResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}",
  tags: ["spaces"],
  summary: "Update a space",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(updateSpaceSchema.partial()),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/branding",
  tags: ["spaces"],
  summary: "Update space branding",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(updateSpaceBrandingSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/archive",
  tags: ["spaces"],
  summary: "Archive a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}",
  tags: ["spaces"],
  summary: "Delete a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/exports",
  tags: ["spaces"],
  summary: "Export space data",
  description: "Omitting include exports only the space and agents (projects, skills and issues default to false); set include.projects and include.skills for a reusable space setup.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spacePortabilityExportSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/exports/preview",
  tags: ["spaces"],
  summary: "Preview space export",
  description: "Omitting include exports only the space and agents (projects, skills and issues default to false); set include.projects and include.skills for a reusable space setup.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spacePortabilityExportSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/imports/preview",
  tags: ["spaces"],
  summary: "Preview space import",
  description: "Safe import into this space only: target must be { mode: \"existing_space\", spaceId } for the route space or a new space, and collisionStrategy may be \"rename\" or \"skip\" (\"replace\" is rejected, so an existing agent is never overwritten). nameOverrides maps an incoming agent, project or issue slug to the name it should get. Preview never changes the space; apply creates or reuses resources and returns them.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spacePortabilityPreviewSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/imports/apply",
  tags: ["spaces"],
  summary: "Apply space import",
  description: "Safe import into this space only: target must be { mode: \"existing_space\", spaceId } for the route space or a new space, and collisionStrategy may be \"rename\" or \"skip\" (\"replace\" is rejected, so an existing agent is never overwritten). nameOverrides maps an incoming agent, project or issue slug to the name it should get. Preview never changes the space; apply creates or reuses resources and returns them.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spacePortabilityImportSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

for (const [method, path, summary, body] of browserUseOperations) {
  registerCurrentRoute({
    method, path, summary, body, tags: ["Browser Use Cloud"],
    ...(path.endsWith("/viewer") ? { query: browserUseViewerSchema.partial() } : {}),
    responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
  });
}

// Voice endpoints accept current authenticated operator sessions (or local implicit operator),
// never agent keys or operator API keys. Provider callbacks use signatures and are
// intentionally documented separately from this operator API contract.
const voiceSessionResponseSchema = z.object({id:z.string().uuid(), spaceId:z.string().uuid(), endpointId:z.string().uuid(), issueId:z.string().uuid(), assignedAgentId:z.string().uuid(), state:z.enum(VOICE_SESSION_STATES), mode:z.enum(["browser","inbound_phone","outbound_phone"]), generation:z.number().int(), callerAuthority:z.enum(["member","instance_admin","local_operator","guest_intake","pending_approval"]), replyCursor:z.number().int(), createdAt:z.string(), expiresAt:z.string(), endedAt:z.string().nullable(), errorCode:z.string().nullable()}).strict();
const voiceMediaResponseSchema = z.object({sessionId:z.string().uuid(), generation:z.number().int(), transportToken:z.string(), transportUrl:z.string()}).strict();
const voiceStartResponseSchema = z.object({session:voiceSessionResponseSchema, media:voiceMediaResponseSchema.optional()}).strict();
for (const [method,path,summary,body,response] of [
  ["post","/api/spaces/{spaceId}/voice-sessions","Create or resume a caller-bound voice session",startVoiceSessionSchema,voiceStartResponseSchema],
  ["get","/api/spaces/{spaceId}/voice-sessions/{sessionId}","Inspect your current voice session",undefined,voiceSessionResponseSchema],
  ["post","/api/spaces/{spaceId}/voice-sessions/{sessionId}/end","End your call while preserving task work",undefined,voiceSessionResponseSchema],
  ["get","/api/spaces/{spaceId}/voice-sessions/{sessionId}/notification","Check for an approved reply notification",undefined,undefined],
  ["get","/api/spaces/{spaceId}/voice-sessions/{sessionId}/report","Read the safe transcript and separate provider charge",undefined,undefined],
  ["get","/api/spaces/{spaceId}/voice-history/{endpointId}","List your permitted completed and active calls",undefined,undefined],
  ["get","/api/spaces/{spaceId}/voice-callbacks/{endpointId}","Read your own saved callback preference",undefined,voiceCallbackPreferenceSchema],
  ["put","/api/spaces/{spaceId}/voice-callbacks/{endpointId}","Save your own number and callback consent",voiceCallbackPreferenceSchema,voiceCallbackPreferenceSchema],
  ["get","/api/spaces/{spaceId}/voice-phone/{endpointId}","Inspect the space's existing Speko number inventory",undefined,undefined],
  ["put","/api/spaces/{spaceId}/voice-phone/{endpointId}","Configure private calls or restricted guest intake",voicePhoneConfigurationSchema,undefined],
  ["get","/api/spaces/{spaceId}/voice-phone/{endpointId}/incoming","List current live calls awaiting authenticated approval",undefined,undefined],
  ["get","/api/spaces/{spaceId}/voice-phone/{endpointId}/history","List unapproved calls without private task bindings",undefined,undefined],
  ["post","/api/spaces/{spaceId}/voice-phone/{endpointId}/incoming/{callId}","Approve or deny this exact live call",voiceInboundDecisionSchema,undefined],
] as const) {
  registry.registerPath({method,path,tags:["voice-sessions"],summary,description:"Experimental Speko connection. Requires a current authenticated operator session (or local implicit operator), space membership and current task/connection authority. Agent keys and operator API keys cannot act as a caller. Caller ID grants no private access. Media tokens are short-lived; durable provider credentials are never returned. Ending your owned call remains available after losing task access.",request:{params:z.object(Object.fromEntries([...path.matchAll(/\{([^}]+)\}/g)].map(m=>[m[1],z.string().uuid()]))),...(body?{body:jsonBody(body)}:{})},responses:{200:r.ok(response),...(method==="post" && path.endsWith("voice-sessions")?{201:r.ok(voiceStartResponseSchema)}:{}),400:r.badRequest,401:r.unauthorized,403:r.forbidden,404:r.notFound,409:r.conflict,422:r.unprocessable,429:{description:"Voice attempt limit reached"}}});
}

// Explicit task-bound email. Operator setup and agent actions share the same vaulted
// connection, while automatic chat publication never applies to these endpoints.
registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/email/connections/{connectionId}/check-address",
  tags: ["Email"],
  summary: "Check for an existing AgentMail address using a saved credential",
  description: "Requires an operator connection manager and enabled chat connectors. Read-only: does not create or reserve an inbox. A missing inbox returns unknown because AgentMail hides resources outside the credential scope; it is never proof of availability.",
  request: {
    params: z.object({ spaceId: z.string().uuid(), connectionId: z.string().uuid() }),
    body: jsonBody(emailAddressCheckSchema),
  },
  responses: {
    200: r.ok(z.object({ address: z.string(), status: z.enum(["taken", "unknown"]) })),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound,
    422: r.unprocessable, 429: { description: "AgentMail request limit reached; retry later" },
    502: r.serverError,
  },
});
for (const [method, path, summary, body, success] of [
  ["get", "/api/spaces/{spaceId}/email/connections", "List accessible saved AgentMail API keys (metadata only)", undefined, 200],
  ["post", "/api/spaces/{spaceId}/email/connections", "Save AgentMail credential and access", emailConnectionSchema, 201],
  ["post", "/api/spaces/{spaceId}/email/connections/{connectionId}/inspect", "Inspect inboxes using a saved AgentMail credential", undefined, 200],
  ["get", "/api/spaces/{spaceId}/email/inboxes", "List authorized AgentMail inboxes", undefined, 200],
  ["post", "/api/spaces/{spaceId}/email/inspect", "Inspect AgentMail inboxes and verified domains for setup", z.object({ apiKey: z.string().min(1).max(4096) }).strict(), 200],
  ["post", "/api/spaces/{spaceId}/email/inboxes", "Create or attach an agent email inbox", emailEndpointSetupSchema, 201],
  ["post", "/api/email/inboxes/{endpointId}/control", "Pause, resume or disconnect an email inbox", z.object({ action: z.enum(["pause", "resume", "remove"]) }).strict(), 200],
  ["post", "/api/email/inboxes/{endpointId}/reconnect", "Reconnect the same email inbox", z.object({ apiKey: z.string().min(1).max(4096), receiveMode: z.enum(["websocket", "webhook"]) }).strict(), 200],
  ["post", "/api/spaces/{spaceId}/email/send", "Explicitly send email: start a child task or reply to a bound conversation", emailSendSchema, 202],
  ["get", "/api/spaces/{spaceId}/email/tasks/{issueId}", "Read a task's email thread, full text context, recipients and delivery outcomes", undefined, 200],
  ["get", "/api/spaces/{spaceId}/email/deliveries/{publicationId}", "Check queued, sent, delivered, failed or uncertain email delivery", undefined, 200],
  ["post", "/api/spaces/{spaceId}/email/deliveries/{publicationId}/resolve", "Resolve uncertain email after checking the provider", z.object({ outcome: z.enum(["sent", "failed"]), providerMessageId: z.string().min(1).max(998).optional() }).strict(), 200],
] as const) {
  registry.registerPath({ method, path, tags: ["Email"], summary,
    ...(!path.includes("/send") && !path.includes("/tasks/") && !path.includes("/deliveries/") && !(method === "get" && path.endsWith("/inboxes"))
      ? { "x-outpost-transport": "rest", "x-outpost-connection-management": method === "get" ? "connections:read" : "connections:configure" } : {}),
    description: "AgentMail email connection. Available without the experimental chat setting. Internal comments never send email. Agent sends require assigned inbox and task ownership, active run authority, and configured action policies. Preserve the same idempotencyKey and payload across retries. New conversations create an email child task; replies require conversationId and replyToMessageId. Reply-all is deliberate and never includes Bcc.",
    request: { params: z.object(Object.fromEntries([...path.matchAll(/\{([^}]+)\}/g)].map(match => [match[1], z.string().uuid()]))), ...(body ? { body: jsonBody(body) } : {}) },
    responses: { [success]: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
  });
}

// Slack bot tools use the verified task/run identity; setup and search grants
// remain operator-only and space/endpoint scoped.
for (const [method, path, summary, body] of [
  ["get", "/api/spaces/{spaceId}/slack/endpoints/{endpointId}/capabilities", "Inspect Slack bot capabilities and missing scopes", undefined],
  ["get", "/api/spaces/{spaceId}/slack/endpoints/{endpointId}/search", "Read personal Slack search authorization status", undefined],
  ["put", "/api/spaces/{spaceId}/slack/endpoints/{endpointId}/search", "Configure optional Slack search OAuth credentials", slackSearchConfigSchema],
  ["post", "/api/spaces/{spaceId}/slack/endpoints/{endpointId}/search/connect", "Begin personal Slack search authorization", undefined],
  ["delete", "/api/spaces/{spaceId}/slack/endpoints/{endpointId}/search", "Disconnect personal Slack search and invalidate pending authorization", undefined],
  ["post", "/api/spaces/{spaceId}/slack/tasks/{issueId}/tools", "Execute a task-bound Slack bot tool", slackToolCallSchema],
] as const) {
  registry.registerPath({ method, path, tags: ["chat-channels"], summary,
    description: "Experimental Slack task tools. Current space, endpoint, linked requester, task/run authority and action permissions are revalidated. Bot credentials remain server-side. Search grants never authorize writes or expand bot membership. Native search is unavailable until the runtime qualifies transient result handling.",
    request: { params: z.object(Object.fromEntries([...path.matchAll(/\{([^}]+)\}/g)].map(match => [match[1], z.string().uuid()]))), ...(body ? { body: jsonBody(body) } : {}) },
    responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
  });
}
registry.registerPath({ method: "get", path: "/api/slack/search/callback", tags: ["chat-channels"], summary: "Complete personal Slack search OAuth",
  description: "Requires the same signed-in user, single-use state, linked Slack identity and workspace; redirects to connector Access. Never accepts model-supplied identity.",
  request: { query: z.object({ state: z.string(), code: z.string() }) },
  responses: { 302: { description: "Redirect to connector Access" }, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

// ─── Chat Channels ─────────────────────────────────────────────────────────

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/chat-endpoints",
  tags: ["chat-channels"],
  summary: "List chat endpoints in a space",
  description:
    "Lists non-archived provider bot endpoints visible to the current operator user. Endpoints are space-scoped.",
  request: { params: z.object({ spaceId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatEndpointResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/chat-endpoints",
  tags: ["chat-channels"],
  summary: "Create a chat endpoint",
  description:
    "Creates one provider bot endpoint bound permanently to one Outpost agent. Provider setup and verification happen in later calls. "
    + "Chat providers need Chat connectors, and GitHub needs GitHub review bots, turned on by an instance admin in Experimental settings at /<prefix>/space/settings/instance/experimental. "
    + "While that setting is off, connections_search shows the provider as unavailable and this call is refused; agents cannot change it. Link that page as [Experimental settings](/<prefix>/space/settings/instance/experimental) and reply.",
  request: {
    params: z.object({ spaceId: z.string().uuid() }),
    body: jsonBody(createChatEndpointSchema),
  },
  responses: {
    201: r.ok(chatEndpointResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/chat-endpoints/{endpointId}",
  tags: ["chat-channels"],
  summary: "Get a chat endpoint",
  description:
    "Returns a chat endpoint only when it belongs to a space accessible to the current operator user; an inaccessible endpoint is reported as not found.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(chatEndpointResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

const githubConfigurationResponseSchema = z.object({
  spaceId: z.string().uuid(),
  endpointId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  configuration: githubChatConfigurationSchema,
  updatedByUserId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const githubPersonResponseSchema = z.object({ githubUserId: z.string(), login: z.string() });
const githubWizardInputSchema = z.object({ name: z.string().trim().min(1).max(34), ownerType: z.enum(["personal", "organization"]), ownerLogin: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/).optional() }).strict();
const githubWizardCheckSchema = z.object({ key: z.string(), label: z.string(), ok: z.boolean(), detail: z.string() });
const githubWizardResponseSchema = z.object({
  endpointId: z.string().uuid(), state: z.enum(["create", "install", "identity", "verify", "connected", "recovery", "enrollment"]),
  registration: z.object({ registrationUrl: z.string().url(), manifest: z.record(z.string(), z.unknown()), expiresAt: z.string() }).optional(),
  installationUrl: z.string().url().optional(), identity: githubPersonResponseSchema.extend({ avatarUrl: z.string().nullable() }).optional(),
  identityLinked: z.boolean().optional(), identityMethod: z.enum(["dedicated_app", "existing_connection"]).optional(),
  verification: z.object({ ready: z.boolean(), checks: z.array(githubWizardCheckSchema) }).optional(),
  runtimeChecks: z.array(githubWizardCheckSchema).optional(), message: z.string().optional(),
  restartableRegistrationId: z.string().uuid().optional(),
});
const githubReviewResponseSchema = z.object({
      id: z.string().uuid(), spaceId: z.string().uuid(), endpointId: z.string().uuid(),
      issueId: z.string().uuid(), runId: z.string().uuid().nullable(), repositoryId: z.string(),
      repository: z.string(), pullNumber: z.number().int(), headSha: z.string(),
      configurationRevision: z.number().int(), state: z.enum(["queued", "running", "completed", "incomplete", "error", "superseded", "manual_required"]),
      assessment: githubReviewAssessmentSchema.nullable(),
      conclusion: z.enum(["success", "failure", "neutral", "action_required"]).nullable(),
      checkUrl: z.string().nullable(), summaryUrl: z.string().nullable(),
      createdAt: z.string(), updatedAt: z.string(),
    }).passthrough();
const githubBotOperations: Array<{
  method: string;
  suffix: string;
  summary: string;
  description: string;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  response: z.ZodTypeAny;
}> = [
  {
    method: "get", suffix: "configuration", summary: "Read GitHub bot review configuration",
    description: "Returns saved space-scoped configuration and its revision, or disabled defaults for an existing chat connection. Requires connection-management access.",
    response: githubConfigurationResponseSchema,
  },
  {
    method: "put", suffix: "configuration", summary: "Save GitHub bot review configuration",
    description: "Compares the configuration revision and rechecks members, sponsors, repositories, and agent tool policy. Does not change the bot's assigned agent or enable formal reviews implicitly.",
    body: updateGitHubChatConfigurationSchema, response: githubConfigurationResponseSchema,
  },
  {
    method: "post", suffix: "verify", summary: "Verify GitHub bot and assigned-agent capabilities",
    description: "Separately checks signed delivery, App identity, current repository permissions, effective tool access, and runtime support. Requires connection-management access.",
    response: z.object({ ready: z.boolean(), checks: z.array(z.object({ key: z.string(), label: z.string(), ok: z.boolean(), detail: z.string() })) }),
  },
  {
    method: "put", suffix: "progress", summary: "Save GitHub setup progress",
    description: "Saves the resumable wizard stage without granting access or bypassing verification.",
    body: z.object({ stage: z.enum(["setup", "connect", "install", "repositories", "verify", "identity", "behavior", "test"]) }).strict(),
    response: chatEndpointResponseSchema,
  },
  {
    method: "get", suffix: "reviews", summary: "List review evidence attached to Outpost tasks",
    description: "Returns up to 100 newest review records for this endpoint. Each review references ordinary Outpost tasks and runs; it is not an independent scheduler.",
    response: z.array(githubReviewResponseSchema),
  },
  {
    method: "get", suffix: "personal-connections", summary: "List the current user's GitHub identity connections",
    description: "Lists only the signed-in user's GitHub grants in this space. Shared and agent credentials cannot prove a person's identity.",
    response: z.array(z.object({ connectionId: z.string().uuid(), name: z.string(), status: z.string(), login: z.string().nullable(), enabled: z.boolean() })),
  },
  {
    method: "post", suffix: "identity", summary: "Verify or confirm your own GitHub identity",
    description: "Resolves the current user's personal connection and verifies GET /user with GitHub. Omitting confirmedGithubUserId previews the identity; supplying its exact ID explicitly confirms ownership after revalidation.",
    body: z.object({ connectionId: z.string().uuid(), confirmedGithubUserId: z.string().regex(/^[1-9][0-9]*$/).optional() }).strict(),
    response: githubPersonResponseSchema.extend({ avatarUrl: z.string().nullable(), connectionId: z.string().uuid(), grantId: z.string().uuid() }),
  },
  {
    method: "post", suffix: "people/lookup", summary: "Resolve a GitHub username to its stable identity",
    description: "Verifies the account with GitHub. Lookup does not grant bot access, link a teammate, or confer the sponsor's credentials.",
    body: z.object({ login: z.string().min(1).max(44) }).strict(), response: githubPersonResponseSchema,
  },
  {
    method: "post", suffix: "registration", summary: "Prepare GitHub App manifest registration",
    description: "Starts or resumes a private App under a personal account or organization. Supplying ownerType uses the two-screen wizard and Cloud callbacks, including localhost; omitting it preserves legacy direct registration. State remains bound to the member, space, draft, connection, agent, and trusted origin. Credentials are never returned.",
    body: githubWizardInputSchema.partial({ ownerType: true }).refine(value => value.ownerType !== "organization" || !!value.ownerLogin, "Enter the GitHub organization"),
    response: z.union([z.object({ expiresAt: z.string(), registrationUrl: z.string().url(), manifest: z.record(z.string(), z.unknown()) }), githubWizardResponseSchema]),
  },
  { method: "post", suffix: "registration/restart", summary: "Renew an expired unconsumed GitHub registration", description: "Connection managers must confirm that no App was created. Retries resume the same replacement registration; a claimed or uncertain exchange must use existing-App recovery.", body: z.object({ registrationId: z.string().uuid(), appNotCreated: z.literal(true) }).strict(), response: githubWizardResponseSchema },
  { method: "put", suffix: "draft", summary: "Save GitHub App setup choices", description: "Saves the App name and ownership choice on the same assigned draft. Requires connection-management access; creates no provider resources.", body: githubWizardInputSchema, response: z.object({ saved: z.literal(true) }) },
  { method: "post", suffix: "setup", summary: "Advance GitHub App setup", description: "Resumes credential delivery, installation discovery, repository import, and verification. Returns redacted progress or the required human action. Runtime execution is reported separately.", response: githubWizardResponseSchema },
  { method: "post", suffix: "identity/start", summary: "Authorize your identity with the dedicated GitHub App", description: "Starts a member-bound OAuth authorization with PKCE. Does not grant bot execution access through personal credentials.", response: z.object({ authorizationUrl: z.string().url() }) },
  { method: "post", suffix: "identity/confirm", summary: "Confirm the observed GitHub identity", description: "Confirms only the signed-in configuring member's expiring observed identity and resumes the same setup draft.", body: z.object({ githubUserId: z.string().regex(/^[1-9][0-9]*$/) }).strict(), response: githubWizardResponseSchema },
  {
    method: "post", suffix: "app", summary: "Connect an existing GitHub App",
    description: "Agents send an empty body to receive a saved credential-entry handoff. Only a human session may import App credentials and its webhook signing key. Human import validates App identity with GitHub and vaults credentials; installation and signed webhook delivery must still be verified.",
    body: z.union([z.object({ appId: z.string().regex(/^[1-9][0-9]*$/), privateKey: z.string().min(1).max(32000), webhookSecret: z.string().min(16).max(1024), clientId: z.string().min(1).max(128).optional(), clientSecret: z.string().min(1).max(1024).optional() }).strict().refine(value => !!value.clientId === !!value.clientSecret, "Supply both OAuth client credentials"), z.object({}).strict()]),
    response: z.union([chatEndpointResponseSchema, chatEndpointCredentialHandoffSchema]),
  },
  {
    method: "post", suffix: "repositories/refresh", summary: "Refresh repositories available to the bot installation",
    description: "Fetches current installation access from GitHub and reconciles resources while preserving Outpost repository enablement. Return parameters alone never prove installation access.",
    response: z.array(chatEndpointResourceResponseSchema),
  },
  {
    method: "get", suffix: "reviews/{reviewId}", summary: "Get a GitHub review by ID",
    description: "Returns a review only within this accessible space and endpoint, including reviews older than the newest list page.",
    response: githubReviewResponseSchema,
  },
  {
    method: "get", suffix: "repositories", summary: "Search a page of GitHub bot repositories",
    description: "Outpost and endpoint-scoped repository access. Counts cover the whole connection; the search limits only returned rows.",
    query: gitHubRepositoryPageQuerySchema,
    response: z.object({ items: z.array(chatEndpointResourceResponseSchema), nextOffset: z.number().int().nullable(), totalCount: z.number().int(), enabledCount: z.number().int(), availableCount: z.number().int() }),
  },
  {
    method: "put", suffix: "repositories/access", summary: "Enable or disable all GitHub bot repositories",
    description: "Operator connection managers only. Applies to every repository in this space-scoped endpoint regardless of search or pagination; unavailable repositories cannot be enabled.",
    body: toggleAllGitHubRepositoriesSchema, response: z.object({ success: z.literal(true) }),
  },
];
for (const operation of githubBotOperations) {
  registry.registerPath({
    method: operation.method,
    path: `/api/chat-endpoints/{endpointId}/github/${operation.suffix}`,
    ...(!["identity", "identity/confirm"].includes(operation.suffix) ? { "x-outpost-transport": "rest", "x-outpost-connection-management": operation.method === "get" ? "connections:read" : "connections:configure" } : {}),
    tags: ["chat-channels"], summary: operation.summary, description: operation.description,
    request: {
      params: z.object({ endpointId: z.string().uuid(), ...(operation.suffix.includes("{reviewId}") ? { reviewId: z.string().uuid() } : {}) }),
      ...(operation.query ? { query: operation.query } : {}),
      ...(operation.body ? { body: jsonBody(operation.body) } : {}),
    },
    responses: {
      200: r.ok(operation.response), 400: r.badRequest, 401: r.unauthorized,
      403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable,
      502: { description: "GitHub returned an invalid response or unavailable capability" },
      503: { description: "GitHub is temporarily unavailable" },
    },
  });
}

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/provider-work/{actionId}/retry",
  tags: ["chat-channels"],
  summary: "Retry retained provider receipt work",
  description: "Requires current space connection-management access. Rearms only the same authorized retained Slack receipt or cleanup responsibility. Does not create a new form or spend a trigger. Revoked, foreign, or changed ownership is refused.",
  request: { params: z.object({ endpointId: z.string().uuid(), actionId: z.string().uuid() }), body: jsonBody(z.object({}).strict()) },
  responses: { 200: r.ok(z.object({ actionId: z.string().uuid(), state: z.enum(["scheduled", "already_scheduled", "complete"]) })),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "patch",
  path: "/api/chat-endpoints/{endpointId}",
  tags: ["chat-channels"],
  summary: "Update chat endpoint access behavior",
  description:
    "Updates the small set of user-configurable access toggles. Provider identity, assigned agent, delivery mode, and maximal provider capabilities are not mutable here.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(updateChatEndpointSchema),
  },
  responses: {
    200: r.ok(chatEndpointResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/setup",
  tags: ["chat-channels"],
  summary: "Configure or change chat endpoint lifecycle state",
  description:
    "Runs a setup or lifecycle action. `configure` and `reconnect` accept provider credentials (Slack: `botToken`, `signingSecret`; GitHub: `appId`, `privateKey` after Outpost generates the webhook secret; Discord: `applicationId`, `guildId`, `botToken`; Microsoft Teams: `clientId`, `tenantId`, `clientSecret`; Telegram: `botToken`; iMessage Photon: `projectSecret`, with nonsecret `photon.projectId` and `photon.lineId` configuration). Agent-supplied signing secrets, webhook secrets, private keys, client secrets, and project secrets return a saved human credential-entry handoff without changing credentials. Authorized write-only bot tokens and API keys remain supported. Credentials are stored as Outpost secret references and are never returned. Other actions do not require credentials.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(configureChatEndpointSchema),
  },
  responses: {
    200: r.ok(z.union([chatEndpointResponseSchema, chatEndpointCredentialHandoffSchema])),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
    429: { description: "Provider request limit reached; retry later" },
    502: { description: "Provider returned an invalid response; inspect provider health" },
    503: { description: "Provider temporarily unavailable; retry later" },
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get", path: "/api/spaces/{spaceId}/chat-slack/setup-options", tags: ["chat-channels"],
  summary: "Discover Slack setup methods and the current user's authorized workspaces",
  description: "Managed setup is advertised only for approved Cloud deployments with the broker profile enabled. Self-hosted discovery makes no hosted-service requests. Grants are personal and space scoped.",
  request: { params: z.object({ spaceId: z.string().uuid() }) }, responses: { 200: r.ok(slackSetupOptionsSchema), 401: r.unauthorized, 403: r.forbidden },
});
for (const action of ["authorize", "provision"] as const) registry.registerPath({
  method: "post", path: `/api/chat-endpoints/{endpointId}/slack/managed/${action}`, "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure", tags: ["chat-channels"],
  summary: action === "authorize" ? "Authorize a personal Slack manager workspace grant" : "Provision the saved managed Slack app",
  description: "Requires the selected managed method, space membership, connection-management permission and Cloud availability. Authorization state is actor/session bound and single use. Provisioning accepts a personal grant ID and idempotent request ID; no provider credentials or arbitrary manifests are accepted. Explicit reconnect uses reconnect=true with a fresh request ID to reinstall the saved app. Repeating that reconnect request returns its saved result without reinstalling a healthy connection.",
  request: { params: z.object({ endpointId: z.string().uuid() }), body: jsonBody(action === "authorize" ? slackSetupActionSchema : slackManagedProvisionSchema) },
  responses: { 200: r.ok(action === "authorize" ? slackManagerAuthorizationSchema : slackManagedResultSchema), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});
registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "delete", path: "/api/spaces/{spaceId}/chat-slack/manager-grants/{grantId}", tags: ["chat-channels"],
  summary: "Revoke the current user's workspace grant for future managed provisioning",
  description: "Removes local manager credentials and invalidates pending manager authorization. Installed bots remain connected; this does not uninstall Slack apps.",
  request: { params: z.object({ spaceId: z.string().uuid(), grantId: z.string().uuid() }) }, responses: { 204: { description: "Personal manager grant revoked" }, 401: r.unauthorized, 403: r.forbidden },
});
registry.registerPath({
  method: "get", path: "/api/chat-slack/managed/oauth/callback", tags: ["chat-channels"],
  summary: "Redeem a sealed manager authorization and return to Slack setup",
  description: "Authenticated, same-origin continuation with space, actor, session, endpoint revision and configured-origin checks. The broker handoff is single use; credentials are never returned to the browser. Explicit local development qualification accepts a Slack code instead of a broker claim; production ignores code.",
  request: { query: z.object({ state: z.string(), claim_id: z.string().optional(), code: z.string().optional(), error: z.string().optional() }) },
  responses: { 200: { description: "Same-origin continuation page" }, 303: { description: "Return to saved setup" }, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 409: r.conflict },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:test",
  method: "post", path: "/api/chat-endpoints/{endpointId}/slack/test-message", tags: ["chat-channels"],
  summary: "Connect the current user's Slack identity and send a test DM",
  description: "Requires an operator connection manager and active space membership. Reuses only the actor's verified identity in the same workspace; otherwise returns paginated account choices and sends a private connection challenge. The account holder must confirm it while signed in before linking or test delivery. Revoked and conflicting links cannot be overwritten. The request ID prevents duplicate or ambiguous sends from being replayed.",
  request: { params: z.object({ endpointId: z.string().uuid() }), body: jsonBody(slackTestMessageSchema) },
  responses: { 200: r.ok(slackTestMessageResultSchema), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable, 429: { description: "Wait before sending another test message" } },
});

for (const action of ["registration", "install", "resume"] as const) {
  registry.registerPath({
    method: "post", path: `/api/chat-endpoints/{endpointId}/slack/${action}`, "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure", tags: ["chat-channels"],
    summary: { registration: "Create a Slack app for a saved draft", install: "Authorize installation of the saved Slack app", resume: "Connect already-vaulted Slack installation credentials" }[action],
    description: "Requires an operator session, space membership, connection-management permission, and the chat connector rollout gate. Secrets are never returned. Creation request IDs are idempotent; uncertain creation requires an explicit checked-no-app confirmation before a new attempt. OAuth installation is bound to the initiating actor/session and expires in ten minutes.",
    request: { params: z.object({ endpointId: z.string().uuid() }), body: jsonBody(action === "registration" ? slackRegistrationSchema : slackSetupActionSchema) },
    responses: { 200: r.ok(action === "install" ? slackInstallAuthorizationSchema : chatEndpointResponseSchema), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
  });
}
registry.registerPath({
  method: "get", path: "/api/chat-slack/oauth/callback", tags: ["chat-channels"],
  summary: "Complete Slack bot installation and return to the saved wizard",
  description: "Authenticated, actor/session-bound OAuth callback. State is claimed once before exchanging the code. Installation links the Slack installer to the initiating Outpost account; reauthorization preserves an established account link. Cross-site browser navigation may receive a same-origin continuation before exchange.",
  request: { query: z.object({ state: z.string(), code: z.string().optional(), error: z.string().optional() }) },
  responses: { 200: { description: "Same-origin continuation page" }, 303: { description: "Return to saved Slack setup" }, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 409: r.conflict },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/setup-secret",
  tags: ["chat-channels"],
  summary: "Generate a GitHub webhook secret",
  description:
    "Authorized agents receive a saved human setup handoff without rotating or reading the signing secret. A human session generates and vaults a new secret, returned exactly once for entry in GitHub. Normal endpoint reads expose only whether one is configured. Human regeneration immediately rotates the server-side value.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(chatEndpointCredentialHandoffSchema),
    201: r.ok(chatEndpointSetupSecretResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/photon/inspect",
  tags: ["chat-channels"],
  summary: "Inspect Photon shared project or dedicated numbers for channel setup",
  description:
    "Requires an operator user with connection-management access. The project secret is write-only input. Returns the project's actual allocation and eligibility for shared DMs or dedicated lines, never project secrets or minted line tokens. Responses are not cached. Inspection alone does not activate the channel.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(inspectPhotonProjectSchema),
  },
  responses: {
    200: r.ok(z.object({
      projectId: photonProjectIdSchema,
      projectName: z.string(),
      allocation: z.enum(["dedicated", "shared"]),
      eligible: z.boolean(),
      lines: z.array(z.object({
        lineId: photonLineIdSchema,
        phoneNumber: z.string(),
        eligible: z.boolean(),
        unavailableReason: z.string().optional(),
      }).strict()),
    }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
    429: { description: "Photon request limit reached; retry later" },
    502: { description: "Photon returned an invalid response; inspect provider health" },
    503: { description: "Photon temporarily unavailable; retry later" },
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post", path: "/api/chat-endpoints/{endpointId}/finish", tags: ["chat-channels"],
  summary: "Finish Slack or GitHub onboarding with an optional conversation test",
  description: "Requires verified provider delivery and an authorized identity linked to the current user. GitHub also checks the assigned agent’s current bot capabilities. Records that a full conversation test was not required.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: { 200: r.ok(chatEndpointResponseSchema), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get", path: "/api/chat-endpoints/{endpointId}/test-status", tags: ["chat-channels"],
  summary: "Check for the current user's first setup message",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: { 200: r.ok(z.object({ messageReceivedAt: z.string().nullable() })), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registry.registerPath({
  method: "post", path: "/api/chat-identity-links/request-access", tags: ["chat-channels"],
  summary: "Request space membership using a private Slack identity link",
  description: "Creates a pending human join request for admin approval. Requires a valid, unexpired self-service token and a signed-in user. Does not grant access or link an identity.",
  request: { body: jsonBody(confirmChatIdentityLinkSchema) },
  responses: { 200: r.ok(z.object({ status: z.enum(["member", "pending_approval"]) })), 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/test",
  tags: ["chat-channels"],
  summary: "Complete a chat endpoint setup test",
  description:
    "Activates a verifying endpoint only after Outpost has received a real provider event since the server-issued setup test boundary. iMessage Photon additionally requires a fresh linked sender's task and a successful outbound agent publication.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(chatEndpointResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/resources",
  tags: ["chat-channels"],
  summary: "List destinations discovered for a chat endpoint",
  description:
    "Lists provider destinations such as Slack and Discord channels, Teams channels, GitHub repositories, Telegram chats, and iMessage Photon groups. Direct-message resources are intentionally omitted.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatEndpointResourceResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "put",
  path: "/api/chat-endpoints/{endpointId}/resources",
  tags: ["chat-channels"],
  summary: "Replace chat endpoint destination access",
  description:
    "Enables or disables known provider destinations. Every resource must belong to the endpoint, and an unavailable or removed provider destination cannot be enabled.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(replaceChatEndpointResourcesSchema),
  },
  responses: {
    200: r.ok(z.array(chatEndpointResourceResponseSchema)),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/principals",
  tags: ["chat-channels"],
  summary: "List external identities seen by a chat endpoint",
  description:
    "Lists provider identities and their explicit Outpost identity-link status for this endpoint's provider account.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatPrincipalLinkResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/principals/{principalId}/link-intent",
  tags: ["chat-channels"],
  summary: "Create an external identity-link intent",
  description:
    "Creates a short-lived confirmation URL for a human external identity belonging to this endpoint. The signed-in Outpost user must confirm the link separately.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      principalId: z.string().uuid(),
    }),
    body: jsonBody(createChatIdentityLinkIntentSchema),
  },
  responses: {
    201: r.ok(chatIdentityLinkIntentResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "delete",
  path: "/api/chat-endpoints/{endpointId}/principals/{principalId}/link",
  tags: ["chat-channels"],
  summary: "Revoke an external identity link",
  description:
    "Revokes the endpoint-scoped link for the external identity. An inaccessible endpoint or missing link is reported as not found.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      principalId: z.string().uuid(),
    }),
  },
  responses: {
    204: r.noContent,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-identity-links/preview",
  tags: ["chat-channels"],
  summary: "Preview an external identity-link intent",
  description:
    "Returns the space and provider identity that a valid, unexpired confirmation token would link. Admin-created links require space access. Private links issued to a signed Slack sender allow a signed-in recipient to preview that identity and request space access.",
  request: {
    query: z.object({ token: z.string().min(32).max(4096) }).strict(),
  },
  responses: {
    200: r.ok(chatIdentityLinkPreviewResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-identity-links/confirm",
  tags: ["chat-channels"],
  summary: "Confirm an external identity link",
  description:
    "Links the token's external identity to the currently signed-in Outpost user after rechecking active space membership and canonical-link conflicts.",
  request: { body: jsonBody(confirmChatIdentityLinkSchema) },
  responses: {
    200: r.ok(chatIdentityLinkConfirmationResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/conversations",
  tags: ["chat-channels"],
  summary: "List external conversations and bound tasks",
  description:
    "Lists each durable provider conversation-to-Outpost-task binding for the endpoint, including provider and task links and the latest publication state.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatConversationResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:audit",
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/activity",
  tags: ["chat-channels"],
  summary: "List chat endpoint delivery and publication activity",
  description:
    "Returns the endpoint's recent redacted inbound-delivery and outbound-publication ledger, including whether a failed item can be replayed. Supply limit (1–100) for a page object and follow nextCursor for older activity. Requests without pagination parameters retain the legacy recent-100 array.",
  request: { params: z.object({ endpointId: z.string().uuid() }), query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().max(256).optional() }) },
  responses: {
    200: r.ok(z.union([z.array(chatActivityResponseSchema), z.object({ items: z.array(chatActivityResponseSchema), nextCursor: z.string().nullable() })])),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/deliveries/{deliveryId}/replay",
  tags: ["chat-channels"],
  summary: "Replay a failed inbound chat delivery",
  description:
    "Retries a failed delivery only when it is already bound to a task. Concurrent or ineligible replay attempts return a conflict.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      deliveryId: z.string().uuid(),
    }),
  },
  responses: {
    204: r.noContent,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/publications/{publicationId}/replay",
  tags: ["chat-channels"],
  summary: "Replay a failed chat publication",
  description:
    "Retries only a publication in `failed` state. Ambiguous `delivery_unknown` rows require an explicit operator resolution instead.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      publicationId: z.string().uuid(),
    }),
  },
  responses: {
    204: r.noContent,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/publications/{publicationId}/resolve",
  tags: ["chat-channels"],
  summary: "Resolve an unconfirmed chat publication",
  description:
    "After checking the provider conversation, an operator may mark an ambiguous publication delivered, retry it while accepting duplicate risk, or cancel it. Every resolution is audited.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      publicationId: z.string().uuid(),
    }),
    body: jsonBody(resolveChatPublicationSchema),
  },
  responses: {
    204: r.noContent,
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/actions/{actionId}/resolve",
  tags: ["chat-channels"],
  summary: "Resolve an unconfirmed provider action",
  description:
    "After checking the provider, an operator may mark an ambiguous durable provider reply delivered, retry it while accepting duplicate risk, or cancel it. Slack slash-command task starts support explicit retry or cancel only. Outpost never replays an ambiguous provider action automatically, and every resolution is audited.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      actionId: z.string().uuid(),
    }),
    body: jsonBody(resolveChatActionSchema),
  },
  responses: {
    204: r.noContent,
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/conversations/{conversationId}/publications",
  tags: ["chat-channels"],
  summary: "Publish an Outpost task comment to an external conversation",
  description:
    "Explicitly projects an eligible comment from the bound Outpost task into the provider conversation. The endpoint, conversation, and comment must belong to the same binding. An Operator send with an already-bound attachment returns 409 with code chat_operator_send_attachments_already_bound and request-scoped details (endpointId, conversationId, idempotencyKey, attachmentIds). This durable rejection queues no publication and is replayed for the same key even if the file later becomes unbound. Correcting it requires an explicit new send identity. Other errors do not establish non-delivery.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      conversationId: z.string().uuid(),
    }),
    body: jsonBody(publishChatPublicationSchema),
  },
  responses: {
    201: r.ok(chatPublicationResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/issues/{issueId}/chat-binding",
  tags: ["chat-channels", "issues"],
  summary: "Get a task's external chat binding",
  description:
    "Returns the task's current external conversation binding, or `null` when it has none. Requires a task UUID; synthetic agent-chat view IDs are invalid. A binding in another space is reported as not found.",
  request: { params: z.object({ issueId: z.string().uuid() }) },
  responses: {
    200: r.ok(externalChannelBindingResponseSchema.nullable()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:test",
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/conversations/{conversationId}/publications/{publicationId}/status",
  tags: ["chat-channels"],
  summary: "Read authoritative delivery status for an Operator publication batch",
  description:
    "Returns the complete ordered batch, its first unresolved part and separate delivered, waiting, declined, expired and cancelled counts. Dismissal is allowed only when every part is settled; a consent card or upload receipt is not final file delivery. This read-only endpoint never retries or sends provider messages. The original publication ID remains a stable batch anchor.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      conversationId: z.string().uuid(),
      publicationId: z.string().uuid(),
    }),
  },
  responses: {
    200: r.ok(
      z
        .object({
          publication: chatPublicationResponseSchema.pick({
            id: true,
            state: true,
            providerUrl: true,
            attempts: true,
            redactedError: true,
            nextAttemptAt: true,
            publishedAt: true,
            fileTransfer: true,
          }),
          total: z.number().int().positive(),
          published: z.number().int().nonnegative(),
          parts: z.array(
            chatPublicationResponseSchema.pick({
              id: true,
              state: true,
              providerUrl: true,
              attempts: true,
              redactedError: true,
              nextAttemptAt: true,
              publishedAt: true,
              fileTransfer: true,
            }),
          ),
          awaitingConsent: z.number().int().nonnegative(),
          declined: z.number().int().nonnegative(),
          expired: z.number().int().nonnegative(),
          cancelled: z.number().int().nonnegative(),
          settled: z.number().int().nonnegative(),
          canDismiss: z.boolean(),
        })
        .strict(),
    ),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Agents ──────────────────────────────────────────────────────────────────

registry.register("AgentAppearance", agentAppearanceSchema);
registry.registerPath({
  method: "put",
  path: "/api/spaces/{spaceId}/agents/{agentId}/avatar",
  tags: ["agents"],
  summary: "Upload or reset an agent profile avatar",
  description: "Operator users require agent_config:update permission to change space agent avatars. Agents can update only their own avatar. Task bridge and skill test credentials cannot change profiles. Upload a base64 raster image, or null to restore the preset portrait. Stored avatars use space-scoped private assets.",
  request: {
    params: z.object({ spaceId: z.string().uuid(), agentId: z.string().uuid() }),
    body: jsonBody(setAgentAvatarSchema),
  },
  responses: {
    200: r.ok(z.object({ agentId: z.string().uuid(), appearance: agentAppearanceSchema, avatarUrl: z.string() })),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agent-avatars/{version}/{palette}/{file}",
  tags: ["agents"],
  summary: "Render or retrieve a public preset agent portrait",
  description: "On-demand PNG artwork; no agent or space lookup. Logical size determines face detail independently of density. Background defaults to transparent; outpost-dark supplies the opaque Outpost dark-mode background for Slack exports. Successful URLs are immutable for one year and return a content-derived ETag. Cache entries regenerate after deletion.",
  request: {
    params: z.object({
      version: z.literal("cap-v1"),
      palette: z.enum([...AGENT_PALETTE_IDS, "muted-dream"]),
      file: z.enum(CHARACTER_STATES.map(pose => `${pose}.png`)),
    }),
    query: z.object({
      size: z.enum(AGENT_AVATAR_SIZES.map(String)).optional().default("512"),
      scale: z.enum(["1", "2"]).optional().default("1"),
      background: z.enum(["transparent", "outpost-dark"]).optional().default("transparent"),
    }).strict(),
  },
  responses: {
    200: { description: "PNG portrait; Cache-Control: public, max-age=31536000, immutable; ETag: SHA-256 of PNG bytes", content: { "image/png": { schema: { type: "string", format: "binary" } } } },
    304: { description: "If-None-Match matches the cached content ETag" },
    400: r.badRequest,
    429: { description: "Cold-render admission limit for this client; Cache-Control: no-store; Retry-After in seconds. Cached portraits remain available." },
    503: { description: "Retryable rendering/storage failure; Cache-Control: no-store; Retry-After: 5" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/built-in-agents",
  tags: ["agents"],
  summary: "List built-in agent provisioning state",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/built-in-agents/{key}/status",
  tags: ["agents"],
  summary: "Get built-in agent bundle status",
  request: { params: z.object({ spaceId: z.string(), key: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/built-in-agents/{key}/reconcile",
  tags: ["agents"],
  summary: "Reconcile built-in agent managed resources",
  request: {
    params: z.object({ spaceId: z.string(), key: z.string() }),
    body: jsonBody(builtInAgentEmptyMutationSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/built-in-agents/{key}/provision",
  tags: ["agents"],
  summary: "Provision a built-in agent",
  request: {
    params: z.object({ spaceId: z.string(), key: z.string() }),
    body: jsonBody(builtInAgentProvisionSchema),
  },
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/built-in-agents/{key}/reset",
  tags: ["agents"],
  summary: "Reset a built-in agent",
  request: { params: z.object({ spaceId: z.string(), key: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

for (const route of [
  ["enable", "Enable a built-in routine schedule", 200],
  ["disable", "Disable a built-in routine schedule", 200],
  ["run", "Run a built-in routine once", 202],
] as const) {
  registry.registerPath({
    method: "post",
    path: `/api/spaces/{spaceId}/built-in-agents/{key}/routines/{routineKey}/${route[0]}`,
    tags: ["agents"],
    summary: route[1],
    request: {
      params: z.object({
        spaceId: z.string(),
        key: z.string(),
        routineKey: z.string(),
      }),
      body: jsonBody(builtInAgentEmptyMutationSchema),
    },
    responses: {
      [route[2]]: r.ok(),
      400: r.badRequest,
      401: r.unauthorized,
      403: r.forbidden,
      404: r.notFound,
      409: r.conflict,
      422: r.unprocessable,
    },
  });
}

const summarySlotParams = z.object({
  spaceId: z.string(),
  scopeKind: z.string(),
  slotKey: z.string(),
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/summary-slots/{scopeKind}/{slotKey}",
  tags: ["summaries"],
  summary: "Get a summary slot with its latest document and generation state",
  request: { params: summarySlotParams },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/summary-slots/{scopeKind}/{slotKey}/revisions",
  tags: ["summaries"],
  summary: "List dated revisions for a summary slot",
  request: { params: summarySlotParams },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/summary-slots/{scopeKind}/{slotKey}/generate",
  tags: ["summaries"],
  summary: "Manually generate (or refresh) a summary slot",
  request: {
    params: summarySlotParams,
    body: jsonBody(generateSummarySlotSchema),
  },
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/spaces/{spaceId}/summary-slots/{scopeKind}/{slotKey}",
  tags: ["summaries"],
  summary: "Write a summary revision (Summarizer built-in agent only)",
  request: {
    params: summarySlotParams,
    body: jsonBody(writeSummarySlotSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/status-cards",
  tags: ["status-cards"],
  summary: "List status cards",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/status-cards",
  tags: ["status-cards"],
  summary: "Create a status card",
  description: "Creates a saved status card on the space's Status page: a live summary of the tasks the interestPrompt describes. "
    + "agentId names the agent that writes its summary; without it the built-in Summarizer is used when configured. "
    + "The response is returned before any summary exists: the card's summarizer compiles its query and writes the first summary in its own run. "
    + "Do not wait or poll for it; reply now with the returned href as a Markdown link, which opens the card at /<prefix>/status/<cardId>.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createStatusCardSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

for (const route of [
  ["get", "/api/status-cards/{id}", "Get a status card"],
  ["delete", "/api/status-cards/{id}", "Delete a status card"],
  ["post", "/api/status-cards/{id}/recompile", "Recompile a status card query"],
  [
    "get",
    "/api/status-cards/{id}/dry-run",
    "Execute stored status card queries without an LLM",
  ],
  ["get", "/api/status-cards/{id}/updates", "List status card updates"],
  [
    "get",
    "/api/status-cards/{id}/summary-revisions",
    "List status card summary revisions",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["status-cards"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "patch",
  path: "/api/status-cards/{id}",
  tags: ["status-cards"],
  summary: "Update, archive, or restore a status card",
  description: "Archiving (archived: true) hides the card from the active list but keeps the card, its summary and its update history; it is not deleted. "
    + "A person views and restores archived cards on the space's Status page (Show archived, then Restore); give them the returned href as a Markdown link. "
    + "Restoring (archived: false) starts a fresh full summary for a card with a compiled query, so restored content is regenerated before it is current.",
  body: patchStatusCardSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/status-cards/{id}/refresh",
  tags: ["status-cards"],
  summary: "Refresh a status card",
  description: "Queues a refresh; it does not return a new summary. The card's summarizer agent writes the update in its own generation run, after which the card's lastGeneratedAt and summary change. "
    + "Do not sleep or poll for it: reply now that the refresh is queued, with the returned card.href as a Markdown link where the person sees the update. "
    + "alreadyGenerating means an earlier refresh is still running. enqueued false without alreadyGenerating means this request started no run: "
    + "if card.lastGeneratedAt is newer than before your request, a concurrent refresh already finished; otherwise the card's refresh policy deferred it, and card.state says why (such as paused_budget or paused_hours).",
  body: refreshStatusCardSchema,
});

registerCurrentRoute({
  method: "put",
  path: "/api/status-cards/{id}/query",
  tags: ["status-cards"],
  summary: "Write a compiled status card query",
  body: writeStatusCardQuerySchema,
});

registerCurrentRoute({
  method: "put",
  path: "/api/status-cards/{id}/summary",
  tags: ["status-cards"],
  summary: "Write a generated status card summary",
  body: writeStatusCardSummarySchema,
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/agents",
  tags: ["agents"],
  summary: "List agents in a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/agents",
  tags: ["agents"],
  summary: "Create an agent",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createAgentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/agent-creations",
  tags: ["agents"],
  summary: "Create an agent",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createAgentCreationSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/agent-configurations",
  tags: ["agents"],
  summary: "List agent configurations for a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/agent-hierarchy",
  tags: ["agents"],
  summary: "Get agent hierarchy data",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me",
  tags: ["agents"],
  summary: "Get the current agent",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/inbox-lite",
  tags: ["agents"],
  summary: "Get current agent inbox (lite)",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

const AgentSecretListResponseSchema = z.object({
  secrets: z.array(
    z.object({
      secretRef: z.string().guid(),
      key: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      delivery: z.enum(["env", "api", "both"]),
      projectionClass: z.string(),
      latestVersion: z.number().int().nonnegative(),
      versionSelector: z.union([
        z.literal("latest"),
        z.number().int().positive(),
      ]),
      resolvedVersion: z.number().int().positive(),
    }),
  ),
});

const createAgentSecretProposalSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("secret"),
      name: z.string().min(1),
      description: z.string().optional().nullable(),
      value: z.string().min(1),
      justification: z.string().min(1),
    }),
    z.object({
      kind: z.literal("binding"),
      secretId: z.string().guid().optional(),
      sourceConfigPath: z.string().min(1).optional(),
      secretProposalId: z.string().guid().optional(),
      targetAgentId: z.string().guid().optional(),
      configPath: z.string().min(1),
      justification: z.string().min(1),
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.kind === "binding" &&
      [value.secretId, value.sourceConfigPath, value.secretProposalId].filter(
        (reference) => Boolean(reference),
      ).length !== 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide exactly one of secretId, sourceConfigPath, or secretProposalId",
      });
    }
  });

const approveSecretProposalSchema = z.object({
  cascade: z.boolean().optional(),
  overrides: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      providerConfigId: z.string().guid().optional().nullable(),
    })
    .optional(),
});

const rejectSecretProposalSchema = z.object({ reason: z.string().min(1) });

registry.registerPath({
  method: "post",
  path: "/api/agents/me/secret-proposals",
  tags: ["secrets"],
  summary: "Propose a space secret or agent secret binding",
  request: { body: jsonBody(createAgentSecretProposalSchema) },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/secret-proposals",
  tags: ["secrets"],
  summary: "List secret proposals visible to the current agent run",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/me/secret-proposals/{id}",
  tags: ["secrets"],
  summary: "Withdraw a pending secret proposal",
  request: { params: z.object({ id: z.string().guid() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/secrets",
  tags: ["secrets"],
  summary: "List secrets accessible to the current agent run",
  responses: {
    200: {
      description: "Accessible secret metadata",
      content: {
        "application/json": { schema: AgentSecretListResponseSchema },
      },
    },
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/me/secrets/{key}/value",
  tags: ["secrets"],
  summary: "Fetch one secret value for the current agent run",
  request: { params: z.object({ key: z.string() }) },
  responses: {
    200: {
      description: "Decrypted secret value",
      content: {
        "application/json": {
          schema: z.object({
            key: z.string(),
            value: z.string(),
            version: z.number().int().positive(),
          }),
        },
      },
    },
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/me/connections/{connectionId}/token",
  tags: ["tools"],
  summary: "Mint a short-lived token for an agent connection",
  request: {
    params: z.object({ connectionId: z.string() }),
    body: jsonBody(connectionTokenRequestSchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/inbox/mine",
  tags: ["agents"],
  summary: "List a person's Mine inbox tasks",
  description: "Agent read of one operator user's personal inbox: the tasks that person participated in and has not archived, the same set as their Mine list, which they open at /<prefix>/inbox/mine. Use it when a person asks what is in their inbox or needs their attention; it is not your own work queue (GET /api/agents/me/inbox-lite) and a space-wide task search is not a substitute. userId is required: use the person's user id, such as the authorUserId of their message.",
  request: {
    query: z.object({
      userId: z.string().min(1).describe("The person's user id, such as the authorUserId of their message. Required."),
      status: z.string().optional().describe("Comma-separated task statuses; defaults to the Mine list statuses (cancelled excluded)."),
    }),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}",
  tags: ["agents"],
  summary: "Get an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/identity",
  tags: ["agents"],
  summary: "Get an agent's public cryptographic identity, or null before provisioning",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(z.object({
      algorithm: z.literal("Ed25519"),
      keyId: z.string(),
      publicKeyPem: z.string(),
      createdAt: z.string().datetime(),
    }).nullable()),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}",
  tags: ["agents"],
  summary: "Update an agent",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentSchema.omit({ permissions: true, spentMonthlyCents: true })),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/{id}",
  tags: ["agents"],
  summary: "Delete an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}/permissions",
  tags: ["agents"],
  summary: "Update agent permissions",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentPermissionsSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}/permission-grants",
  tags: ["agents"],
  summary: "Grant or revoke one explicit agent permission",
  description: "Operator-only. Requires users:manage_permissions in the agent's space. Enables an unscoped grant or removes that permission key without replacing other grants. Does not reactivate inactive memberships or start agent work. Writes an activity record in the same transaction.",
  request: { params: z.object({ id: z.string().uuid() }), body: jsonBody(updateAgentPermissionGrantSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

const agentInteractionPermissionsResponse = z.object({
  agentId: z.string().uuid(), spaceId: z.string().uuid(), overrides: agentInteractionPermissionsSchema,
  effective: agentInteractionPermissionsSchema.required(),
});
registry.registerPath({
  method: "get", path: "/api/agents/{id}/interaction-permissions", tags: ["agents"],
  summary: "Read individual agent interaction restrictions",
  description: "Requires agent configuration read access. Returns sparse saved overrides and effective restriction values; true does not grant authority denied by other policies.",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: r.ok(agentInteractionPermissionsResponse), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registry.registerPath({
  method: "patch", path: "/api/agents/{id}/interaction-permissions", tags: ["agents"],
  summary: "Set individual agent interaction restrictions",
  description: "Human permission managers only: requires operator authentication and users:manage_permissions. A partial map sets true/false; null removes the override. Missing values preserve existing behavior. Does not change grants or start work. Every change is audited atomically.",
  request: { params: z.object({ id: z.string().uuid() }), body: jsonBody(updateAgentInteractionPermissionsSchema) },
  responses: { 200: r.ok(agentInteractionPermissionsResponse), 400: r.badRequest, 401: r.unauthorized,
    403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

const agentProjectAccessResponse = z.object({ projectIds: z.array(z.string().uuid()), canManage: z.boolean() });
registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/project-access",
  tags: ["agents"],
  summary: "Read an agent's allowed projects and the current operator's management capability",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(agentProjectAccessResponse), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/project-access",
  tags: ["agents"],
  summary: "Add allowed projects without replacing an agent's other permissions",
  description: "Requires operator access and agents:create in the agent's space. Accepts 1 to 100 project IDs. Selected projects must be readable and in that space. Locks the low-trust agent, preserves existing containment, audits new additions, and rejects pending-approval agents or changed trust settings. Repeated additions are idempotent. Saving does not start or retry a task.",
  request: { params: z.object({ id: z.string() }), body: jsonBody(addAgentProjectAccessSchema) },
  responses: { 200: r.ok(agentProjectAccessResponse), 400: r.badRequest, 401: r.unauthorized,
    403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}/instructions-path",
  tags: ["agents"],
  summary: "Update agent instructions path",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentInstructionsPathSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/instructions-bundle",
  tags: ["agents"],
  summary: "Get agent instructions bundle",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}/instructions-bundle",
  tags: ["agents"],
  summary: "Update agent instructions bundle",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentInstructionsBundleSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/instructions-bundle/file",
  tags: ["agents"],
  summary: "Get agent file content or download its original bytes",
  request: { params: z.object({ id: z.string() }), query: z.object({ path: z.string(), download: z.enum(["true", "false"]).optional() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/agents/{id}/instructions-bundle/file",
  tags: ["agents"],
  summary: "Upsert agent instructions file",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(upsertAgentInstructionsFileSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

for (const operation of [
  { suffix: "history", summary: "List pre-upgrade instruction revisions. Current saves record no revision history; an empty list means no earlier version is retained", query: z.object({ path: z.string().optional(), cursor: z.string().uuid().optional() }) },
  { suffix: "revision/{revisionId}", summary: "Read exact instruction content at a revision", query: z.object({ path: z.string().optional() }) },
  { suffix: "diff", summary: "Compare instruction revisions (exact common prefix, removed, added, suffix)", query: z.object({ path: z.string().optional(), from: z.string().uuid(), to: z.string().uuid() }) },
]) {
  registry.registerPath({ method: "get", path: `/api/agents/{id}/instructions-bundle/${operation.suffix}`, tags: ["agents"], summary: operation.summary,
    request: { params: operation.suffix.includes("revisionId") ? z.object({ id: z.string(), revisionId: z.string().uuid() }) : z.object({ id: z.string() }), query: operation.query },
    responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound } });
}
registry.registerPath({ method: "post", path: "/api/agents/{id}/instructions-bundle/restore", tags: ["agents"], summary: "Restore a pre-upgrade instruction snapshot into current files with compare-and-swap",
  request: { params: z.object({ id: z.string() }), body: jsonBody(restoreAgentInstructionSchema) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict } });

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/instructions-bundle/candidates",
  tags: ["agents"],
  summary: "List preserved instruction edits and collection diagnostics",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/instructions-bundle/candidates/{runId}/resolve",
  tags: ["agents"],
  summary: "Explicitly save a preserved instruction edit with compare-and-swap",
  request: {
    params: z.object({ id: z.string(), runId: z.string().uuid() }),
    body: jsonBody(resolveAgentInstructionCandidateSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/{id}/instructions-bundle/file",
  tags: ["agents"],
  summary: "Delete agent file with compare-and-swap for managed storage",
  request: { params: z.object({ id: z.string() }), query: z.object({ path: z.string(), baseHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/configuration",
  tags: ["agents"],
  summary: "Get agent configuration",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/config-revisions",
  tags: ["agents"],
  summary: "List agent config revisions",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/config-revisions/{revisionId}",
  tags: ["agents"],
  summary: "Get an agent config revision",
  request: { params: z.object({ id: z.string(), revisionId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/config-revisions/{revisionId}/rollback",
  tags: ["agents"],
  summary: "Roll back to a config revision",
  request: { params: z.object({ id: z.string(), revisionId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/runtime-state",
  tags: ["agents"],
  summary: "Get agent runtime state",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/runtime-state/reset-session",
  tags: ["agents"],
  summary: "Reset agent session",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resetAgentSessionSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/task-sessions",
  tags: ["agents"],
  summary: "List agent task sessions",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/skills",
  tags: ["agents"],
  summary: "List agent skills",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/skills/sync",
  tags: ["agents"],
  summary: "Sync desired skills onto an agent configuration",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(agentSkillSyncSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/keys",
  tags: ["agents"],
  summary: "List agent API keys",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/keys",
  tags: ["agents"],
  summary: "Create an agent API key",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createAgentKeySchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/{id}/keys/{keyId}",
  tags: ["agents"],
  summary: "Delete an agent API key",
  request: { params: z.object({ id: z.string(), keyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/wakeup",
  tags: ["agents"],
  summary: "Wake up an agent",
  description:
    "Operator failed-run retries supply failedRunId with reason retry_failed_run. Outpost derives the exact request and current authorization; a chat retry may return a durable queued/deferred receipt before a run exists. Caller task/comment markers and fresh-session overrides do not authorize replay.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(wakeAgentSchema),
  },
  responses: {
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/lifecycle/retry",
  tags: ["agents"],
  summary: "Retry an incomplete agent lifecycle step",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/pause",
  tags: ["agents"],
  summary: "Pause an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/resume",
  tags: ["agents"],
  summary: "Resume an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/clear-error",
  tags: ["agents"],
  summary: "Clear an agent error",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/terminate",
  tags: ["agents"],
  summary: "Terminate an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/scheduler-heartbeats",
  tags: ["agents"],
  summary: "List scheduler heartbeats",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Adapters ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/adapters/{type}/models",
  tags: ["adapters"],
  summary: "List models for an adapter type and runner provider",
  description: "Answers which models an agent's runtime can select. For a outpost_runner agent, pass its adapterConfig.provider, its adapterConfig.acpxAgent when the provider is acpx, and its defaultEnvironmentId; the response is that runtime's own list. An OpenCode agent whose model starts with openrouter/ uses an OpenRouter key: list those choices with type opencode_local and provider=openrouter. That list is OpenRouter's public catalog, so whether a model works depends on the key's account and is not a qualification. With those inputs, these calls answer the question: report the options with that caveat and reply, rather than enumerating providers through other routes, the shell or the web.",
  request: {
    params: z.object({ spaceId: z.string(), type: z.string() }),
    query: z.object({
      provider: z
        .enum(["codex", "acpx", "opencode", "claude_managed", "aws_agentcore", "openrouter"])
        .optional(),
      environmentId: z.string().optional(),
      refresh: z.string().optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/adapters/{type}/detect-model",
  tags: ["adapters"],
  summary: "Detect active model for an adapter",
  request: { params: z.object({ spaceId: z.string(), type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/adapters/{type}/test-environment",
  tags: ["adapters"],
  summary: "Validate adapter environment access for a space",
  request: {
    params: z.object({ spaceId: z.string(), type: z.string() }),
    body: jsonBody(testAdapterEnvironmentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/qualify-runner",
  tags: ["agents"],
  summary: "Qualify an existing agent's saved computer for a runner upgrade",
  description: "Requires agent_config:update authorization, normally agents:configure. Resolves the saved agent's effective sandbox; expectedEnvironmentId only guards against stale UI state. Does not change the agent or grant instance environment access.",
  request: { params: z.object({ id: z.string() }), body: jsonBody(qualifyAgentRunnerSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/adapters/{type}/auth-signal",
  tags: ["adapters"],
  summary:
    "Read the cheap host-local authentication signal for an adapter type",
  request: {
    params: z.object({ spaceId: z.string(), type: z.string() }),
    query: z.object({ environmentId: z.string().optional() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/adapters/{type}/login-sessions",
  tags: ["adapters"],
  summary: "Start a space-scoped adapter device login",
  description: "For a managed AI Connection, omit agentId to select an eligible computer in the sign-in environment.",
  request: {
    params: z.object({ spaceId: z.string(), type: z.string() }),
    body: jsonBody(startAdapterLoginSessionSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/adapters/{type}/login-sessions/active",
  tags: ["adapters"],
  summary: "Read the caller's active adapter device login session",
  request: {
    params: z.object({ spaceId: z.string(), type: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/adapters/{type}/login-sessions/{sessionId}",
  tags: ["adapters"],
  summary: "Read an adapter device login session",
  request: {
    params: z.object({
      spaceId: z.string(),
      type: z.string(),
      sessionId: z.string(),
    }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/adapters/{type}/login-sessions/{sessionId}/cancel",
  tags: ["adapters"],
  summary: "Cancel an adapter device login session",
  request: {
    params: z.object({
      spaceId: z.string(),
      type: z.string(),
      sessionId: z.string(),
    }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Issues ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/chats",
  tags: ["issues"],
  summary: "List the current operator user's agent conversations",
  description: "Requires Agent Chat to be enabled. Returns accessible conversations in the space, ordered by most recent activity. Each agent has one conversation per user.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/inbox/mine",
  tags: ["issues"],
  summary: "Get the operator user's initial Mine inbox and required task context",
  description: "Operator-only presentation read. Returns userId, issues, contextIssues, failureRuns and verified failureIssueIds. Uses the existing space, private-task, run-read and secret-redaction policies. Optional failureError or contextError retains successful task rows. The initial task page is bounded to 100 and failed-run history to 200. No query parameters are accepted. This GET shares issue-list coalescing and admission limits; it creates no work.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 429: r.tooManyRequests },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/issues",
  tags: ["issues"],
  summary: "List issues in a space",
  description:
    "Use view=index for collection membership/order without task bodies or diagnostic enrichment; view=rows enriches visible rows without task bodies. These responses include listProjection and cannot stand in for a full issue. view=compact retains the operator row compatibility contract. The default response remains the broad compatibility contract. All projections enforce space and task access. Results are paged: limit defaults to 500 (maximum 1000) and offset to 0. For actors who can read the whole space's task list, every page sets X-Outpost-Has-More (true when more results exist) and X-Outpost-Limit; a capped page also sets X-Outpost-Next-Offset, or X-Outpost-Next-After-Id for sortField=id&sortDir=asc cursor paging (not with oneChildPerParent). Actors whose rows are filtered by task access, such as low-trust agents, get no pagination headers. Agent call_api results carry these as pagination.hasMore/nextOffset/nextAfterId. A page whose hasMore is true is not the complete list: repeat the request with the same filters and the next offset or afterId until hasMore is false.",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      view: z.enum(["compact", "index", "rows"]).optional(),
      ids: z.string().optional().describe("One to 100 comma-separated task UUIDs; requires index or rows without attention."),
      parentIds: z.string().optional().describe("One to 100 comma-separated parent UUIDs; requires index or rows without attention."),
      oneChildPerParent: z.boolean().optional().describe("Return at most one readable child per parent; requires view=index and parentIds."),
      limit: z.number().int().min(1).max(1000).optional().describe("Page size; defaults to 500, at most 1000. Check X-Outpost-Has-More (call_api: pagination.hasMore) for more results."),
      offset: z.number().int().min(0).optional().describe("Rows to skip; use X-Outpost-Next-Offset (call_api: pagination.nextOffset) from the previous page."),
      sortField: z.enum(["updated", "created", "id"]).optional(),
      sortDir: z.enum(["asc", "desc"]).optional(),
      afterId: z.string().uuid().optional().describe("Cursor paging: return rows after this task UUID; requires sortField=id, sortDir=asc and no offset. Use X-Outpost-Next-After-Id (call_api: pagination.nextAfterId)."),
    }).passthrough(),
  },
  responses: {
    200: r.ok(),
    304: { description: "Not Modified" },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/issues/summaries",
  tags: ["issues"],
  summary: "Get authorized recent-task summaries",
  description: "Accepts only the ids query parameter: one to fifty comma-separated UUIDs, bounded before deduplication. IDs are trimmed and normalized to lowercase. Repeated, array and nested query syntax is rejected, including mixed forms. Returns accessible, visible tasks in request order; unavailable IDs are omitted. This private, no-store read excludes full task and workspace enrichment.",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({ ids: z.string().min(1).describe("One to fifty comma-separated task UUIDs; repeated query parameters are rejected") }),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/issues/chat-bootstrap",
  tags: ["issues"],
  summary: "Read what the task chat needs before its first frame, for up to ten tasks",
  description: "Accepts only the ids query parameter: one to ten comma-separated task UUIDs or identifiers, normalized (UUID lowercase, identifier uppercase) and deduplicated. Returns { items } in request order; each item has the normalized ref plus issue (GET /issues/{id}?view=core), recentComments (/recent-comments), commentInputFacts (/activity?view=comment-inputs for the recent comments), recentActivity (/activity?view=recent), recentRuns (/runs?view=recent), interactions, attachments, liveRuns and activeRun, each in that endpoint's shape. Missing, foreign and unreadable tasks are omitted. Read-only, without break-glass; private, no-store. Task-bridge keys are rejected.",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({ ids: z.string().min(1).describe("One to ten comma-separated task UUIDs or identifiers; other query parameters are rejected") }),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{ref}/chat-bootstrap",
  tags: ["issues"],
  summary: "Read what the task chat needs before its first frame, for one task",
  description: "The single-task form of /spaces/{spaceId}/issues/chat-bootstrap for a hard load of a task URL. Returns one item (not wrapped in items), identical to the batch item for the same ref. 404 when the task is missing or unreadable. Read-only, without break-glass; private, no-store.",
  request: { params: z.object({ ref: z.string().describe("A task UUID or identifier") }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/issues",
  tags: ["issues"],
  summary: "Create an issue",
  description: "Title is optional when description contains the task prompt. The server seeds a provisional title from the first 120 characters of the whitespace-normalized prompt and asks the assigned agent to refine it early. Explicit titles are preserved.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createIssueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}",
  tags: ["issues"],
  summary: "Get an issue",
  request: { params: z.object({ id: z.string() }), query: z.object({ view: z.literal("core").optional().describe("Task fields with saved document and work-product cards, without recovery or related-task enrichment and without provider refresh.") }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/title",
  tags: ["issues"],
  summary: "Set a task title",
  description: "Changes only the title. onlyIfProvisional preserves an explicit title, including concurrent user edits. Agent callers must own the task's active run. Allowed in Ask and Plan modes.",
  request: { params: z.object({ id: z.string() }), body: jsonBody(setIssueTitleSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "patch",
  path: "/api/issues/{id}",
  tags: ["issues"],
  summary: "Update an issue",
  description:
    "When posting a comment, attachmentIds selects up to 20 unique uploaded attachments from this exact task and space. The comment, attachment binding, and issue update commit atomically. attachmentIds without a comment is rejected; Markdown links alone do not bind uploads. For a prepared backlog task, send exactly status=todo and expectedStatusVersion from the task response. The locked promotion returns 409 if the status or assignment changed. Other mutation fields with this guard return 422.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateIssueSchema.partial()),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/stalled-review-decision",
  tags: ["issues"],
  summary: "Resolve a stalled issue review",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(stalledReviewDecisionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}",
  tags: ["issues"],
  summary: "Delete an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/heartbeat-context",
  tags: ["issues"],
  summary: "Get issue heartbeat context",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/runner-goal",
  tags: ["issues"],
  summary: "Get the effective agent session north star for an issue",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ agentId: z.string().optional() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/runner-goal/actions",
  tags: ["issues"],
  summary: "Queue a control action for an agent session north star",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(runnerGoalActionRequestSchema),
  },
  responses: {
    202: { description: "North Star control accepted" },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/workspace",
  tags: ["issues"],
  summary: "Inspect the task workspace and repository preparation state",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/workspace",
  tags: ["issues"],
  summary: "Select a task workspace for the next normal admission",
  description: "Records workspace intent without restarting active work or changing the task's organizational project. Agents may select only for their bound task.",
  request: { params: z.object({ id: z.string().uuid() }), body: jsonBody(selectTaskWorkspaceSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/workspace/repositories",
  tags: ["issues"],
  summary: "Request repository preparation in the task workspace",
  description: "Queues an authorized repository for the next normal admission. The response does not claim the repository is available in an already-running provider session.",
  request: { params: z.object({ id: z.string().uuid() }), body: jsonBody(prepareWorkspaceRepositorySchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/watchdog",
  tags: ["issues"],
  summary: "Get active issue watchdog",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/watchdog",
  tags: ["issues"],
  summary: "Create or update an issue watchdog",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(upsertIssueWatchdogSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/watchdog",
  tags: ["issues"],
  summary: "Disable an issue watchdog",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/work-products",
  tags: ["issues"],
  summary: "List issue work products",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ refreshPullRequests: z.enum(["true"]).optional() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/work-products",
  tags: ["issues"],
  summary: "Create an issue work product",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createIssueWorkProductSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/work-products/{workProductId}/review-document",
  tags: ["issues"],
  summary: "Ensure the review document for a Markdown work product",
  request: { params: z.object({ id: z.string(), workProductId: z.string() }) },
  responses: {
    200: r.ok(),
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    413: r.payloadTooLarge,
    415: r.unsupportedMediaType,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/work-products/{id}",
  tags: ["issues"],
  summary: "Update a work product",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateIssueWorkProductSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/work-products/{id}",
  tags: ["issues"],
  summary: "Delete a work product",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents",
  tags: ["issues"],
  summary: "List issue documents",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents/{key}",
  tags: ["issues"],
  summary: "Get an issue document",
  request: { params: z.object({ id: z.string(), key: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/documents/{key}",
  tags: ["issues"],
  summary: "Upsert an issue document",
  request: {
    params: z.object({ id: z.string(), key: z.string() }),
    body: jsonBody(upsertIssueDocumentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/documents/{key}",
  tags: ["issues"],
  summary: "Delete an issue document",
  request: { params: z.object({ id: z.string(), key: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents/{key}/revisions",
  tags: ["issues"],
  summary: "List issue document revisions",
  request: { params: z.object({ id: z.string(), key: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents/{key}/revisions/{revisionId}",
  tags: ["issues"],
  summary: "Get an exact issue document revision",
  description:
    "Available to operator users and agents with current issue read access. Returns the specified revision only when its document is linked to this issue under the given key. Document keys are trimmed and lowercased before validation. The response also carries the document's current latestRevisionId and latestRevisionNumber, and isLatest says whether this revision is still current; to read the current text, use GET /api/issues/{id}/documents/{key}. This read does not restore or modify the document.",
  request: {
    params: z.object({
      id: z.string(),
      key: issueDocumentKeySchema,
      revisionId: z.string().uuid(),
    }),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/documents/{key}/revisions/{revisionId}/restore",
  tags: ["issues"],
  summary: "Restore a document revision",
  request: {
    params: z.object({
      id: z.string(),
      key: z.string(),
      revisionId: z.string(),
    }),
    body: jsonBody(restoreIssueDocumentRevisionSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/recent-comments",
  tags: ["issues"],
  summary: "Read a bounded recent task exchange",
  description: "Returns four recent comments, the latest human comment, and the first human instruction when the task has no description. Agent chats instead return the latest 20 contiguous comments and oldestCommentId for backward cursor paging. Includes latestCommentId and hasMore. Uses the same authorization and redaction as full comment reads.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/comments",
  tags: ["issues"],
  summary: "List issue comments",
  description: "Lists discussion comments, not complete status or assignment history. For progress walkthroughs and handoff attribution, use GET /api/spaces/{spaceId}/timeline for the requested interval and GET /api/issues/{id}/activity for saved transitions and their recorded actors. Do not infer prior ownership from the current assignee or from successful runs.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/comments",
  tags: ["issues"],
  summary: "Add a comment to an issue",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(addIssueCommentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/comments/{commentId}",
  tags: ["issues"],
  summary: "Delete an issue comment",
  request: { params: z.object({ id: z.string(), commentId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/privacy-constraints",
  tags: ["issues"],
  summary: "Get task privacy action constraints for an authorized manager",
  description: "Returns action hints without disclosing protected parent or project identity. Visibility writes recheck the current rules under the privacy-tree lock.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(z.object({
      publicBlockedBy: z.enum(["parent", "project"]).nullable(),
      leavesPersonalProject: z.boolean(),
    }).strict()),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/access-grants",
  tags: ["issues"],
  summary: "List issue access grants",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/access-grants/{grantId}/revoke",
  tags: ["issues"],
  summary: "Revoke an issue access grant",
  request: { params: z.object({ id: z.string(), grantId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/approvals",
  tags: ["issues"],
  summary: "List issue approvals",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/approvals",
  tags: ["issues"],
  summary: "Link an approval to an issue",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(linkIssueApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/approvals/{approvalId}",
  tags: ["issues"],
  summary: "Unlink an approval from an issue",
  request: { params: z.object({ id: z.string(), approvalId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/checkout",
  tags: ["issues"],
  summary: "Check out an issue",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(checkoutIssueSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/release",
  tags: ["issues"],
  summary: "Release an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/read",
  tags: ["issues"],
  summary: "Mark an issue as read",
  request: { params: z.object({ id: z.string() }), body: { ...jsonBody(markIssueReadSchema), required: false } },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/read",
  tags: ["issues"],
  summary: "Mark an issue as unread",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/inbox-archive",
  tags: ["issues"],
  summary: "Archive issue from inbox",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(z.object({ userId: z.string().min(1).optional() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/inbox-archive",
  tags: ["issues"],
  summary: "Un-archive issue from inbox",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(z.object({ userId: z.string().min(1).optional() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/feedback-votes",
  tags: ["issues"],
  summary: "List issue feedback votes",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/feedback-votes",
  tags: ["issues"],
  summary: "Upsert a feedback vote",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(upsertIssueFeedbackVoteSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{issueId}/file-resources/availability",
  tags: ["issues"],
  summary: "Check whether issue workspace files can be opened",
  request: {
    params: z.object({ issueId: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: workspaceFileAvailabilityRequestSchema },
      },
    },
  },
  responses: {
    200: r.ok(workspaceFileAvailabilityResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/file-resources/list",
  tags: ["issues"],
  summary: "List workspace files for an issue",
  request: {
    params: z.object({ issueId: z.string() }),
    query: workspaceFileListQuerySchema,
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/file-resources/resolve",
  tags: ["issues"],
  summary: "Resolve an issue workspace file",
  request: {
    params: z.object({ issueId: z.string() }),
    query: workspaceFileResourceQuerySchema,
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/file-resources/content",
  tags: ["issues"],
  summary: "Read issue workspace file content",
  request: {
    params: z.object({ issueId: z.string() }),
    query: workspaceFileResourceQuerySchema,
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/attachments",
  tags: ["issues"],
  summary: "List issue attachments",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/labels",
  tags: ["issues"],
  summary: "List labels in a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/labels",
  tags: ["issues"],
  summary: "Create a label",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createIssueLabelSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/labels/{labelId}",
  tags: ["issues"],
  summary: "Delete a label",
  request: { params: z.object({ labelId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Projects ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/project-environments",
  tags: ["projects"],
  summary: "List compatible project environments and the caller's default",
  description: "Groups configured environments by repository storage owner. Returns names and IDs without provider configuration. Creation revalidates environmentId and stores its storage owner without overriding agent execution environments.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: {
    200: r.ok(z.object({
      groups: z.array(z.object({
        storageProviderPluginId: z.string().uuid().nullable(),
        environments: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
      })),
      defaultEnvironmentId: z.string().uuid().nullable(),
      error: z.string().nullable(),
    })),
    401: r.unauthorized, 403: r.forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/project-repositories",
  tags: ["projects"],
  summary: "Discover GitHub repositories available to the current operator user",
  description:
    "Deduplicates repositories across usable personal and space-shared GitHub connections. Failed connections are reported without discarding successful results.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: {
    200: r.ok(
      z.object({
        repositories: z.array(
          z.object({
            id: z.string(),
            fullName: z.string(),
            url: z.string(),
            private: z.boolean().optional(),
            connections: z.array(z.string()),
          }),
        ),
        connectionCount: z.number().int().nonnegative(),
        failedConnectionCount: z.number().int().nonnegative(),
      }),
    ),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

const projectGitAuthorizationResponse = z.object({
  grantId: z.string().uuid().nullable(),
  authorizedByUserId: z.string().nullable(),
  options: z.array(z.object({ grantId: z.string().uuid(), connectionName: z.string(), login: z.string() })),
});
registry.registerPath({
  method: "get", path: "/api/projects/{id}/git-authorization", tags: ["projects"],
  summary: "Read background project GitHub authorization and the viewer's eligible grants",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(projectGitAuthorizationResponse), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registry.registerPath({
  method: "put", path: "/api/projects/{id}/git-authorization", tags: ["projects"],
  summary: "Authorize or revoke a personal GitHub grant for background project work",
  description: "Operator project workspace writers can select only their own active space-installed grant. No task authority or token is stored.",
  request: { params: z.object({ id: z.string() }), body: jsonBody(z.object({ grantId: z.string().uuid().nullable() }).strict()) },
  responses: { 200: r.ok(projectGitAuthorizationResponse), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/projects/{id}/repositories",
  tags: ["projects"],
  summary: "Replace selected GitHub source repositories",
  description:
    "Saves provider IDs transactionally, refreshes canonical names and URLs, and preserves legacy workspace URLs. Unavailable existing selections can remain; new selections must be available to the caller.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      createProjectSchema.pick({ repositoryIds: true }).required(),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/projects",
  tags: ["projects"],
  summary: "List projects in a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/projects",
  tags: ["projects"],
  summary: "Create a project",
  description:
    "The optional repositoryIds field selects GitHub source repositories and requires an operator caller. It cannot be combined with workspace. All selections are validated before the project and repository workspaces are created atomically.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createProjectSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}",
  tags: ["projects"],
  summary: "Get a project",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/projects/{id}",
  tags: ["projects"],
  summary: "Update project properties and defaults",
  description: "Save project properties and defaults. The description holds shared project context and guidance, including checklists; goalIds links the project to its north stars. Read the project back to verify the saved fields. Updating description or goalIds does not rewrite existing tasks or the inputs already admitted to active native runs; changing existing work is a separate operation. Environment and executionWorkspacePolicy fields configure separate project settings and are not required to save description or goalIds.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateProjectSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/projects/{id}",
  tags: ["projects"],
  summary: "Delete a project",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}/access-members",
  tags: ["projects"],
  summary: "List project access members",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/projects/{id}/access-members",
  tags: ["projects"],
  summary: "Add a project access member",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(addProjectAccessMemberSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/projects/{id}/access-members/{memberId}",
  tags: ["projects"],
  summary: "Remove a project access member",
  request: { params: z.object({ id: z.string(), memberId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}/workspaces",
  tags: ["projects"],
  summary: "List project workspaces",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/projects/{id}/workspaces",
  tags: ["projects"],
  summary: "Create a project workspace",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createProjectWorkspaceSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/projects/{id}/workspaces/{workspaceId}",
  tags: ["projects"],
  summary: "Update a project workspace",
  request: {
    params: z.object({ id: z.string(), workspaceId: z.string() }),
    body: jsonBody(updateProjectWorkspaceSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/projects/{id}/workspaces/{workspaceId}",
  tags: ["projects"],
  summary: "Delete a project workspace",
  request: { params: z.object({ id: z.string(), workspaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Routines ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/routines",
  tags: ["routines"],
  summary: "List routines in a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/routines",
  tags: ["routines"],
  summary: "Create a routine",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createRoutineSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// A plugin-managed routine is still an ordinary routine row, so agents read it
// through the routine routes; say there who owns it and where it is changed.
const PLUGIN_MANAGED_ROUTINE_GUIDANCE =
  "A routine with a non-null `managedByPlugin` is a plugin-managed routine: that plugin created it and owns its definition "
  + "(title, instructions, schedule, assignee), and the plugin can reset it to its manifest defaults. "
  + "It is changed through the settings that plugin exposes, which an operator user opens at "
  + "[plugin settings](/<prefix>/space/settings/instance/plugins/<pluginId>), with `managedByPlugin.pluginId` as <pluginId> "
  + "and this conversation's space prefix as <prefix>. "
  + "Do not rewrite, detach or duplicate a plugin-managed routine to imitate a change, and do not search for another route: "
  + "reply now with that link and the routine's page link.";
// When the hosting operator hides plugin management, that settings page redirects
// away, so the guidance names the operator instead of linking it.
const PLUGIN_MANAGED_ROUTINE_OPERATOR_GUIDANCE =
  "A routine with a non-null `managedByPlugin` is a plugin-managed routine: that plugin created it and owns its definition "
  + "(title, instructions, schedule, assignee), and the plugin can reset it to its manifest defaults. "
  + "On this instance the hosting operator manages plugins, so no Outpost page offers that change. "
  + "Do not rewrite, detach or duplicate a plugin-managed routine to imitate a change, and do not search for another route: "
  + "reply now that the hosting operator controls this plugin's settings, with the routine's page link.";

/** Picks the plugin-managed routine and experimental settings guidance that matches settings visibility. */
export function applyPluginSettingsVisibility(document: any, hidden: ReadonlySet<string> = getHiddenSettings()): any {
  if (hidden.has("instance.plugins")) {
    for (const operation of [document.paths?.["/api/routines/{id}"]?.get, document.paths?.["/api/routines/{id}"]?.patch]) {
      if (typeof operation?.description === "string") {
        operation.description = operation.description.replace(PLUGIN_MANAGED_ROUTINE_GUIDANCE, PLUGIN_MANAGED_ROUTINE_OPERATOR_GUIDANCE);
      }
    }
  }
  if (hidden.has("instance.experimental")) {
    const experimental = document.paths?.["/api/instance/settings/experimental"];
    for (const operation of [experimental?.get, experimental?.patch]) {
      if (typeof operation?.description === "string") {
        operation.description = operation.description.replace(EXPERIMENTAL_SETTINGS_PAGE, EXPERIMENTAL_SETTINGS_OPERATOR_GUIDANCE);
      }
    }
  }
  return document;
}

registry.registerPath({
  method: "get",
  path: "/api/routines/{id}",
  tags: ["routines"],
  summary: "Get a routine",
  description: `Routine details including triggers. ${PLUGIN_MANAGED_ROUTINE_GUIDANCE}`,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/routines/{id}",
  tags: ["routines"],
  summary: "Update a routine",
  description: `Agents can update only routines assigned to them and cannot reassign them. ${PLUGIN_MANAGED_ROUTINE_GUIDANCE}`,
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateRoutineSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/routines/{id}/runs",
  tags: ["routines"],
  summary: "List runs for a routine",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/routines/{id}/run",
  tags: ["routines"],
  summary: "Manually run a routine",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(runRoutineSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/routines/{id}/triggers",
  tags: ["routines"],
  summary: "Create a routine trigger",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createRoutineTriggerSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/routine-triggers/{id}",
  tags: ["routines"],
  summary: "Update a routine trigger",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateRoutineTriggerSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/routine-triggers/{id}",
  tags: ["routines"],
  summary: "Delete a routine trigger",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/routine-triggers/{id}/rotate-secret",
  tags: ["routines"],
  summary: "Rotate a routine trigger secret",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(rotateRoutineTriggerSecretSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/routine-triggers/public/{publicId}/fire",
  tags: ["routines"],
  summary: "Fire a public routine trigger",
  request: {
    params: z.object({ publicId: z.string() }),
    headers: z.object({
      "X-Outpost-Source-Run-Token": z.string().optional().describe("Optional current Outpost run JWT. It establishes creation provenance only; the trigger still requires its own authentication."),
      "X-Outpost-Idempotency-Scope": z.enum(["trigger", "routine"]).optional().describe("Scope of a stable Idempotency-Key. Default: trigger. Timestamped HMAC always uses trigger scope."),
      "Idempotency-Key": z.string().optional().describe("Stable sender event identity, reused on retries."),
    }),
    body: jsonBody(z.record(z.string(), z.unknown())),
  },
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 404: r.notFound,
    409: r.conflict, 415: { ...r.badRequest, description: "Unsupported media type" }, 422: r.unprocessable },
});

// ─── Goals ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/goals",
  tags: ["goals"],
  summary: "List north stars in a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/goals",
  tags: ["goals"],
  summary: "Create a north star",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createGoalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/goals/{id}",
  tags: ["goals"],
  summary: "Get a north star",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/goals/{id}",
  tags: ["goals"],
  summary: "Update a north star",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateGoalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/goals/{id}",
  tags: ["goals"],
  summary: "Delete a north star",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Secrets ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/secret-providers",
  tags: ["secrets"],
  summary: "List secret providers",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/secrets/catalog",
  tags: ["secrets"],
  summary:
    "List secret metadata (id, name, key, status) — accessible to agents",
  description: "Discover stored space credential metadata, never values. To add a space credential, direct the human to the space-prefixed /space/settings/secrets page and New secret, then bind only the intended agent's environment reference in its configuration. Secure storage of an already-requested key does not require connecting a new external service. Never request the value in chat or claim it is saved or bound before observing the authorized changes.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/secrets",
  tags: ["secrets"],
  summary: "List secrets in a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/secrets",
  tags: ["secrets"],
  summary: "Create a space secret credential",
  description: "Operator-only secure credential entry. An agent cannot create the value on behalf of the human. Direct the human to New secret on the space-prefixed /space/settings/secrets page; never request the value in chat. After entry, use only the intended consumer's secret reference, not plaintext or a grant to every agent. A saved credential is not proof of runtime delivery.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createSecretSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/secret-proposals",
  tags: ["secrets"],
  summary: "List space secret proposals for operator review",
  request: {
    params: z.object({ spaceId: z.string().guid() }),
    query: z.object({
      status: z
        .enum(["pending", "approved", "rejected", "withdrawn", "expired"])
        .optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/secret-proposals/{id}/approve",
  tags: ["secrets"],
  summary: "Approve and execute a secret proposal as the approving operator user",
  request: {
    params: z.object({ spaceId: z.string().guid(), id: z.string().guid() }),
    body: jsonBody(approveSecretProposalSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/secret-proposals/{id}/reject",
  tags: ["secrets"],
  summary: "Reject a pending secret proposal and dependent bindings",
  request: {
    params: z.object({ spaceId: z.string().guid(), id: z.string().guid() }),
    body: jsonBody(rejectSecretProposalSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/secrets/{id}",
  tags: ["secrets"],
  summary: "Update a secret",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateSecretSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/secrets/{id}/rotate",
  tags: ["secrets"],
  summary: "Rotate a secret",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(rotateSecretSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/secrets/{id}",
  tags: ["secrets"],
  summary: "Delete a secret",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/user-secret-definitions",
  tags: ["secrets"],
  summary: "List personal credential definitions (user secrets)",
  description: "Operator-only space-admin metadata for personal credential definitions, not their values. Agents cannot read this list using the human's identity. For an existing required personal credential, direct the current person to the space-prefixed /space/settings/secrets page, My secrets, then Set my value for the matching definition. Outpost admins can also open definition details with ?definition=<definitionId> when its ID is already known; other members use My secrets and Set my value. Only that signed-in person's value is set; another person's value cannot satisfy it. Never request values in chat. Storing a credential for an existing definition does not require choosing or connecting a new external provider.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/user-secret-definitions",
  tags: ["secrets"],
  summary: "Create a user secret definition",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createUserSecretDefinitionSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/user-secret-definitions/{definitionId}",
  tags: ["secrets"],
  summary: "Update a user secret definition",
  request: {
    params: z.object({ spaceId: z.string(), definitionId: z.string() }),
    body: jsonBody(updateUserSecretDefinitionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/user-secret-definitions/{definitionId}",
  tags: ["secrets"],
  summary: "Delete a user secret definition",
  request: {
    params: z.object({ spaceId: z.string(), definitionId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/user-secret-definitions/{definitionId}/coverage",
  tags: ["secrets"],
  summary: "Get user secret definition coverage",
  request: {
    params: z.object({ spaceId: z.string(), definitionId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/me/user-secrets",
  tags: ["secrets"],
  summary: "List my personal credential definitions and value metadata",
  description: "Operator-only current-person metadata. An agent cannot impersonate the person or list another owner's values. The signed-in person uses My secrets on the space-prefixed /space/settings/secrets page and Set my value for an existing definition; never send the value in chat. This secure entry is separate from connecting an external service. Confirm availability only after authorized entry and the intended task's required delivery have been observed.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/me/user-secrets",
  tags: ["secrets"],
  summary: "Create my user secret value",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createUserSecretValueSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/me/user-secrets/{secretId}",
  tags: ["secrets"],
  summary: "Update my user secret value",
  request: {
    params: z.object({ spaceId: z.string(), secretId: z.string() }),
    body: jsonBody(updateUserSecretValueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/me/user-secrets/{secretId}/rotate",
  tags: ["secrets"],
  summary: "Rotate my user secret value",
  request: {
    params: z.object({ spaceId: z.string(), secretId: z.string() }),
    body: jsonBody(rotateUserSecretValueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/me/user-secrets/{secretId}",
  tags: ["secrets"],
  summary: "Delete my user secret value",
  request: {
    params: z.object({ spaceId: z.string(), secretId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Approvals ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/approvals",
  tags: ["approvals"],
  summary: "List approvals in a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/approvals",
  tags: ["approvals"],
  summary: "Create an approval",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/approvals/{id}",
  tags: ["approvals"],
  summary: "Get an approval",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/approvals/{id}/issues",
  tags: ["approvals"],
  summary: "List issues linked to an approval",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/approve",
  tags: ["approvals"],
  summary: "Approve an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resolveApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/reject",
  tags: ["approvals"],
  summary: "Reject an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resolveApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/request-revision",
  tags: ["approvals"],
  summary: "Request revision on an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(requestApprovalRevisionSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/resubmit",
  tags: ["approvals"],
  summary: "Revise and resubmit a changes-requested approval",
  description:
    "Replace the payload of an approval whose status is revision_requested, or resubmit its existing payload. " +
    "Use this operation to revise a changes-requested create proposal, such as changing its agent configuration to a cheaper model, and send it back for operator review. " +
    "An agent must be the original requesting agent; operator callers still need access to the space and approval. " +
    "The approval returns to pending. This operation does not approve the request or create or execute the create.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resubmitApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/approvals/{id}/comments",
  tags: ["approvals"],
  summary: "List approval comments",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/comments",
  tags: ["approvals"],
  summary: "Add a comment to an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(addApprovalCommentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Agent feedback ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/agent-commentary",
  tags: ["agents"],
  summary: "Browse agent suggestions and complaints",
  description: "Operator members need space membership and commentary:view, granted by default to all human space roles. An agent may list only its own commentary (agentId set to itself) unless it holds commentary:view, which is never a default agent grant; otherwise it gets 403 with a remediation naming the Commentary page. Source-task privacy filters both previews and counts. Returns items, total, limit and offset; previews contain at most 280 characters and omit full bodies.",
  request: { params: z.object({ spaceId: z.string() }), query: agentCommentaryQuerySchema },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/agent-commentary/{id}",
  tags: ["agents"],
  summary: "Read a full agent commentary message",
  description: "Same permission and task-privacy gates as the list. An agent may read its own entry, or any entry with commentary:view; another agent's entry returns 403 with a remediation. Returns the full body with agent, task and run context. Foreign-space and invisible entries return 404.",
  request: { params: z.object({ spaceId: z.string(), id: z.string().uuid() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post", path: "/api/agents/me/chat/messages", tags: ["agents"],
  summary: "Send a task message to the agent's own chat",
  description: "Requires the assigned agent's active standard task run, standard credentials and an active responsible human. Resolves or creates that agent's conversation automatically. Outpost visibility, task permissions, Stop and the shared cross-issue run cap apply. Equivalent retries do not spend another slot. Does not wake the chat agent or change task status.",
  request: { body: jsonBody(sendChatMessageSchema) },
  responses: { 200: r.ok(), 201: { ...r.ok(), description: "Message saved" }, 400: r.badRequest,
    401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 429: r.tooManyRequests },
});

const agentCommentaryAcknowledgementSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["complaint", "suggestion"]),
  createdAt: z.string().datetime(),
  replayed: z.boolean(),
}).strict();

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/agent-commentary",
  tags: ["agents"],
  summary: "Submit internally attributed agent feedback",
  description: "Requires an active legacy agent run: a run-bound agent JWT, or an agent API key with X-Outpost-Run-Id. Attribution is derived from authority; ownership fields are rejected. Equivalent replay returns the existing acknowledgement. Native runs use their bound feedback tools. Failure must not interrupt the primary task or trigger retries.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(submitAgentCommentarySchema),
  },
  responses: {
    200: r.ok(agentCommentaryAcknowledgementSchema),
    201: { ...r.ok(agentCommentaryAcknowledgementSchema), description: "Feedback stored" },
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 409: r.conflict,
    503: { description: "Feedback storage unavailable; continue the primary task without retrying" },
  },
});

// ─── Costs ───────────────────────────────────────────────────────────────────

const costReportQuerySchema = z.object({
  period: z.enum(["month", "all"]).optional().describe("Defaults to the current UTC month. All-time cannot be combined with date bounds."),
  from: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional().describe("Inclusive start bound."),
  to: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional().describe("Inclusive end bound; must not precede from."),
});

const costSummaryPaths = [
  "summary",
  "by-agent",
  "by-user",
  "by-agent-model",
  "by-provider",
  "by-biller",
  "by-project",
  "finance-summary",
  "finance-by-biller",
  "finance-by-kind",
  "finance-events",
  "window-spend",
  "quota-windows",
  "subscriptions",
  "data-quality",
] as const;

/** Reports whose rows count usage that has no known price. */
const UNPRICED_COUNT_COST_REPORTS = new Set<string>(["summary", "by-agent", "by-user", "by-agent-model", "by-provider", "by-biller", "by-project"]);
export const UNPRICED_COST_REPORT_DESCRIPTION = "costCents counts priced usage only. A row whose unpricedEventCount is above 0 includes usage with no known price, so its real cost is unknown, not zero: report that usage as unpriced and its total as incomplete, never as $0.00. To find that usage, list the agent's runs with GET /api/spaces/{spaceId}/heartbeat-runs?agentId=<agentId>: a run whose usageJson.costStatus is \"unpriced\" is one, and its usageJson.ledgerScope.issueId names its task. Link each run you cite at /<prefix>/agents/<agentId>/runs/<runId>, or its task.";

for (const segment of costSummaryPaths) {
  registry.registerPath({
    method: "get",
    path: `/api/spaces/{spaceId}/costs/${segment}`,
    tags: ["costs"],
    summary: `Cost report: ${segment}`,
    ...(UNPRICED_COUNT_COST_REPORTS.has(segment) ? { description: UNPRICED_COST_REPORT_DESCRIPTION } : {}),
    request: {
      params: z.object({ spaceId: z.string() }),
      ...(!["window-spend", "quota-windows"].includes(segment) ? {
        query: segment === "finance-events" ? costReportQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(500).optional() }) : costReportQuerySchema,
      } : {}),
    },
    responses: { 200: r.ok(), 401: r.unauthorized },
  });
}

registry.registerPath({ method: "post", path: "/api/spaces/{spaceId}/costs/retry-accounting", tags: ["costs"],
  summary: "Retry recording a run's saved cost data",
  description: "Requires space cost-read and operator write access. Viewers and agents cannot retry. Replays accounting evidence only; never starts provider work or invents missing usage. An operator user retries with Retry cost recording on the run's row on the [Costs page](/<prefix>/activity/costs).",
  request: { params: z.object({ spaceId: z.string() }), body: jsonBody(retryAccountingSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({ method: "post", path: "/api/spaces/{spaceId}/costs/subscriptions/refresh", tags: ["costs"],
  summary: "Refresh connected subscription estimates in the background",
  description: "Operator members only. Probes only credentials the caller can use. Successful observations are cached for six hours; provider failures retain prior estimates. No inference requests, invoices, or budget charges are created.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 202: { description: "Background refresh accepted" }, 401: r.unauthorized, 403: r.forbidden,
    429: { description: "Discovery capacity is full; retry the request later" } },
});
registry.registerPath({ method: "patch", path: "/api/spaces/{spaceId}/costs/subscriptions/{subscriptionId}", tags: ["costs"],
  summary: "Set a subscription price or end tracking",
  description: "Owner only for personal subscriptions; connection managers for shared subscriptions. Appends price history from now. Expected revision prevents lost updates. Ending tracking does not cancel provider billing. Monthly estimates never change recorded charges or agent budgets.",
  request: { params: z.object({ spaceId: z.string(), subscriptionId: z.string().uuid() }), body: jsonBody(subscriptionPriceSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registry.registerPath({ method: "post", path: "/api/spaces/{spaceId}/costs/subscriptions/{subscriptionId}/link", tags: ["costs"],
  summary: "Link duplicate subscription accounts",
  description: "Requires editing permission on both accounts in this space. Combines their usage, counts the fee once, and keeps the target price. Historical run IDs and price history are preserved.",
  request: { params: z.object({ spaceId: z.string(), subscriptionId: z.string().uuid() }), body: jsonBody(mergeSubscriptionsSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/cost-events",
  tags: ["costs"],
  summary: "Record a cost event",
  description: "Amounts are USD cents, including fractional cents. Decimal strings preserve exact nanodollar precision. Reuse the idempotency key and original receipt on retries; conflicting reuse returns 409.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createCostEventSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 409: r.conflict },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/finance-events",
  tags: ["costs"],
  summary: "Record a finance event",
  description: "Amounts accept exact decimal cents in the recorded currency. Credits use a nonnegative amount with direction credit. No currency conversion is inferred. Receipt-key conflicts return 409.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createFinanceEventSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 409: r.conflict },
});

for (const [suffix, summary] of [
  ["health", "Inspect pending receipts, unpriced charges, cancellation backlog, and held reservations"],
  ["inspect", "Independently compare ledger evidence and stored totals"],
  ["invoices", "List imported provider invoices"],
  ["invoices/{invoiceId}", "Review exact invoice matches and unresolved differences"],
  ["events/{eventId}/adjustments", "Read append-only correction history and prior pricing evidence"],
] as const) {
  registry.registerPath({
    method: "get", path: `/api/spaces/{spaceId}/accounting/${suffix}`, tags: ["costs"], summary,
    description: "Outpost-scoped operator access is required. Operator viewers may inspect; agents cannot access operator accounting evidence.",
    request: { params: z.object({ spaceId: z.string(),
      ...(suffix.includes("invoiceId") ? { invoiceId: z.string() } : {}),
      ...(suffix.includes("eventId") ? { eventId: z.string() } : {}),
    }) },
    responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
  });
}

for (const operation of [
  { suffix: "repair", schema: repairAccountingSchema, status: 200, summary: "Repair reviewed ledger projections", description: "Requires an audit reason and the current inspection fingerprint. A stale inspection returns 409. Missing evidence is never invented." },
  { suffix: "retry", schema: retryAccountingSchema, status: 200, summary: "Retry accounting for a space-owned run", description: "Retries accounting only. Provider work is never re-executed; incomplete evidence remains pending." },
  { suffix: "provider-costs/import", schema: importProviderCostsSchema, status: 200, summary: "Import a scoped provider cost report", description: "Reads up to 31 completed UTC days from OpenAI or Anthropic with a space admin credential. Requires explicit provider account and project/workspace identifiers. All pages validate before writing. Reimports append only the difference; run costs are not repriced. Report totals remain separate from invoices." },
  { suffix: "invoices", schema: importBillingInvoiceSchema, status: 201, summary: "Import normalized invoice evidence", description: "Idempotent by space, biller, and external invoice ID. Conflicting reuse returns 409. Import atomically creates finance timeline events and does not reprice run costs." },
  { suffix: "events/{eventId}/adjustments", schema: adjustCostSchema, status: 201, summary: "Apply a reviewed cost correction", description: "Requires the expected exact cents, an idempotency key, reason, and pricing evidence. Original amounts and pricing revisions remain in history. Stale reviews return 409; ambiguous or contradictory invoice evidence returns 422." },
] as const) {
  registry.registerPath({
    method: "post", path: `/api/spaces/{spaceId}/accounting/${operation.suffix}`, tags: ["costs"],
    summary: operation.summary, description: `${operation.description} Outpost-scoped operator write access is required; viewers and agents cannot mutate accounting.`,
    request: { params: z.object({ spaceId: z.string(), ...(operation.suffix.includes("eventId") ? { eventId: z.string() } : {}) }), body: jsonBody(operation.schema) },
    responses: { [operation.status]: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
  });
}

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/budgets/policies",
  tags: ["costs"],
  summary: "Create or update a budget policy",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(upsertBudgetPolicySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/budget-incidents/{incidentId}/resolve",
  tags: ["costs"],
  summary: "Resolve a budget incident",
  description: "Operator only: agent credentials get 403, so an agent cannot raise a limit or resume a budget-stopped agent. An operator user chooses the new amount and resumes on the Budgets page: link [Open budgets](/<prefix>/activity/budgets) with this conversation's space prefix as <prefix>, and reply.",
  request: {
    params: z.object({ spaceId: z.string(), incidentId: z.string() }),
    body: jsonBody(resolveBudgetIncidentSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/budgets/overview",
  tags: ["costs"],
  summary: "Get budget overview",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/budgets",
  tags: ["costs"],
  summary: "Update space budget",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(updateBudgetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{agentId}/budgets",
  tags: ["costs"],
  summary: "Update agent budget",
  description: "Operator only: agent credentials get 403. An operator user changes the limit on the agent's budget tab: link [Open budget](/<prefix>/agents/<agentId>/budgets) with this conversation's space prefix as <prefix>, and reply.",
  request: {
    params: z.object({ agentId: z.string() }),
    body: jsonBody(updateBudgetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Activity ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/activity",
  tags: ["activity"],
  summary: "List space activity",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/audit/agent-actions",
  tags: ["activity"],
  summary: "List agent action audit entries",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      agentId: z.string().guid().optional(),
      responsibleUserId: z.string().min(1).optional(),
      runId: z.string().guid().optional(),
      entityType: z.string().min(1).optional(),
      entityId: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      actorType: z.enum(["agent", "user", "system", "plugin"]).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/audit/agent-actions.csv",
  tags: ["activity"],
  summary: "Export agent action audit entries as CSV",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      agentId: z.string().guid().optional(),
      responsibleUserId: z.string().min(1).optional(),
      runId: z.string().guid().optional(),
      entityType: z.string().min(1).optional(),
      entityId: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      actorType: z.enum(["agent", "user", "system", "plugin"]).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "Agent action audit export",
      content: { "text/csv": { schema: z.string() } },
    },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/activity",
  tags: ["activity"],
  summary: "Create an activity entry",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(
      z.object({
        actorType: z.enum(["agent", "user", "system", "plugin"]).optional(),
        actorId: z.string().min(1),
        action: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        agentId: z.string().guid().optional().nullable(),
        details: z.record(z.string(), z.unknown()).optional().nullable(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/activity",
  tags: ["activity"],
  summary: "List activity for an issue",
  request: { params: z.object({ id: z.string() }), query: z.object({
    view: z.enum(["recent", "comment-inputs"]).optional().describe("Recent activity (at most 50 rows), or original comment/steering facts for selected comments."),
    commentIds: z.string().optional().describe("For comment-inputs: up to 100 comma-separated comment UUIDs. Returns at most two original facts per comment."),
  }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/runs",
  tags: ["activity"],
  summary: "List runs for an issue",
  request: { params: z.object({ id: z.string() }), query: z.object({ view: z.literal("recent").optional().describe("At most two recent run summaries."), runIds: z.string().optional().describe("Comma-separated list of 1 to 100 run UUIDs. Returns only those runs linked to this accessible issue.") }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/context-usage",
  tags: ["activity"],
  summary: "Latest context-window usage for an issue's agent session",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/context/compact",
  tags: ["issues"],
  summary: "Ask the assignee agent to compact its context window",
  description: "Operator only. Queues a short run that resumes the assignee's runner session and compacts it (Codex and Claude on the Outpost runner). Unavailable while the agent is running on the task.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 202: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/issues",
  tags: ["activity"],
  summary: "List issues for a heartbeat run",
  request: { params: z.object({ runId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/dashboard",
  tags: ["dashboard"],
  summary: "Get dashboard data",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/recovery-observability",
  tags: ["dashboard"],
  summary: "Get recovery observability report",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      weeks: z.string().optional(),
      threshold: z.string().optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Sidebar ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/sidebar-badges",
  tags: ["sidebar"],
  summary: "Get sidebar badge counts",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/attention",
  tags: ["inbox"],
  summary: "List decision-only attention feed items",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      includeDismissed: z.enum(["true", "false"]).optional(),
      archived: z.enum(["true", "false"]).optional(),
      all: z.enum(["true", "false"]).optional(),
      activitySince: z.string().datetime().optional(),
      activityUntil: z.string().datetime().optional(),
      queue: z.string().min(1).optional(),
      sort: z.enum(["activity", "decide"]).optional(),
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

const attentionSummaryResponseSchema = z.object({
  spaceId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  totalCount: z.number().int().nonnegative(),
  deskBadgeCount: z.number().int().nonnegative(),
  countsBySourceKind: z.record(z.enum(ATTENTION_SOURCE_KINDS), z.number().int().nonnegative()),
}).strict();

for (const [projection, responseSchema] of [
  ["summary", attentionSummaryResponseSchema],
  ["tasks", attentionSummaryResponseSchema.extend({ taskIds: z.array(z.string().uuid()) })],
] as const) {
  registry.registerPath({
    method: "get",
    path: `/api/spaces/{spaceId}/attention/${projection}`,
    tags: ["inbox"],
    summary: projection === "summary" ? "Get canonical attention counts" : "Get complete attention task membership",
    description: "Requires an operator user with space access. Reads the complete canonical attention set with current task privacy, addressee, dismissal, snooze, and archive rules. Returns counts without decision cards, images, plan bodies, or pagination. The tasks projection also returns distinct accessible task IDs. This read grants no resolution authority.",
    request: { params: z.object({ spaceId: z.string() }) },
    responses: { 200: r.ok(responseSchema), 401: r.unauthorized, 403: r.forbidden },
  });
}

// ─── Decisions ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/attention/history",
  tags: ["inbox"],
  summary: "List recorded decisions visible to the current operator user",
  description:
    "Requires an operator user with space access. Returns a DecisionHistoryPage with current task and decision audience access enforced. Only the declared filters are accepted. The default page size is 40, sorted newest first.",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      cursor: z.string().max(1000).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      search: z.string().trim().max(200).optional(),
      outcome: z.string().max(40).optional(),
      agentId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      sort: z.enum(["newest", "oldest"]).optional(),
      since: z.string().datetime().optional(),
    }).strict(),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

// Decision queues and triage

const decisionQueueSeedRuleSchema = z
  .object({
    key: z.string(),
    description: z.string(),
    signal: z.enum([
      "issue_has_pull_request_work_product",
      "plan_document_confirmation",
      "ask_user_questions",
    ]),
  })
  .strict();

const decisionQueueSchema = z
  .object({
    id: z.string(),
    spaceId: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    createdByType: z.enum(["agent", "user", "system"]),
    createdByAgentId: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    createdByRunId: z.string().nullable(),
    retentionDays: z.number().int().nullable(),
    seedRules: z.array(decisionQueueSeedRuleSchema),
    seedRulesEnabled: z.boolean(),
    itemCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const decisionQueueItemSchema = z
  .object({
    id: z.string(),
    spaceId: z.string(),
    queueId: z.string(),
    sourceKind: decisionAttentionSourceKindSchema,
    sourceId: z.string(),
    addedByType: z.enum(["agent", "user", "system"]),
    addedByAgentId: z.string().nullable(),
    addedByUserId: z.string().nullable(),
    addedByRunId: z.string().nullable(),
    responsibleUserId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

const decisionTriageSchema = z
  .object({
    id: z.string(),
    spaceId: z.string(),
    sourceKind: decisionAttentionSourceKindSchema,
    sourceId: z.string(),
    decideBy: z.string().nullable(),
    snoozedUntil: z.string().datetime().nullable(),
    setByType: z.enum(["agent", "user"]),
    setByAgentId: z.string().nullable(),
    setByUserId: z.string().nullable(),
    setByRunId: z.string().nullable(),
    responsibleUserId: z.string().nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const decisionRetentionSchema = z
  .object({
    id: z.string(),
    spaceId: z.string(),
    sourceKind: decisionAttentionSourceKindSchema,
    sourceId: z.string(),
    sourceActivityAt: z.string().datetime(),
    keep: z.boolean(),
    archivedAt: z.string().datetime().nullable(),
    archivedReason: z.string().nullable(),
    archivedByType: z.enum(["agent", "user", "system"]).nullable(),
    archivedByAgentId: z.string().nullable(),
    archivedByUserId: z.string().nullable(),
    archivedByRunId: z.string().nullable(),
    version: z.number().int().positive(),
    archiveVersion: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decision-queue-seed-rules",
  tags: ["decision-queues"],
  summary: "List built-in decision queue seed rules",
  responses: {
    200: r.ok(z.array(decisionQueueSeedRuleSchema)),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decision-queues",
  tags: ["decision-queues"],
  summary: "List decision queues",
  responses: {
    200: r.ok(z.array(decisionQueueSchema)),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/decision-queues",
  tags: ["decision-queues"],
  summary: "Create a decision queue",
  body: createDecisionQueueSchema,
  responses: {
    200: r.ok(decisionQueueSchema),
    201: r.ok(decisionQueueSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/spaces/{spaceId}/decision-queues/{key}",
  tags: ["decision-queues"],
  summary: "Update a decision queue",
  body: updateDecisionQueueSchema,
  responses: {
    200: r.ok(decisionQueueSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decision-queues/{key}/items",
  tags: ["decision-queues"],
  summary: "List visible items in a decision queue",
  responses: {
    200: r.ok(z.array(decisionQueueItemSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/decision-queues/{key}/items",
  tags: ["decision-queues"],
  summary: "Add an item to a decision queue",
  body: addDecisionQueueItemSchema,
  responses: {
    200: r.ok(decisionQueueItemSchema),
    201: r.ok(decisionQueueItemSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/spaces/{spaceId}/decision-queues/{key}/items/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Remove an item from a decision queue",
  body: removeDecisionQueueItemSchema,
  responses: {
    200: r.ok(decisionQueueItemSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decision-triage/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Get decision triage for an attention source",
  responses: {
    200: r.ok(decisionTriageSchema.nullable()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "put",
  path: "/api/spaces/{spaceId}/decision-triage/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Set decision triage for an attention source",
  body: updateDecisionTriageSchema,
  responses: {
    200: r.ok(decisionTriageSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/spaces/{spaceId}/decision-retention/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Set Keep for an attention source",
  body: updateDecisionRetentionSchema,
  responses: {
    200: r.ok(decisionRetentionSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

for (const action of ["archive", "revive"] as const) {
  registerCurrentRoute({
    method: "post",
    path: `/api/spaces/{spaceId}/decision-retention/{sourceKind}/{sourceId}/${action}`,
    tags: ["decision-queues"],
    summary:
      action === "archive"
        ? "Archive an attention source"
        : "Revive an archived attention source",
    responses: {
      200: r.ok(decisionRetentionSchema),
      400: r.badRequest,
      401: r.unauthorized,
      403: r.forbidden,
      404: r.notFound,
    },
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/decision-archive-proposals",
  tags: ["decisions"],
  summary: "Propose one signed bulk archive decision",
  body: createDecisionArchiveProposalSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

// Decisions

const createDecisionBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    body: z.string().max(100_000),
    ruleKey: z.string().trim().max(240).nullable().optional(),
    options: decisionOptionsSchema,
    inputs: decisionInputsSchema.nullable().optional(),
    expiresAt: z.string().datetime().optional(),
    idempotencyKey: z.string().trim().min(1).max(500).nullable().optional(),
    continuationPolicy: z.enum(["none", "wake_origin_agent"]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/decisions",
  tags: ["decisions"],
  summary: "Propose a decision",
  body: createDecisionBodySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/decision-bundles",
  tags: ["decisions"],
  summary: "Propose a decision bundle",
  body: z
    .object({
      title: z.string().trim().min(1).max(500),
      summary: z.string().max(100_000),
      decisions: z.array(createDecisionBodySchema).min(1).max(50),
    })
    .strict(),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decisions",
  tags: ["decisions"],
  summary: "List decisions",
  query: z.object({
    status: z.enum(["open", "decided", "expired", "cancelled"]).optional(),
    bundleId: z.string().guid().optional(),
    targetIssueId: z.string().guid().optional(),
    originAgentId: z.string().guid().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decisions/stats",
  tags: ["decisions"],
  summary: "Get decision telemetry grouped by rule key",
  query: z.object({
    groupBy: z.literal("ruleKey"),
    originAgentId: z.string().guid().optional(),
    since: z.string().datetime().optional(),
  }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/decisions/{id}",
  tags: ["decisions"],
  summary: "Get a decision outcome",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/decisions/{id}/decide",
  tags: ["decisions"],
  summary: "Resolve a decision",
  body: z
    .object({
      optionId: z.string().trim().min(1).max(120),
      inputValues: z.record(z.string(), z.string().max(20_000)).optional(),
      idempotencyKey: z.string().trim().min(1).max(500).nullable().optional(),
    })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/decisions/{id}/dismiss",
  tags: ["decisions"],
  summary: "Dismiss a decision",
  body: z
    .object({ reason: z.string().max(20_000).nullable().optional() })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/decisions/{id}/cancel",
  tags: ["decisions"],
  summary: "Cancel a decision",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

// ─── Decision training ──────────────────────────────────────────────────────

const decisionTrainingSourceKindSchema = z.enum([
  "interaction",
  "approval",
  "execution_decision",
]);

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/decision-training",
  tags: ["decision-training"],
  summary: "Capture a decision training example",
  body: z
    .object({
      sourceKind: decisionTrainingSourceKindSchema,
      sourceId: z.string().guid(),
      issueId: z.string().guid(),
      notes: z.string().max(100_000).default(""),
    })
    .strict(),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/decision-training/preview",
  tags: ["decision-training"],
  summary: "Preview a decision training snapshot",
  body: z
    .object({
      sourceKind: decisionTrainingSourceKindSchema,
      sourceId: z.string().guid(),
      issueId: z.string().guid(),
    })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decision-training",
  tags: ["decision-training"],
  summary: "List decision training examples",
  query: z.object({
    project: z.string().guid().optional(),
    kind: decisionTrainingSourceKindSchema.optional(),
    author: z.string().optional(),
    q: z.string().max(500).optional(),
  }),
});

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/decision-training/export.jsonl",
  tags: ["decision-training"],
  summary: "Export decision training examples as JSONL",
});

registerCurrentRoute({
  method: "get",
  path: "/api/decision-training/{id}",
  tags: ["decision-training"],
  summary: "Get a decision training example",
});

registerCurrentRoute({
  method: "patch",
  path: "/api/decision-training/{id}",
  tags: ["decision-training"],
  summary: "Update decision training notes",
  body: z.object({ notes: z.string().max(100_000) }).strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/decision-training/{id}",
  tags: ["decision-training"],
  summary: "Delete a decision training example",
  responses: {
    204: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/workspace-preferences/me",
  tags: ["workspace-preferences"],
  summary: "Get the current human's personal workspace preference (off by default)",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "put",
  path: "/api/spaces/{spaceId}/workspace-preferences/me",
  tags: ["workspace-preferences"],
  summary: "Update your personal workspace or time zone; active space membership provides audit context",
  body: updateWorkspacePreferenceSchema,
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Get current user sidebar preferences",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "put",
  path: "/api/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Update current user sidebar preferences",
  request: { body: jsonBody(upsertSidebarOrderPreferenceSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Get sidebar preferences for space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "put",
  path: "/api/spaces/{spaceId}/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Update sidebar preferences for space",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(upsertSidebarOrderPreferenceSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

const defaultAgentPreferenceResponse = z.object({
  spaceId: z.string().uuid(),
  userId: z.string(),
  defaultAgentId: z.string().uuid().nullable(),
  initialized: z.boolean(),
});

for (const method of ["get", "put"] as const) {
  registry.registerPath({
    method,
    path: "/api/spaces/{spaceId}/default-agent/me",
    tags: ["agents"],
    summary: method === "get" ? "Get the default agent" : "Set the default agent",
    description: "Uses the Space-wide default agent while retaining the legacy /me path and defaultAgentId field for client compatibility. Active Space members may read it; changing it requires agents:configure authority for the chosen agent. Agent credentials cannot access this operator route. In the human UI, open the chosen agent's profile and select Set as default agent. Confirm the replacement when a default is already set. The default receives new tasks when no assignee is selected and is the initial Chat fallback; it does not gain rank or permissions. The selected agent must be visible, approved, and non-terminated.",
    request: {
      params: z.object({ spaceId: z.string().uuid() }),
      ...(method === "put" ? { body: jsonBody(updateDefaultAgentSchema) } : {}),
    },
    responses: {
      200: r.ok(defaultAgentPreferenceResponse),
      400: r.badRequest,
      401: r.unauthorized,
      403: r.forbidden,
      404: r.notFound,
      ...(method === "put" ? { 422: r.unprocessable } : {}),
    },
  });
}

// ─── Announcements ───────────────────────────────────────────────────────────

const announcementResponseHeaders = {
  "Cache-Control": { schema: { type: "string", enum: ["private, no-store"] } },
};

registry.registerPath({
  method: "get",
  path: "/api/announcements/current",
  tags: ["announcements"],
  summary: "Get the current user's eligible announcement",
  description: "Returns null for dismissed, disabled, unavailable, expired or incompatible content. Dismissals follow the operator user across spaces within this instance; no-login installations use local-operator.",
  responses: {
    200: { ...r.ok(announcementSchema.nullable()), headers: announcementResponseHeaders },
    401: r.unauthorized,
    403: r.forbidden,
    500: r.serverError,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/announcements/{id}/image",
  tags: ["announcements"],
  summary: "Get the current announcement's validated image",
  description: "Proxies only the content-addressed raster asset in the eligible manifest. Arbitrary URLs and asset paths are not accepted.",
  request: { params: z.object({ id: announcementIdSchema }) },
  responses: {
    200: {
      description: "Validated announcement image",
      headers: announcementResponseHeaders,
      content: {
        "image/png": { schema: { type: "string", format: "binary" } },
        "image/jpeg": { schema: { type: "string", format: "binary" } },
        "image/webp": { schema: { type: "string", format: "binary" } },
      },
    },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/announcements/{id}/animation",
  tags: ["announcements"],
  summary: "Get the current announcement's isolated HTML/CSS animation",
  description: "Operator-only, validated content-addressed HTML. Scripts, links, forms and embedded resources are rejected; CSP sandbox and resource restrictions also apply to direct visits. Missing or invalid assets return 404 and the card uses its static image.",
  request: { params: z.object({ id: announcementIdSchema }) },
  responses: {
    200: {
      description: "Validated visual HTML/CSS document",
      headers: { ...announcementResponseHeaders, "Content-Security-Policy": { schema: { type: "string" } } },
      content: { "text/html": { schema: { type: "string" } } },
    },
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/announcements/{id}/dismiss",
  tags: ["announcements"],
  summary: "Dismiss an announcement for the current user",
  description: "Idempotently saves a personal preference. The supplied space is validated audit context; viewers may dismiss their own announcement. The first dismissal and its audit entry commit together. IDs from a previously validated feed remain valid for offline retries; unknown IDs return 404 without creating records.",
  request: {
    params: z.object({ id: announcementIdSchema }),
    body: jsonBody(dismissAnnouncementSchema),
  },
  responses: {
    204: { ...r.noContent, headers: announcementResponseHeaders },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    500: r.serverError,
  },
});

// ─── Inbox dismissals ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/inbox-dismissals",
  tags: ["inbox"],
  summary: "List inbox dismissals",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/inbox-dismissals",
  tags: ["inbox"],
  summary: "Create an inbox dismissal or snooze",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(
      z.object({
        itemKey: z
          .string()
          .trim()
          .min(1)
          .regex(
            /^(approval|join|run|attention):.+$/,
            "Unsupported inbox item key",
          ),
        kind: z.enum(["dismiss", "snooze"]).optional(),
        snoozedUntil: z.string().datetime().optional(),
      }),
    ),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/inbox-dismissals/{itemKey}",
  tags: ["inbox"],
  summary: "Restore an inbox dismissal or snooze",
  request: { params: z.object({ spaceId: z.string(), itemKey: z.string() }) },
  responses: { 204: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Instance settings ────────────────────────────────────────────────────────

// Agents cannot read or write experimental settings; the person turns a feature on in the UI.
const EXPERIMENTAL_SETTINGS_PAGE = "Instance experimental features (for example Cases via enableCases) are turned on or off by an instance admin in "
  + "Experimental settings at /<prefix>/space/settings/instance/experimental. Agent credentials cannot read or change these settings, "
  + "so do not claim a change: link that page as [Experimental settings](/<prefix>/space/settings/instance/experimental), name the feature's setting, and reply.";
// When the hosting operator hides the Experimental page, it redirects away, so name the operator instead.
const EXPERIMENTAL_SETTINGS_OPERATOR_GUIDANCE = "Instance experimental features (for example Cases via enableCases) are controlled by the hosting operator on this instance, "
  + "so no Outpost page offers that change. Agent credentials cannot read or change these settings, "
  + "so do not claim a change or search for another route: reply that the hosting operator controls it.";

registry.registerPath({
  method: "get",
  path: "/api/instance/settings",
  tags: ["instance"],
  summary: "Get instance settings",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/instance/settings",
  tags: ["instance"],
  summary: "Update instance settings",
  request: { body: jsonBody(patchInstanceSettingsSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/settings/general",
  tags: ["instance"],
  summary: "Get general instance settings",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/instance/settings/general",
  tags: ["instance"],
  summary: "Update general instance settings",
  request: { body: jsonBody(patchInstanceGeneralSettingsSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/settings/experimental",
  tags: ["instance"],
  summary: "Get experimental instance settings",
  description: `${EXPERIMENTAL_SETTINGS_PAGE} Agent Chat is always on for every person on every instance and needs no setup. enableAgentChat is a retired compatibility key: it always reads true and written values are ignored. If someone asks to enable Agent Chat, tell them it is already on, since they are using it now; do not send them to a settings toggle.`,
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/instance/settings/experimental",
  tags: ["instance"],
  summary: "Update experimental instance settings",
  description: `${EXPERIMENTAL_SETTINGS_PAGE} Requires instance-admin access or a trusted Cloud stack admin. Operator-hidden settings and Cloud-managed feature restrictions still apply. This does not grant access to other instance administration operations. Agent Chat is always on for every person on every instance and needs no setup. enableAgentChat is a retired compatibility key: it always reads true and written values are ignored. If someone asks to enable Agent Chat, tell them it is already on, since they are using it now; do not send them to a settings toggle.`,
  request: { body: jsonBody(patchInstanceExperimentalSettingsSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/task-drain",
  tags: ["instance"],
  summary:
    "Get process task-drain status, with optional bounded upgrade-readiness or idle-safety reports for instance operators",
  description: "With idleSleepSafety=1, the exact current idle owner can retire idle native sessions before a fresh safety inspection. Busy or failed retirement prevents sleep. Native retirement is skipped for diagnostic inspection. scheduledWake=domain-deadlines-v1 requires signed Cloud authority with idleCapabilities.deadlineCatalog=domain_deadlines_v1 and returns a mandatory deadlineProof even when no wake is scheduled. Cloud must acknowledge any returned durable alarm and revalidate the report before stopping the instance.",
  request: { query: z.object({ upgradeReadiness: z.literal("1").optional().describe("Instance operators can request a bounded aggregate report of current remote-runner recovery eligibility. This read does not hold admission or detach runners. The version 1 report also carries an additive handoff object (version, ready, recoverableRuns, restartableRuns, blockingRuns, pendingWakes, unsavedWakes) for a graceful server replacement: restartable runs have launched no agent work and are started again by restart recovery, and unsavedWakes counts wake admissions that have not committed their queued run. Only handoff.blockingRuns, handoff.unsavedWakes, draining or an incomplete census make handoff.ready false. The top-level version 1 fields keep their meaning."), ownerId: z.string().uuid().optional(), idleSleepSafety: z.literal("1").optional().describe("Instance admins can request a conservative durable-work report while admission and ingress are held. Unknown or present work must prevent automatic sleep."), scheduledWake: z.enum(["1", "2", "domain-deadlines-v1"]).optional().describe("Cloud control callers may request routine deadlines (1), routines and issue monitors (2), or the domain deadline catalog (domain-deadlines-v1). The domain catalog requires signed Cloud authority with idleCapabilities.deadlineCatalog=domain_deadlines_v1 and returns a deadlineProof even when no wake is scheduled. Cloud must acknowledge any returned durable alarm and revalidate this report before stopping the instance.") }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/instance/task-drain/status",
  tags: ["instance"],
  summary: "Read task-drain status with body-bound signed Cloud idle capabilities",
  description: "Requires the task-drain:read-body Cloud control assertion bound to the exact raw JSON SHA256. The body alone and browser administrator access do not grant this authority. Uses the same status/idle-safety reader and owner/scheduled-wake semantics as GET; does not start or stop a drain.",
  request: { body: jsonBody(z.object({ idleCapabilities: z.unknown().describe("Complete closed incoming-wake and deadline catalogs, validated by the existing capability parser after signature and exact raw-body binding") }).strict()),
    query: z.object({ upgradeReadiness: z.literal("1").optional(), ownerId: z.string().uuid().optional(), idleSleepSafety: z.literal("1").optional(), scheduledWake: z.enum(["1", "2", "domain-deadlines-v1"]).optional() }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/instance/task-drain",
  tags: ["instance"],
  summary:
    "Start a task drain, so new run admission holds until active runs finish",
  request: { body: jsonBody(startTaskDrainRequestSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/instance/task-drain",
  tags: ["instance"],
  summary: "End a task drain and restore run admission",
  request: { query: z.object({ ownerId: z.string().uuid().optional() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 409: r.conflict },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/lifecycle",
  tags: ["instance"],
  summary:
    "Read the Cloud-pinned primary space's lifecycle status and how many other spaces are not archived; 404 when the instance is not Cloud-managed",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/instance/lifecycle/unarchive-primary",
  tags: ["instance"],
  summary:
    "Unarchive the Cloud-pinned primary space (idempotent); used by the Cloud control plane while restoring an archived stack",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

// ─── Access / invites / members ───────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/invites",
  tags: ["access"],
  summary: "List space invites",
  description: "Operator members or agents holding users:invite in this space. Lists invite records; it never returns invite tokens.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/invites",
  tags: ["access"],
  summary: "Create a space invite",
  description: "Operator members or agents holding users:invite in this space. Creates a shareable join link (inviteUrl) that the person who should join opens; it does not send email and has no email field. Write the returned inviteUrl as a Markdown link in your reply. Membership starts only after the person accepts the link (and a join request is approved when required). humanRole defaults to operator.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createSpaceInviteSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/join-requests",
  tags: ["access"],
  summary: "List space join requests",
  description: "Operator members or agents holding joins:approve in this space.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/join-requests/{requestId}/approve",
  tags: ["access"],
  summary: "Approve a space join request",
  description: "Operator members or agents holding joins:approve in this space.",
  request: {
    params: z.object({ spaceId: z.string(), requestId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/join-requests/{requestId}/reject",
  tags: ["access"],
  summary: "Reject a space join request",
  description: "Operator members or agents holding joins:approve in this space.",
  request: {
    params: z.object({ spaceId: z.string(), requestId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/invites/{inviteId}/revoke",
  tags: ["access"],
  summary: "Revoke an invite",
  request: { params: z.object({ inviteId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}",
  tags: ["access"],
  summary: "Get an invite by token",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/invites/{token}/accept",
  tags: ["access"],
  summary: "Accept an invite and create or replay a join request",
  request: {
    params: z.object({ token: z.string() }),
    body: jsonBody(acceptInviteSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/members",
  tags: ["access"],
  summary: "List space members",
  description: "Internal compatibility endpoint for actors holding users:manage_permissions. Returns each member's role, status and explicit grants. Outpost no longer exposes human member management in the product UI.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/members/{memberId}",
  tags: ["access"],
  summary: "Update a space member status or role",
  description: "Internal compatibility endpoint. Operator-only; Outpost no longer exposes human member management in the product UI.",
  request: {
    params: z.object({ spaceId: z.string(), memberId: z.string() }),
    body: jsonBody(updateSpaceMemberSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/members/{memberId}/role-and-grants",
  tags: ["access"],
  summary: "Update a space member role and explicit grants",
  description: "Internal compatibility endpoint. Operator-only; Outpost no longer exposes human member management in the product UI.",
  request: {
    params: z.object({ spaceId: z.string(), memberId: z.string() }),
    body: jsonBody(updateSpaceMemberWithPermissionsSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/members/{memberId}/archive",
  tags: ["access"],
  summary: "Archive a space member",
  description: "Internal compatibility endpoint. Operator-only; Outpost no longer exposes human member management in the product UI.",
  request: {
    params: z.object({ spaceId: z.string(), memberId: z.string() }),
    body: jsonBody(archiveSpaceMemberSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/members/{memberId}/permissions",
  tags: ["access"],
  summary: "Update explicit space member permissions",
  description: "Internal compatibility endpoint. Operator-only; Outpost no longer exposes human member management in the product UI.",
  request: {
    params: z.object({ spaceId: z.string(), memberId: z.string() }),
    body: jsonBody(updateMemberPermissionsSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/user-directory",
  tags: ["access"],
  summary: "Get space user directory",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/cli-auth/me",
  tags: ["access"],
  summary: "Get current CLI auth session",
  description: "Operator-credential read used by `npx @outpost/cli auth whoami` in the person's own terminal. Agent API keys receive 401: an agent cannot sign a terminal in as a person. To connect someone's terminal, see POST /api/cli-auth/challenges.",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/openclaw/invite-prompt",
  tags: ["access"],
  summary: "Create an OpenClaw invite prompt bundle",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createOpenClawInvitePromptSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/challenges",
  tags: ["access"],
  summary: "Connect a person's terminal to Outpost: create a CLI auth challenge for terminal login",
  description: "Called by the Outpost CLI in a person's own terminal, never by an agent on their behalf. To connect someone's terminal to Outpost as themselves, tell them to run `npx @outpost/cli auth login --api-base <this Outpost URL>` in that terminal (add `--space-id <spaceId>` to name the space). The URL is the address the person already opens Outpost at in their browser; leave it as that placeholder instead of looking it up, because addresses an agent can see (such as a runner-local API URL) may not be reachable from the person's machine. The CLI prints an approval link; they open it in a browser where they are signed in, review the requesting command, space and Operator access, and approve. Only that CLI receives the resulting Operator credential. `npx @outpost/cli auth whoami` confirms who it is signed in as and `npx @outpost/cli auth logout` revokes it. Agent API keys are a separate identity: never hand out an agent key, create or approve a challenge yourself, or ask for the person's password in chat.",
  request: { body: jsonBody(createCliAuthChallengeSchema) },
  responses: { 200: r.ok(), 400: r.badRequest },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/challenges/{id}/approve",
  tags: ["access"],
  summary: "Approve a CLI auth challenge",
  description: "Only the signed-in person approves, from the approval page their own CLI printed; agent API keys receive 401. To connect someone's terminal, give them the `npx @outpost/cli auth login` command (see POST /api/cli-auth/challenges).",
  request: {
    params: z.object({ id: cliAuthChallengeIdParamSchema }),
    body: jsonBody(resolveCliAuthChallengeSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/challenges/{id}/cancel",
  tags: ["access"],
  summary: "Cancel a CLI auth challenge",
  request: {
    params: z.object({ id: cliAuthChallengeIdParamSchema }),
    body: jsonBody(resolveCliAuthChallengeSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/revoke-current",
  tags: ["access"],
  summary: "Revoke current CLI auth session",
  description: "Used by `npx @outpost/cli auth logout` with the CLI's own Operator credential; it revokes only that credential and leaves agent API keys untouched.",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/skills/available",
  tags: ["access"],
  summary: "List available skills",
  responses: { 200: r.ok() },
});

registry.registerPath({
  method: "get",
  path: "/api/skills/index",
  tags: ["access"],
  summary: "Get skills index",
  responses: { 200: r.ok() },
});

registry.registerPath({
  method: "get",
  path: "/api/skills/{skillName}",
  tags: ["access"],
  summary: "Get a skill by name",
  request: { params: z.object({ skillName: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/join-requests/{requestId}/claim-api-key",
  tags: ["access"],
  summary: "Claim the initial API key for an approved agent join request",
  request: {
    params: z.object({ requestId: z.string() }),
    body: jsonBody(claimJoinRequestApiKeySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/users",
  tags: ["admin"],
  summary: "List all users (admin)",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

// ─── Auth / profile ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/auth/get-session",
  tags: ["auth"],
  summary: "Get current session",
  description: "Authenticated operator sessions can include an optional same-user operatorBootstrap with accessible spaces and operatorAccess. Existing session fields are unchanged; clients retain ordinary space and access reads when the optional projection is absent.",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/managed-agent-profiles",
  tags: ["agents"],
  summary: "List Claude Managed Agent profiles for a space",
  description: "Operator only: agent credentials get 403. There is no web page for Claude Managed Agent profiles; see the POST route for how an operator user creates one.",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/managed-agent-profiles",
  tags: ["agents"],
  summary: "Create or operator-attest a Claude Managed Agent profile",
  description: "Operator only: agent credentials get 403. A Claude Managed Agent runs on Anthropic's managed-agents beta. An operator creates the space profile with an Anthropic API-key secret and a limited environment (no hosts, no packages), attests its qualification and explicitly acknowledges stateful retention before it can be enabled. There is no web page for this: the operator user runs the CLI command `outpost managed-agent setup --space-id <spaceId> --profile-key <key> --display-name <name> --api-key-secret-id <secretId> --acknowledge-retention` with ANTHROPIC_API_KEY set in their shell (add --probe for a read-only qualification check first). It creates or adopts the limited Anthropic Agent and Environment, qualifies them and calls this route with operator credentials. The secret itself is added on the space Secrets page, /<prefix>/space/settings/secrets.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(
      z.object({
        profileKey: z.string(),
        displayName: z.string(),
        anthropicAgentId: z.string(),
        agentVersion: z.string(),
        environmentId: z.string(),
        defaultModel: z.literal("claude-sonnet-5").optional(),
        defaultMaxListCostUsd: z.number().positive().optional(),
        apiKeySecretId: z.string(),
        enabled: z.boolean().optional(),
        retentionAcknowledged: z.boolean().optional(),
        qualification: z
          .object({
            probedAt: z.string().datetime(),
            betaVersion: z.literal("managed-agents-2026-04-01"),
            environmentPolicy: z.literal("limited_no_hosts_no_packages"),
            agentCapabilities: z.literal(
              "no_tools_no_mcp_no_skills_no_multiagent",
            ),
          })
          .strict()
          .optional(),
      }),
    ),
  },
  responses: {
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/remote-agent-profiles",
  tags: ["agents"],
  summary: "List remote AgentCore profiles for a space",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      service: z.literal("aws_bedrock_agentcore_harness").optional(),
    }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/remote-agent-profiles",
  tags: ["agents"],
  summary: "Create or operator-attest a remote AgentCore profile",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(
      z.object({
        profileKey: z.string(),
        displayName: z.string(),
        service: z.literal("aws_bedrock_agentcore_harness"),
        configuration: z.record(z.string(), z.unknown()),
        enabled: z.boolean().optional(),
        retentionAcknowledged: z.boolean().optional(),
        qualification: z
          .object({ suite: z.literal("aws-agentcore-harness-context-v2") })
          .strict()
          .optional(),
      }),
    ),
  },
  responses: {
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

// ─── Heartbeat runs ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/heartbeat-runs",
  tags: ["runs"],
  summary: "List heartbeat runs for a space",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: z.object({
      agentId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(200),
      summary: z.enum(["true", "false", "1", "0"]).optional(),
      latestFailuresOnly: z.enum(["true", "false"]).optional().describe("Return failures only when the agent's latest run within the bounded result failed or timed out. Applied before read redaction."),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/provider-traces",
  tags: ["runs"],
  summary: "List provider trace metadata for selected runs",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/live-runs",
  tags: ["runs"],
  summary: "List live runs for a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/live-runs",
  tags: ["runs"],
  summary: "List live runs for an issue",
  request: { params: z.object({ issueId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/execution",
  tags: ["runs"],
  summary: "Get the current issue execution and permitted recovery actions",
  request: { params: z.object({ issueId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/active-run",
  tags: ["runs"],
  summary: "Get active run for an issue",
  request: { params: z.object({ issueId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}",
  tags: ["runs"],
  summary: "Get a heartbeat run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/cancel",
  tags: ["runs"],
  summary: "Cancel a heartbeat run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/provider-trace",
  tags: ["runs"],
  summary: "Inspect a redacted provider trace",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/provider-trace/reproject-workspace-diffs",
  tags: ["runs"],
  summary: "Reproject retained Codex workspace diffs into run events",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/provider-trace/frames/{frameId}/reveal",
  tags: ["runs"],
  summary: "Reveal one exact provider trace frame",
  request: {
    params: z.object({
      runId: heartbeatRunIdParamSchema,
      frameId: z.coerce.number().int().positive(),
    }),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/provider-trace/download",
  tags: ["runs"],
  summary: "Download an exact provider trace as NDJSON",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/heartbeat-runs/{runId}/provider-trace",
  tags: ["runs"],
  summary: "Permanently delete a provider trace",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/queued-comments",
  tags: ["issues"],
  summary: "List queued comments for an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/issues/{id}/queued-comments/{commentId}",
  tags: ["issues"],
  summary: "Edit a queued issue comment",
  request: {
    params: z.object({ id: z.string(), commentId: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        body: z.string().min(1).max(200_000),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/queued-comments/order",
  tags: ["issues"],
  summary: "Reorder queued issue comments",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        orderedCommentIds: z.array(z.string().min(1)).max(500),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/queued-comments/{commentId}",
  tags: ["issues"],
  summary: "Delete a queued issue comment",
  request: {
    params: z.object({ id: z.string(), commentId: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/queued-comments/interrupt",
  tags: ["issues"],
  summary: "Interrupt the active legacy run and continue its queued comments",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        targetRunId: z.string().min(1),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/queued-comments/{commentId}/steer",
  tags: ["issues"],
  summary: "Steer a queued issue comment into the active native run",
  request: {
    params: z.object({ id: z.string(), commentId: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        targetRunId: z.string().min(1),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/runtime-requests/{requestId}/resolve",
  tags: ["runs"],
  summary: "Resolve a pending Outpost runner runtime request",
  request: {
    params: z.object({ runId: heartbeatRunIdParamSchema, requestId: z.string() }),
    body: jsonBody(
      z.object({
        turnId: z.string().min(1).max(160),
        requestKind: z.enum([
          "command_approval",
          "file_approval",
          "permission_approval",
          "user_input",
          "elicitation",
        ]),
        resolution: z.union([
          z.object({
            action: z.enum([
              "accept",
              "accept_for_session",
              "decline",
              "cancel",
            ]),
          }),
          z.object({
            action: z.literal("submit"),
            answers: z.record(
              z.string(),
              z.object({ answers: z.array(z.string()) }),
            ),
          }),
          z.object({
            action: z.literal("submit"),
            content: z.record(z.string(), z.unknown()),
          }),
        ]),
      }),
    ),
  },
  responses: {
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/watchdog-decisions",
  tags: ["runs"],
  summary: "Submit watchdog decisions for a run",
  request: {
    params: z.object({ runId: heartbeatRunIdParamSchema }),
    body: jsonBody(
      z.object({
        decision: z.enum(["snooze", "continue", "dismissed_false_positive"]),
        evaluationIssueId: z.string().optional().nullable(),
        reason: z.string().optional().nullable(),
        snoozedUntil: z.string().datetime().optional().nullable(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/events",
  tags: ["runs"],
  summary: "Get events for a heartbeat run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }), query: z.object({
      view: z.literal("conversation").optional().describe("Assistant text, request lifecycle events and body-free successful Plan-write boundaries. Excludes ordinary historical tool activity."),
      afterSeq: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
    }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/log",
  tags: ["runs"],
  summary: "Get log for a heartbeat run",
  request: {
    params: z.object({ runId: heartbeatRunIdParamSchema }),
    query: z.object({
      offset: z.coerce.number().int().min(0).optional(),
      limitBytes: z.coerce.number().int().min(1).max(1024 * 1024).optional(),
      alignStartToRecord: z.enum(["true", "false"]).optional().describe("Extend the tail backward to include its first complete log record. The response can exceed limitBytes by that record's prefix."),
    }),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/workspace-operations",
  tags: ["runs"],
  summary: "List workspace operations for a run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/workspace-operations/{operationId}/log",
  tags: ["runs"],
  summary: "Get log for a workspace operation",
  request: { params: z.object({ operationId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Agent runs & heartbeat ───────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/approve",
  tags: ["agents"],
  summary: "Approve a pending agent action",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/heartbeat/invoke",
  tags: ["agents"],
  summary: "Invoke agent heartbeat",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/claude-login",
  tags: ["agents"],
  summary: "Trigger Claude login for agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// Space-and-environment Claude setup-token login session routes. The owner
// user starts one session for one adapter in one environment. The scope carries
// no agent id, so a create flow with no agent still starts one session. The owner
// reads the login prompt, submits the browser code from the browser, and reads
// the completion claim. The prompt, code, and completion responses require a
// confidential transport; the guard returns 403 when the transport is not
// confidential. No response carries a token; the completion returns the
// non-secret `storedSessionId` claim.
//
// The stored-token status read returns only the secret id and the latest version
// of the owner value; it returns no token. The server derives the owner from the
// authenticated actor. A missing or a foreign value returns the same fixed 404,
// so the read discloses no existence distinction. The response is `no-store`.
registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/claude-oauth-token-status",
  tags: ["spaces"],
  summary:
    "Read the stored Claude OAuth token status for the authenticated owner",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: {
    200: r.ok(claudeOAuthTokenStatusResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/setup-token-login-sessions",
  tags: ["spaces"],
  summary: "Start a space-and-environment Claude setup-token login session",
  description: "For a managed AI Connection, omit agentId to select an eligible computer in the sign-in environment.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(startClaudeSetupTokenSessionRequestSchema),
  },
  responses: {
    201: r.ok(claudeSetupTokenSessionOwnerResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    503: r.serverError,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/setup-token-login-sessions/active",
  tags: ["spaces"],
  summary: "Read the caller's active Claude setup-token login session",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: {
    200: r.ok(claudeSetupTokenSessionOwnerResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/setup-token-login-sessions/{sessionId}",
  tags: ["spaces"],
  summary: "Read the status of a Claude setup-token login session",
  request: {
    params: z.object({ spaceId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(claudeSetupTokenSessionResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/setup-token-login-sessions/{sessionId}/prompt",
  tags: ["spaces"],
  summary: "Read the login prompt for a Claude setup-token login session",
  request: {
    params: z.object({ spaceId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(claudeSetupTokenSessionPromptSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/setup-token-login-sessions/{sessionId}/code",
  tags: ["spaces"],
  summary: "Submit the browser code for a Claude setup-token login session",
  request: {
    params: z.object({ spaceId: z.string(), sessionId: z.string() }),
    body: jsonBody(submitBrowserCodeRequestSchema),
  },
  responses: {
    200: r.ok(claudeSetupTokenSessionResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/setup-token-login-sessions/{sessionId}/completion",
  tags: ["spaces"],
  summary: "Read the completion claim of a Claude setup-token login session",
  request: {
    params: z.object({ spaceId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(claudeSetupTokenCompletionResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/setup-token-login-sessions/{sessionId}/cancel",
  tags: ["spaces"],
  summary: "Cancel a Claude setup-token login session",
  // The 404 is reserved for the pre-scope non-member gate. The space-access
  // gate runs before the cancel logic and returns a fixed 404 for a non-member.
  // Cancel itself is idempotent and stays uniform: a same-space owner-scoped
  // missing, terminal, or foreign session id all return 200. So the route never
  // confirms a session exists for the owner.
  request: {
    params: z.object({ spaceId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Issue interactions & tree ───────────────────────────────────────────────

const conversationQuestionSubjectSchema = z.object({
  kind: z.string(), id: z.string(), spaceId: z.string(), title: z.string().nullable(),
  identifier: z.string().nullable(), status: z.string().nullable(), href: z.string().nullable(),
}).passthrough();
const conversationPendingQuestionSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  sourceKind: z.literal("issue_thread_interaction"),
  subject: conversationQuestionSubjectSchema,
  relatedIssue: conversationQuestionSubjectSchema,
  detail: z.object({
    kind: z.literal("questions"), questionCount: z.number().int(), firstQuestionText: z.string().nullable(),
    images: z.array(z.object({ assetId: z.string(), alt: z.string().nullable().optional() })),
  }),
}).passthrough().describe("Canonical AttentionItem question projection; additional attention fields, including resolverAudience, are returned unchanged.");

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/pending-questions",
  tags: ["issues"],
  summary: "List pending task questions for your conversation",
  description:
    "Requires an operator user who owns and can read the conversation. Returns AttentionItem[] containing canonical pending ask_user_questions from readable tasks handed off in the current session, plus ordinary tasks created by this user and currently assigned to this conversation's agent. Ordinary-task questions remain current obligations across chat resets. Tasks linked to any chat handoff never enter through the ordinary-task scope. Excludes the conversation's own questions. Uses the same audience, dismissal, snooze and archive rules as Needs You. Accepts no query parameters. Reads one complete authorized space attention snapshot and filters it to these tasks, so cost scales with space attention; it retains existing attention queue/retention bookkeeping and creates no copied questions or agent turns. This endpoint is intended for event-driven refresh, not polling.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(z.array(conversationPendingQuestionSchema)), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/decision-receipts",
  tags: ["issues"],
  summary: "List decision receipts for your conversation",
  description:
    "Requires an operator user who owns the conversation and has current issue read access. Returns a DecisionHistoryPage for tasks handed off in the current conversation session, plus ordinary tasks created by this user and currently assigned to this conversation's agent. Ordinary-task receipts are limited to resolutions since the current session's boundary comment (or conversation creation for its initial session); missing reset provenance omits ordinary-task history. Tasks linked to any chat handoff retain their original session scope. Both sources are merged newest first under the same cursor, with current task and decision audience access enforced. Accepts only cursor and limit; the default page size is 40. Reading receipts does not copy messages, create handoffs, or wake agents.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      cursor: z.string().max(1000).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).strict(),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/chat-handoffs",
  tags: ["issues"],
  summary: "List tasks created from your conversation",
  description:
    "Requires an operator user who owns the conversation and has current issue read access. Returns a ConversationTaskHandoffPage for the current conversation session, newest first, omitting tasks the user can no longer read. Accepts only cursor and limit; the default page size is 40. This read does not create tasks or wake agents.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      cursor: z.string().max(1000).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).strict(),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/interactions",
  tags: ["issues"],
  summary: "List issue thread interactions",
  description: "A connection_intent interaction is a connection request card addressed to one person, its addresseeUserId. Only that person can connect or decline it; no other member, operator user or agent can resolve it for them.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions",
  tags: ["issues"],
  summary: "Create an issue thread interaction",
  description:
    "Resolver policy defaults to canonical `anyone` for every interaction kind. `not_creator` and `human_only` are opt-in restrictions; deprecated `operator_or_agents` and `operator_only` inputs are accepted as compatibility aliases.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createIssueThreadInteractionSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/resolve-from-comment",
  tags: ["issues"],
  summary: "Record a user's conversational confirmation answer",
  description: "An eligible active agent run resolves a confirmation on its own task using the latest user comment. Resolver permissions, target staleness and conversation reset boundaries remain enforced. Matching retries are idempotent. No new wake is scheduled.",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(resolveConfirmationFromCommentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound,
    409: { description: "Stale or conflicting decision" }, 422: { description: "Invalid answer evidence or selection" } },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/accept",
  tags: ["issues"],
  summary: "Accept an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(acceptIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/reject",
  tags: ["issues"],
  summary: "Reject an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(rejectIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/respond",
  tags: ["issues"],
  summary: "Answer questions on an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(respondIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/verdicts",
  tags: ["issues"],
  summary: "Submit item verdicts on an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(submitIssueThreadInteractionVerdictsSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/withdraw",
  tags: ["issues"],
  summary: "Withdraw a pending issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(withdrawIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/children",
  tags: ["issues"],
  summary: "Create child issues",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createChildIssueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/admin/force-release",
  tags: ["issues"],
  summary: "Force-release an issue (admin)",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/tree-control/state",
  tags: ["issues"],
  summary: "Get issue tree control state",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/tree-control/preview",
  tags: ["issues"],
  summary: "Preview issue tree control changes",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(previewIssueTreeControlSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/tree-holds",
  tags: ["issues"],
  summary: "List issue tree holds",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/tree-holds",
  tags: ["issues"],
  summary: "Create an issue tree hold",
  description: "Operator-only. An agent cannot pause, cancel or resume a task tree, and this denial is final for agents. A person pauses the parent task and all of its subtasks on the space-prefixed task page /{prefix}/issues/{identifier}: More task actions, then Pause subtree. The person resumes it later on the same page with Resume subtree. Link that task page. Moving tasks to backlog or changing assignees is not a tree pause.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createIssueTreeHoldSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/tree-holds/{holdId}",
  tags: ["issues"],
  summary: "Get an issue tree hold",
  request: { params: z.object({ id: z.string(), holdId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/tree-holds/{holdId}/release",
  tags: ["issues"],
  summary: "Release an issue tree hold",
  request: {
    params: z.object({ id: z.string(), holdId: z.string() }),
    body: jsonBody(releaseIssueTreeHoldSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Attachments ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/issues/{issueId}/attachments",
  tags: ["assets"],
  summary: "Upload an attachment to an issue",
  request: { params: z.object({ spaceId: z.string(), issueId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/attachments/{attachmentId}/content",
  tags: ["assets"],
  summary: "Download attachment content",
  request: { params: z.object({ attachmentId: z.string() }) },
  responses: {
    200: { description: "File content" },
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/attachments/{attachmentId}",
  tags: ["assets"],
  summary: "Delete an attachment",
  request: { params: z.object({ attachmentId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Assets ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/assets/images",
  tags: ["assets"],
  summary: "Upload an image asset",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/logo",
  tags: ["assets"],
  summary: "Upload space logo",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/onboarding-seed",
  tags: ["spaces"],
  summary: "Apply the onboarding seed Outpost Cloud collected at signup",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/assets/{assetId}/content",
  tags: ["assets"],
  summary: "Download asset content",
  request: { params: z.object({ assetId: z.string() }) },
  responses: {
    200: { description: "File content" },
    401: r.unauthorized,
    404: r.notFound,
  },
});

// ─── Space skills ───────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills",
  tags: ["skills"],
  summary: "List skills for a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills/{skillId}",
  tags: ["skills"],
  summary: "Get a space skill",
  request: { params: z.object({ spaceId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills/{skillId}/update-status",
  tags: ["skills"],
  summary: "Get skill update status",
  request: { params: z.object({ spaceId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills/{skillId}/update-diff",
  tags: ["skills"],
  summary: "Show what a pending skill source update changes (diff installed vs latest revision)",
  description: "For a skill installed from a tracked GitHub source, compares the installed source revision (currentRef) with the latest tracked revision (latestRef) and returns each changed package file with a unified line diff: lines starting with \"-\" exist only in the installed revision and lines starting with \"+\" only in the latest one. hasUpdate is false and files is empty when the installed revision is already the latest. A file with change \"not_compared\" was left out of a revision's scan, and diffUnavailable says why a file has no diff. truncated is true when the response reached its size budget. Read-only; it does not apply the update. Use this to review an update before installing it.",
  request: { params: z.object({ spaceId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills/{skillId}/files",
  tags: ["skills"],
  summary: "List skill files",
  request: { params: z.object({ spaceId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/{skillId}/rename",
  tags: ["skills"],
  summary: "Rename a managed space skill",
  request: {
    params: z.object({ spaceId: z.string(), skillId: z.string() }),
    body: jsonBody(spaceSkillRenameSchema),
  },
  responses: {
    200: r.ok(spaceSkillRenameResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills",
  tags: ["skills"],
  summary: "Create a space skill",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spaceSkillCreateSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/skills/{skillId}/files",
  tags: ["skills"],
  summary: "Update a skill file (optional expectedVersionId and idempotencyKey guard agent retries)",
  request: {
    params: z.object({ spaceId: z.string(), skillId: z.string() }),
    body: jsonBody(spaceSkillFileUpdateSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 409: r.conflict },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/skills/{skillId}/files",
  tags: ["skills"],
  summary: "Delete a skill file or folder",
  request: {
    params: z.object({ spaceId: z.string(), skillId: z.string() }),
    body: jsonBody(spaceSkillFileDeleteSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-inputs",
  tags: ["skills"],
  summary: "List skill test inputs",
  request: { params: z.object({ spaceId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-inputs",
  tags: ["skills"],
  summary: "Create a skill test input",
  request: {
    params: z.object({ spaceId: z.string(), skillId: z.string() }),
    body: jsonBody(spaceSkillTestInputCreateSchema),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-inputs/{inputId}",
  tags: ["skills"],
  summary: "Update a skill test input",
  request: {
    params: z.object({
      spaceId: z.string(),
      skillId: z.string(),
      inputId: z.string(),
    }),
    body: jsonBody(spaceSkillTestInputUpdateSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-inputs/{inputId}",
  tags: ["skills"],
  summary: "Delete a skill test input",
  request: {
    params: z.object({
      spaceId: z.string(),
      skillId: z.string(),
      inputId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skill-test-run-templates",
  tags: ["skills"],
  summary: "List skill test-run templates",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skill-test-run-templates",
  tags: ["skills"],
  summary: "Create a skill test-run template",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spaceSkillTestRunTemplateCreateSchema),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/spaces/{spaceId}/skill-test-run-templates/{templateId}",
  tags: ["skills"],
  summary: "Update a skill test-run template",
  request: {
    params: z.object({ spaceId: z.string(), templateId: z.string() }),
    body: jsonBody(spaceSkillTestRunTemplateUpdateSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/skill-test-run-templates/{templateId}",
  tags: ["skills"],
  summary: "Delete a skill test-run template",
  request: {
    params: z.object({ spaceId: z.string(), templateId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-runs",
  tags: ["skills"],
  summary: "List skill test runs",
  request: {
    params: z.object({ spaceId: z.string(), skillId: z.string() }),
    query: spaceSkillTestRunListQuerySchema,
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-runs/{runId}",
  tags: ["skills"],
  summary: "Get a skill test run",
  request: {
    params: z.object({
      spaceId: z.string(),
      skillId: z.string(),
      runId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-runs",
  tags: ["skills"],
  summary: "Create a skill test run",
  request: {
    params: z.object({ spaceId: z.string(), skillId: z.string() }),
    body: jsonBody(spaceSkillTestRunCreateSchema),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-runs/{runId}/cancel",
  tags: ["skills"],
  summary: "Cancel a skill test run",
  request: {
    params: z.object({
      spaceId: z.string(),
      skillId: z.string(),
      runId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/skills/{skillId}/test-runs/{runId}",
  tags: ["skills"],
  summary: "Delete a skill test run",
  request: {
    params: z.object({
      spaceId: z.string(),
      skillId: z.string(),
      runId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/import",
  tags: ["skills"],
  summary: "Import an existing skill from a source",
  description: "Import existing SKILL.md content from an allowed local skill directory or a supported remote source. Retain its source provenance instead of authoring new content with create_skill. Local paths must satisfy the space workspace and managed-root boundary checks. Remote imports keep their source access checks. Importing does not assign the skill to an agent. Outpost skill policy still applies.",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spaceSkillImportSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/browse-project",
  tags: ["skills"],
  summary: "Browse a project workspace for skills",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spaceSkillProjectBrowseRequestSchema),
  },
  responses: {
    200: r.ok(spaceSkillProjectBrowseResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/scan-projects",
  tags: ["skills"],
  summary: "Scan project for skills",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spaceSkillProjectScanRequestSchema),
  },
  responses: {
    200: r.ok(spaceSkillProjectScanResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skills/{skillId}/install-update",
  tags: ["skills"],
  summary: "Install a skill update",
  request: { params: z.object({ spaceId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/skills/{skillId}",
  tags: ["skills"],
  summary: "Delete a space skill",
  request: { params: z.object({ spaceId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/skill-policy",
  tags: ["skills"],
  summary: "Get the effective space skill policy",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/spaces/{spaceId}/skill-policy",
  tags: ["skills"],
  summary: "Replace the space skill policy",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(replaceSkillPolicySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/spaces/{spaceId}/skill-policy",
  tags: ["skills"],
  summary: "Reset the space skill policy to the open default",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/skill-policy/evaluate",
  tags: ["skills"],
  summary: "Evaluate a space skill policy decision",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(evaluateSkillPolicySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/users/me/inbox-agent-policy",
  tags: ["spaces"],
  summary: "Get the current user's inbox agent policy",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/spaces/{spaceId}/users/me/inbox-agent-policy",
  tags: ["spaces"],
  summary: "Update the current user's inbox agent policy",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(updateInboxAgentPolicySchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/users/{userId}/inbox-agent-policy",
  tags: ["spaces"],
  summary: "Get a space user's inbox agent policy",
  request: { params: z.object({ spaceId: z.string(), userId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/spaces/{spaceId}/users/{userId}/inbox-agent-policy",
  tags: ["spaces"],
  summary: "Update a space user's inbox agent policy",
  request: {
    params: z.object({ spaceId: z.string(), userId: z.string() }),
    body: jsonBody(updateInboxAgentPolicySchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

// ─── Execution workspaces ─────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/execution-workspaces",
  tags: ["execution-workspaces"],
  summary: "List execution workspaces for a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/workspace-overview",
  tags: ["execution-workspaces"],
  summary: "List bounded execution workspace overview rows for a space",
  request: {
    params: z.object({ spaceId: z.string() }),
    query: workspaceOverviewQuerySchema,
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/execution-workspaces/{id}",
  tags: ["execution-workspaces"],
  summary: "Get an execution workspace",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/execution-workspaces/{id}/close-readiness",
  tags: ["execution-workspaces"],
  summary: "Check close-readiness of a workspace",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/execution-workspaces/{id}/workspace-operations",
  tags: ["execution-workspaces"],
  summary: "List workspace operations",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/execution-workspaces/{id}",
  tags: ["execution-workspaces"],
  summary: "Update an execution workspace",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateExecutionWorkspaceSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/reconcile-branch",
  tags: ["execution-workspaces"],
  summary: "Reconcile an execution workspace branch record",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(reconcileExecutionWorkspaceBranchSchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/login-handoff",
  tags: ["execution-workspaces"],
  summary: "Issue a single-use workspace login handoff",
  description:
    "Mints a short-lived, single-use ticket the isolated workspace exchanges for its own " +
    "instance-scoped session, so opening a managed workspace does not depend on a cloned " +
    "password. Operator actors only. The response `url` must be navigated to, not stored: the " +
    "workspace answers it with a redirect so the ticket never enters browser history. A refusal " +
    "carries a machine `reason` and, where the control plane probed it, the workspace's own " +
    "readiness.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      z.object({
        next: z
          .string()
          .optional()
          .describe(
            "Same-origin path to land on; anything else collapses to `/`.",
          ),
      }),
    ),
  },
  responses: {
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    501: r.serverError,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/runtime-services/{action}",
  tags: ["execution-workspaces"],
  summary: "Control a runtime service in a workspace",
  request: {
    params: z.object({ id: z.string(), action: z.string() }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/runtime-commands/{action}",
  tags: ["execution-workspaces"],
  summary: "Run a runtime command in a workspace",
  request: {
    params: z.object({ id: z.string(), action: z.string() }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Environments ─────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/environments",
  tags: ["environments"],
  summary: "List environments for a space",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/environments/capabilities",
  tags: ["environments"],
  summary: "Get environment capabilities",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/environments",
  tags: ["environments"],
  summary: "Create an environment",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(createEnvironmentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}",
  tags: ["environments"],
  summary: "Get an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}/delete-blast-radius",
  tags: ["environments"],
  summary: "Get environment delete blast radius",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}/secret-refs",
  tags: ["environments"],
  summary:
    "Describe an environment's config secret refs (name, status, owning space — never values)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}/leases",
  tags: ["environments"],
  summary: "List leases for an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/environment-leases/{leaseId}",
  tags: ["environments"],
  summary: "Get an environment lease",
  request: { params: z.object({ leaseId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/environments/{id}",
  tags: ["environments"],
  summary: "Update an environment",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateEnvironmentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/environments/{id}",
  tags: ["environments"],
  summary: "Delete an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{id}/probe",
  tags: ["environments"],
  summary: "Probe an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/environments/probe-config",
  tags: ["environments"],
  summary: "Probe environment config",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(probeEnvironmentConfigSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{environmentId}/custom-image-template",
  tags: ["environments"],
  summary:
    "Get the active customImage template and setup status for an environment",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageSpaceQuerySchema,
  },
  responses: {
    200: r.ok(environmentCustomImageOverviewSchema),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{environmentId}/custom-image-setup-sessions",
  tags: ["environments"],
  summary: "Start an interactive environment customImage setup session",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageSpaceQuerySchema,
    body: jsonBody(startEnvironmentCustomImageSetupSessionSchema),
  },
  responses: {
    201: r.ok(environmentCustomImageSetupSessionResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}",
  tags: ["environments"],
  summary: "Get and refresh an environment customImage setup session",
  request: { params: z.object({ sessionId: z.string() }) },
  responses: {
    200: r.ok(environmentCustomImageSetupSessionResultSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}/terminal-session-token",
  tags: ["environments"],
  summary:
    "Mint a short-lived terminal websocket token for a customImage SSH setup session",
  request: {
    params: z.object({ sessionId: z.string() }),
    body: jsonBody(createEnvironmentCustomImageTerminalSessionTokenSchema),
  },
  responses: {
    201: r.ok(environmentCustomImageTerminalSessionTokenSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}/finish",
  tags: ["environments"],
  summary: "Capture and promote an environment customImage setup session",
  request: {
    params: z.object({ sessionId: z.string() }),
    body: jsonBody(finishEnvironmentCustomImageSetupSessionSchema),
  },
  responses: {
    200: r.ok(environmentCustomImageSetupSessionFinishResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}/cancel",
  tags: ["environments"],
  summary: "Cancel an environment customImage setup session",
  request: {
    params: z.object({ sessionId: z.string() }),
    body: jsonBody(cancelEnvironmentCustomImageSetupSessionSchema),
  },
  responses: {
    200: r.ok(environmentCustomImageSetupSessionSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{environmentId}/custom-image-template/rollback",
  tags: ["environments"],
  summary:
    "Roll back an environment customImage template to the previous captured template",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageSpaceQuerySchema,
  },
  responses: {
    200: r.ok(environmentCustomImageTemplateRollbackResultSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{environmentId}/custom-image-template/relink",
  tags: ["environments"],
  summary:
    "Relink a detached environment customImage template to the current config",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageSpaceQuerySchema,
    body: jsonBody(relinkEnvironmentCustomImageTemplateSchema),
  },
  responses: {
    200: r.ok(environmentCustomImageTemplateRelinkResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/environments/{environmentId}/custom-image-template",
  tags: ["environments"],
  summary: "Disable the active environment customImage template",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: disableEnvironmentCustomImageTemplateQuerySchema,
  },
  responses: {
    200: r.ok(environmentCustomImageTemplateSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Adapters (full) ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/adapters",
  tags: ["adapters"],
  summary: "List all adapters",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/adapters/install",
  tags: ["adapters"],
  summary: "Install an adapter",
  request: {
    body: jsonBody(
      z.object({
        packageName: z.string(),
        isLocalPath: z.boolean().optional(),
        version: z.string().optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/adapters/{type}",
  tags: ["adapters"],
  summary: "Enable or disable an adapter",
  request: {
    params: z.object({ type: z.string() }),
    body: jsonBody(z.object({ disabled: z.boolean() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/adapters/{type}/override",
  tags: ["adapters"],
  summary: "Pause or resume an adapter's override of a builtin",
  request: {
    params: z.object({ type: z.string() }),
    body: jsonBody(z.object({ paused: z.boolean() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/adapters/{type}",
  tags: ["adapters"],
  summary: "Delete an adapter",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/adapters/{type}/reload",
  tags: ["adapters"],
  summary: "Reload an adapter",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/adapters/{type}/reinstall",
  tags: ["adapters"],
  summary: "Reinstall an adapter",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/adapters/{type}/config-schema",
  tags: ["adapters"],
  summary: "Get adapter config schema",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/plugins",
  tags: ["plugins"],
  summary: "List installed plugins",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/examples",
  tags: ["plugins"],
  summary: "List example plugins",
  responses: { 200: r.ok() },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/ui-contributions",
  tags: ["plugins"],
  summary: "List plugin UI contributions",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/tools",
  tags: ["plugins"],
  summary: "List plugin tools",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/tools/execute",
  tags: ["plugins"],
  summary: "Execute a plugin tool",
  request: {
    body: jsonBody(
      z.object({
        tool: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        runContext: z.object({
          agentId: z.string(),
          runId: z.string(),
          spaceId: z.string(),
          projectId: z.string().nullable().optional(),
        }),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/install",
  tags: ["plugins"],
  summary: "Install a plugin",
  request: {
    body: jsonBody(
      z.object({
        packageName: z.string(),
        version: z.string().optional(),
        isLocalPath: z.boolean().optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}",
  tags: ["plugins"],
  summary: "Get a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "delete",
  path: "/api/plugins/{pluginId}",
  tags: ["plugins"],
  summary: "Delete a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/enable",
  tags: ["plugins"],
  summary: "Enable a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/disable",
  tags: ["plugins"],
  summary: "Disable a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/health",
  tags: ["plugins"],
  summary: "Get plugin health",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/logs",
  tags: ["plugins"],
  summary: "Get plugin logs",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/upgrade",
  tags: ["plugins"],
  summary: "Upgrade a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/config",
  tags: ["plugins"],
  summary: "Get space-scoped plugin config",
  request: {
    params: z.object({ pluginId: z.string() }),
    query: z.object({ spaceId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/config",
  tags: ["plugins"],
  summary: "Set space-scoped plugin config",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        spaceId: z.string(),
        configJson: z.record(z.string(), z.unknown()),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/config/test",
  tags: ["plugins"],
  summary: "Test space-scoped plugin config",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        spaceId: z.string(),
        configJson: z.record(z.string(), z.unknown()),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/jobs",
  tags: ["plugins"],
  summary: "List plugin jobs",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/jobs/{jobId}/runs",
  tags: ["plugins"],
  summary: "List runs for a plugin job",
  request: { params: z.object({ pluginId: z.string(), jobId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/jobs/{jobId}/trigger",
  tags: ["plugins"],
  summary: "Trigger a plugin job",
  request: { params: z.object({ pluginId: z.string(), jobId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/webhooks/{endpointKey}",
  tags: ["plugins"],
  summary: "Deliver an external webhook payload to a plugin",
  request: {
    params: z.object({ pluginId: z.string(), endpointKey: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/dashboard",
  tags: ["plugins"],
  summary: "Get plugin dashboard data",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/bridge/data",
  tags: ["plugins"],
  summary: "Send data via plugin bridge",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        key: z.string(),
        spaceId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/bridge/action",
  tags: ["plugins"],
  summary: "Send action via plugin bridge",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        key: z.string(),
        spaceId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/data/{key}",
  tags: ["plugins"],
  summary: "Get plugin data by key (URL-keyed bridge)",
  request: {
    params: z.object({ pluginId: z.string(), key: z.string() }),
    body: jsonBody(
      z.object({
        spaceId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/actions/{key}",
  tags: ["plugins"],
  summary: "Invoke a plugin action (URL-keyed bridge)",
  request: {
    params: z.object({ pluginId: z.string(), key: z.string() }),
    body: jsonBody(
      z.object({
        spaceId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Instance database backups ────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/instance/database-backups",
  tags: ["instance"],
  summary: "Trigger a database backup",
  description: "Instance admins only: agent credentials receive 403, and cloud-managed instances run backups for you. Automatic gzip-compressed backups run about hourly by default; instance admins set how long they are kept in the Backup retention section of the space-prefixed /space/settings page. The web UI has no control that creates or restores a backup. For a backup now, an instance admin calls this endpoint, or an operator with shell access to the server runs `outpost db:backup` (add --json for metadata). The result names a gzip-compressed SQL file (backupFile) on the server host and its size. Outpost has no restore endpoint or command: to check a backup, an operator restores the file with psql into a separate, empty PostgreSQL database, never over the live one, and then checks the restored data.",
  responses: { 201: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

// ─── LLM text endpoints ───────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/llms/agent-configuration.txt",
  tags: ["llms"],
  summary: "Get agent configuration as plain text (for LLM context)",
  responses: {
    200: { description: "Plain text agent configuration" },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/llms/agent-configuration/{adapterType}.txt",
  tags: ["llms"],
  summary: "Get agent configuration for a specific adapter type",
  request: { params: z.object({ adapterType: z.string() }) },
  responses: {
    200: { description: "Plain text agent configuration" },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/llms/agent-icons.txt",
  tags: ["llms"],
  summary: "Get agent icon names as plain text",
  responses: {
    200: { description: "Plain text icon list" },
    401: r.unauthorized,
  },
});

// ─── Issues (legacy / misc) ───────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/issues",
  tags: ["issues"],
  summary:
    "Legacy — returns error directing to /api/spaces/{spaceId}/issues",
  responses: { 400: r.badRequest },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/comments/{commentId}",
  tags: ["issues"],
  summary: "Get a single issue comment",
  request: { params: z.object({ id: z.string(), commentId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/link-preview",
  tags: ["spaces"],
  summary: "Read optional link metadata for the current operator user",
  description: "Outpost access and operator authentication are required. This read uses a viewer-scoped cache and returns a quiet null preview when provider access is unavailable. It does not change tasks or schedule background work.",
  request: { params: z.object({ spaceId: z.string() }), query: z.object({ url: z.string().max(2048) }) },
  responses: {
    200: r.ok(z.object({
      preview: z.object({
        target: z.object({ provider: z.string(), kind: z.string(), canonicalUrl: z.string(), label: z.string() }),
        title: z.string(), state: z.enum(["unknown", "open", "draft", "merged", "closed", "conflicts"]),
        author: z.string().nullable(), updatedAt: z.string().nullable(),
      }).nullable(),
      maxAgeMs: z.number(),
    })),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/external-objects",
  tags: ["issues"],
  summary: "List external objects mentioned by an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/external-object-summary",
  tags: ["issues"],
  summary: "Get external object status summary for an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/issues/external-object-summaries",
  tags: ["issues"],
  summary: "Get external object status summaries for issues",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(externalObjectSummariesBodySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/external-objects/refresh",
  tags: ["issues"],
  summary: "Refresh external objects mentioned by an issue",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(refreshExternalObjectsBodySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}/external-object-summary",
  tags: ["projects"],
  summary: "Get external object status summary for a project",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Agent hierarchy images ───────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/agent-hierarchy.svg",
  tags: ["spaces"],
  summary: "Get agent hierarchy as SVG",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: { description: "SVG image" }, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/agent-hierarchy.png",
  tags: ["spaces"],
  summary: "Get agent hierarchy as PNG",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: { description: "PNG image" }, 401: r.unauthorized },
});

// ─── Space portability (legacy routes) ─────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/spaces/issues",
  tags: ["spaces"],
  summary: "Legacy — returns error directing to correct issues path",
  responses: { 400: r.badRequest },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/{spaceId}/export",
  tags: ["spaces"],
  summary: "Export a space (legacy singular form)",
  request: {
    params: z.object({ spaceId: z.string() }),
    body: jsonBody(spacePortabilityExportSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/{spaceId}/export/fidelity",
  tags: ["spaces"],
  summary: "Report space data that an export bundle does not include",
  request: { params: z.object({ spaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/import/preview",
  tags: ["spaces"],
  summary: "Preview a space import (legacy route)",
  description:
    "Accepts either the inline JSON body (`application/json`) or the raw space " +
    "package uploaded as a compressed zip (`multipart/form-data` with a `package` " +
    "file field plus a JSON `meta` field carrying the other import fields, or a bare " +
    "`application/zip` body with the `meta` JSON in the `meta` query parameter). The " +
    'zip is unzipped server-side into the same `{ source: { type: "inline", ... } }` ' +
    "bundle the JSON body carries.",
  request: { body: importRequestBody(spacePortabilityPreviewSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/spaces/import",
  tags: ["spaces"],
  summary: "Apply a space import (legacy route)",
  description:
    "Accepts either the inline JSON body (`application/json`) or the raw space package " +
    "uploaded as a compressed zip (`multipart/form-data` with a `package` file field plus a " +
    "JSON `meta` field, or a bare `application/zip` body with the `meta` JSON in the `meta` " +
    "query parameter); the zip is unzipped server-side into the same import bundle. " +
    "Callers can opt into asynchronous processing: trusted Cloud tenants set the " +
    "`x-outpost-cloud-async-import: 1` header (browsers cannot — the Cloud harness proxy " +
    "strips inbound `x-outpost-cloud-*` headers), while operator sessions use the proxy-safe " +
    "`?async=1` query parameter. Either way the server responds 202 with a job id and status " +
    "URL instead of holding the connection open for the whole import. While an operator actor " +
    "already has an async job running, a resubmit returns 409 carrying the running job's id " +
    "and status URL. Jobs are held in memory and are lost on restart.",
  request: {
    query: z.object({ async: z.enum(["1"]).optional() }),
    body: importRequestBody(spacePortabilityImportSchema),
  },
  responses: {
    200: r.ok(),
    202: { description: "Async import job accepted" },
    400: r.badRequest,
    401: r.unauthorized,
    409: {
      description: "An async import job is already running for this actor",
    },
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: SPACE_IMPORT_TRANSFERS_API_PATH,
  tags: ["spaces"],
  summary: "Declare a chunked space import transfer",
  description:
    "Declares the caller's existing space package .zip as content-addressed byte-range parts " +
    "(whole-file plus per-part sha256). Re-declaring the same zip resumes the prior transfer " +
    "with its uploaded parts intact; the response carries the transfer id and the part indexes " +
    "still missing.",
  request: { body: jsonBody(spaceImportTransferDeclarationSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "put",
  path: `${SPACE_IMPORT_TRANSFERS_API_PATH}/{transferId}/parts/{partIndex}`,
  tags: ["spaces"],
  summary: "Upload one declared part of a space import transfer",
  description:
    "Raw part bytes as the request body. The upload is verified against the declared byte size " +
    "and sha256 before it is spooled; re-uploading an already completed part is a no-op success. " +
    "Uploading against a transfer the abandoned-spool sweep has expired returns 410 — the client " +
    "re-creates the transfer.",
  request: {
    params: z.object({ transferId: z.string(), partIndex: z.string() }),
    body: {
      content: {
        "application/octet-stream": {
          schema: {
            type: "string",
            format: "binary",
            description: "The raw part bytes.",
          },
        },
      },
      required: true as const,
    },
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    409: { description: "The transfer has already been applied" },
    410: {
      description: "The transfer expired and its spooled parts were deleted",
    },
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: `${SPACE_IMPORT_TRANSFERS_API_PATH}/{transferId}`,
  tags: ["spaces"],
  summary: "Get space import transfer progress",
  description:
    "Resume polling for a chunked import transfer: the transfer status plus which declared " +
    "parts are completed and which are still missing.",
  request: { params: z.object({ transferId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: `${SPACE_IMPORT_TRANSFERS_API_PATH}/{transferId}/preview`,
  tags: ["spaces"],
  summary: "Preview a completed space import transfer",
  description:
    "Runs the import preview against the assembled spool without consuming the transfer: the " +
    "ledger run stays open and the parts stay spooled, so the subsequent apply reuses them " +
    "instead of re-uploading. The JSON body carries the same fields as the multipart preview " +
    "route's `meta` field (include, target, collisionStrategy, ...).",
  request: {
    params: z.object({ transferId: z.string() }),
    body: jsonBody(spacePortabilityPreviewSchema.omit({ source: true })),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: {
      description:
        "Parts are still missing, an apply is in progress, or the transfer was already applied",
    },
    410: {
      description: "The transfer expired and its spooled parts were deleted",
    },
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: `${SPACE_IMPORT_TRANSFERS_API_PATH}/{transferId}/apply`,
  tags: ["spaces"],
  summary: "Apply a completed space import transfer",
  description:
    "Assembles the spooled parts back into the original zip, verifies the whole file against " +
    "the declared hash fail-closed, and runs it through the same import pipeline as the " +
    "single-shot upload — including the async import job machinery via the proxy-safe " +
    "`?async=1` query parameter. The JSON body carries the same import fields as the multipart " +
    "route's `meta` field (include, target, collisionStrategy, ...). Overlapping applies of " +
    "the same transfer are serialized: exactly one proceeds, the rest get 409.",
  request: {
    params: z.object({ transferId: z.string() }),
    query: z.object({ async: z.enum(["1"]).optional() }),
    body: jsonBody(spacePortabilityImportSchema.omit({ source: true })),
  },
  responses: {
    200: r.ok(),
    202: { description: "Async import job accepted" },
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: {
      description:
        "Parts are still missing, an apply is already in progress, or the transfer was already applied",
    },
    410: {
      description: "The transfer expired and its spooled parts were deleted",
    },
    422: r.unprocessable,
  },
});

// ─── Operator claim & CLI auth ───────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/operator-claim/{token}",
  tags: ["access"],
  summary: "Get operator claim details by token",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/operator-claim/{token}/claim",
  tags: ["access"],
  summary: "Claim an operator token",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/cli-auth/challenges/{id}",
  tags: ["access"],
  summary: "Get a CLI auth challenge",
  request: { params: z.object({ id: cliAuthChallengeIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 404: r.notFound },
});

// ─── Invite onboarding ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/logo",
  tags: ["access"],
  summary: "Get space logo for an invite",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: { description: "Image file" }, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/onboarding",
  tags: ["access"],
  summary: "Get onboarding data for an invite",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/onboarding.txt",
  tags: ["access"],
  summary: "Get onboarding instructions as plain text",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: { description: "Plain text onboarding instructions" },
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/skills/index",
  tags: ["access"],
  summary: "Get skills index for an invite",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/skills/{skillName}",
  tags: ["access"],
  summary: "Get a skill by name for an invite",
  request: { params: z.object({ token: z.string(), skillName: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/test-resolution",
  tags: ["access"],
  summary: "Test invite token resolution",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

// ─── Admin ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/admin/users/{userId}/space-access",
  tags: ["admin"],
  summary: "Get space access for a user (admin)",
  request: { params: z.object({ userId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/admin/users/{userId}/space-access",
  tags: ["admin"],
  summary: "Set space access for a user (admin)",
  request: {
    params: z.object({ userId: z.string() }),
    body: jsonBody(updateUserSpaceAccessSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/users/{userId}/promote-instance-admin",
  tags: ["admin"],
  summary: "Promote a user to instance admin",
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/users/{userId}/demote-instance-admin",
  tags: ["admin"],
  summary: "Demote a user from instance admin",
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Project workspace runtime ────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/projects/{id}/workspaces/{workspaceId}/runtime-services/{action}",
  tags: ["projects"],
  summary: "Control a runtime service in a project workspace",
  request: {
    params: z.object({
      id: z.string(),
      workspaceId: z.string(),
      action: z.string(),
    }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/projects/{id}/workspaces/{workspaceId}/runtime-commands/{action}",
  tags: ["projects"],
  summary: "Run a runtime command in a project workspace",
  request: {
    params: z.object({
      id: z.string(),
      workspaceId: z.string(),
      action: z.string(),
    }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Plugin bridge stream ─────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/bridge/stream/{channel}",
  tags: ["plugins"],
  summary: "Subscribe to a plugin bridge SSE stream",
  request: { params: z.object({ pluginId: z.string(), channel: z.string() }) },
  responses: {
    200: { description: "Server-sent event stream (text/event-stream)" },
    401: r.unauthorized,
  },
});

// ─── Plugin UI static ─────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/_plugins/{pluginId}/ui/{filePath}",
  tags: ["plugins"],
  summary: "Serve plugin UI static file",
  request: { params: z.object({ pluginId: z.string(), filePath: z.string() }) },
  responses: { 200: { description: "Static file content" }, 404: r.notFound },
});

// ─── Adapter UI parser ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/adapters/{type}/ui-parser.js",
  tags: ["adapters"],
  summary: "Get adapter UI parser script",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: { description: "JavaScript file" }, 404: r.notFound },
});

// ─── Current route coverage ─────────────────────────────────────────────────

registerCurrentRoute({
  method: "get",
  path: "/api/adapters/{type}",
  tags: ["adapters"],
  summary: "Get adapter registration details",
});

registerCurrentRoute({
  method: "post",
  path: "/api/health/dev-server/restart",
  tags: ["health"],
  summary: "Request a managed dev-server instance restart",
  description: "Request a restart of this Outpost instance through its managed development-server supervisor. In authenticated deployments this requires an operator identity; an agent credential does not inherit operator access from its responsible user or from a chat request. Hand that operation to an authorized operator/operator when the route denies the current agent. Returns 404 when no managed supervisor is available and 409 when no restart is required. Acceptance is not proof that the restart completed. This operation does not delete stored conversations or task comments.",
  responses: {
    202: r.ok(),
    403: r.forbidden,
    404: r.notFound,
    409: { description: "Restart is not required" },
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/bootstrap/claim",
  tags: ["access"],
  summary: "Claim first instance admin from a browser session",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    409: { description: "Instance admin already claimed" },
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/operator-api-keys",
  tags: ["access"],
  summary: "List operator API keys",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registerCurrentRoute({
  method: "post",
  path: "/api/operator-api-keys",
  tags: ["access"],
  summary: "Create a named operator API key",
  body: createOperatorApiKeySchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/operator-api-keys/{keyId}",
  tags: ["access"],
  summary: "Revoke an operator API key",
});

registry.registerPath({
  method: "get",
  path: "/api/spaces/import/jobs/{jobId}",
  tags: ["spaces"],
  summary: "Get space import job status",
  description:
    "A job is readable only by the actor that created it — the operator user or the trusted Cloud " +
    "tenant identity from the async import submission. Any other caller gets the same 404 as an " +
    "unknown id. Jobs are held in memory: they are dropped a few minutes after finishing and do " +
    "not survive a server restart.",
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

for (const route of [
  ["get", "/api/spaces/{spaceId}/search", "Search space data"],
  [
    "get",
    "/api/spaces/{spaceId}/search/extract",
    "Extract space search matches",
  ],
  [
    "get",
    "/api/spaces/{spaceId}/issues/count",
    "Count issues in a space",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["spaces"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "get",
  path: "/api/spaces/{spaceId}/folders",
  tags: ["folders"],
  summary: "List folders for a space item kind",
  query: z.object({ kind: folderKindSchema }),
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/folders",
  tags: ["folders"],
  summary: "Create a folder",
  body: createFolderSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/folders/ensure-my",
  tags: ["folders"],
  summary: "Ensure the current user's personal skill folder exists",
  body: ensureMySkillFolderSchema,
});

registerCurrentRoute({
  method: "patch",
  path: "/api/spaces/{spaceId}/folders/{folderId}",
  tags: ["folders"],
  summary: "Update a folder",
  body: updateFolderSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/folders/items/move",
  tags: ["folders"],
  summary: "Move an item into or out of a folder",
  body: moveFolderItemSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/folders/{folderId}/move",
  tags: ["folders"],
  summary: "Move or reorder a folder",
  body: moveFolderSchema,
});

registerCurrentRoute({
  method: "delete",
  path: "/api/spaces/{spaceId}/folders/{folderId}",
  tags: ["folders"],
  summary: "Delete a folder",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/cost-summary",
  tags: ["costs"],
  summary: "Get issue cost summary",
});

registerCurrentRoute({
  method: "put",
  path: "/api/spaces/{spaceId}/resource-memberships/me/documents/{documentId}",
  tags: ["resource-memberships"],
  summary: "Star or unstar a document resource",
  body: updateDocumentResourceMembershipSchema,
});

for (const route of [
  [
    "get",
    "/api/spaces/{spaceId}/resource-memberships/me",
    "List current user's resource memberships",
  ],
  [
    "put",
    "/api/spaces/{spaceId}/resource-memberships/me/agents/{agentId}",
    "Join or leave an agent resource",
  ],
  [
    "put",
    "/api/spaces/{spaceId}/resource-memberships/me/projects/{projectId}",
    "Join or leave a project resource",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["resource-memberships"],
    summary: route[2],
    ...(route[0] === "put" ? { body: updateResourceMembershipSchema } : {}),
  });
}

for (const route of [
  [
    "get",
    "/api/spaces/{spaceId}/secret-providers/health",
    "Check configured secret providers",
  ],
  [
    "get",
    "/api/spaces/{spaceId}/secret-provider-configs",
    "List secret provider configurations",
  ],
  [
    "get",
    "/api/secret-provider-configs/{id}",
    "Get a secret provider configuration",
  ],
  [
    "delete",
    "/api/secret-provider-configs/{id}",
    "Delete a secret provider configuration",
  ],
  [
    "post",
    "/api/secret-provider-configs/{id}/default",
    "Set the default secret provider configuration",
  ],
  [
    "post",
    "/api/secret-provider-configs/{id}/health",
    "Check a secret provider configuration",
  ],
  ["get", "/api/secrets/{id}/usage", "Get secret usage"],
  ["get", "/api/secrets/{id}/access-events", "List secret access events"],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["secrets"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/secret-provider-configs",
  tags: ["secrets"],
  summary: "Create a secret provider configuration",
  body: createSecretProviderConfigSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/secret-provider-configs/{id}",
  tags: ["secrets"],
  summary: "Update a secret provider configuration",
  body: updateSecretProviderConfigSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/secret-provider-configs/discovery/preview",
  tags: ["secrets"],
  summary: "Preview secret provider discovery",
  body: secretProviderConfigDiscoveryPreviewSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/secrets/remote-import/preview",
  tags: ["secrets"],
  summary: "Preview remote secret import",
  body: remoteSecretImportPreviewSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/secrets/remote-import",
  tags: ["secrets"],
  summary: "Import remote secrets",
  body: remoteSecretImportSchema,
});

for (const route of [
  ["get", "/api/skills/catalog", "List catalog skills"],
  ["get", "/api/skills/catalog/{catalogId}", "Get a catalog skill"],
  ["get", "/api/skills/catalog/{catalogId}/files", "List catalog skill files"],
  [
    "post",
    "/api/spaces/{spaceId}/skills/install-catalog",
    "Install a catalog skill",
  ],
  [
    "get",
    "/api/spaces/{spaceId}/skills/categories",
    "List space skill categories",
  ],
  [
    "post",
    "/api/spaces/{spaceId}/skills/{skillId}/audit",
    "Audit a space skill",
  ],
  [
    "patch",
    "/api/spaces/{spaceId}/skills/{skillId}",
    "Update a space skill",
  ],
  [
    "get",
    "/api/spaces/{spaceId}/skills/{skillId}/versions",
    "List skill versions",
  ],
  [
    "post",
    "/api/spaces/{spaceId}/skills/{skillId}/versions",
    "Create a skill version",
  ],
  [
    "get",
    "/api/spaces/{spaceId}/skills/{skillId}/versions/{versionId}",
    "Get a skill version",
  ],
  [
    "post",
    "/api/spaces/{spaceId}/skills/{skillId}/star",
    "Star a space skill",
  ],
  [
    "delete",
    "/api/spaces/{spaceId}/skills/{skillId}/star",
    "Unstar a space skill",
  ],
  [
    "get",
    "/api/spaces/{spaceId}/skills/{skillId}/fork-precheck",
    "Preview space skill fork impact",
  ],
  [
    "post",
    "/api/spaces/{spaceId}/skills/{skillId}/fork",
    "Fork a space skill",
  ],
  [
    "get",
    "/api/spaces/{spaceId}/skills/{skillId}/comments",
    "List skill comments",
  ],
  [
    "post",
    "/api/spaces/{spaceId}/skills/{skillId}/comments",
    "Create a skill comment",
  ],
  [
    "patch",
    "/api/spaces/{spaceId}/skills/{skillId}/comments/{commentId}",
    "Update a skill comment",
  ],
  [
    "delete",
    "/api/spaces/{spaceId}/skills/{skillId}/comments/{commentId}",
    "Delete a skill comment",
  ],
  [
    "post",
    "/api/spaces/{spaceId}/skills/{skillId}/reset",
    "Reset a space skill",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["skills"],
    summary: route[2],
    ...(route[0] === "post"
      ? { body: z.record(z.string(), z.unknown()).optional() }
      : {}),
  });
}

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/accepted-plan-decompositions",
  tags: ["issues"],
  summary: "List accepted plan decompositions",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/accepted-plan-decompositions",
  tags: ["issues"],
  summary: "Create accepted plan decomposition child issues",
  body: createAcceptedPlanDecompositionSchema,
});

for (const route of [
  [
    "get",
    "/api/issues/{id}/documents/{key}/annotations",
    "List document annotation threads",
  ],
  [
    "get",
    "/api/issues/{id}/documents/{key}/annotations/{threadId}",
    "Get a document annotation thread",
  ],
  ["post", "/api/issues/{id}/documents/{key}/lock", "Lock an issue document"],
  [
    "post",
    "/api/issues/{id}/documents/{key}/unlock",
    "Unlock an issue document",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["issues"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/documents/{key}/annotations",
  tags: ["issues"],
  summary: "Create a document annotation thread",
  body: createDocumentAnnotationThreadSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/documents/{key}/annotations/{threadId}/comments",
  tags: ["issues"],
  summary: "Add a document annotation comment",
  body: createDocumentAnnotationCommentSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/low-trust/promotions",
  tags: ["issues"],
  summary: "Promote quarantined low-trust output",
  body: z.object({
    sourceArtifactKind: z.enum([
      "comment",
      "document",
      "work_product",
      "issue",
    ]),
    sourceArtifactId: z.string().guid(),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(8_000),
  }),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/issues/{id}/documents/{key}/annotations/{threadId}",
  tags: ["issues"],
  summary: "Update a document annotation thread",
  body: updateDocumentAnnotationThreadSchema,
});

for (const route of [
  [
    "get",
    "/api/routines/{id}/description/annotations",
    "List routine description annotation threads",
  ],
  [
    "get",
    "/api/routines/{id}/description/annotations/{threadId}",
    "Get a routine description annotation thread",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["routines"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/routines/{id}/description/annotations",
  tags: ["routines"],
  summary: "Create a routine description annotation thread",
  body: createDocumentAnnotationThreadSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/routines/{id}/description/annotations/{threadId}/comments",
  tags: ["routines"],
  summary: "Add a routine description annotation comment",
  body: createDocumentAnnotationCommentSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/routines/{id}/description/annotations/{threadId}",
  tags: ["routines"],
  summary: "Update a routine description annotation thread",
  body: updateDocumentAnnotationThreadSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/diagnostics/blockers",
  tags: ["issues"],
  summary: "Get blocker diagnostics for an issue",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/diagnostics/wakes",
  tags: ["issues"],
  summary: "Get wake diagnostics for an issue",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/diagnostics/subtree",
  tags: ["issues"],
  summary: "Get bounded subtree wake and blocker diagnostics for an issue",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/recovery-actions",
  tags: ["issues"],
  summary: "List issue recovery actions",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/retry",
  tags: ["issues"],
  summary: "Request one durable task retry from current input and preserved results",
  body: taskRetrySchema,
  responses: { 200: r.ok(), 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/recover-workspace",
  tags: ["issues"],
  summary: "Request safe recovery of a retained workspace without restarting the source turn",
  body: recoverWorkspaceSchema,
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/resume-workspace-finalization",
  tags: ["issues"],
  summary: "Resume a saved native result after operator verification of the prior workspace owner's stop",
  body: resumeWorkspaceFinalizationSchema,
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/confirm-controller-stopped",
  tags: ["issues"],
  summary: "Confirm that a native run's previous server stopped when its host was not recorded",
  body: confirmNativeControllerStoppedSchema,
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/confirm-run-stopped",
  tags: ["issues"],
  summary: "Confirm that a local run whose process was never recorded stopped, so its parked Retry can start",
  body: confirmRunStoppedSchema,
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/confirm-owner-gone",
  tags: ["issues"],
  summary: "Confirm that the unrecorded server holding a stuck recovery record stopped, so recovery can release it",
  body: confirmOwnerGoneSchema,
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/retry-workspace-export",
  tags: ["issues"],
  summary: "Retry only workspace export for a repaired accepted native result",
  body: retryWorkspaceExportSchema,
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/reconstruct-workspace",
  tags: ["issues"],
  summary: "Continue from saved task attachments after confirmed destruction of the original workspace",
  body: reconstructWorkspaceSchema,
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/resolve",
  tags: ["issues"],
  summary: "Resolve an issue recovery action",
  body: resolveIssueRecoveryActionSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/scheduled-retry/retry-now",
  tags: ["issues"],
  summary: "Retry a scheduled issue run now",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/monitor/check-now",
  tags: ["issues"],
  summary: "Run an issue monitor check now; humans may check blocked tasks",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/cancel",
  tags: ["issues"],
  summary: "Cancel an issue question interaction",
  body: cancelIssueThreadInteractionSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/dismiss",
  tags: ["issues"],
  summary: "Defer a request to conversation history (human operator users only)",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/skip",
  tags: ["issues"],
  summary: "Skip a pending issue thread interaction",
  body: skipIssueThreadInteractionSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/withdraw",
  tags: ["issues"],
  summary: "Withdraw a pending issue thread interaction",
  body: withdrawIssueThreadInteractionSchema,
});

for (const route of [
  ["get", "/api/routines/{id}/revisions", "List routine revisions"],
  [
    "post",
    "/api/routines/{id}/revisions/{revisionId}/restore",
    "Restore a routine revision",
  ],
  [
    "get",
    "/api/routines/{id}/description/annotations",
    "List routine description annotation threads",
  ],
  [
    "get",
    "/api/routines/{id}/description/annotations/{threadId}",
    "Get a routine description annotation thread",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["routines"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/routines/{id}/description/annotations",
  tags: ["routines"],
  summary: "Create a routine description annotation thread",
  body: createDocumentAnnotationThreadSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/routines/{id}/description/annotations/{threadId}/comments",
  tags: ["routines"],
  summary: "Add a routine description annotation comment",
  body: createDocumentAnnotationCommentSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/routines/{id}/description/annotations/{threadId}",
  tags: ["routines"],
  summary: "Update a routine description annotation thread",
  body: updateDocumentAnnotationThreadSchema,
});

const pluginLocalFolderRequestSchema = z.object({
  path: z.string().min(1),
  access: z.enum(["read", "readWrite"]).optional(),
  requiredDirectories: z.array(z.string()).optional(),
  requiredFiles: z.array(z.string()).optional(),
});

for (const route of [
  [
    "get",
    "/api/plugins/{pluginId}/spaces/{spaceId}/local-folders",
    "List plugin local folders",
  ],
  [
    "get",
    "/api/plugins/{pluginId}/spaces/{spaceId}/local-folders/{folderKey}/status",
    "Get plugin local folder status",
  ],
  [
    "post",
    "/api/plugins/{pluginId}/spaces/{spaceId}/local-folders/{folderKey}/validate",
    "Validate a plugin local folder",
  ],
  [
    "put",
    "/api/plugins/{pluginId}/spaces/{spaceId}/local-folders/{folderKey}",
    "Save a plugin local folder",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["plugins"],
    summary: route[2],
    ...(route[0] === "post" || route[0] === "put"
      ? { body: pluginLocalFolderRequestSchema }
      : {}),
  });
}

// --- Connection intents ------------------------------------------------------

registerCurrentRoute({
  method: "post",
  path: "/api/mcp/project-tools",
  tags: ["projects"],
  summary: "Call project and task tools through the active task run's MCP transport",
  body: z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).nullable().optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  responses: { 200: r.ok(), 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/runtime-tools/github/credentials",
  tags: ["connection-intents"],
  summary:
    "Resolve operation credentials using a run capability with github_credentials scope; browser sessions are rejected",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/mcp/runtime-tools",
  tags: ["connection-intents"],
  summary: "Reject SSE discovery because the runtime tools endpoint supports POST only",
  responses: { 405: { description: "SSE stream is not supported" }, 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "post",
  path: "/mcp/runtime-tools",
  tags: ["connection-intents"],
  summary: "Call the heartbeat-bound runtime tools MCP endpoint",
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/runtime-tools/connections/search",
  tags: ["connection-intents"],
  summary: "Search connections available to the active heartbeat run",
  body: connectionsSearchInputSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/runtime-tools/connections/request",
  tags: ["connection-intents"],
  summary: "Request a connection for the active heartbeat run",
  body: connectionRequestInputSchema,
});

const ADDRESSED_CONNECTION_REQUEST = "Person-only: a connection request card is addressed to one person, its addresseeUserId. "
  + "Only that person, signed in to their own browser, can open its setup, connect their account or decline it. The server refuses every other member, operator user and agent, so nobody can finish it for them. "
  + "When someone else offers to finish it, tell them the addressee must connect their own account from the card on its task, linked as [<identifier>](/<prefix>/issues/<identifier>). "
  + "Do not create another request for the addressee and do not search for another route.";

registerCurrentRoute({
  method: "get",
  path: "/api/connection-intents/{interactionId}/setup-options",
  tags: ["connection-intents"],
  summary: "Get setup options for an addressed connection request",
  description: ADDRESSED_CONNECTION_REQUEST,
});

registerCurrentRoute({
  method: "post",
  path: "/api/connection-intents/{interactionId}/phase",
  tags: ["connection-intents"],
  summary: "Update the setup phase for an addressed connection request",
  description: ADDRESSED_CONNECTION_REQUEST,
  body: z
    .object({
      phase: z.enum(["requested", "authorizing", "needs_retry"]),
      setupAccess: connectionIntentPayloadSchema.shape.setupAccess,
    })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/connection-intents/{interactionId}/complete",
  tags: ["connection-intents"],
  summary: "Complete an addressed connection request",
  description: ADDRESSED_CONNECTION_REQUEST,
  body: completeConnectionIntentSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/agents/{id}/connection-intents/{interactionId}/adopt",
  tags: ["connection-intents", "agents"],
  summary: "Validate and atomically adopt an AI connection for a legacy agent",
  body: completeConnectionIntentSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/connection-intents/{interactionId}/decline",
  tags: ["connection-intents"],
  summary: "Decline an addressed connection request",
  description: ADDRESSED_CONNECTION_REQUEST,
  body: declineConnectionIntentSchema,
});

// --- AI runtime connections -------------------------------------------------

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/ai-connection-pools",
  tags: ["ai-connections"],
  summary: "List space AI connection pools for connection managers",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/ai-connection-pools",
  tags: ["ai-connections"],
  summary: "Create or revise an experimental plugin-owned connection pool",
  body: z.object({ pluginKey: z.string().min(1), id: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional(), config: aiConnectionPoolConfigSchema }).strict(),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "delete",
  path: "/api/spaces/{spaceId}/ai-connection-pools/{poolId}",
  tags: ["ai-connections"],
  summary: "Delete a connection pool while retaining task and run records",
  body: z.object({ expectedRevision: z.number().int().positive() }).strict(),
  responses: { 200: r.ok(z.object({ ok: z.literal(true) })), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/ai-connection-pools/{poolId}/inspection",
  tags: ["ai-connections"],
  summary: "Inspect authorized pool members and fresh cached usage without probing",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/ai-connections/{connectionId}/identity",
  tags: ["ai-connections"],
  summary: "Read the selected authorized AI account's provider email and organization",
  query: z.object({ grantId: z.string().uuid().optional() }),
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/ai-connections/{connectionId}/usage",
  tags: ["ai-connections"],
  summary: "Probe the selected AI account’s provider usage limits on demand",
  query: z.object({ grantId: z.string().uuid().optional() }),
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/ai-connections",
  tags: ["ai-connections"],
  summary: "List available AI connections, personal defaults, and connection-manager access",
  query: z.object({ agentId: z.string().uuid().optional() }),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/ai-connections",
  tags: ["ai-connections"],
  summary: "Validate and connect an AI API key, or reconnect its existing grant",
  body: createAiConnectionSchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "put",
  path: "/api/spaces/{spaceId}/ai-connections/default",
  tags: ["ai-connections"],
  summary: "Set the signed-in owner’s personal AI default",
  body: z.object({ grantId: z.string().uuid() }),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/ai-connections/{connectionId}/active-runs",
  tags: ["ai-connections"],
  summary: "List active runs attributed to an AI connection",
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/ai-connections/login/{sessionId}",
  tags: ["ai-connections"],
  summary: "Get the connection saved by an owned completed login",
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/ai-connections/login/{sessionId}/setup",
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  tags: ["ai-connections"], summary: "Reopen an owned saved AI sign-in with its original account and environment",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

// --- Tool access -------------------------------------------------------------

/** Where a person manages a space model service; agents relay this page instead of guessing a settings route. */
function spaceModelServiceSettingsPage(section: string, condition = "") {
  return `People who manage connections configure, enable and test this in the ${section} section of the space-prefixed /space/settings/connections page; link it as a Markdown link to /<prefix>/space/settings/connections, not the general /space/settings page.${condition} Agent credentials cannot change or test it.`;
}

for (const [method, suffix, summary] of [
  ["get", "", "Get prompt injection settings and eligible shared OpenRouter connections; non-managers receive no settings or choices"],
  ["put", "", "Configure opt-in prompt injection model checks as an operator connection manager"],
  ["get", "/models", "List OpenRouter model suggestions for an authorized shared connection as an operator connection manager"],
  ["post", "/test", "Classify two fixed billed samples using saved settings as an operator connection manager; fallback is not a passing model test"],
] as const) registerCurrentRoute({
  method, path: `/api/spaces/{spaceId}/prompt-injection-prevention${suffix}`,
  tags: ["prompt-injection-prevention"], summary, description: spaceModelServiceSettingsPage("Prompt Injection Prevention"),
  ...(method === "put" ? { body: updatePromptInjectionPreventionSchema } : {}),
  ...(method === "post" ? { body: z.object({}).strict() } : {}),
  ...(suffix === "/models" ? { query: z.object({ connectionId: z.string().uuid() }) } : {}),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});

for (const [method, suffix, summary] of [
  ["get", "", "Get fast response settings and compatible shared API connections"],
  ["put", "", "Configure the space fast response model"],
  ["get", "/models", "List models for an authorized API connection"],
  ["get", "/availability", "Check fast response configuration without contacting the provider"],
  ["post", "/test", "Generate a fixed billed fast response sample"],
  ["get", "/history", "List fast response accounting and publication outcomes"],
] as const) registerCurrentRoute({ method, path: `/api/spaces/{spaceId}/fast-response${suffix}`, tags: ["fast-responses"], summary,
  description: spaceModelServiceSettingsPage("Fast response", " The section is shown only while an instance admin has fast responses turned on in /<prefix>/space/settings/instance/experimental."),
  ...(method === "put" ? { body: updateFastResponseSchema } : {}), responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable } });

registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/decision-model", tags: ["decision-models"],
  description: spaceModelServiceSettingsPage("Decision model"),
  summary: "Get decision settings, compatible connections, and manager capability",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});
registerCurrentRoute({
  method: "put", path: "/api/spaces/{spaceId}/decision-model", tags: ["decision-models"],
  description: spaceModelServiceSettingsPage("Decision model"),
  summary: "Configure the space decision model as a connection manager", body: updateDecisionModelSchema,
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});
registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/decision-model/availability", tags: ["decision-models"],
  description: spaceModelServiceSettingsPage("Decision model"),
  summary: "Check local decision configuration and caller authorization without contacting a provider",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/decision-model/test", tags: ["decision-models"],
  description: spaceModelServiceSettingsPage("Decision model"),
  summary: "Run the fixed billed three-question setup test as a connection manager",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});
registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/decision-model/history", tags: ["decision-models"],
  description: spaceModelServiceSettingsPage("Decision model"),
  summary: "List decision metadata and charges with authorized task links",
  query: costReportQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(500).optional() }),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/gallery",
  tags: ["tool-access"],
  summary: "List tool app gallery entries",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/apps/{galleryKey}/preflight",
  tags: ["tool-access"],
  summary:
    "Inspect a curated app's public MCP and OAuth metadata without credentials or registration",
});

const OWN_MCP_SERVER_KEY = "When a person's own MCP server needs an API key, the person adds it themselves on [Connect your own MCP server](/<prefix>/apps/byo): they enter its URL and type the key into that page's secure field. "
  + "An agent cannot enter the key and must not ask for it in chat. Link that page and reply instead of creating the connection here.";

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/apps/connect",
  tags: ["tool-access"],
  summary: "Create a draft app connection from gallery input",
  description: OWN_MCP_SERVER_KEY,
  body: connectToolAppSchema,
  responses: {
    200: r.ok(),
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/apps/{connectionId}/finish",
  tags: ["tool-access"],
  summary: "Finish a gallery app connection and profile setup",
  body: finishToolAppSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/apps/{connectionId}/finalize-oauth-access",
  tags: ["tool-access"],
  summary: "Choose personal or space-wide access after OAuth sign-in",
  body: finalizeOAuthAccessSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

const QUARANTINED_ACTION_REVIEW = "Catalog entries with status quarantined are new actions that a catalog refresh found and holds for a person's review. "
  + "No agent can call a quarantined action, through this connection or any other transport, until a person who manages the connection allows it on the app's Permissions page, "
  + "[Permissions](/<prefix>/apps/<connectionId>/permissions), with this conversation's space prefix and the connection's id. Allowing it is that person's decision, not an agent's. "
  + "When asked to use a quarantined action, say it is waiting for review, link that page and reply; do not search for another route.";

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/apps/attention",
  tags: ["tool-access"],
  summary: "List tool apps needing attention",
  description: QUARANTINED_ACTION_REVIEW,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/action-requests",
  tags: ["tool-access"],
  summary: "List pending tool action requests",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/examples",
  tags: ["tool-access"],
  summary: "List installable tool examples",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/examples/{id}/install",
  tags: ["tool-access"],
  summary: "Install a safe tool example",
  responses: {
    200: r.ok(),
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/tools/examples/{id}/smoke",
  tags: ["tool-access"],
  summary: "Run tool example policy smoke checks",
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/applications",
  tags: ["tool-access"],
  summary: "List tool applications",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/applications",
  tags: ["tool-access"],
  summary: "Create a tool application",
  body: createToolApplicationSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "patch",
  path: "/api/tool-applications/{applicationId}",
  tags: ["tool-access"],
  summary: "Update a tool application",
  body: updateToolApplicationSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "delete",
  path: "/api/tool-applications/{applicationId}",
  tags: ["tool-access"],
  summary: "Delete a tool application",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/connections",
  tags: ["tool-access"],
  summary: "List tool connections",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/connections",
  tags: ["tool-access"],
  summary: "Create a tool connection",
  description: "Saves a connection as given without checking that its server answers. To connect an MCP server from its URL, use POST /api/spaces/{spaceId}/tools/apps/connect with link instead: it checks the server first, and a fresh setup saves no connection when the server cannot be reached. "
    + OWN_MCP_SERVER_KEY,
  body: createToolConnectionSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/tool-connections/{connectionId}",
  tags: ["tool-access"],
  summary: "Get a tool connection",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/connections/{connectionId}/start-authorization",
  tags: ["tool-access"],
  summary: "Start user authorization for a tool connection",
  body: startConnectionAuthorizationSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/agents/me/connections/{connectionId}/start-authorization",
  tags: ["tool-access"],
  summary: "Start user authorization for an agent tool connection",
  body: startConnectionAuthorizationSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/tool-connections/{connectionId}/grants",
  tags: ["tool-access"],
  summary: "List tool connection grants",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/tool-connections/{connectionId}/grants/installations",
  tags: ["tool-access"],
  summary: "Add an installation grant to a tool connection",
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}/delegations",
  tags: ["tool-access"],
  summary: "Delegate a personal tool connection grant to an agent",
  body: createConnectionGrantDelegationSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "delete",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}/delegations/{delegationId}",
  tags: ["tool-access"],
  summary: "Revoke a personal tool connection grant delegation",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "delete",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}",
  tags: ["tool-access"],
  summary: "Revoke a tool connection grant",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/tool-connections/{connectionId}/review-counts",
  tags: ["tool-access"],
  summary: "Get pending action request and quarantined catalog entry counts for one connection",
  description: QUARANTINED_ACTION_REVIEW,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/tool-connections/{connectionId}/usage",
  tags: ["tool-access"],
  summary: "Get tool connection usage",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "put",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}/members",
  tags: ["tool-access"],
  summary: "Replace the member audience of a tool connection grant",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/tool-connections/{connectionId}/railway/ssh",
  tags: ["tool-access"],
  summary: "Prepare, enable, or remove a Railway container SSH key",
  body: configureRailwaySshSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "get",
  path: "/api/tool-connections/{connectionId}/installs",
  tags: ["tool-access"],
  summary: "List tool connection installs",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "put",
  path: "/api/tool-connections/{connectionId}/installs",
  tags: ["tool-access"],
  summary: "Sync tool connection installs",
  body: putToolConnectionInstallsSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "patch",
  path: "/api/tool-connections/{connectionId}",
  tags: ["tool-access"],
  summary: "Update a tool connection",
  body: updateToolConnectionSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "delete",
  path: "/api/tool-connections/{connectionId}",
  tags: ["tool-access"],
  summary: "Archive a tool connection",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/tool-connections/{connectionId}/health-check",
  tags: ["tool-access"],
  summary: "Run a tool connection health check",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/tool-connections/{connectionId}/reconnect",
  tags: ["tool-access"],
  summary: "Reconnect a tool app with replacement credentials",
  body: reconnectToolAppSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/tool-connections/{connectionId}/catalog/refresh",
  tags: ["tool-access"],
  summary: "Refresh a tool connection catalog",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/tool-connections/{connectionId}/catalog",
  tags: ["tool-access"],
  summary: "List a tool connection catalog",
  description: QUARANTINED_ACTION_REVIEW,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:audit",
  method: "get",
  path: "/api/tool-connections/{connectionId}/activity",
  tags: ["tool-access"],
  summary: "List tool connection activity",
});

for (const provider of ["aggregator", "composio"] as const) {
  registerCurrentRoute({
    "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
    method: "get", path: `/api/tool-connections/{connectionId}/${provider}/apps`, tags: ["tool-access"],
    summary: "List upstream account observations for the current connection manager",
  });
  registerCurrentRoute({
    "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
    method: "post", path: `/api/tool-connections/{connectionId}/${provider}/apps/sync`, tags: ["tool-access"],
    summary: "Start upstream account discovery without changing tool access",
    body: provider === "aggregator" ? aggregatorAppsSyncSchema : composioAppsSyncSchema,
  });
  registerCurrentRoute({
    "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:configure",
    method: "post", path: `/api/tool-connections/{connectionId}/${provider}/apps/refresh`, tags: ["tool-access"],
    summary: "Refresh upstream account observations",
    body: provider === "aggregator" ? aggregatorAppsRefreshSchema : composioAppsRefreshSchema,
  });
}
registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "put", path: "/api/tool-connections/{connectionId}/aggregator/discovery", tags: ["tool-access"],
  summary: "Save manager-owned optional Arcade account discovery credentials",
  body: arcadeDiscoverySetupSchema,
});
registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post", path: "/api/tool-connections/{connectionId}/composio/apps/{toolkit}/setup", tags: ["tool-access"],
  summary: "Start or verify Composio app authorization through a saved gateway",
  body: composioAppSetupSchema,
});
registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post", path: "/api/tool-connections/{connectionId}/composio/apps/{toolkit}/accounts", tags: ["tool-access"],
  summary: "Manage a Composio account through a saved gateway",
  body: composioAppAccountSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/tool-connections/{connectionId}/test-agents",
  tags: ["tool-access"],
  summary: "List agents available for tool connection test calls",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/tool-connections/{connectionId}/test-agents/{agentId}/access",
  tags: ["tool-access"],
  summary: "Summarize one agent's effective access to a tool connection",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:test",
  method: "post",
  path: "/api/tool-connections/{connectionId}/test-calls",
  tags: ["tool-access"],
  summary: "Run a tool connection test call",
  body: toolConnectionTestCallSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
    501: r.ok(),
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:test",
  method: "get",
  path: "/api/tool-connections/{connectionId}/test-calls/{actionRequestId}",
  tags: ["tool-access"],
  summary: "Get a tool connection test call status",
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    501: r.ok(),
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/tools/oauth/{connectionId}/start",
  tags: ["tool-access"],
  summary: "Start OAuth sign-in for a tool connection",
  body: startToolOAuthSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/callback",
  tags: ["tool-access"],
  summary: "Handle a tool app OAuth callback",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/cloud-connector/callback",
  tags: ["tool-access"],
  summary: "Handle a brokered Outpost Cloud OAuth callback",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/outpost-id/callback",
  tags: ["tool-access"],
  summary: "Handle a legacy brokered Outpost ID OAuth callback",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/cloud-connector/enrollment",
  tags: ["tool-access"],
  summary: "Get Outpost Cloud connector enrollment status",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tools/oauth/cloud-connector/enrollment",
  tags: ["tool-access"],
  summary: "Start Outpost Cloud connector enrollment",
  body: z
    .object({ spaceId: z.string().min(1), label: z.string().optional() })
    .strict(),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/cloud-connector/enrollment-callback",
  tags: ["tool-access"],
  summary: "Complete Outpost Cloud connector enrollment",
  query: z
    .object({
      enrollment_id: z.string().min(1),
      approval_code: z.string().min(1),
      state: z.string().min(1),
    })
    .strict(),
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/vercel-connect/callback",
  tags: ["tool-access"],
  summary: "Handle a managed Vercel Connect OAuth callback",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "get",
  path: "/api/tool-connections/{connectionId}/profile-configuration",
  tags: ["tool-access"],
  summary: "Read connection Permissions profile configuration without summaries or review counts",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/profiles",
  tags: ["tool-access"],
  summary: "List tool access profiles with entries and bindings",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/profiles",
  tags: ["tool-access"],
  summary: "Create a tool access profile",
  body: createToolProfileWithEntriesSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/profiles/effective/agents/{agentId}",
  tags: ["tool-access"],
  summary: "Resolve effective tool access profiles for an agent",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "get",
  path: "/api/tool-profiles/{profileId}/new-tools",
  tags: ["tool-access"],
  summary: "List new catalog tools pending profile review",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "patch",
  path: "/api/tool-profiles/{profileId}",
  tags: ["tool-access"],
  summary: "Update a tool access profile",
  body: updateToolProfileWithEntriesSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/tool-profiles/{profileId}/duplicate",
  tags: ["tool-access"],
  summary: "Duplicate a tool access profile",
  body: duplicateToolProfileSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "delete",
  path: "/api/tool-profiles/{profileId}",
  tags: ["tool-access"],
  summary: "Delete a tool access profile",
  body: deleteToolProfileSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/tool-profiles/{profileId}/new-tools/review",
  tags: ["tool-access"],
  summary: "Review new catalog tools for a profile",
  body: reviewToolProfileNewToolsSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/tool-profiles/{profileId}/entries",
  tags: ["tool-access"],
  summary: "Create a tool access profile entry",
  body: createToolProfileEntryForProfileSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "patch",
  path: "/api/tool-profile-entries/{entryId}",
  tags: ["tool-access"],
  summary: "Update a tool access profile entry",
  body: updateToolProfileEntrySchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "delete",
  path: "/api/tool-profile-entries/{entryId}",
  tags: ["tool-access"],
  summary: "Delete a tool access profile entry",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/profiles/{profileId}/bind",
  tags: ["tool-access"],
  summary:
    "Bind a tool access profile to a space, agent, project, routine, or issue",
  body: createToolProfileBindingForProfileSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/profiles/{profileId}/unbind",
  tags: ["tool-access"],
  summary:
    "Unbind a tool access profile from a space, agent, project, routine, or issue",
  body: unbindToolProfileBindingSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:runtime",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/runtime-slots",
  tags: ["tool-access"],
  summary: "List MCP runtime slots",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:runtime",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/runtime-slots/{id}/stop",
  tags: ["tool-access"],
  summary: "Stop a local stdio MCP runtime slot",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:runtime",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/runtime-slots/{id}/restart",
  tags: ["tool-access"],
  summary: "Restart a local stdio MCP runtime slot",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:runtime",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/runtime-health",
  tags: ["tool-access"],
  summary: "Summarize MCP runtime health and alert recommendations",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:audit",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/runs/{runId}/decisions",
  tags: ["tool-access"],
  summary: "Get controlled tool decisions for a run transcript",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/trust-rules",
  tags: ["tool-access"],
  summary: "List tool trust rules",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/policies",
  tags: ["tool-access"],
  summary: "List tool policies",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/policies/reorder",
  tags: ["tool-access"],
  summary: "Reorder tool policies",
  body: reorderToolPoliciesSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/policies",
  tags: ["tool-access"],
  summary: "Create a tool policy",
  body: createToolPolicySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/policies/{policyId}/duplicate",
  tags: ["tool-access"],
  summary: "Duplicate a tool policy",
  body: duplicateToolPolicySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "patch",
  path: "/api/spaces/{spaceId}/tools/policies/{policyId}",
  tags: ["tool-access"],
  summary: "Update a tool policy",
  body: updateToolPolicySchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "delete",
  path: "/api/spaces/{spaceId}/tools/policies/{policyId}",
  tags: ["tool-access"],
  summary: "Delete a tool policy",
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/tools/action-requests/{actionRequestId}/trust-rule",
  tags: ["tool-access"],
  summary: "Create a tool trust rule from an action request",
  body: createToolTrustRuleFromActionRequestSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:profiles",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/trust-rules/{policyId}/revoke",
  tags: ["tool-access"],
  summary: "Revoke a tool trust rule",
  body: revokeToolTrustRuleSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest", "x-outpost-connection-management": "connections:read",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/stdio-templates",
  tags: ["tool-access"],
  summary: "List approved stdio MCP templates",
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/tools/stdio-templates",
  tags: ["tool-access"],
  summary: "Create an approved stdio MCP template",
  body: createToolStdioCommandTemplateSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/tools/stdio-templates/{templateId}/disable",
  tags: ["tool-access"],
  summary: "Disable an approved stdio MCP template",
  body: disableToolStdioCommandTemplateSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/tools/mcp/import-json",
  tags: ["tool-access"],
  summary: "Preview MCP JSON import",
  body: importMcpJsonSchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/policy/test",
  tags: ["tool-access"],
  summary: "Test tool policy decision",
  body: toolPolicyTestRequestSchema,
});

// --- Tool gateway ------------------------------------------------------------

const toolGatewaySessionSchema = z.object({
  spaceId: z.string().optional(),
  agentId: z.string().optional(),
  runId: z.string().optional(),
  issueId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  ttlMs: z.number().int().positive().optional(),
});

const toolGatewayCallSchema = z.object({
  tool: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  approvedActionRequestId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

const toolGatewaySpaceQuerySchema = z.object({
  spaceId: z.string().optional(),
});
const toolGatewaySpaceBodySchema = z
  .object({
    spaceId: z.string(),
  })
  .passthrough();

const mcpGatewayProtocolSchema = z.record(z.string(), z.unknown());

registerCurrentRoute({
  method: "get",
  path: "/mcp/gateways/{gatewayPublicId}",
  tags: ["tool-gateway"],
  summary: "Describe a public MCP gateway endpoint",
});

registerCurrentRoute({
  method: "post",
  path: "/mcp/gateways/{gatewayPublicId}",
  tags: ["tool-gateway"],
  summary: "Handle MCP gateway protocol requests by public id",
  body: mcpGatewayProtocolSchema,
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    429: r.ok(),
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:gateway",
  method: "get",
  path: "/api/spaces/{spaceId}/tools/gateways",
  tags: ["tool-gateway"],
  summary: "List named MCP gateways",
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:gateway",
  method: "post",
  path: "/api/spaces/{spaceId}/tools/gateways",
  tags: ["tool-gateway"],
  summary: "Create a named MCP gateway",
  description: "Creates a gateway that exposes a tool access profile to external MCP clients. Agents with delegated connection management may create it; agent responses also include gatewayPath (/<prefix>/apps/gateways/<gatewayId>/overview) and tokensPath (/<prefix>/apps/gateways/<gatewayId>/tokens). Link the person to them as Markdown links. A client needs a gateway client token to connect; see POST /api/tool-gateway/gateways/{gatewayId}/tokens.",
  body: createToolMcpGatewaySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:gateway",
  method: "patch",
  path: "/api/tool-gateway/gateways/{gatewayId}",
  tags: ["tool-gateway"],
  summary: "Update a named MCP gateway",
  body: toolGatewaySpaceBodySchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:gateway",
  method: "post",
  path: "/api/tool-gateway/gateways/{gatewayId}/tokens",
  tags: ["tool-gateway"],
  summary: "Create a named MCP gateway token",
  description: "Creates a client token for an external MCP client. A person caller receives the token value once in the response. An agent with delegated connection management may create the token for its responsible person, but receives only metadata (id, tokenPrefix, expiresAt, pendingReveal: true) plus tokensPath, the gateway's Tokens page (/<prefix>/apps/gateways/<gatewayId>/tokens). The value does not exist until that person reveals it there; send the person to tokensPath as a Markdown link, and never ask for, accept, or repeat token values in chat. To rotate, create the replacement and leave the old token active in that turn: its client keeps working on it until the person installs the new value. Revoke the old token only after the person says the client works with the new one, or let them revoke it on the Tokens page.",
  body: toolGatewaySpaceBodySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  method: "post",
  path: "/api/tool-gateway/gateway-tokens/{tokenId}/reveal",
  tags: ["tool-gateway"],
  summary: "Reveal an agent-created MCP gateway token value",
  description: "Person-only. Generates the value of an agent-created client token that is pending reveal and returns it once. Only the token's responsible person can reveal it; a second reveal, or a reveal after the token expired or was revoked, returns 409. Agent callers receive 403 gateway_token_requires_person.",
  body: toolGatewaySpaceQuerySchema.required({ spaceId: true }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:gateway",
  method: "post",
  path: "/api/tool-gateway/gateway-tokens/{tokenId}/revoke",
  tags: ["tool-gateway"],
  summary: "Revoke a named MCP gateway token",
  description: "Revokes a gateway client token immediately; clients using it stop working. Agents with delegated connection management may revoke. When rotating, revoke the old token only after the replacement works.",
  body: toolGatewaySpaceQuerySchema.required({ spaceId: true }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

const museBindingPath = "/api/spaces/{spaceId}/agents/{agentId}/muse-binding";
const museBindingIdentitySchema = z.object({ bindingId: z.uuid(), generation: z.number().int().positive(), expectedRevision: z.number().int().positive() }).strict();
const museQualificationIdentitySchema = z.object({ bindingId: z.uuid(), qualificationId: z.uuid() }).strict();
const museManagementErrors = { 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable };
registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/muse-invitations", tags: ["agents"],
  summary: "Resume the signed-in operator's unfinished personal Muse invitation",
  responses: { 200: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/muse-invitations", tags: ["agents"],
  summary: "Create or resume a personal Muse invitation with space creation approvals",
  body: z.object({ name: z.string().trim().min(1).max(100), role: z.string().trim().min(1).max(100) }).strict(),
  responses: { 200: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "get", path: museBindingPath, tags: ["agents"],
  summary: "Read personal Muse connection, receiver, verified reply, and stop health",
  responses: { 200: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "post", path: museBindingPath, tags: ["agents"],
  summary: "Create a short-lived single-use personal Muse pairing ticket",
  body: z.object({ replaceBindingId: z.uuid().optional(), expectedRevision: z.number().int().positive().optional() }).strict(),
  responses: { 201: r.ok(z.object({ bindingId: z.uuid(), generation: z.number().int().positive(), revision: z.number().int().positive(),
    ticket: z.string(), expiresAt: z.string().datetime(), setupInstruction: z.string(), assetVersion: z.literal(MUSE_ASSET_VERSION) })), ...museManagementErrors },
});
registerCurrentRoute({
  method: "post", path: `${museBindingPath}/verify`, tags: ["agents"],
  summary: "Queue a harmless background reply verification for the current Muse connection",
  body: museBindingIdentitySchema, responses: { 200: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "post", path: `${museBindingPath}/revoke`, tags: ["agents"],
  summary: "Revoke Muse authority immediately and request best-effort receiver cleanup",
  body: museBindingIdentitySchema, responses: { 204: { description: "Authority revoked; remote stopping and cleanup may remain unconfirmed" }, ...museManagementErrors },
});
registerCurrentRoute({
  method: "post", path: `${museBindingPath}/attest-detector-cleanup`, tags: ["agents"],
  summary: "Record a current operator observation that the exact revoked Muse detector is absent",
  body: museDetectorCleanupAttestationSchema, responses: { 200: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "post", path: `${museBindingPath}/attest-stop`, tags: ["agents"],
  summary: "Record operator confirmation that the exact remote Muse work boundary stopped",
  body: z.object({ boundary: museStopBoundarySchema, expectedRevision: z.number().int().positive(), workerStopped: z.literal(true) }).strict(),
  responses: { 200: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "post", path: `${museBindingPath}/qualification`, tags: ["agents"],
  summary: "Begin a bounded 24-hour personal Muse qualification with an immutable deadline",
  body: museQualificationIdentitySchema.extend({ generation: z.number().int().positive(), expectedRevision: z.number().int().positive() }).strict(),
  responses: { 201: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "get", path: `${museBindingPath}/qualification`, tags: ["agents"],
  summary: "Read retained receiver and native assignment qualification evidence",
  query: museQualificationIdentitySchema, responses: { 200: r.ok(), ...museManagementErrors },
});
registerCurrentRoute({
  method: "delete", path: `${museBindingPath}/qualification`, tags: ["agents"],
  summary: "Stop the exact qualification and revoke its authority",
  body: museQualificationIdentitySchema, responses: { 204: { description: "Qualification stopped and authority fenced; remote stopping may remain unconfirmed" }, ...museManagementErrors },
});

const dotInvitationResponseSchema = z.object({
  agent: z.object({ id: z.string().uuid(), name: z.string(), status: z.string() }),
  approvalId: z.string().uuid().nullable(),
  binding: z.object({
    id: z.string().uuid(), status: z.string(), connected: z.boolean(),
    subscriptionVerified: z.boolean(), hasPendingChallenge: z.boolean(),
    pairingExpiresAt: z.string().datetime().nullable(), challengeExpiresAt: z.string().datetime().nullable(),
  }).nullable(),
});
registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/dot-invitations", tags: ["agents"],
  summary: "Resume the signed-in operator's unfinished Dot invitation",
  responses: { 200: r.ok(dotInvitationResponseSchema.nullable()), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/dot-invitations", tags: ["agents"],
  summary: "Create or resume a Dot invitation with space create approval gates",
  body: z.object({}).strict(),
  responses: { 200: r.ok(dotInvitationResponseSchema), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 409: r.conflict },
});

registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/agents/{agentId}/dot-binding", tags: ["agents"],
  summary: "Read the experimental Dot agent connection and event readiness",
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/agents/{agentId}/dot-binding", tags: ["agents"],
  summary: "Create a one-use Dot pairing code as a space operator",
  body: z.object({ dotUrl: z.string().max(2048).optional(), replaceBindingId: z.string().uuid().optional() }).strict(),
  responses: { 201: r.ok(z.object({ bindingId: z.string().uuid(), pairingCode: z.string(), expiresAt: z.string().datetime(), instructions: z.string() })),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/agents/{agentId}/dot-binding/event-test", tags: ["agents"],
  summary: "Request a harmless Dot readiness challenge as a space operator",
  body: z.object({ bindingId: z.string().uuid().optional() }).strict(),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "delete", path: "/api/spaces/{spaceId}/agents/{agentId}/dot-binding", tags: ["agents"],
  summary: "Revoke a Dot connection and fence its active Outpost assignments",
  responses: { 204: { description: "Dot connection revoked; external stop is unconfirmed" },
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/grok-invitations", tags: ["agents"],
  summary: "Resume this operator's unfinished Grok Bot setup",
  responses: { 200: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/grok-invitations", tags: ["agents"],
  summary: "Create Grok Bot agent setup under normal create approval gates",
  body: createGrokInvitationSchema,
  responses: { 201: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "get", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding", tags: ["agents"],
  summary: "Read Grok connection health and visible task activity",
  responses: { 200: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding", tags: ["agents"],
  summary: "Create a one-use Grok agent browser pairing code",
  body: pairGrokBindingSchema,
  responses: { 201: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "put", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding/routine", tags: ["agents"],
  summary: "Store encrypted Grok routine credentials under the current configuration revision",
  body: configureGrokRoutineSchema,
  responses: { 200: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding/verify", tags: ["agents"],
  summary: "Verify routine delivery and authenticated agent reply",
  body: verifyGrokRoutineSchema,
  responses: { 200: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding/retry", tags: ["agents"],
  summary: "Explicitly retry a confirmed rejected routine delivery",
  body: retryGrokDeliverySchema,
  responses: { 200: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding/stop", tags: ["agents"],
  summary: "Revoke Outpost work-session authority without confirming remote termination",
  body: stopGrokWorkSchema,
  responses: { 200: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding/recover", tags: ["agents"],
  summary: "Record remote inspection and require fresh verification",
  body: recoverGrokRoutineSchema,
  responses: { 200: r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "delete", path: "/api/spaces/{spaceId}/agents/{agentId}/grok-binding", tags: ["agents"],
  summary: "Disconnect the Grok agent and fence its work sessions",
  responses: { 204: { description: "Grok agent authority revoked; remote execution is unconfirmed" },
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

const ASSISTANT_CONNECTION_SETUP_PERSON_ONLY = "Person-only: a person connects their own assistant, such as Claude, ChatGPT or another MCP client, in their browser on "
  + "[Assistant connections](/<prefix>/apps/assistant-connection), with this conversation's space prefix as <prefix>. "
  + "That page gives the invitation and server URL to paste into the assistant; the assistant then opens an Outpost consent screen where the person picks the space and approves access. "
  + "The consent screen offers only access within that person's own role: a read-only member can grant read access but not writes. "
  + "An agent cannot read this setup or approve consent for anyone: these routes accept only the person's own signed-in browser session. "
  + "Do not search for another route; link that page, say the person approves access there themselves, and reply.";
registerCurrentRoute({
  method: "get", path: "/api/mcp/setup", tags: ["tool-gateway"],
  summary: "Read assistant connection setup using a human browser session",
  description: ASSISTANT_CONNECTION_SETUP_PERSON_ONLY,
  // Available while disabled; returns metadata only and never grants access.
  responses: {
    200: r.ok(z.object({ enabled: z.boolean(), serverUrl: z.string().url(), invitationUrl: z.string().url(), invitation: z.string() })),
    401: r.unauthorized, 403: r.forbidden, 404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get", path: "/api/mcp/requests/{id}", tags: ["tool-gateway"],
  summary: "Describe an assistant connection request and available sign-in options",
  responses: { 200: r.ok(), 404: r.notFound },
});
registerCurrentRoute({
  method: "post", path: "/api/mcp/requests/{id}/dot-pairing/preview", tags: ["tool-gateway"],
  summary: "Preview exact Dot agent access using a same-origin one-use pairing capability",
  body: z.object({ pairingCode: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict(),
  responses: { 200: r.ok(), 400: r.badRequest, 403: r.forbidden, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/mcp/requests/{id}/dot-pairing", tags: ["tool-gateway"],
  summary: "Consume a same-origin one-use pairing capability and approve its exact Dot agent connection",
  body: z.object({ pairingCode: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict(),
  responses: { 200: r.ok(), 400: r.badRequest, 403: r.forbidden, 409: r.conflict },
});
registerCurrentRoute({
  method: "get", path: "/api/dot-mcp/requests/{id}", tags: ["tool-gateway"],
  summary: "Describe a dedicated Dot connection request; personal requests are unavailable",
  responses: { 200: r.ok(), 404: r.notFound },
});
for (const suffix of ["/dot-pairing/preview", "/dot-pairing"]) registerCurrentRoute({
  method: "post", path: "/api/dot-mcp/requests/{id}" + suffix, tags: ["tool-gateway"],
  summary: suffix.endsWith("preview")
    ? "Preview exact Dot agent access using a same-origin one-use pairing capability"
    : "Consume a same-origin one-use pairing capability and approve its exact Dot agent connection",
  body: z.object({ pairingCode: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict(),
  responses: { 200: r.ok(), 400: r.badRequest, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registerCurrentRoute({
  method: "post", path: "/api/mcp/requests/{id}/consent", tags: ["tool-gateway"],
  summary: "Approve or deny assistant access using a same-origin browser session",
  description: ASSISTANT_CONNECTION_SETUP_PERSON_ONLY,
  body: mcpConsentSchema,
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});
registerCurrentRoute({
  method: "get", path: "/api/mcp/device", tags: ["tool-gateway"],
  summary: "Describe a device approval request without revealing unauthenticated organization data",
  responses: { 200: r.ok(), 400: r.badRequest, 404: r.notFound },
});
registerCurrentRoute({
  method: "post", path: "/api/mcp/device/consent", tags: ["tool-gateway"],
  summary: "Approve or deny a device request using a same-origin human browser session",
  body: mcpConsentSchema.extend({ userCode: z.string().min(8).max(12) }),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});
const ASSISTANT_CONNECTIONS_PERSON_ONLY = "Personal and person-only: only the signed-in person can list or revoke their own assistant connections, in their browser on "
  + "[Assistant connections](/<prefix>/apps/assistant-connection), with this conversation's space prefix as <prefix>. "
  + "An agent cannot do it for them: these routes accept only the person's own signed-in browser session, and the only other revocation is OAuth token revocation sent by the connected assistant itself with its own token. "
  + "Do not search for another route; link that page and tell the person which connection to revoke. "
  + "Revoking stops that assistant's further calls; tasks it already created keep their assignees and running work.";
registerCurrentRoute({
  method: "get", path: "/api/mcp/connections", tags: ["tool-gateway"],
  summary: "List the signed-in person's assistant connections",
  description: ASSISTANT_CONNECTIONS_PERSON_ONLY,
  responses: { 200: r.ok(), 401: r.unauthorized },
});
registerCurrentRoute({
  method: "delete", path: "/api/mcp/connections/{id}", tags: ["tool-gateway"],
  summary: "Revoke an assistant connection using a same-origin browser session",
  description: ASSISTANT_CONNECTIONS_PERSON_ONLY,
  responses: { 204: { description: "Connection revoked" }, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-gateway/gateways/{gatewayId}/mcp",
  tags: ["tool-gateway"],
  summary: "Describe a named MCP gateway endpoint",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/gateways/{gatewayId}/mcp",
  tags: ["tool-gateway"],
  summary: "Handle named MCP gateway protocol requests",
  body: mcpGatewayProtocolSchema,
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    429: r.ok(),
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/sessions",
  tags: ["tool-gateway"],
  summary: "Create a tool gateway session",
  body: toolGatewaySessionSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/sessions/{sessionId}/revoke",
  tags: ["tool-gateway"],
  summary: "Revoke a tool gateway session",
  body: toolGatewaySpaceQuerySchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-gateway/tools",
  tags: ["tool-gateway"],
  summary: "List tools available to a gateway session",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/tools/call",
  tags: ["tool-gateway"],
  summary: "Execute a tool through the gateway",
  body: toolGatewayCallSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/action-requests/{id}/approve",
  tags: ["tool-gateway"],
  summary: "Approve a deferred tool gateway action request",
  query: toolGatewaySpaceQuerySchema,
  body: z.object({ spaceId: z.string().optional() }),
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/action-requests/{id}/decline",
  tags: ["tool-gateway"],
  summary: "Decline a deferred tool gateway action request",
  query: toolGatewaySpaceQuerySchema,
  body: z.object({ spaceId: z.string().optional() }),
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:runtime",
  method: "get",
  path: "/api/tool-gateway/runtime-slots",
  tags: ["tool-gateway"],
  summary: "List gateway runtime slots",
  query: toolGatewaySpaceQuerySchema,
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:runtime",
  method: "post",
  path: "/api/tool-gateway/runtime-slots/{slotId}/stop",
  tags: ["tool-gateway"],
  summary: "Stop a gateway runtime slot",
  query: toolGatewaySpaceQuerySchema,
  body: z.object({ spaceId: z.string().optional() }),
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:runtime",
  method: "post",
  path: "/api/tool-gateway/runtime-slots/{slotId}/restart",
  tags: ["tool-gateway"],
  summary: "Restart a gateway runtime slot",
  query: toolGatewaySpaceQuerySchema,
  body: z.object({ spaceId: z.string().optional() }),
});

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:audit",
  method: "get",
  path: "/api/tool-gateway/audit",
  tags: ["tool-gateway"],
  summary: "List tool gateway audit events",
  query: z.object({
    spaceId: z.string().optional(),
    limit: z.number().int().positive().optional(),
    app: z.string().optional(),
    agent: z.string().optional(),
    outcome: z.string().optional(),
    window: z.enum(["1h", "24h", "7d", "30d"]).optional(),
    search: z.string().optional(),
    cursor: z.string().optional(),
  }),
});

// Every experimental REST route remains discoverable while its runtime feature
// flag and actor checks stay authoritative. Shared validators prevent drift.
// OpenAPI 3.0 cannot represent the shared validator's conditional refinement.
// Derive separate creation/existing branches so discovery marks workflow text
// required for case.create without requiring it for ordinary phase transfers.
const caseHandoffApiBodySchema = z.union([
  agentCaseHandoffSchema.safeExtend({ case: agentCaseHandoffSchema.shape.case.options[1], workflow_document_text: caseWorkflowDocumentTextSchema }),
  agentCaseHandoffSchema.safeExtend({ case: agentCaseHandoffSchema.shape.case.options[1], workflowId: z.string().uuid() }),
  agentCaseHandoffSchema.safeExtend({ case: agentCaseHandoffSchema.shape.case.options[0] }),
  doneCaseHandoffSchema,
]);
registry.registerPath({ method: "post", path: "/api/spaces/{spaceId}/case-handoffs", tags: ["Cases"],
  summary: "Start or hand off a case using its primary task",
  description: "Requires enableCases and standard work mode. Kickoff requires either workflowId or workflow_document_text. Workflows are reusable name-and-prompt definitions; phases are free text. On later agent handoffs, omit workflowId to preserve instructions, supply an ID to adopt its latest prompt (including refresh of the current ID), or null to detach while keeping instructions. Acceptance snapshots the selected prompt. Transfer applies workflow, phase and task-document revision together after outgoing execution settles; a document revision conflict holds the handoff for recovery. Workflow and other initial document bodies together must total at most 200000 characters. Inline callers remain supported. Current space, case, task assignment, source-trust and run authority apply. Reuses the primary task; self-handoffs also yield. An idempotent replay returns the existing authorized receipt.",
  request: { params: z.object({ spaceId: z.string().uuid() }), body: jsonBody(caseHandoffApiBodySchema) },
  responses: { 200: r.ok(), 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden,
    404: r.notFound, 409: r.conflict, 422: r.unprocessable } });
registry.registerPath({ method: "get", path: "/api/cases/{caseId}/handoffs", tags: ["Cases"],
  summary: "Read a standalone case's handoff history", description: "Requires enableCases and access to all retained case permission sources.",
  request: { params: z.object({ caseId: z.string().uuid() }), query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.iso.datetime().optional(), cursor: z.string().max(400).optional() }) }, responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound } });
for (const action of ["retry", "cancel"] as const) registry.registerPath({ method: "post", path: `/api/cases/{caseId}/handoffs/{handoffId}/${action}`,
  tags: ["Cases"], summary: `${action === "retry" ? "Retry" : "Cancel"} pending case handoff`,
  description: "Requires case access and ordinary task-control authority. Retry preserves the existing handoff/task identity. Cancellation remains available when enableCases is disabled; it prevents delivery and does not undo an applied assignment.",
  request: { params: z.object({ caseId: z.string().uuid(), handoffId: z.string().uuid() }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict } });

for (const [method, path, body, summary] of [
  ["get", "/api/spaces/{spaceId}/workflows", undefined, "List reusable workflow metadata"],
  ["post", "/api/spaces/{spaceId}/workflows", createWorkflowSchema, "Create a reusable workflow"],
  ["get", "/api/workflows/{id}", undefined, "Read a reusable workflow and its Markdown prompt"],
  ["patch", "/api/workflows/{id}", updateWorkflowSchema, "Update a reusable workflow for future adoptions"],
] as const) registry.registerPath({ method, path, tags: ["Cases"], summary,
  description: "Requires enableCases and space access. Definitions are space-shared. Writes enforce the current agent run fence and source-trust policy. Editing a definition does not change existing case task documents. Individual reads return an ETag containing a SHA-256 content fingerprint; pass it without quotes or the optional W/ prefix as snapshot to reject a changed definition with 409.",
  request: { params: path.includes("{spaceId}") ? z.object({ spaceId: z.string().uuid() }) : z.object({ id: z.string().uuid() }),
    ...(body ? { body: jsonBody(body) } : {}), ...(method === "get" ? { query: path.includes("{spaceId}") ? listWorkflowsSchema : readWorkflowQuerySchema } : {}) },
  responses: { [method === "post" ? 201 : 200]: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict } });

for (const [method, path, body] of experimentalApiPaths) {
  const query = experimentalApiQueries[`${method.toUpperCase()} ${path}`];
  const metadata = experimentalApiMetadata[`${method.toUpperCase()} ${path}`];
  const docs = experimentalApiDocs[`${method.toUpperCase()} ${path}`];
  registry.registerPath({
    method,
    path,
    tags: ["Experimental"],
    summary: docs?.summary ?? `${method.toUpperCase()} ${path
      .replace(/\{[^}]+\}/g, "")
      .replace(/\/api\//, "")
      .replaceAll("/", " ")}`,
    description: `${docs ? `${docs.description} ` : ""}Experimental API; the corresponding instance feature must be enabled. Existing route authorization applies.`,
    request: {
      params: z.object(
        Object.fromEntries(
          [...path.matchAll(/\{([^}]+)\}/g)].map((match) => [
            match[1],
            z.string(),
          ]),
        ),
      ),
      ...(query ? { query } : {}),
      ...(path === "/api/cases/{id}/attachments"
        ? {
            body: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["file"],
                    properties: { file: { type: "string", format: "binary" } },
                  },
                },
              },
            },
          }
        : body
          ? {
              body: {
                required: true,
                content: { "application/json": { schema: body } },
              },
            }
          : {}),
    },
    responses: {
      ...Object.fromEntries(
        (metadata?.successStatuses ?? [200]).map((status) => [
          status,
          responses.ok(),
        ]),
      ),
      400: responses.badRequest,
      403: responses.forbidden,
      404: responses.notFound,
    },
  });
}

// ─── Spec builder ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildOpenApiDocument(): any {
  return applyPluginSettingsVisibility(applyDocumentFixups({
    openapi: "3.0.0",
    info: {
      title: "Outpost API",
      version: "1.0.0",
      description: "REST API for the Outpost AI agent management platform",
    },
    servers: [{ url: "/" }],
    components: registry.buildComponents(),
    paths: registry.buildPaths(),
  }));
}

export const buildOpenApiSpec = buildOpenApiDocument;

export function openApiRoutes() {
  const router = Router();
  router.get("/openapi.json", (_req, res) => {
    res.json(buildOpenApiDocument());
  });
  return router;
}

registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/ai-connections/local",
  tags: ["ai-connections"],
  summary: "Verify and save an owned local subscription sign-in",
  body: localAiConnectionSchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});
registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/ai-connections/local/attempts",
  tags: ["ai-connections"], summary: "Prepare an isolated local subscription sign-in",
  body: localAiLoginStartSchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});
registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "delete",
  path: "/api/spaces/{spaceId}/ai-connections/local/attempts/{sessionId}",
  tags: ["ai-connections"], summary: "Cancel an owned local subscription sign-in",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registerCurrentRoute({
  "x-outpost-transport": "rest",
  "x-outpost-connection-management": "connections:configure",
  method: "post",
  path: "/api/spaces/{spaceId}/ai-connections/local/check",
  tags: ["ai-connections"], summary: "Check an owned local subscription sign-in without saving a connection",
  body: localAiConnectionSchema,
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "post",
  path: "/api/spaces/{spaceId}/ai-connections/local/attempts/{sessionId}/code",
  tags: ["ai-connections"], summary: "Submit the browser code for an owned local Claude sign-in",
  body: z.object({ browserCode: browserCodeSchema }),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

for (const [method, path, summary] of [
  ["get", "/api/spaces/{spaceId}/skill-sources", "List GitHub skill sources"],
  ["get", "/api/spaces/{spaceId}/skill-sources/project-repositories", "List accessible project repositories and skill import status"],
  ["post", "/api/spaces/{spaceId}/skill-sources/adopt-project", "Import all skills from an accessible project repository"],
  ["patch", "/api/spaces/{spaceId}/skill-sources/{sourceId}/settings", "Set automatic skill updates and authorized refresh connection"],
  ["get", "/api/spaces/{spaceId}/skill-sources/{sourceId}/branches", "List authorized repository branches, including the default branch"],
  ["get", "/api/spaces/{spaceId}/skill-sources/repositories", "Browse authorized GitHub repositories for skills"],
  ["get", "/api/spaces/{spaceId}/skill-sources/{sourceId}", "Get a skill source and entries"],
  ["post", "/api/spaces/{spaceId}/skill-sources/discover", "Discover and validate repository skills"],
  ["post", "/api/spaces/{spaceId}/skill-sources/preview", "Preview an audited skill package file at an immutable commit"],
  ["post", "/api/spaces/{spaceId}/skill-sources", "Import a GitHub skill source"],
  ["patch", "/api/spaces/{spaceId}/skill-sources/{sourceId}", "Save skill source selection and connection"],
  ["post", "/api/spaces/{spaceId}/skill-sources/{sourceId}/refresh", "Refresh installed source skills"],
  ["delete", "/api/spaces/{spaceId}/skill-sources/{sourceId}", "Disconnect a skill source and retain installed skills"],
] as const) registerCurrentRoute({
  method, path, tags: ["skills"], summary,
  ...(method === "get" && path.endsWith("/branches") ? { query: skillSourceBranchesQuerySchema }
    : method === "patch" && path.endsWith("/settings") ? { body: skillSourceSettingsSchema }
    : method === "post" && path.endsWith("/adopt-project") ? { body: projectSkillSourceAdoptSchema }
    : method === "patch" ? { body: skillSourceSelectionSchema }
    : method === "post" && path.endsWith("/discover") ? { body: skillSourceDiscoverySchema }
    : method === "post" && path.endsWith("/preview") ? { body: skillSourcePreviewSchema }
    : method === "post" && path.endsWith("/skill-sources") ? { body: skillSourceCreateSchema } : {}),
  responses: {
    [path.endsWith("/adopt-project") ? 202 : method === "post" && path.endsWith("/skill-sources") ? 201 : 200]: path.endsWith("/discover") ? {
      description: "JSON discovery by default. Accept: application/x-ndjson streams progress (phase, measured Git download percentages, and package/file counts), candidate metadata, then complete with discovery. An error event terminates a failed scan; partial candidates cannot be imported. Disconnecting cancels further provider reads.",
      content: { "application/json": { schema: z.unknown() }, "application/x-ndjson": { schema: z.string() } },
    } : r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden,
    404: r.notFound, 409: r.conflict, 422: r.unprocessable,
  },
});
