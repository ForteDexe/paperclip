import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginContext,
  type PluginManagedRoutineDeclaration,
  type PluginManagedRoutineResolution,
} from "@outpost/plugin-sdk";
import {
  OUTPOST_DISTILL_SKILL_KEY,
  WIKI_MAINTENANCE_ROUTINE_KEYS,
  WIKI_ROOT_FOLDER_KEY,
} from "./manifest.js";
import {
  bootstrapWikiRoot,
  bootstrapSpace,
  assembleOutpostSourceBundle,
  archiveSpace,
  captureWikiSource,
  createSpace,
  createOutpostDistillationRun,
  createOutpostDistillationWorkItem,
  createOperationIssue,
  distillOutpostProjectPage,
  enableActiveProjectDistillation,
  fileQueryAnswerAsPage,
  getDistillationOverview,
  getDistillationPageProvenance,
  getDistillationAutoApplyRestriction,
  getEventIngestionSettings,
  listOutpostIngestionCandidates,
  getOutpostIngestionProfile,
  getOverview,
  listSpaces,
  handleOutpostEventIngestion,
  listWikiAgentOptions,
  listWikiProjectOptions,
  listOperations,
  listPages,
  listSources,
  readSpaceIdFromParams,
  readTemplate,
  readWikiPage,
  recordOutpostDistillationOutcome,
  reconcileWikiAgentResource,
  reconcileWikiProjectResource,
  reconcileWikiRoutineResources,
  reconcileWikiSkillResources,
  registerWikiTools,
  resetWikiSkillResources,
  resetWikiAgentResource,
  resetWikiProjectResource,
  selectWikiAgentResource,
  selectWikiProjectResource,
  startWikiQuerySession,
  spaceFolderStatus,
  updateEventIngestionSettings,
  updateOutpostIngestionProfile,
  updateSpace,
  writeTemplate,
  writeWikiPage,
} from "./wiki.js";

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function routineKeyField(value: unknown): (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number] {
  const routineKey = stringField(value);
  if (!routineKey) {
    throw new Error(`routineKey is required; valid values: ${WIKI_MAINTENANCE_ROUTINE_KEYS.join(", ")}`);
  }
  if (!WIKI_MAINTENANCE_ROUTINE_KEYS.includes(routineKey as (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number])) {
    throw new Error(`Unknown managed routine: ${routineKey}`);
  }
  return routineKey as (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number];
}

function routineOverridesFromParams(params: Record<string, unknown>) {
  const overrides: { assigneeAgentId?: string; projectId?: string } = {};
  const assigneeAgentId = stringField(params.assigneeAgentId);
  const projectId = stringField(params.projectId);
  if (assigneeAgentId) overrides.assigneeAgentId = assigneeAgentId;
  if (projectId) overrides.projectId = projectId;
  return overrides;
}

let activeContext: PluginContext | null = null;
const OUTPOST_EVENT_INGESTION_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.comment.created",
  "issue.document.created",
  "issue.document.updated",
] as const;

type ManagedRoutineDefaultDrift = {
  changedFields: string[];
  defaultTitle: string;
  defaultDescription: string | null;
};

type ManagedRoutineSettingsResolution = PluginManagedRoutineResolution & {
  defaultDrift: ManagedRoutineDefaultDrift | null;
};

function requireContext(): PluginContext {
  if (!activeContext) throw new Error("LLM Wiki plugin has not been set up");
  return activeContext;
}

function normalizeRoutineTemplateText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}

function manualDistillScopeLabel(input: { projectId?: string | null; rootIssueId?: string | null }) {
  if (input.rootIssueId) return "selected root issue";
  if (input.projectId) return "selected project";
  return "space-wide stale cursor scan";
}

