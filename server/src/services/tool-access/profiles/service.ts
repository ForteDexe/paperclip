import { assertAgentToolAssignmentInteractions } from "../../connection-management.js";
import type { ConnectionManagementContext } from "../../connection-management.js";
import { createConnectionProfileConfigurationReader } from "./connection-configuration.js";
import { connectionActorUserId } from "../actor.js";
import { assertProfileEntryInputs } from "../../tool-profile-entry-validation.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { agents, issues, projects, routines, toolApplications, toolCatalogEntries, toolConnections, toolMcpGateways, toolProfileBindings, toolProfileEntries, toolProfiles } from "@outpost/db";
import type { CreateToolProfileBindingForProfile, CreateToolProfileEntryForProfile, CreateToolProfileWithEntries, DeleteToolProfile, DuplicateToolProfile, ToolProfile, ToolProfileBinding, ToolProfileEntry, ToolProfileNewToolReviewItem, ToolProfileNewToolsReview, ToolProfileNewToolsReviewResult, ToolProfileSummary, ToolProfileWithDetails, ReviewToolProfileNewTools, UpdateToolProfileEntry, UpdateToolProfileWithEntries, UnbindToolProfileBinding } from "@outpost/shared";
import { badRequest, conflict, notFound, unprocessable } from "../../../errors.js";
import type { ActorInfo, ToolAccessMutationDb } from "../types.js";
import { lockProfileEntryReferences, lockToolAssignmentAgents } from "../assignment-locks.js";
import { normalizeKey } from "../identifiers.js";
import { toProfile, toProfileEntry, toProfileBinding, profileCatalogColumns, profileReviewCatalogColumns, pendingNewToolsForProfile, buildProfileDetails } from "./projection.js";

