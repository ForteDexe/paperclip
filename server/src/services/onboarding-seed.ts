import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { agents, spaceOnboardingSeeds, goals, issues, projects } from "@outpost/db";
import type { ApplyOnboardingSeed } from "@outpost/shared";
import { writeOutpostSkillSyncPreference } from "@outpost/adapter-utils/server-utils";
import { findActiveServerAdapter } from "../adapters/registry.js";
import { agentService } from "./agents.js";
import { createAgentLifecycle, scheduleAgentLifecycle } from "./agent-lifecycle.js";
import { withDedicatedDbConnection } from "@outpost/db";
import { OUTPOST_CORE_SKILL_KEYS } from "./space-skills.js";
import { goalService } from "./goals.js";
import { projectService } from "./projects.js";
import { issueService } from "./issues.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";

/**
 * The project the seeded first task lands in, matching the name the tenant's
 * own first-run wizard uses so a later manual run reuses it instead of
 * creating a second "Onboarding" project.
 */
export const ONBOARDING_SEED_PROJECT_NAME = "Onboarding";

/**
 * Role assigned to the seeded lead agent. The seed's own `agent.role` is
 * customer free text (for example, "Lead") and lands on `title`; `role` keeps
 * the legacy `lead` compatibility key until the stored role contract migrates.
 */
const SEEDED_AGENT_ROLE = "lead";

/**
 * Adapter the seeded agent is created with. `claude_local` is the safe adapter
 * for agents created server-side
 * without a human running an environment test first.
 */
const FALLBACK_SEEDED_AGENT_ADAPTER_TYPE = "claude_local";

function seededAgentAdapterType() {
  const configured = process.env.OUTPOST_ONBOARDING_SEED_ADAPTER_TYPE?.trim()
    || process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE?.trim()
    || FALLBACK_SEEDED_AGENT_ADAPTER_TYPE;
  // Server-seeded onboarding deliberately stays on a direct adapter. Native
  // runner rollout is an explicit post-onboarding configuration choice.
  return configured === "outpost_runner"
    ? FALLBACK_SEEDED_AGENT_ADAPTER_TYPE
    : configured;
}

/**
 * Adapter config for the seeded default agent. Its instructions tell the
 * agent to use the core Outpost skills (delegation, memory, coordination), and
 * an agent's runtime only receives skills listed in its own desired set — so
 * a seeded agent with an empty adapter config arrives with zero skills and
 * truthfully reports its own toolkit as not installed. Enable the core set
 * whenever the seeded adapter supports skill sync.
 */
function seededAgentAdapterConfig(adapterType: string): Record<string, unknown> {
  const adapter = findActiveServerAdapter(adapterType);
  if (!adapter?.listSkills && !adapter?.syncSkills) return {};
  return writeOutpostSkillSyncPreference(
    {},
    OUTPOST_CORE_SKILL_KEYS.map((key) => ({ key, versionId: null })),
  );
}

/**
 * Split a free-text mission into a goal title + description the same way the
 * first-run wizard's `parseOnboardingGoalInput` does: first line is the title,
 * the remainder is the description.
 */
export function parseSeedMission(raw: string): { title: string; description: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { title: "", description: null };

  const [firstLine, ...restLines] = trimmed.split(/\r?\n/);
  const description = restLines.join("\n").trim();
  return {
    title: (firstLine ?? "").trim(),
    description: description.length > 0 ? description : null,
  };
}

export type OnboardingSeedApplication = {
  revision: string;
  /** False when the stored revision already matched and nothing was re-applied. */
  changed: boolean;
  goalId: string | null;
  agentId: string | null;
  issueId: string | null;
};

/**
 * The actor fields the audit entry needs, as `getActorInfo` produces them.
 * Narrowed to what {@link LogActivityInput} reads so the route can hand its
 * actor straight through without the service depending on Express.
 */
export type OnboardingSeedAuditActor = {
  actorType: "agent" | "user" | "system" | "plugin";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
  agentApiKeyId?: string | null;
};