function buildManualDistillPrompt(input: { spaceId: string; projectId?: string | null; rootIssueId?: string | null }) {
  const scopeLabel = manualDistillScopeLabel(input);
  return [
    "Manual LLM Wiki distillation requested outside recurring cadence.",
    "",
    "Prompt source: LLM Wiki plugin action `distill-outpost-now` (`packages/plugins/plugin-llm-wiki/src/worker.ts`).",
    `Required skill: use the installed \`${OUTPOST_DISTILL_SKILL_KEY}\` skill before changing wiki files.`,
    "",
    "Scope:",
    `- Outpost ID: ${input.spaceId}`,
    `- Requested scope: ${scopeLabel}`,
    input.projectId ? `- Source project ID: ${input.projectId}` : null,
    input.rootIssueId ? `- Source root issue ID: ${input.rootIssueId}` : null,
    !input.projectId && !input.rootIssueId
      ? "- Do not hardcode a single project. Find non-plugin Outpost issues/comments/documents that changed in any project after the last processed cursor and are old enough for the stale/debounce threshold."
      : null,
    "",
    "Process:",
    "1. Read the wiki root AGENTS.md, wiki/index.md, and recent wiki/log.md entries.",
    "2. Assemble bounded Outpost source bundles for every eligible project or root issue, excluding LLM Wiki plugin-operation issues.",
    "3. Turn durable signal into project standups, wiki-insightful project pages, decisions, history, index, and log updates per the outpost-distill skill.",
    "4. Surface clipped, low-signal, stale-hash, or source-window warnings instead of hiding them.",
  ].filter((line): line is string => line !== null).join("\n");
}

