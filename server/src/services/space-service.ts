import { notifyMuseContactVerification } from "../modules/external-agents/index.js";
import { promoteDeferredWorkIntents } from "./work-intent-outbox.js";
import { notifyDeferredExecutionEligibility } from "./deferred-execution-notifications.js";
import { notifyRunDispatch } from "./run-dispatch-notifications.js";
import { notifyGitHubSpaceChange } from "./github-connection-notifications.js";
import { notifyChatInboundWakeNotices } from "./chat-inbound-wake-notice-notifications.js";
import { notifySpaceRetentionWork } from "./retention-work-notifications.js";
import { notifyExternalObjectRefresh } from "./external-object-refresh-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { isRunnerApiResponseAsset } from "./asset-content-access.js";
import { deleteSpace } from "./space-deletion.js";
import { fenceActiveSpaceAgentStopsInTransaction } from "./agent-lifecycle.js";
import { publishAccountingActivities } from "./accounting-transaction.js";
import { budgetServiceInTransaction, type BudgetServiceHooks } from "./budgets.js";
import { and, count, eq, gte, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  spaces,
  spaceLogos,
  assets,
  agents,
  agentWakeupRequests,
  issues,
  heartbeatRuns,
  costEvents,
} from "@outpost/db";
import { notFound, unprocessable } from "../errors.js";
import { isCloudManagedInstance } from "./cloud-instance.js";
import { notifyCloudOfPrimarySpaceLifecycleChange } from "./cloud-lifecycle-sync.js";
import {
  MAX_ISSUE_PREFIX_ATTEMPTS,
  deriveIssuePrefixBase,
  isIssuePrefixConflict,
  issuePrefixSuffixForAttempt,
  pickAvailableIssuePrefix,
  rekeySpaceIssueIdentifiers,
} from "./issue-prefix.js";
import { environmentService } from "./environments.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";
import type { Space } from "@outpost/shared";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface SpaceActivityActor {
  actorType: "user" | "agent" | "system" | "plugin";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
}

const SYSTEM_SPACE_ACTOR: SpaceActivityActor = {
  actorType: "system",
  actorId: "system",
  agentId: null,
  runId: null,
};