export function onboardingSeedService(db: Db) {
  async function readRecord(dbx: Db, spaceId: string) {
    return dbx
      .select()
      .from(spaceOnboardingSeeds)
      .where(eq(spaceOnboardingSeeds.spaceId, spaceId))
      .then((rows) => rows[0] ?? null);
  }

  async function goalStillExists(dbx: Db, spaceId: string, goalId: string | null) {
    if (!goalId) return false;
    return dbx
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.spaceId, spaceId)))
      .then((rows) => rows.length > 0);
  }

  /**
   * The agent a re-push should update rather than duplicate: the one this
   * seed created if it is still around, else a pre-existing lead the tenant
   * already has.
   */
  async function resolveTargetAgentId(dbx: Db, spaceId: string, recordedAgentId: string | null) {
    if (recordedAgentId) {
      const recorded = await dbx
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, recordedAgentId), eq(agents.spaceId, spaceId)))
        .then((rows) => rows[0] ?? null);
      if (recorded) return recorded.id;
    }

    const candidates = await dbx
      .select({ id: agents.id })
      .from(agents)
      .where(and(
        eq(agents.spaceId, spaceId),
        eq(agents.role, SEEDED_AGENT_ROLE),
        ne(agents.status, "terminated"),
      ));
    return candidates[0]?.id ?? null;
  }

  async function issueStillExists(dbx: Db, spaceId: string, issueId: string | null) {
    if (!issueId) return false;
    return dbx
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.spaceId, spaceId)))
      .then((rows) => rows.length > 0);
  }

  async function resolveOnboardingProjectId(
    dbx: Db,
    projectSvc: ReturnType<typeof projectService>,
    spaceId: string,
    goalId: string | null,
  ) {
    const existing = await dbx
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(eq(projects.spaceId, spaceId));
    const reusable = existing.find(
      (project) =>
        project.status !== "cancelled"
        && project.name.trim().toLowerCase() === ONBOARDING_SEED_PROJECT_NAME.toLowerCase(),
    );
    if (reusable) return reusable.id;

    const created = await projectSvc.create(spaceId, {
      name: ONBOARDING_SEED_PROJECT_NAME,
      status: "in_progress",
      ...(goalId ? { goalIds: [goalId] } : {}),
    });
    return created.id;
  }

  async function prepareAgent(dbx: Db, spaceId: string, seed: ApplyOnboardingSeed, audit?: OnboardingSeedAuditActor) {
    const existing = await readRecord(dbx, spaceId);
    if (existing?.revision === seed.revision) return existing.agentId;
    const agentSvc = agentService(dbx);
    const agentName = seed.agent?.name.trim() || null;
    const agentRole = seed.agent?.role?.trim() || null;
    // 2. Agent → the customer's first create, the lead the first task is
    //    assigned to.
    let agentId = await resolveTargetAgentId(dbx, spaceId, existing?.agentId ?? null);
    if (agentName) {
      if (agentId) {
        await agentSvc.update(agentId, { name: agentName, title: agentRole });
      } else {
        const adapterType = seededAgentAdapterType();
        const created = await createAgentLifecycle(dbx).requestCreation(spaceId, {
          name: agentName,
          role: SEEDED_AGENT_ROLE,
          title: agentRole,
          adapterType,
          adapterConfig: seededAgentAdapterConfig(adapterType),
          runtimeConfig: {},
          permissions: {},
          status: "idle",
          spentMonthlyCents: 0,
          lastHeartbeatAt: null,
        }, { createdByUserId: audit?.actorType === "user" ? audit.actorId : null });
        agentId = created.id;
      }
    }

    return agentId;
  }

  async function applyWithin(
    dbx: Db,
    spaceId: string,
    seed: ApplyOnboardingSeed,
    preparedAgentId: string | null,
  ): Promise<OnboardingSeedApplication> {
    const goalSvc = goalService(dbx);
    const projectSvc = projectService(dbx);
    const issueSvc = issueService(dbx);

    const existing = await readRecord(dbx, spaceId);
    if (existing && existing.revision === seed.revision) {
      return {
        revision: existing.revision,
        changed: false,
        goalId: existing.goalId,
        agentId: existing.agentId,
        issueId: existing.issueId,
      };
    }

    const mission = seed.mission?.trim() || null;
    const agentName = seed.agent?.name.trim() || null;
    const agentRole = seed.agent?.role?.trim() || null;
    const firstTaskTitle = seed.firstTask?.title.trim() || null;
    const firstTaskDetails = seed.firstTask?.details?.trim() || null;

    // 1. Mission → the space-level goal the dashboard reads.
    let goalId = existing?.goalId ?? null;
    if (mission) {
      const parsed = parseSeedMission(mission);
      const target = (await goalStillExists(dbx, spaceId, goalId))
        ? goalId
        : (await goalSvc.getDefaultSpaceGoal(spaceId))?.id ?? null;
      if (target) {
        await goalSvc.update(target, {
          title: parsed.title,
          description: parsed.description,
        });
        goalId = target;
      } else {
        const created = await goalSvc.create(spaceId, {
          title: parsed.title,
          description: parsed.description,
          level: "space",
          status: "active",
        });
        goalId = created.id;
      }
    }

    const agentId = preparedAgentId;

    // A mission-only seed leaves the first task to the onboarding route.
    let issueId = existing?.issueId ?? null;
    if (firstTaskTitle) {
      if (await issueStillExists(dbx, spaceId, issueId)) {
        await issueSvc.update(
          issueId as string,
          {
            title: firstTaskTitle,
            description: firstTaskDetails,
            // Keep the task's relationships in step with a later revision that
            // supplied the agent or goal after the task already existed —
            // otherwise the record would report an assignee/goal the issue row
            // does not actually carry. Only set them when resolved, so an
            // absent value never clears an assignment the tenant made.
            ...(agentId ? { assigneeAgentId: agentId } : {}),
            ...(goalId ? { goalId } : {}),
          },
          dbx,
        );
      } else {
        const projectId = await resolveOnboardingProjectId(dbx, projectSvc, spaceId, goalId);
        // The idempotency key is what protects two pushes that arrive at once
        // — Cloud's reconcile runs off portfolio fetches, which can overlap.
        // It is deliberately not revision-scoped: if the recorded issue is
        // lost, a later revision should still dedupe against whatever the
        // first push created.
        const created = await issueSvc.create(spaceId, {
          title: firstTaskTitle,
          ...(firstTaskDetails ? { description: firstTaskDetails } : {}),
          ...(agentId ? { assigneeAgentId: agentId } : {}),
          projectId,
          ...(goalId ? { goalId } : {}),
          status: "todo",
          idempotencyKey: `onboarding-seed:${spaceId}`,
        });
        issueId = created.id;
      }
    }

    // 4. Record the revision last. Everything above has to have landed before
    //    this row claims the seed is applied.
    const now = new Date();
    const values = {
      spaceId,
      revision: seed.revision,
      mission,
      agentName,
      agentRole,
      firstTaskTitle,
      firstTaskDetails,
      goalId,
      agentId,
      issueId,
      appliedAt: now,
      updatedAt: now,
    };
    await dbx
      .insert(spaceOnboardingSeeds)
      .values(values)
      .onConflictDoUpdate({
        target: spaceOnboardingSeeds.spaceId,
        set: {
          revision: values.revision,
          mission: values.mission,
          agentName: values.agentName,
          agentRole: values.agentRole,
          firstTaskTitle: values.firstTaskTitle,
          firstTaskDetails: values.firstTaskDetails,
          goalId: values.goalId,
          agentId: values.agentId,
          issueId: values.issueId,
          appliedAt: values.appliedAt,
          updatedAt: values.updatedAt,
        },
      });

    return { revision: seed.revision, changed: true, goalId, agentId, issueId };
  }

  // Create first. If the content transaction fails, a retry reuses the committed agent.
  // The dedicated transaction holds only the workflow lock, not the create writes.
  async function apply(
    spaceId: string,
    seed: ApplyOnboardingSeed,
    audit?: OnboardingSeedAuditActor,
  ): Promise<OnboardingSeedApplication> {
    // Collected inside the transaction, published only after it commits: the
    // activity row is transactional but its realtime/plugin fan-out is not, and
    // announcing a seed that then rolled back would be worse than announcing it
    // late.
    const publications: ActivityPublication[] = [];

    const database = db;
    const lockKey = `outpost:onboarding-seed:${spaceId}`;
    return withDedicatedDbConnection(db, lockDb => lockDb.transaction(async lock => {
      await lock.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const preparedAgentId = await prepareAgent(database, spaceId, seed, audit);
      const result = await database.transaction(async (tx) => {
        const dbx = tx as unknown as Db;
        const applied = await applyWithin(dbx, spaceId, seed, preparedAgentId);

        if (applied.changed && audit) {
          await logActivity(
            dbx,
            {
              spaceId,
              actorType: audit.actorType,
              actorId: audit.actorId,
              agentId: audit.agentId,
              runId: audit.runId,
              agentApiKeyId: audit.agentApiKeyId,
              action: "space.onboarding_seed_applied",
              entityType: "space",
              entityId: spaceId,
              details: {
                revision: applied.revision,
                goalId: applied.goalId,
                agentId: applied.agentId,
                issueId: applied.issueId,
              },
            },
            publications,
          );
        }

        return applied;
      });

      for (const publication of publications) publishActivity(publication);
      if (result.agentId) scheduleAgentLifecycle(db, result.agentId);
      return result;
    }));
  }

  return { apply, get: (spaceId: string) => readRecord(db, spaceId) };
}