export function createToolProfileService(db: Db, now: () => Date) {
  async function getProfileRow(profileId: string, spaceId?: string, dbClient: ToolAccessMutationDb = db) {
    const where = spaceId
      ? and(
          eq(toolProfiles.id, profileId),
          eq(toolProfiles.spaceId, spaceId),
        )
      : eq(toolProfiles.id, profileId);
    const [row] = await dbClient.select().from(toolProfiles).where(where);
    if (!row) throw notFound("Tool profile not found");
    return row;
  }

  async function profileDetails(
    profileId: string,
    spaceId?: string,
    dbClient: ToolAccessMutationDb = db,
  ): Promise<ToolProfileWithDetails> {
    const profile = await getProfileRow(profileId, spaceId, dbClient);
    const [
      entries,
      bindings,
      catalog,
      spaceAgents,
      applications,
      connections,
    ] = await Promise.all([
      dbClient
        .select()
        .from(toolProfileEntries)
        .where(
          and(
            eq(toolProfileEntries.spaceId, profile.spaceId),
            eq(toolProfileEntries.profileId, profile.id),
          ),
        )
        .orderBy(asc(toolProfileEntries.createdAt), asc(toolProfileEntries.id)),
      dbClient
        .select()
        .from(toolProfileBindings)
        .where(
          and(
            eq(toolProfileBindings.spaceId, profile.spaceId),
            eq(toolProfileBindings.profileId, profile.id),
          ),
        )
        .orderBy(
          asc(toolProfileBindings.priority),
          asc(toolProfileBindings.createdAt),
        ),
      dbClient
        .select(profileCatalogColumns)
        .from(toolCatalogEntries)
        .where(
          and(
            eq(toolCatalogEntries.spaceId, profile.spaceId),
            eq(toolCatalogEntries.status, "active"),
          ),
        ),
      dbClient
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.spaceId, profile.spaceId)),
      dbClient
        .select({ id: toolApplications.id, name: toolApplications.name })
        .from(toolApplications)
        .where(eq(toolApplications.spaceId, profile.spaceId)),
      dbClient
        .select({ id: toolConnections.id, name: toolConnections.name })
        .from(toolConnections)
        .where(eq(toolConnections.spaceId, profile.spaceId)),
    ]);
    return buildProfileDetails({
      profile,
      entries,
      bindings,
      catalog,
      agentIds: spaceAgents.map((agent) => agent.id),
      applicationsById: new Map(
        applications.map((application) => [application.id, application]),
      ),
      connectionsById: new Map(
        connections.map((connection) => [connection.id, connection]),
      ),
    });
  }

  async function listProfileNewTools(
    profileId: string,
    spaceId?: string,
  ): Promise<ToolProfileNewToolsReview> {
    const profile = await getProfileRow(profileId, spaceId);
    const [entries, catalog, applications, connections] = await Promise.all([
      db
        .select()
        .from(toolProfileEntries)
        .where(
          and(
            eq(toolProfileEntries.spaceId, profile.spaceId),
            eq(toolProfileEntries.profileId, profile.id),
          ),
        )
        .orderBy(asc(toolProfileEntries.createdAt)),
      db
        .select(profileReviewCatalogColumns)
        .from(toolCatalogEntries)
        .where(
          and(
            eq(toolCatalogEntries.spaceId, profile.spaceId),
            eq(toolCatalogEntries.status, "active"),
          ),
        )
        .orderBy(asc(toolCatalogEntries.toolName)),
      db
        .select({ id: toolApplications.id, name: toolApplications.name })
        .from(toolApplications)
        .where(eq(toolApplications.spaceId, profile.spaceId)),
      db
        .select({ id: toolConnections.id, name: toolConnections.name })
        .from(toolConnections)
        .where(eq(toolConnections.spaceId, profile.spaceId)),
    ]);
    const tools = pendingNewToolsForProfile({
      profile,
      entries,
      catalog,
      applicationsById: new Map(
        applications.map((application) => [application.id, application]),
      ),
      connectionsById: new Map(
        connections.map((connection) => [connection.id, connection]),
      ),
    });
    return {
      profileId: profile.id,
      reviewedAt: profile.newToolsReviewedAt,
      pendingCount: tools.length,
      tools,
    };
  }

  async function reviewProfileNewTools(
    profileId: string,
    input: ReviewToolProfileNewTools,
    actor?: ActorInfo,
  ): Promise<ToolProfileNewToolsReviewResult> {
    await actor?.managementContext?.reauthorize();
    const profile = await getProfileRow(profileId);
    const review = await listProfileNewTools(profile.id, profile.spaceId);
    if (review.tools.length === 0)
      throw badRequest("No new tools are pending review for this profile");

    const decisionIds = input.decisions.map(
      (decision) => decision.catalogEntryId,
    );
    if (new Set(decisionIds).size !== decisionIds.length) {
      throw badRequest(
        "New-tools review decisions must not contain duplicate catalogEntryId values",
      );
    }
    const pendingIds = new Set(review.tools.map((tool) => tool.catalogEntryId));
    if (
      decisionIds.length !== pendingIds.size ||
      decisionIds.some((id) => !pendingIds.has(id))
    ) {
      throw badRequest(
        "New-tools review decisions must cover every currently pending tool exactly once",
      );
    }

    const toolById = new Map(
      review.tools.map((tool) => [tool.catalogEntryId, tool]),
    );
    const allowTools = input.decisions
      .filter((decision) => decision.decision === "allow")
      .map((decision) => toolById.get(decision.catalogEntryId))
      .filter(Boolean) as ToolProfileNewToolReviewItem[];
    const nowAt = now();
    let createdEntries: ToolProfileEntry[] = [];
    if (allowTools.length > 0) {
      const rows = await db
        .insert(toolProfileEntries)
        .values(
          allowTools.map((tool) => ({
            spaceId: profile.spaceId,
            profileId: profile.id,
            selectorType: "catalog_entry" as const,
            effect: "include" as const,
            applicationId: tool.applicationId,
            connectionId: tool.connectionId,
            catalogEntryId: tool.catalogEntryId,
          })),
        )
        .returning();
      createdEntries = rows.map(toProfileEntry);
    }

    await db
      .update(toolCatalogEntries)
      .set({
        reviewedAt: nowAt,
        reviewedByAgentId:
          actor?.actorType === "agent" ? (actor.actorId ?? null) : null,
        reviewedByUserId:
          connectionActorUserId(actor),
        updatedAt: nowAt,
      })
      .where(
        and(
          eq(toolCatalogEntries.spaceId, profile.spaceId),
          inArray(toolCatalogEntries.id, decisionIds),
        ),
      );
    await db
      .update(toolProfiles)
      .set({ newToolsReviewedAt: nowAt, updatedAt: nowAt })
      .where(eq(toolProfiles.id, profile.id));

    return {
      profile: await profileDetails(profile.id, profile.spaceId),
      reviewedAt: nowAt,
      allowedCount: allowTools.length,
      keptBlockedCount: input.decisions.length - allowTools.length,
      entriesCreated: createdEntries,
      reviewedCatalogEntryIds: decisionIds,
    };
  }

  async function createProfileEntries(
    spaceId: string,
    profileId: string,
    entries: CreateToolProfileEntryForProfile[],
    dbClient: ToolAccessMutationDb = db,
  ) {
    await assertProfileEntryInputs(dbClient, spaceId, entries);
    if (entries.length === 0) return;
    await dbClient.insert(toolProfileEntries).values(
      entries.map((entry) => ({
        spaceId,
        profileId,
        selectorType: entry.selectorType,
        effect: entry.effect ?? "include",
        applicationId: entry.applicationId ?? null,
        connectionId: entry.connectionId ?? null,
        catalogEntryId: entry.catalogEntryId ?? null,
        toolName: entry.toolName ?? null,
        riskLevel: entry.riskLevel ?? null,
        conditions: entry.conditions ?? null,
      })),
    );
  }

  async function replaceProfileEntries(
    spaceId: string,
    profileId: string,
    entries: CreateToolProfileEntryForProfile[],
    dbClient: ToolAccessMutationDb = db,
  ) {
    await assertProfileEntryInputs(dbClient, spaceId, entries);
    await dbClient
      .delete(toolProfileEntries)
      .where(
        and(
          eq(toolProfileEntries.spaceId, spaceId),
          eq(toolProfileEntries.profileId, profileId),
        ),
      );
    await createProfileEntries(spaceId, profileId, entries, dbClient);
  }

  async function assertTargetExists(
    spaceId: string,
    targetType: CreateToolProfileBindingForProfile["targetType"],
    targetId: string,
    dbClient: ToolAccessMutationDb = db,
  ) {
    if (targetType === "space") {
      if (targetId !== spaceId)
        throw unprocessable(
          "Outpost profile bindings must target the same space id",
        );
      return;
    }
    if (targetType === "agent") {
      const [row] = await dbClient
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, targetId), eq(agents.spaceId, spaceId)));
      if (!row)
        throw unprocessable(
          "Tool profile agent binding target must belong to the same space",
        );
      return;
    }
    if (targetType === "project") {
      const [row] = await dbClient
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, targetId), eq(projects.spaceId, spaceId)),
        );
      if (!row)
        throw unprocessable(
          "Tool profile project binding target must belong to the same space",
        );
      return;
    }
    if (targetType === "routine") {
      const [row] = await dbClient
        .select({ id: routines.id })
        .from(routines)
        .where(
          and(eq(routines.id, targetId), eq(routines.spaceId, spaceId)),
        );
      if (!row)
        throw unprocessable(
          "Tool profile routine binding target must belong to the same space",
        );
      return;
    }
    if (targetType === "issue") {
      const [row] = await dbClient
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, targetId), eq(issues.spaceId, spaceId)));
      if (!row)
        throw unprocessable(
          "Tool profile issue binding target must belong to the same space",
        );
      return;
    }
    if (targetType === "gateway") {
      const [row] = await dbClient
        .select({ id: toolMcpGateways.id })
        .from(toolMcpGateways)
        .where(
          and(
            eq(toolMcpGateways.id, targetId),
            eq(toolMcpGateways.spaceId, spaceId),
          ),
        );
      if (!row)
        throw unprocessable(
          "Tool profile gateway binding target must belong to the same space",
        );
    }
  }
  return {
    listConnectionProfileConfiguration: createConnectionProfileConfigurationReader(db),

    listProfiles: async (
      spaceId: string,
    ): Promise<ToolProfileWithDetails[]> => {
      const profiles = await db
        .select()
        .from(toolProfiles)
        .where(eq(toolProfiles.spaceId, spaceId))
        .orderBy(desc(toolProfiles.updatedAt));
      if (profiles.length === 0) return [];
      const profileIds = profiles.map((profile) => profile.id);
      const [
        entries,
        bindings,
        catalog,
        spaceAgents,
        applications,
        connections,
      ] = await Promise.all([
        db
          .select()
          .from(toolProfileEntries)
          .where(
            and(
              eq(toolProfileEntries.spaceId, spaceId),
              inArray(toolProfileEntries.profileId, profileIds),
            ),
          )
          .orderBy(asc(toolProfileEntries.createdAt), asc(toolProfileEntries.id)),
        db
          .select()
          .from(toolProfileBindings)
          .where(
            and(
              eq(toolProfileBindings.spaceId, spaceId),
              inArray(toolProfileBindings.profileId, profileIds),
            ),
          )
          .orderBy(
            asc(toolProfileBindings.priority),
            asc(toolProfileBindings.createdAt),
          ),
        db
          .select(profileCatalogColumns)
          .from(toolCatalogEntries)
          .where(
            and(
              eq(toolCatalogEntries.spaceId, spaceId),
              eq(toolCatalogEntries.status, "active"),
            ),
          ),
        db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.spaceId, spaceId)),
        db
          .select({ id: toolApplications.id, name: toolApplications.name })
          .from(toolApplications)
          .where(eq(toolApplications.spaceId, spaceId)),
        db
          .select({ id: toolConnections.id, name: toolConnections.name })
          .from(toolConnections)
          .where(eq(toolConnections.spaceId, spaceId)),
      ]);
      const entriesByProfile = new Map<
        string,
        Array<typeof toolProfileEntries.$inferSelect>
      >();
      const bindingsByProfile = new Map<
        string,
        Array<typeof toolProfileBindings.$inferSelect>
      >();
      for (const entry of entries) {
        const list = entriesByProfile.get(entry.profileId) ?? [];
        list.push(entry);
        entriesByProfile.set(entry.profileId, list);
      }
      for (const binding of bindings) {
        const list = bindingsByProfile.get(binding.profileId) ?? [];
        list.push(binding);
        bindingsByProfile.set(binding.profileId, list);
      }
      const agentIds = spaceAgents.map((agent) => agent.id);
      const applicationsById = new Map(
        applications.map((application) => [application.id, application]),
      );
      const connectionsById = new Map(
        connections.map((connection) => [connection.id, connection]),
      );
      return profiles.map((profile) =>
        buildProfileDetails({
          profile,
          entries: entriesByProfile.get(profile.id) ?? [],
          bindings: bindingsByProfile.get(profile.id) ?? [],
          catalog,
          agentIds,
          applicationsById,
          connectionsById,
        }),
      );
    },

    createProfile: async (
      spaceId: string,
      input: CreateToolProfileWithEntries, managementContext?: ConnectionManagementContext,
    ): Promise<ToolProfileWithDetails> => {
      await managementContext?.reauthorize();
      await assertProfileEntryInputs(db, spaceId, input.entries ?? []);
      const [row] = await db
        .insert(toolProfiles)
        .values({
          spaceId,
          profileKey: input.profileKey,
          name: input.name,
          description: input.description ?? null,
          status: input.status ?? "active",
          defaultAction: input.defaultAction ?? "deny",
          metadata: input.metadata ?? {},
        })
        .returning();
      await createProfileEntries(spaceId, row.id, input.entries ?? []);
      return profileDetails(row.id, spaceId);
    },

    getProfile: profileDetails,

    listProfileNewTools,

    reviewProfileNewTools,

    updateProfile: async (
      profileId: string,
      input: UpdateToolProfileWithEntries, managementContext?: ConnectionManagementContext,
    ): Promise<ToolProfileWithDetails> => {
      await managementContext?.reauthorize();
      const existing = await getProfileRow(profileId);
      if (input.entries) {
        await assertProfileEntryInputs(db, existing.spaceId, input.entries);
      }
      const referencesChanged = new Error("Tool profile references changed");
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await db.transaction(async tx => {
            const db = tx as unknown as Db;
            const readReferences = () => tx.select({ applicationId: toolProfileEntries.applicationId, connectionId: toolProfileEntries.connectionId, catalogEntryId: toolProfileEntries.catalogEntryId })
              .from(toolProfileEntries).where(and(eq(toolProfileEntries.spaceId, existing.spaceId), eq(toolProfileEntries.profileId, profileId)))
              .orderBy(toolProfileEntries.id);
            const oldReferences = input.entries ? await readReferences() : [];
            await lockProfileEntryReferences(tx, existing.spaceId, [...oldReferences, ...(input.entries ?? [])]);
            const [current] = await tx.select().from(toolProfiles).where(eq(toolProfiles.id, profileId)).for("no key update");
            if (!current) throw notFound("Tool profile not found");
            if (input.entries && JSON.stringify(await readReferences()) !== JSON.stringify(oldReferences)) throw referencesChanged;
            await db
              .update(toolProfiles)
              .set({
                profileKey: input.profileKey ?? current.profileKey,
                name: input.name ?? current.name,
                description: input.description ?? current.description,
                status: input.status ?? current.status,
                defaultAction: input.defaultAction ?? current.defaultAction,
                metadata: input.metadata ?? current.metadata,
                updatedAt: new Date(),
              })
              .where(eq(toolProfiles.id, profileId));
            if (input.entries) {
              await replaceProfileEntries(
                existing.spaceId,
                profileId,
                input.entries,
                tx,
              );
            }
          });
          break;
        } catch (error) {
          if (error !== referencesChanged) throw error;
          if (attempt >= 2) throw conflict("Tool profile entries changed during replacement", { retryable: true });
        }
      }
      return profileDetails(profileId, existing.spaceId);
    },

    duplicateProfile: async (
      profileId: string,
      input: DuplicateToolProfile, managementContext?: ConnectionManagementContext,
    ): Promise<ToolProfileWithDetails> => {
      await managementContext?.reauthorize();
      const existing = await getProfileRow(profileId);
      const [entries, bindings] = await Promise.all([
        db
          .select()
          .from(toolProfileEntries)
          .where(
            and(
              eq(toolProfileEntries.spaceId, existing.spaceId),
              eq(toolProfileEntries.profileId, existing.id),
            ),
          )
          .orderBy(asc(toolProfileEntries.createdAt)),
        db
          .select()
          .from(toolProfileBindings)
          .where(
            and(
              eq(toolProfileBindings.spaceId, existing.spaceId),
              eq(toolProfileBindings.profileId, existing.id),
            ),
          )
          .orderBy(
            asc(toolProfileBindings.priority),
            asc(toolProfileBindings.createdAt),
          ),
      ]);
      const [created] = await db
        .insert(toolProfiles)
        .values({
          spaceId: existing.spaceId,
          profileKey: normalizeKey(`${input.name}-${randomUUID().slice(0, 8)}`),
          name: input.name,
          description: existing.description,
          status: "active",
          defaultAction: existing.defaultAction,
          newToolsReviewedAt: existing.newToolsReviewedAt,
          metadata: existing.metadata ?? {},
        })
        .returning();
      if (entries.length > 0) {
        await db.insert(toolProfileEntries).values(
          entries.map((entry) => ({
            spaceId: entry.spaceId,
            profileId: created.id,
            selectorType: entry.selectorType,
            effect: entry.effect,
            applicationId: entry.applicationId,
            connectionId: entry.connectionId,
            catalogEntryId: entry.catalogEntryId,
            toolName: entry.toolName,
            riskLevel: entry.riskLevel,
            conditions: entry.conditions,
          })),
        );
      }
      if (input.includeAssignments && bindings.length > 0) {
        await db.insert(toolProfileBindings).values(
          bindings.map((binding) => ({
            spaceId: binding.spaceId,
            profileId: created.id,
            targetType: binding.targetType,
            targetId: binding.targetId,
            priority: binding.priority,
            metadata: binding.metadata ?? {},
            createdByAgentId: binding.createdByAgentId,
            createdByUserId: binding.createdByUserId,
          })),
        );
      }
      return profileDetails(created.id, existing.spaceId);
    },

    deleteProfile: async (
      profileId: string,
      input: DeleteToolProfile, managementContext?: ConnectionManagementContext,
    ): Promise<{
      profile: ToolProfile;
      summary: ToolProfileSummary;
      reassignedToProfileId: string | null;
      reassignedBindingCount: number;
    }> => db.transaction(async tx => {
      await managementContext?.reauthorize();
      const existing = await getProfileRow(profileId, undefined, tx);
      const db = tx as unknown as Db;
      await tx.select({ id: toolProfiles.id }).from(toolProfiles)
        .where(and(eq(toolProfiles.spaceId, existing.spaceId), inArray(toolProfiles.id, [profileId, ...(input.reassignToProfileId ? [input.reassignToProfileId] : [])])))
        .orderBy(toolProfiles.id).for("update");
      await lockToolAssignmentAgents(tx, existing.spaceId, [{ targetType: "space", targetId: existing.spaceId }]);
      if (input.force && input.reassignToProfileId) {
        throw badRequest(
          "Use either force or reassignToProfileId when deleting a tool profile, not both",
        );
      }
      const details = await profileDetails(existing.id, existing.spaceId, tx);
      if (
        details.summary.isSpaceDefault &&
        !input.force &&
        !input.reassignToProfileId
      ) {
        throw unprocessable(
          "Cannot delete the space default tool profile. Reassign the default profile or pass force=true to delete it.",
          { summary: details.summary },
        );
      }

      let reassignedBindingCount = 0;
      if (input.reassignToProfileId) {
        if (input.reassignToProfileId === existing.id) {
          throw badRequest(
            "reassignToProfileId must reference a different tool profile",
          );
        }
        const target = await getProfileRow(
          input.reassignToProfileId,
          existing.spaceId,
          tx,
        );
        if (target.status !== "active") {
          throw unprocessable(
            "Tool profile assignments can only be reassigned to an active profile",
          );
        }
        const targetBindings = await db
          .select()
          .from(toolProfileBindings)
          .where(
            and(
              eq(toolProfileBindings.spaceId, existing.spaceId),
              eq(toolProfileBindings.profileId, target.id),
            ),
          );
        const targetKeys = new Set(
          targetBindings.map(
            (binding) => `${binding.targetType}:${binding.targetId}`,
          ),
        );
        const copiedBindings = details.bindings.filter(
          (binding) =>
            !targetKeys.has(`${binding.targetType}:${binding.targetId}`),
        );
        if (copiedBindings.length > 0) {
          await db.insert(toolProfileBindings).values(
            copiedBindings.map((binding) => ({
              spaceId: binding.spaceId,
              profileId: target.id,
              targetType: binding.targetType,
              targetId: binding.targetId,
              priority: binding.priority,
              metadata: binding.metadata ?? {},
              createdByAgentId: binding.createdByAgentId,
              createdByUserId: binding.createdByUserId,
            })),
          );
          reassignedBindingCount = copiedBindings.length;
          await db
            .update(toolProfiles)
            .set({ updatedAt: new Date() })
            .where(eq(toolProfiles.id, target.id));
        }
      }

      const [deleted] = await db
        .delete(toolProfiles)
        .where(eq(toolProfiles.id, existing.id))
        .returning();
      if (!deleted) throw notFound("Tool profile not found");
      return {
        profile: toProfile(deleted),
        summary: details.summary,
        reassignedToProfileId: input.reassignToProfileId ?? null,
        reassignedBindingCount,
      };
    }),

    addProfileEntry: async (
      profileId: string,
      input: CreateToolProfileEntryForProfile, managementContext?: ConnectionManagementContext,
    ): Promise<ToolProfileEntry> => db.transaction(async tx => {
      await managementContext?.reauthorize();
      const db = tx as unknown as Db;
      const profile = await getProfileRow(profileId, undefined, tx);
      await assertProfileEntryInputs(tx, profile.spaceId, [input]);
      await lockProfileEntryReferences(tx, profile.spaceId, [input]);
      await tx.select({ id: toolProfiles.id }).from(toolProfiles).where(eq(toolProfiles.id, profile.id)).for("no key update");
      const [row] = await db
        .insert(toolProfileEntries)
        .values({
          spaceId: profile.spaceId,
          profileId: profile.id,
          selectorType: input.selectorType,
          effect: input.effect ?? "include",
          applicationId: input.applicationId ?? null,
          connectionId: input.connectionId ?? null,
          catalogEntryId: input.catalogEntryId ?? null,
          toolName: input.toolName ?? null,
          riskLevel: input.riskLevel ?? null,
          conditions: input.conditions ?? null,
        })
        .returning();
      await db
        .update(toolProfiles)
        .set({ updatedAt: new Date() })
        .where(eq(toolProfiles.id, profile.id));
      return toProfileEntry(row);
    }),

    getProfileEntry: async (entryId: string): Promise<ToolProfileEntry> => {
      const [row] = await db
        .select()
        .from(toolProfileEntries)
        .where(eq(toolProfileEntries.id, entryId));
      if (!row) throw notFound("Tool profile entry not found");
      return toProfileEntry(row);
    },

    updateProfileEntry: async (
      entryId: string,
      input: UpdateToolProfileEntry, managementContext?: ConnectionManagementContext,
    ): Promise<ToolProfileEntry> => db.transaction(async tx => {
      await managementContext?.reauthorize();
      const db = tx as unknown as Db;
      const [existing] = await db
        .select()
        .from(toolProfileEntries)
        .where(eq(toolProfileEntries.id, entryId));
      if (!existing) throw notFound("Tool profile entry not found");
      const next: CreateToolProfileEntryForProfile = {
        selectorType: input.selectorType ?? existing.selectorType,
        effect: input.effect ?? existing.effect,
        applicationId: input.applicationId ?? existing.applicationId,
        connectionId: input.connectionId ?? existing.connectionId,
        catalogEntryId: input.catalogEntryId ?? existing.catalogEntryId,
        toolName: input.toolName ?? existing.toolName,
        riskLevel: input.riskLevel ?? existing.riskLevel,
        conditions: input.conditions ?? existing.conditions,
      };
      await assertProfileEntryInputs(tx, existing.spaceId, [next]);
      await lockProfileEntryReferences(tx, existing.spaceId, [next]);
      await tx.select({ id: toolProfiles.id }).from(toolProfiles).where(eq(toolProfiles.id, existing.profileId)).for("no key update");
      const [row] = await db
        .update(toolProfileEntries)
        .set({
          selectorType: next.selectorType,
          effect: next.effect ?? "include",
          applicationId: next.applicationId ?? null,
          connectionId: next.connectionId ?? null,
          catalogEntryId: next.catalogEntryId ?? null,
          toolName: next.toolName ?? null,
          riskLevel: next.riskLevel ?? null,
          conditions: next.conditions ?? null,
          updatedAt: new Date(),
        })
        .where(eq(toolProfileEntries.id, entryId))
        .returning();
      await db
        .update(toolProfiles)
        .set({ updatedAt: new Date() })
        .where(eq(toolProfiles.id, existing.profileId));
      return toProfileEntry(row);
    }),

    deleteProfileEntry: async (entryId: string, managementContext?: ConnectionManagementContext): Promise<ToolProfileEntry> => db.transaction(async tx => {
      await managementContext?.reauthorize();
      const db = tx as unknown as Db;
      const [existing] = await tx.select().from(toolProfileEntries).where(eq(toolProfileEntries.id, entryId));
      if (!existing) throw notFound("Tool profile entry not found");
      await tx.select({ id: toolProfiles.id }).from(toolProfiles).where(eq(toolProfiles.id, existing.profileId)).for("no key update");
      const [row] = await db
        .delete(toolProfileEntries)
        .where(eq(toolProfileEntries.id, entryId))
        .returning();
      if (!row) throw notFound("Tool profile entry not found");
      await db
        .update(toolProfiles)
        .set({ updatedAt: new Date() })
        .where(eq(toolProfiles.id, row.profileId));
      return toProfileEntry(row);
    }),

    bindProfile: async (
      profileId: string,
      input: CreateToolProfileBindingForProfile,
      actor?: ActorInfo,
    ): Promise<ToolProfileBinding> => db.transaction(async tx => {
      await actor?.managementContext?.reauthorize();
      const db = tx as unknown as Db;
      const [profile] = await tx.select().from(toolProfiles).where(eq(toolProfiles.id, profileId)).for("no key update");
      if (!profile) throw notFound("Tool profile not found");
      await assertTargetExists(
        profile.spaceId,
        input.targetType,
        input.targetId,
        tx,
      );
      if (input.targetType === "agent") await assertAgentToolAssignmentInteractions(db,
        actor?.managementContext?.actor.type === "agent" ? actor.managementContext.actor.agentId : actor?.actorType === "agent" ? actor.actorId : null,
        profile.spaceId, [input.targetId]);

      const [row] = await db
        .insert(toolProfileBindings)
        .values({
          spaceId: profile.spaceId,
          profileId: profile.id,
          targetType: input.targetType,
          targetId: input.targetId,
          priority: input.priority ?? 100,
          metadata: input.metadata ?? {},
          createdByAgentId:
            actor?.actorType === "agent" ? (actor.actorId ?? null) : null,
          createdByUserId:
            connectionActorUserId(actor),
        })
        .returning();
      await db
        .update(toolProfiles)
        .set({ updatedAt: new Date() })
        .where(eq(toolProfiles.id, profile.id));
      return toProfileBinding(row);
    }),

    unbindProfile: async (
      profileId: string,
      input: UnbindToolProfileBinding, managementContext?: ConnectionManagementContext,
    ): Promise<{ unbound: number }> => db.transaction(async tx => {
      await managementContext?.reauthorize();
      const db = tx as unknown as Db;
      const [profile] = await tx.select().from(toolProfiles).where(eq(toolProfiles.id, profileId)).for("no key update");
      if (!profile) throw notFound("Tool profile not found");
      await assertTargetExists(
        profile.spaceId,
        input.targetType,
        input.targetId,
        tx,
      );
      if (input.targetType === "agent") await assertAgentToolAssignmentInteractions(db,
        managementContext?.actor.type === "agent" ? managementContext.actor.agentId : null, profile.spaceId, [input.targetId]);

      const rows = await db
        .delete(toolProfileBindings)
        .where(
          and(
            eq(toolProfileBindings.spaceId, profile.spaceId),
            eq(toolProfileBindings.profileId, profile.id),
            eq(toolProfileBindings.targetType, input.targetType),
            eq(toolProfileBindings.targetId, input.targetId),
          ),
        )
        .returning({ id: toolProfileBindings.id });
      if (rows.length > 0) {
        await db
          .update(toolProfiles)
          .set({ updatedAt: new Date() })
          .where(eq(toolProfiles.id, profile.id));
      }
      return { unbound: rows.length };
    })
  };
}