export function spaceService(db: Db, _budgetHooks: BudgetServiceHooks = {}) {
  const environmentsSvc = environmentService(db);

  type SpaceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  async function applyArchiveCascadeInTx(tx: SpaceTx, id: string) {
    const [agentCount] = await tx.select({ value: count() }).from(agents).where(and(eq(agents.spaceId, id), notInArray(agents.status, ["paused", "terminated", "pending_approval"])));

    const [runCount] = await tx
      .select({ value: count() })
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.spaceId, id),
        inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
      ));

    await notifyChatInboundWakeNotices(tx, { spaceId: id });
    await tx
      .update(agentWakeupRequests)
      .set({
        status: "cancelled",
        error: "Cancelled because the space was archived",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(agentWakeupRequests.spaceId, id),
        inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution", "claimed"]),
        isNull(agentWakeupRequests.runId),
      ));

    return { agentsPauseRequested: agentCount.value, runsCancellationRequested: runCount.value };
  }

  async function finalizeArchive(
    id: string,
    actor: SpaceActivityActor,
    cascade: { agentsPauseRequested: number; runsCancellationRequested: number },
  ) {
    // The committed space status blocks dispatch immediately. Lifecycle
    // projection owns provider termination, including paused agents with work.
    await logActivity(db, {
      spaceId: id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      action: "space.archived",
      entityType: "space",
      entityId: id,
      details: {
        agentsPauseRequested: cascade.agentsPauseRequested,
        runsCancellationRequested: cascade.runsCancellationRequested,
      },
    });
  }

  const spaceSelection = {
    id: spaces.id,
    name: spaces.name,
    description: spaces.description,
    workspaceRoot: spaces.workspaceRoot,
    status: spaces.status,
    pauseReason: spaces.pauseReason,
    pausedAt: spaces.pausedAt,
    issuePrefix: spaces.issuePrefix,
    issueCounter: spaces.issueCounter,
    budgetMonthlyCents: spaces.budgetMonthlyCents,
    spentMonthlyCents: spaces.spentMonthlyCents,
    defaultResponsibleUserId: spaces.defaultResponsibleUserId,
    defaultAgentId: spaces.defaultAgentId,
    requireOperatorApprovalForNewAgents: spaces.requireOperatorApprovalForNewAgents,
    interactionResolverPolicy: spaces.interactionResolverPolicy,
    feedbackDataSharingEnabled: spaces.feedbackDataSharingEnabled,
    feedbackDataSharingConsentAt: spaces.feedbackDataSharingConsentAt,
    feedbackDataSharingConsentByUserId: spaces.feedbackDataSharingConsentByUserId,
    feedbackDataSharingTermsVersion: spaces.feedbackDataSharingTermsVersion,
    logoAssetId: spaceLogos.assetId,
    createdAt: spaces.createdAt,
    updatedAt: spaces.updatedAt,
  };

  function enrichSpace<T extends { logoAssetId: string | null; status: string; pauseReason: string | null }>(space: T) {
    return {
      ...space,
      status: space.status as Space["status"],
      pauseReason: space.pauseReason as Space["pauseReason"],
      logoUrl: space.logoAssetId ? `/api/assets/${space.logoAssetId}/content` : null,
    };
  }

  function currentUtcMonthWindow(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
    };
  }

  async function getMonthlySpendBySpaceIds(
    spaceIds: string[],
    database: Pick<Db, "select"> = db,
  ) {
    if (spaceIds.length === 0) return new Map<string, number>();
    const { start, end } = currentUtcMonthWindow();
    const rows = await database
        .select({
          spaceId: costEvents.spaceId,
          spentMonthlyCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.spaceId, spaceIds),
          gte(costEvents.occurredAt, start),
          lt(costEvents.occurredAt, end),
        ),
      )
      .groupBy(costEvents.spaceId);
    return new Map(rows.map((row) => [row.spaceId, Number(row.spentMonthlyCents ?? 0)]));
  }

  async function hydrateSpaceSpend<T extends { id: string; spentMonthlyCents: number }>(
    rows: T[],
    database: Pick<Db, "select"> = db,
  ) {
    const spendBySpaceId = await getMonthlySpendBySpaceIds(rows.map((row) => row.id), database);
    return rows.map((row) => ({
      ...row,
      spentMonthlyCents: spendBySpaceId.get(row.id) ?? 0,
    }));
  }

  function getSpaceQuery(database: Pick<Db, "select">) {
    return database
      .select(spaceSelection)
      .from(spaces)
      .leftJoin(spaceLogos, eq(spaceLogos.spaceId, spaces.id));
  }

  /**
   * Decides whether a rename must move the space onto a new issue prefix, and
   * returns the exact prefix pair to re-key.
   *
   * Self-hosted spaces pick their prefix from the name at creation and keep
   * it, so a rename leaves the prefix alone. On a hosted/managed instance the
   * space is provisioned for the operator, so the name is the only prefix
   * source the operator ever chose — a rename re-derives it. Returns null when
   * the current prefix is already correct or when the suffix space is
   * exhausted.
   */
  async function resolveRenamedIssuePrefix(
    tx: SpaceTx,
    spaceId: string,
    spacePatch: Partial<typeof spaces.$inferInsert>,
  ): Promise<{ fromPrefix: string; toPrefix: string } | null> {
    // Only patch and environment facts gate the lock. Every comparison against
    // the space's own name or prefix happens below, under the lock.
    // An explicit prefix in the patch is the caller's decision; never override it.
    if (spacePatch.issuePrefix !== undefined) return null;
    const nextName = spacePatch.name;
    if (typeof nextName !== "string" || nextName.trim().length === 0) return null;
    if (!isCloudManagedInstance()) return null;

    // Lock the space row before comparing anything against it. Two concurrent
    // updates would otherwise each decide from the row they read before either
    // committed, and both ways of getting that wrong end with a space whose
    // prefix disagrees with its own identifiers:
    //
    //   - Two renames: the second re-keys from the prefix it read, finds the
    //     identifiers the first already moved, and leaves them on the first
    //     rename's prefix while the row carries the second one's.
    //   - A rename plus a stale form that resubmits the original name: the
    //     second sees a name equal to the one it read, skips re-derivation, and
    //     restores the old name on top of the first rename's prefix.
    //
    // Reading the row under the lock makes the second transaction decide from
    // what the first actually committed. Only a managed instance takes this
    // lock, and only for an update that carries a name.
    const locked = await tx
      .select({ name: spaces.name, issuePrefix: spaces.issuePrefix })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .for("update")
      .then((rows) => rows[0] ?? null);
    if (!locked || nextName === locked.name) return null;

    const nextBase = deriveIssuePrefixBase(nextName);
    // A rename that keeps the same base keeps the current prefix, including
    // any disambiguating suffix it was allocated.
    if (nextBase === deriveIssuePrefixBase(locked.name)) return null;
    if (nextBase === locked.issuePrefix) return null;

    const candidate = await pickAvailableIssuePrefix(tx, nextBase);
    if (!candidate || candidate === locked.issuePrefix) return null;
    return { fromPrefix: locked.issuePrefix, toPrefix: candidate };
  }

  async function createSpaceWithUniquePrefix(data: typeof spaces.$inferInsert) {
    const base = deriveIssuePrefixBase(data.name);
    let suffix = 1;
    while (suffix <= MAX_ISSUE_PREFIX_ATTEMPTS) {
      const candidate = `${base}${issuePrefixSuffixForAttempt(suffix)}`;
      try {
        const rows = await db
          .insert(spaces)
          .values({ ...data, issuePrefix: candidate })
          .returning();
        return rows[0];
      } catch (error) {
        if (!isIssuePrefixConflict(error)) throw error;
      }
      suffix += 1;
    }
    throw new Error("Unable to allocate unique issue prefix");
  }

  return {
    getByWorkspaceRootKey: async (workspaceRootKey: string) => {
      const row = await getSpaceQuery(db)
        .where(eq(spaces.workspaceRootKey, workspaceRootKey))
        .then((rows) => rows[0] ?? null);
      return row ? enrichSpace(row) : null;
    },
    list: async () => {
      const rows = await getSpaceQuery(db);
      const hydrated = await hydrateSpaceSpend(rows);
      return hydrated.map((row) => enrichSpace(row));
    },

    getById: async (id: string) => {
      // Non-UUID refs previously reached the uuid-typed query and threw a
      // DrizzleQueryError ("invalid input syntax for type uuid"), surfacing
      // as HTTP 500 from GET /api/spaces/:spaceId. Treat them as
      // not-found so the route returns 404.
      if (!UUID_RE.test(id)) return null;
      const row = await getSpaceQuery(db)
        .where(eq(spaces.id, id))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const [hydrated] = await hydrateSpaceSpend([row], db);
      return enrichSpace(hydrated);
    },

    create: async (data: typeof spaces.$inferInsert) => {
      const created = await createSpaceWithUniquePrefix(data);
      await environmentsSvc.ensureLocalEnvironment(created.id);
      const row = await getSpaceQuery(db)
        .where(eq(spaces.id, created.id))
        .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Space not found after creation");
      const [hydrated] = await hydrateSpaceSpend([row], db);
      return enrichSpace(hydrated);
    },

    update: async (
      id: string,
      data: Partial<typeof spaces.$inferInsert> & { logoAssetId?: string | null },
      actor: SpaceActivityActor = SYSTEM_SPACE_ACTOR,
    ) => {
      const budgetPublications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        if (data.status !== undefined || data.budgetMonthlyCents !== undefined) {
          await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, id)).for("no key update");
        }
        const existing = await getSpaceQuery(tx)
          .where(eq(spaces.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        const { logoAssetId, ...spacePatch } = data;
        const willReactivate = existing.status !== "active" && spacePatch.status === "active";
        const willArchive = existing.status !== "archived" && spacePatch.status === "archived";

        if (logoAssetId !== undefined && logoAssetId !== null) {
          const nextLogoAsset = await tx
            .select()
            .from(assets)
            .where(eq(assets.id, logoAssetId))
            .then((rows) => rows[0] ?? null);
          if (!nextLogoAsset) throw notFound("Logo asset not found");
          if (await isRunnerApiResponseAsset(tx, nextLogoAsset)) {
            throw unprocessable("API response snapshots cannot be space logos; upload a logo asset");
          }
          if (nextLogoAsset.spaceId !== existing.id) {
            throw unprocessable("Logo asset must belong to the same space");
          }
        }

        const renamedPrefix = await resolveRenamedIssuePrefix(tx, id, spacePatch);

        if (spacePatch.status !== undefined && spacePatch.status !== existing.status) {
          if(willReactivate)await notifyMuseContactVerification(tx,{spaceId:id});
          await notifyRunDispatch(tx, { spaceId: id });
          await notifyGitHubSpaceChange(tx, id);
          await notifyDeferredExecutionEligibility(tx, { spaceId: id });
          if (spacePatch.status === "active") await promoteDeferredWorkIntents(tx, { spaceId: id, trigger: "pause_lifted" });
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillSourceSync);
          await notifyExternalObjectRefresh(tx, id);
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.routineSchedules);
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.issueMonitors);
          await notifySpaceRetentionWork(tx, id);
          await notifyChatInboundWakeNotices(tx, { spaceId: id });
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentLifecycle, id);
        }
        const updated = await tx
          .update(spaces)
          .set({
            ...spacePatch,
            ...(renamedPrefix ? { issuePrefix: renamedPrefix.toPrefix } : {}),
            updatedAt: new Date(),
          })
          .where(eq(spaces.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;

        let issuePrefixRederived: {
          previousIssuePrefix: string;
          issuePrefix: string;
          issuesRekeyed: number;
          casesRekeyed: number;
        } | null = null;
        if (renamedPrefix) {
          const rekeyed = await rekeySpaceIssueIdentifiers(tx, {
            spaceId: id,
            fromPrefix: renamedPrefix.fromPrefix,
            toPrefix: renamedPrefix.toPrefix,
          });
          issuePrefixRederived = {
            previousIssuePrefix: renamedPrefix.fromPrefix,
            issuePrefix: renamedPrefix.toPrefix,
            issuesRekeyed: rekeyed.issues,
            casesRekeyed: rekeyed.cases,
          };
        }

        let agentsRestored = 0;
        if (willReactivate) {
          const restoredRows = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.spaceId, id), eq(agents.pauseReason, "space_archived")));
          agentsRestored = restoredRows.length;
        }

        const archiveCascade = willArchive ? await applyArchiveCascadeInTx(tx, id) : null;
        if (spacePatch.status !== existing.status && (spacePatch.status === "paused" || spacePatch.status === "archived")) {
          await fenceActiveSpaceAgentStopsInTransaction(tx as unknown as Db, id, spacePatch.status);
        }

        if (logoAssetId === null) {
          await tx.delete(spaceLogos).where(eq(spaceLogos.spaceId, id));
        } else if (logoAssetId !== undefined) {
          await tx
            .insert(spaceLogos)
            .values({
              spaceId: id,
              assetId: logoAssetId,
            })
            .onConflictDoUpdate({
              target: spaceLogos.spaceId,
              set: {
                assetId: logoAssetId,
                updatedAt: new Date(),
              },
            });
        }

        if (logoAssetId !== undefined && existing.logoAssetId && existing.logoAssetId !== logoAssetId) {
          await tx.delete(assets).where(eq(assets.id, existing.logoAssetId));
        }

        if (data.budgetMonthlyCents !== undefined) {
          await budgetServiceInTransaction(tx as unknown as Db, budgetPublications).upsertPolicy(id, {
            scopeType: "space", scopeId: id, amount: data.budgetMonthlyCents, isActive: data.budgetMonthlyCents > 0, windowKind: "calendar_month_utc",
          }, actor.actorType === "user" ? actor.actorId : null);
          const [budgetUpdated] = await tx.select().from(spaces).where(eq(spaces.id, id));
          Object.assign(updated, budgetUpdated);
        }
        const [hydrated] = await hydrateSpaceSpend([{
          ...updated,
          logoAssetId: logoAssetId === undefined ? existing.logoAssetId : logoAssetId,
        }], tx);

        const shouldLogReactivation = willReactivate &&
          (existing.status === "archived" || agentsRestored > 0);

        return {
          space: enrichSpace(hydrated),
          reactivated: shouldLogReactivation ? { agentsRestored } : null,
          archiveCascade,
          unarchived: willReactivate && existing.status === "archived",
          issuePrefixRederived,
        };
      });
      if (!result) return null;
      publishAccountingActivities(id, budgetPublications);
      // Post-commit, fire-and-forget, and BEFORE any finalization that
      // could throw: a Cloud-pinned primary space that crossed the
      // archived boundary (either direction) rings the harness so the
      // stack itself can converge. The status transaction has already
      // committed, so a later cascade or activity-log failure must not
      // leave Cloud unaware of a space that is in fact archived.
      if (result.archiveCascade || result.unarchived) {
        void notifyCloudOfPrimarySpaceLifecycleChange(id);
      }
      if (result.issuePrefixRederived) {
        await logActivity(db, {
          spaceId: id,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId ?? null,
          runId: actor.runId ?? null,
          action: "space.updated",
          entityType: "space",
          entityId: id,
          details: {
            source: "space_rename",
            reason: "issue_prefix_rederived",
            ...result.issuePrefixRederived,
          },
        });
      }
      if (result.reactivated) {
        await logActivity(db, {
          spaceId: id,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId ?? null,
          runId: actor.runId ?? null,
          action: "space.reactivated",
          entityType: "space",
          entityId: id,
          details: { agentsRestored: result.reactivated.agentsRestored },
        });
      }
      if (result.archiveCascade) {
        await finalizeArchive(id, actor, result.archiveCascade);
      }
      return result.space;
    },

    archive: async (id: string, actor: SpaceActivityActor = SYSTEM_SPACE_ACTOR) => {
      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select({ status: spaces.status })
          .from(spaces)
          .where(eq(spaces.id, id))
          .for("no key update")
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        const wasAlreadyArchived = existing.status === "archived";

        if (!wasAlreadyArchived) {
          await notifyRunDispatch(tx, { spaceId: id });
          await notifyGitHubSpaceChange(tx, id);
          await notifyDeferredExecutionEligibility(tx, { spaceId: id });
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillSourceSync);
          await notifyExternalObjectRefresh(tx, id);
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.routineSchedules);
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.issueMonitors);
          await notifySpaceRetentionWork(tx, id);
          await notifyChatInboundWakeNotices(tx, { spaceId: id });
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentLifecycle, id);
          await tx
            .update(spaces)
            .set({ status: "archived", updatedAt: new Date() })
            .where(eq(spaces.id, id));
        }

        const cascade = wasAlreadyArchived ? null : await applyArchiveCascadeInTx(tx, id);
        if (!wasAlreadyArchived) await fenceActiveSpaceAgentStopsInTransaction(tx as unknown as Db, id, "archived");

        const row = await getSpaceQuery(tx)
          .where(eq(spaces.id, id))
          .then((rows) => rows[0] ?? null);
        if (!row) return null;
        const [hydrated] = await hydrateSpaceSpend([row], tx);
        return {
          space: enrichSpace(hydrated),
          cascade,
        };
      });
      if (!result) return null;

      // Same doorbell rule as update(): the archive is committed, so ring
      // before finalization, which can throw without undoing it.
      if (result.cascade) {
        void notifyCloudOfPrimarySpaceLifecycleChange(id);
        await finalizeArchive(id, actor, result.cascade);
      }

      return result.space;
    },

    remove: (id: string) => deleteSpace(db, id),

    stats: () =>
      Promise.all([
        db
          .select({ spaceId: agents.spaceId, count: count() })
          .from(agents)
          .groupBy(agents.spaceId),
        db
          .select({ spaceId: issues.spaceId, count: count() })
          .from(issues)
          .groupBy(issues.spaceId),
      ]).then(([agentRows, issueRows]) => {
        const result: Record<string, { agentCount: number; issueCount: number }> = {};
        for (const row of agentRows) {
          result[row.spaceId] = { agentCount: row.count, issueCount: 0 };
        }
        for (const row of issueRows) {
          if (result[row.spaceId]) {
            result[row.spaceId].issueCount = row.count;
          } else {
            result[row.spaceId] = { agentCount: 0, issueCount: row.count };
          }
        }
        return result;
      }),
  };
}