function withManagedRoutineDefaultDrift(
  routine: PluginManagedRoutineResolution,
  declaration: PluginManagedRoutineDeclaration | undefined,
): ManagedRoutineSettingsResolution {
  if (!routine.routine || !declaration) {
    return { ...routine, defaultDrift: null };
  }

  const changedFields: string[] = [];
  if (normalizeRoutineTemplateText(routine.routine.title) !== normalizeRoutineTemplateText(declaration.title)) {
    changedFields.push("title");
  }
  if (normalizeRoutineTemplateText(routine.routine.description) !== normalizeRoutineTemplateText(declaration.description ?? null)) {
    changedFields.push("description");
  }
  if (routine.routine.priority !== (declaration.priority ?? "medium")) {
    changedFields.push("priority");
  }
  if (routine.routine.concurrencyPolicy !== (declaration.concurrencyPolicy ?? "coalesce_if_active")) {
    changedFields.push("concurrency policy");
  }
  if (routine.routine.catchUpPolicy !== (declaration.catchUpPolicy ?? "skip_missed")) {
    changedFields.push("catch-up policy");
  }

  return {
    ...routine,
    defaultDrift: changedFields.length > 0
      ? {
          changedFields,
          defaultTitle: declaration.title,
          defaultDescription: declaration.description ?? null,
        }
      : null,
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    activeContext = ctx;
    await registerWikiTools(ctx);

    for (const eventName of OUTPOST_EVENT_INGESTION_EVENTS) {
      ctx.events.on(eventName, async (event) => {
        const result = await handleOutpostEventIngestion(ctx, event);
        if (result.status === "recorded") {
          ctx.logger.info("LLM Wiki recorded Outpost event for cursor discovery", {
            eventType: event.eventType,
            spaceId: event.spaceId,
            sourceKind: result.sourceKind,
            sourceId: result.sourceId,
            cursorId: result.cursorId,
          });
        }
      });
    }

    ctx.data.register("overview", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      return getOverview(ctx, spaceId);
    });

    ctx.data.register("health", async (params) => {
      const spaceId = stringField(params.spaceId);
      return spaceId
        ? getOverview(ctx, spaceId)
        : { status: "ok", checkedAt: new Date().toISOString(), message: "LLM Wiki worker is running" };
    });

    ctx.actions.register("bootstrap-root", async (params) => {
      return bootstrapWikiRoot(ctx, {
        spaceId: readSpaceIdFromParams(params),
        path: stringField(params.path),
      });
    });

    ctx.data.register("spaces", async (params) => {
      return listSpaces(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
      });
    });

    ctx.data.register("space", async (params) => {
      return spaceFolderStatus(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.actions.register("create-space", async (params) => {
      return createSpace(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        slug: stringField(params.slug),
        displayName: stringField(params.displayName),
        folderMode: stringField(params.folderMode) as "managed_subfolder" | "existing_local_folder" | null,
        accessScope: stringField(params.accessScope) as "shared" | "personal" | "team" | null,
        settings: typeof params.settings === "object" && params.settings != null ? params.settings as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("update-space", async (params) => {
      return updateSpace(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        displayName: stringField(params.displayName),
        status: stringField(params.status) as "active" | "archived" | null,
        settings: typeof params.settings === "object" && params.settings != null ? params.settings as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("bootstrap-space", async (params) => {
      return bootstrapSpace(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.actions.register("archive-space", async (params) => {
      return archiveSpace(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.actions.register("create-operation", async (params) => {
      const operationType = stringField(params.operationType);
      if (
        operationType !== "ingest" &&
        operationType !== "query" &&
        operationType !== "lint" &&
        operationType !== "file-as-page" &&
        operationType !== "index" &&
        operationType !== "distill" &&
        operationType !== "backfill"
      ) {
        throw new Error("operationType must be ingest, query, lint, file-as-page, index, distill, or backfill");
      }
      return createOperationIssue(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        operationType,
        title: stringField(params.title),
        prompt: stringField(params.prompt),
      });
    });

    ctx.actions.register("capture-source", async (params) => {
      return captureWikiSource(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        sourceType: stringField(params.sourceType),
        title: stringField(params.title),
        url: stringField(params.url),
        contents: typeof params.contents === "string" ? params.contents : "",
        rawPath: stringField(params.rawPath),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("write-page", async (params) => {
      return writeWikiPage(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        path: stringField(params.path) ?? "",
        contents: typeof params.contents === "string" ? params.contents : "",
        expectedHash: stringField(params.expectedHash),
        summary: stringField(params.summary),
        sourceRefs: params.sourceRefs,
        writer: "board_ui",
      });
    });

    ctx.actions.register("write-template", async (params) => {
      return writeTemplate(ctx, {
        spaceId: readSpaceIdFromParams(params),
        path: stringField(params.path) ?? "",
        contents: typeof params.contents === "string" ? params.contents : "",
      });
    });

    ctx.actions.register("update-event-ingestion-settings", async (params) => {
      const requestedSources = typeof params.sources === "object" && params.sources != null && !Array.isArray(params.sources)
        ? params.sources as Record<string, unknown>
        : null;
      const sources: { issues?: boolean; comments?: boolean; documents?: boolean } = {};
      if (requestedSources && Object.prototype.hasOwnProperty.call(requestedSources, "issues")) {
        sources.issues = requestedSources.issues === true;
      }
      if (requestedSources && Object.prototype.hasOwnProperty.call(requestedSources, "comments")) {
        sources.comments = requestedSources.comments === true;
      }
      if (requestedSources && Object.prototype.hasOwnProperty.call(requestedSources, "documents")) {
        sources.documents = requestedSources.documents === true;
      }
      const settings: {
        enabled?: boolean;
        wikiId?: string;
        maxCharacters?: number;
        sources?: typeof sources;
      } = {
        wikiId: stringField(params.wikiId) ?? undefined,
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : undefined,
      };
      if (typeof params.enabled === "boolean") {
        settings.enabled = params.enabled;
      }
      if (Object.keys(sources).length > 0) {
        settings.sources = sources;
      }
      return updateEventIngestionSettings(ctx, {
        spaceId: readSpaceIdFromParams(params),
        settings,
      });
    });

    ctx.data.register("outpost-ingestion-profile", async (params) => {
      return getOutpostIngestionProfile(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.data.register("outpost-ingestion-candidates", async (params) => {
      return listOutpostIngestionCandidates(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        query: stringField(params.query),
      });
    });

    ctx.actions.register("update-outpost-ingestion-profile", async (params) => {
      return updateOutpostIngestionProfile(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        profile: params.profile,
      });
    });

    ctx.actions.register("queue-outpost-ingestion-backfill", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const sourceScope = typeof params.sourceScope === "object" && params.sourceScope != null && !Array.isArray(params.sourceScope)
        ? params.sourceScope as Record<string, unknown>
        : {};
      const sourceScopeKind = stringField(sourceScope.kind);
      const projectIds = Array.isArray(sourceScope.projectIds) ? sourceScope.projectIds.map(stringField).filter((id): id is string => Boolean(id)) : [];
      const issueIds = Array.isArray(sourceScope.issueIds) ? sourceScope.issueIds.map(stringField).filter((id): id is string => Boolean(id)) : [];
      const scopes = sourceScopeKind === "selected_projects"
        ? projectIds.map((projectId) => ({ projectId, rootIssueId: null as string | null }))
        : sourceScopeKind === "root_issues"
          ? issueIds.map((rootIssueId) => ({ projectId: null as string | null, rootIssueId }))
          : [];
      if (scopes.length === 0) {
        return {
          status: "refused_policy",
          wikiId: stringField(params.wikiId) ?? "default",
          spaceSlug: stringField(params.spaceSlug) ?? "default",
          warnings: ["Backfill requires a selected project or root issue scope in Phase 4."],
        };
      }
      const backfillStartAt = stringField(params.backfillStartAt);
      const backfillEndAt = stringField(params.backfillEndAt);
      const wikiId = stringField(params.wikiId);
      const spaceSlug = stringField(params.spaceSlug);
      const requestedByIssueId = stringField(params.requestedByIssueId);
      const idempotencyKey = stringField(params.idempotencyKey);
      const queued: Array<{ workItemId: string; issueId: string; projectId: string | null; rootIssueId: string | null }> = [];
      for (const scope of scopes) {
        const idempotencyScope = scope.rootIssueId ? `root:${scope.rootIssueId}` : `project:${scope.projectId}`;
        const workItem = await createOutpostDistillationWorkItem(ctx, {
          spaceId,
          wikiId,
          spaceSlug,
          kind: "backfill",
          projectId: scope.projectId,
          rootIssueId: scope.rootIssueId,
          requestedByIssueId,
          priority: "low",
          idempotencyKey: idempotencyKey && scopes.length === 1
            ? idempotencyKey
            : `${idempotencyKey ?? "profile-backfill"}:${idempotencyScope}:${backfillStartAt ?? "begin"}:${backfillEndAt ?? "now"}`,
          metadata: { backfillStartAt, backfillEndAt, requestedFrom: "queue-outpost-ingestion-backfill" },
        });
        const operation = await createOperationIssue(ctx, {
          spaceId,
          wikiId,
          spaceSlug,
          operationType: "backfill",
          title: scope.rootIssueId ? "Backfill Outpost root issue wiki history" : "Backfill Outpost project wiki history",
          prompt: [
            "Backfill LLM Wiki distillation was queued from a per-space Outpost ingestion profile.",
            scope.projectId ? `Project ID: ${scope.projectId}` : null,
            scope.rootIssueId ? `Root issue ID: ${scope.rootIssueId}` : null,
            backfillStartAt ? `Start: ${backfillStartAt}` : null,
            backfillEndAt ? `End: ${backfillEndAt}` : null,
            "Process this bounded window through the profile destination space only.",
          ].filter(Boolean).join("\n"),
        });
        queued.push({
          workItemId: workItem.workItemId,
          issueId: operation.issue.id,
          projectId: scope.projectId,
          rootIssueId: scope.rootIssueId,
        });
      }
      const primary = queued[0];
      return {
        status: "queued",
        wikiId: stringField(params.wikiId) ?? "default",
        spaceSlug: stringField(params.spaceSlug) ?? "default",
        workItemId: primary?.workItemId ?? null,
        issueId: primary?.issueId ?? null,
        workItems: queued,
        warnings: [],
      };
    });

    ctx.actions.register("ingest-source", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const wikiId = stringField(params.wikiId);
      const spaceSlug = stringField(params.spaceSlug);
      const sourceType = stringField(params.sourceType) ?? "text";
      const title = stringField(params.title) ?? sourceType.toUpperCase();
      const contents = typeof params.contents === "string" ? params.contents : "";
      const url = stringField(params.url);
      const captured = await captureWikiSource(ctx, {
        spaceId,
        wikiId,
        spaceSlug,
        sourceType,
        title,
        url,
        contents,
        rawPath: stringField(params.rawPath),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
      const op = await createOperationIssue(ctx, {
        spaceId,
        wikiId,
        spaceSlug,
        operationType: "ingest",
        title: `Ingest ${sourceType}: ${title}`,
        prompt: [
          `Ingest a captured source from raw/${captured.rawPath.replace(/^raw\//, "")}.`,
          url ? `Source URL: ${url}` : null,
          "Follow the installed wiki-ingest skill: read the raw file end to end, summarise into wiki/sources/<slug>.md, update related entity/concept/synthesis pages, refresh wiki/index.md, and append wiki/log.md.",
        ].filter(Boolean).join("\n"),
      });
      return { status: "ok", source: captured, operation: op };
    });

    ctx.actions.register("assemble-outpost-source-bundle", async (params) => {
      return assembleOutpostSourceBundle(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
      });
    });

    ctx.actions.register("create-outpost-distillation-run", async (params) => {
      return createOutpostDistillationRun(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        workItemId: stringField(params.workItemId),
        operationIssueId: stringField(params.operationIssueId),
      });
    });

    ctx.actions.register("record-outpost-distillation-outcome", async (params) => {
      const status = stringField(params.status);
      if (status !== "succeeded" && status !== "failed" && status !== "review_required") {
        throw new Error("status must be succeeded, failed, or review_required");
      }
      const runId = stringField(params.runId);
      if (!runId) throw new Error("runId is required");
      return recordOutpostDistillationOutcome(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        runId,
        cursorId: stringField(params.cursorId),
        status,
        sourceHash: stringField(params.sourceHash),
        sourceWindowEnd: stringField(params.sourceWindowEnd),
        warning: stringField(params.warning),
        costCents: typeof params.costCents === "number" ? params.costCents : null,
        retryCount: typeof params.retryCount === "number" ? params.retryCount : null,
      });
    });

    ctx.actions.register("distill-outpost-project-page", async (params) => {
      return distillOutpostProjectPage(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        workItemId: stringField(params.workItemId),
        operationIssueId: stringField(params.operationIssueId),
        autoApply: params.autoApply === true ? true : params.autoApply === false ? false : undefined,
        expectedProjectPageHash: stringField(params.expectedProjectPageHash),
        includeSupportingPages: params.includeSupportingPages !== false,
      });
    });

    ctx.actions.register("distill-outpost-now", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const spaceSlug = stringField(params.spaceSlug);
      const projectId = stringField(params.projectId);
      const rootIssueId = stringField(params.rootIssueId);
      const idempotencyScope = rootIssueId ? `root:${rootIssueId}` : projectId ? `project:${projectId}` : "space";
      const workItem = await createOutpostDistillationWorkItem(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        kind: "manual",
        projectId,
        rootIssueId,
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: "medium",
        idempotencyKey: stringField(params.idempotencyKey) ?? `manual:${idempotencyScope}`,
        metadata: { requestedFrom: "distill-outpost-now" },
      });
      const operation = await createOperationIssue(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        operationType: "distill",
        title: rootIssueId
          ? "Distill Outpost root issue into wiki"
          : projectId
            ? "Distill Outpost project into wiki"
            : "Distill Outpost changes into wiki",
        prompt: buildManualDistillPrompt({ spaceId, projectId, rootIssueId }),
      });
      return { status: "queued", workItem, operation };
    });

    ctx.actions.register("enable-outpost-distillation-active-projects", async (params) => {
      return enableActiveProjectDistillation(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.actions.register("backfill-outpost-distillation", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const spaceSlug = stringField(params.spaceSlug);
      const projectId = stringField(params.projectId);
      const rootIssueId = stringField(params.rootIssueId);
      if (!projectId && !rootIssueId) throw new Error("projectId or rootIssueId is required");
      const backfillStartAt = stringField(params.backfillStartAt);
      const backfillEndAt = stringField(params.backfillEndAt);
      const idempotencyScope = rootIssueId ? `root:${rootIssueId}` : `project:${projectId}`;
      const workItem = await createOutpostDistillationWorkItem(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        kind: "backfill",
        projectId,
        rootIssueId,
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: "low",
        idempotencyKey: stringField(params.idempotencyKey) ?? `backfill:${idempotencyScope}:${backfillStartAt ?? "begin"}:${backfillEndAt ?? "now"}`,
        metadata: { backfillStartAt, backfillEndAt, requestedFrom: "backfill-outpost-distillation" },
      });
      const operation = await createOperationIssue(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        operationType: "backfill",
        title: rootIssueId ? "Backfill Outpost root issue wiki history" : "Backfill Outpost project wiki history",
        prompt: [
          "Backfill LLM Wiki distillation requested for a bounded Outpost source window.",
          projectId ? `Project ID: ${projectId}` : null,
          rootIssueId ? `Root issue ID: ${rootIssueId}` : null,
          backfillStartAt ? `Start: ${backfillStartAt}` : null,
          backfillEndAt ? `End: ${backfillEndAt}` : null,
          "Do not process whole-space history; stay within the selected project/root issue and date window.",
        ].filter(Boolean).join("\n"),
      });
      const result = await distillOutpostProjectPage(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        projectId,
        rootIssueId,
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt,
        backfillEndAt,
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        autoApply: params.autoApply === true ? true : params.autoApply === false ? false : undefined,
        expectedProjectPageHash: stringField(params.expectedProjectPageHash),
        includeSupportingPages: params.includeSupportingPages !== false,
        workItemId: workItem.workItemId,
        operationIssueId: operation.issue.id,
      });
      return { ...result, workItem, operation };
    });

    ctx.actions.register("create-outpost-distillation-work-item", async (params) => {
      const kind = stringField(params.kind);
      if (
        kind !== "manual" &&
        kind !== "retry" &&
        kind !== "backfill" &&
        kind !== "priority_override" &&
        kind !== "review_patch"
      ) {
        throw new Error("kind must be manual, retry, backfill, priority_override, or review_patch");
      }
      const priority = stringField(params.priority);
      if (priority && priority !== "critical" && priority !== "high" && priority !== "medium" && priority !== "low") {
        throw new Error("priority must be critical, high, medium, or low");
      }
      return createOutpostDistillationWorkItem(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        kind,
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: priority as "critical" | "high" | "medium" | "low" | null,
        idempotencyKey: stringField(params.idempotencyKey),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("file-as-page", async (params) => {
      return fileQueryAnswerAsPage(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        querySessionId: stringField(params.querySessionId),
        question: stringField(params.question),
        answer: stringField(params.answer),
        path: stringField(params.path) ?? "",
        title: stringField(params.title),
        contents: stringField(params.contents),
        expectedHash: stringField(params.expectedHash),
      });
    });

    ctx.actions.register("start-query", async (params) => {
      return startWikiQuerySession(ctx, {
        spaceId: readSpaceIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        question: stringField(params.question) ?? "",
        title: stringField(params.title),
      });
    });

    ctx.actions.register("reset-managed-agent", async (params) => {
      return resetWikiAgentResource(ctx, readSpaceIdFromParams(params));
    });

    ctx.actions.register("reset-managed-project", async (params) => {
      return resetWikiProjectResource(ctx, readSpaceIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-agent", async (params) => {
      return reconcileWikiAgentResource(ctx, readSpaceIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-project", async (params) => {
      return reconcileWikiProjectResource(ctx, readSpaceIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-skills", async (params) => {
      return { managedSkills: await reconcileWikiSkillResources(ctx, readSpaceIdFromParams(params)) };
    });

    ctx.actions.register("reset-managed-skills", async (params) => {
      return { managedSkills: await resetWikiSkillResources(ctx, readSpaceIdFromParams(params)) };
    });

    ctx.actions.register("select-managed-agent", async (params) => {
      const agentId = stringField(params.agentId);
      if (!agentId) throw new Error("agentId is required");
      return selectWikiAgentResource(ctx, {
        spaceId: readSpaceIdFromParams(params),
        agentId,
      });
    });

    ctx.actions.register("select-managed-project", async (params) => {
      const projectId = stringField(params.projectId);
      if (!projectId) throw new Error("projectId is required");
      return selectWikiProjectResource(ctx, {
        spaceId: readSpaceIdFromParams(params),
        projectId,
      });
    });

    ctx.actions.register("reset-managed-routine", async (params) => {
      return ctx.routines.managed.reset(
        routineKeyField(params.routineKey),
        readSpaceIdFromParams(params),
        routineOverridesFromParams(params),
      );
    });

    ctx.actions.register("reconcile-managed-routine", async (params) => {
      return ctx.routines.managed.reconcile(
        routineKeyField(params.routineKey),
        readSpaceIdFromParams(params),
        routineOverridesFromParams(params),
      );
    });

    ctx.actions.register("reconcile-managed-routines", async (params) => {
      return reconcileWikiRoutineResources(ctx, readSpaceIdFromParams(params));
    });

    ctx.actions.register("update-managed-routine-status", async (params) => {
      const status = stringField(params.status);
      if (!status) throw new Error("status is required");
      return ctx.routines.managed.update(routineKeyField(params.routineKey), readSpaceIdFromParams(params), {
        status,
      });
    });

    ctx.actions.register("run-managed-routine", async (params) => {
      return ctx.routines.managed.run(
        routineKeyField(params.routineKey),
        readSpaceIdFromParams(params),
        routineOverridesFromParams(params),
      );
    });

    ctx.data.register("pages", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      return listPages(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        pageType: stringField(params.pageType),
        includeRaw: params.includeRaw === true || params.includeRaw === "true",
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("sources", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      return listSources(ctx, { spaceId, wikiId: stringField(params.wikiId), spaceSlug: stringField(params.spaceSlug), limit: typeof params.limit === "number" ? params.limit : null });
    });

    ctx.data.register("page-content", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const path = stringField(params.path);
      if (!path) throw new Error("path is required");
      return readWikiPage(ctx, { spaceId, wikiId: stringField(params.wikiId), spaceSlug: stringField(params.spaceSlug), path });
    });

    ctx.data.register("template", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const path = stringField(params.path) ?? "AGENTS.md";
      return readTemplate(ctx, { spaceId, path });
    });

    ctx.data.register("operations", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      return listOperations(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        operationType: stringField(params.operationType),
        status: stringField(params.status),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("distillation-overview", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      return getDistillationOverview(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("distillation-page-provenance", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const pagePath = stringField(params.pagePath);
      if (!pagePath) {
        return { binding: null, runs: [], snapshot: null, cursor: null };
      }
      return getDistillationPageProvenance(ctx, {
        spaceId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        pagePath,
      });
    });

    ctx.data.register("settings", async (params) => {
      const spaceId = readSpaceIdFromParams(params);
      const folder = await ctx.localFolders.status(spaceId, WIKI_ROOT_FOLDER_KEY);
      const overview = await getOverview(ctx, spaceId);
      const managedRoutines = await Promise.all(
        WIKI_MAINTENANCE_ROUTINE_KEYS.map((routineKey) => ctx.routines.managed.get(routineKey, spaceId)),
      );
      const managedRoutinesWithDefaultDrift = managedRoutines.map((routine) =>
        withManagedRoutineDefaultDrift(
          routine,
          ctx.manifest.routines?.find((declaration) => declaration.routineKey === routine.resourceKey),
        ),
      );
      return {
        folder,
        spaces: await listSpaces(ctx, { spaceId }),
        managedAgent: overview.managedAgent,
        managedProject: overview.managedProject,
        managedSkills: overview.managedSkills,
        managedRoutine: managedRoutinesWithDefaultDrift[0],
        managedRoutines: managedRoutinesWithDefaultDrift,
        distillationPolicy: getDistillationAutoApplyRestriction(),
        eventIngestion: await getEventIngestionSettings(ctx, spaceId),
        agentOptions: await listWikiAgentOptions(ctx, spaceId),
        projectOptions: await listWikiProjectOptions(ctx, spaceId),
        capabilities: ctx.manifest.capabilities,
      };
    });
  },

  async onApiRequest(input: PluginApiRequestInput) {
    const ctx = requireContext();
    if (input.routeKey === "overview") {
      return { body: await getOverview(ctx, input.spaceId) };
    }

    if (input.routeKey === "bootstrap") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await bootstrapWikiRoot(ctx, {
          spaceId: input.spaceId,
          path: stringField(body?.path),
        }),
      };
    }

    if (input.routeKey === "spaces") {
      return {
        body: await listSpaces(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(input.query.wikiId),
        }),
      };
    }

    if (input.routeKey === "create-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await createSpace(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(body?.wikiId),
          slug: stringField(body?.slug),
          displayName: stringField(body?.displayName),
          folderMode: stringField(body?.folderMode) as "managed_subfolder" | "existing_local_folder" | null,
          accessScope: stringField(body?.accessScope) as "shared" | "personal" | "team" | null,
          settings: typeof body?.settings === "object" && body.settings != null ? body.settings as Record<string, unknown> : null,
        }),
      };
    }

    if (input.routeKey === "update-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        body: await updateSpace(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: input.params.spaceSlug,
          displayName: stringField(body?.displayName),
          status: stringField(body?.status) as "active" | "archived" | null,
          settings: typeof body?.settings === "object" && body.settings != null ? body.settings as Record<string, unknown> : null,
        }),
      };
    }

    if (input.routeKey === "bootstrap-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await bootstrapSpace(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: input.params.spaceSlug,
        }),
      };
    }

    if (input.routeKey === "archive-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        body: await archiveSpace(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: input.params.spaceSlug,
        }),
      };
    }

    if (input.routeKey === "capture-source") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await captureWikiSource(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: stringField(body?.spaceSlug),
          sourceType: stringField(body?.sourceType),
          title: stringField(body?.title),
          url: stringField(body?.url),
          contents: typeof body?.contents === "string" ? body.contents : "",
          rawPath: stringField(body?.rawPath),
          metadata: typeof body?.metadata === "object" && body.metadata != null ? body.metadata as Record<string, unknown> : null,
        }),
      };
    }

    if (input.routeKey === "operations") {
      return {
        body: await listOperations(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(input.query.wikiId),
          spaceSlug: stringField(input.query.spaceSlug),
          operationType: stringField(input.query.operationType),
          status: stringField(input.query.status),
          limit: typeof input.query.limit === "string" ? Number(input.query.limit) : null,
        }),
      };
    }

    if (input.routeKey === "start-query") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await startWikiQuerySession(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: stringField(body?.spaceSlug),
          question: stringField(body?.question) ?? "",
          title: stringField(body?.title),
        }),
      };
    }

    if (input.routeKey === "file-as-page") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await fileQueryAnswerAsPage(ctx, {
          spaceId: input.spaceId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: stringField(body?.spaceSlug),
          querySessionId: stringField(body?.querySessionId),
          question: stringField(body?.question),
          answer: stringField(body?.answer),
          path: stringField(body?.path) ?? "",
          title: stringField(body?.title),
          contents: stringField(body?.contents),
          expectedHash: stringField(body?.expectedHash),
        }),
      };
    }

    return { status: 404, body: { error: `Unknown LLM Wiki route: ${input.routeKey}` } };
  },

  async onHealth() {
    return {
      status: "ok",
      message: "LLM Wiki plugin worker is running",
      details: {
        surfaces: ["page", "sidebar", "settings", "tools", "database", "local-folder"],
      },
    };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
