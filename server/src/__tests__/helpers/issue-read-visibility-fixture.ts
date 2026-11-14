import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  agents, authUsers, spaces, spaceMemberships, heartbeatRuns, issueAccessGrants, issueRelations, issues,
  projectAccessMembers, projects, type Db,
} from "@outpost/db";
import type { AuthorizationActor } from "../../services/authorization.js";

/** Every actor type and membership role that can reach a task read. */
export const ISSUE_READ_VISIBILITY_ACTORS = [
  "operator owner", "operator admin", "operator operator", "operator viewer", "operator member", "operator key operator",
  "cloud tenant owner", "cloud tenant viewer", "instance admin", "local implicit operator", "operator without membership",
  "agent key", "assignee agent key", "agent run for owner", "agent run for operator", "agent run for viewer",
  "agent run for owner, membership read from the database", "agent run for a user without membership",
  "agent authorized by operator", "agent authorized by owner for owner",
  "low-trust agent bounded to tasks", "low-trust agent bounded to a subtree",
  "agent of another space", "unauthenticated",
] as const;
export type IssueReadVisibilityActorName = (typeof ISSUE_READ_VISIBILITY_ACTORS)[number];

export type IssueReadVisibilityFixture = Awaited<ReturnType<typeof seedIssueReadVisibilityFixture>>;

/**
 * One space whose tasks cover every way a task read is allowed or denied:
 * open tasks, private tasks readable through creation, assignment, a grant or
 * a private ancestor, private tasks nobody in the fixture may read, tasks of a
 * private project, a hidden task, tasks of another space and missing IDs.
 * `publicCount` sizes the open group; the other groups are fixed.
 */
export async function seedIssueReadVisibilityFixture(db: Db, input: { publicCount?: number } = {}) {
  const spaceId = randomUUID(), foreignSpaceId = randomUUID();
  const tag = spaceId.replaceAll("-", "").slice(0, 6).toUpperCase();
  const foreignTag = foreignSpaceId.replaceAll("-", "").slice(0, 6).toUpperCase();
  await db.insert(spaces).values([
    { id: spaceId, name: `Visibility ${spaceId}`, issuePrefix: `V${tag}`, requireOperatorApprovalForNewAgents: false },
    { id: foreignSpaceId, name: `Foreign ${foreignSpaceId}`, issuePrefix: `F${foreignTag}`, requireOperatorApprovalForNewAgents: false },
  ]);

  const roles = ["owner", "admin", "operator", "viewer", "member"] as const;
  const users = Object.fromEntries(roles.map((role) => [role, `user-${role}-${randomUUID()}`])) as Record<(typeof roles)[number], string>;
  const outsiderUserId = `user-outsider-${randomUUID()}`, strangerUserId = `user-stranger-${randomUUID()}`;
  const now = new Date();
  await db.insert(authUsers).values([...Object.values(users), outsiderUserId, strangerUserId].map((id) => ({
    id, name: id, email: `${id}@example.test`, emailVerified: true, createdAt: now, updatedAt: now,
  })));
  await db.insert(spaceMemberships).values([
    ...roles.map((role) => ({ spaceId, principalType: "user", principalId: users[role], status: "active", membershipRole: role })),
    { spaceId, principalType: "user", principalId: strangerUserId, status: "active", membershipRole: "operator" },
    { spaceId: foreignSpaceId, principalType: "user", principalId: outsiderUserId, status: "active", membershipRole: "owner" },
  ]);

  const readerAgentId = randomUUID(), assigneeAgentId = randomUUID(), lowTrustAgentId = randomUUID();
  const lowTrustRootAgentId = randomUUID(), foreignAgentId = randomUUID();
  await db.insert(agents).values([
    { id: readerAgentId, spaceId, name: "Reader", role: "engineer", adapterType: "process" },
    { id: assigneeAgentId, spaceId, name: "Assignee", role: "engineer", adapterType: "process" },
    { id: lowTrustAgentId, spaceId, name: "Low trust", role: "engineer", adapterType: "process" },
    { id: lowTrustRootAgentId, spaceId, name: "Low trust root", role: "engineer", adapterType: "process" },
    { id: foreignAgentId, spaceId: foreignSpaceId, name: "Foreign", role: "engineer", adapterType: "process" },
  ]);

  const openProjectId = randomUUID(), privateProjectId = randomUUID();
  await db.insert(projects).values([
    { id: openProjectId, spaceId, name: "Open project" },
    { id: privateProjectId, spaceId, name: "Private project", visibility: "private" },
  ]);
  await db.insert(projectAccessMembers).values({ spaceId, projectId: privateProjectId, subjectType: "user", subjectId: users.admin });

  const publicCount = input.publicCount ?? 6;
  const publicIds = Array.from({ length: publicCount }, () => randomUUID());
  const boundaryRootId = publicIds[0]!, boundaryChildId = publicIds[1]!;
  await db.insert(issues).values(publicIds.map((id, index) => ({
    id, spaceId, title: `Open ${index}`, status: "todo",
    projectId: index % 3 === 2 ? openProjectId : null,
    parentId: index === 1 ? boundaryRootId : null,
    assigneeAgentId: index % 4 === 3 ? assigneeAgentId : null,
    createdByUserId: strangerUserId,
  })));

  /** A private root and two generations below it. Descendants inherit privacy and are readable only through an ancestor. */
  async function privateTree(title: string, root: Partial<typeof issues.$inferInsert>) {
    const rootId = randomUUID(), childId = randomUUID(), grandchildId = randomUUID();
    await db.insert(issues).values({
      id: rootId, spaceId, title: `${title} root`, status: "todo", visibility: "private", privacyRootIssueId: rootId,
      createdByUserId: strangerUserId, responsibleUserId: strangerUserId, ...root,
    });
    await db.insert(issues).values({
      id: childId, spaceId, title: `${title} child`, status: "todo", parentId: rootId, visibility: "private",
      privacyRootIssueId: rootId, privacyParentIssueId: rootId, createdByUserId: strangerUserId,
    });
    await db.insert(issues).values({
      id: grandchildId, spaceId, title: `${title} grandchild`, status: "todo", parentId: childId, visibility: "private",
      privacyRootIssueId: rootId, privacyParentIssueId: childId, createdByUserId: strangerUserId,
    });
    return [rootId, childId, grandchildId];
  }
  const ownedPrivateIds = await privateTree("Owner private", { createdByUserId: users.owner, responsibleUserId: users.owner });
  const grantedPrivateIds = await privateTree("Granted private", {});
  await db.insert(issueAccessGrants).values([
    { issueId: grantedPrivateIds[0]!, subjectType: "user", subjectId: users.operator, source: "explicit" },
    { issueId: grantedPrivateIds[0]!, subjectType: "agent", subjectId: readerAgentId, source: "explicit" },
    // A revoked grant must stay ineffective on both paths.
    { issueId: grantedPrivateIds[0]!, subjectType: "user", subjectId: users.viewer, source: "explicit", revokedAt: now },
  ]);
  const assignedPrivateIds = await privateTree("Assigned private", { assigneeAgentId });
  const unreadablePrivateIds = await privateTree("Stranger private", {});

  const privateProjectIssueIds = [randomUUID(), randomUUID()];
  await db.insert(issues).values(privateProjectIssueIds.map((id, index) => ({
    id, spaceId, title: `Private project ${index}`, status: "todo", projectId: privateProjectId, createdByUserId: strangerUserId,
  })));

  const hiddenId = randomUUID();
  await db.insert(issues).values({ id: hiddenId, spaceId, title: "Hidden", status: "todo", hiddenAt: now });

  // Blocked open tasks, so the summaries route also filters their blockers.
  const blockedIds = [randomUUID(), randomUUID()];
  await db.insert(issues).values(blockedIds.map((id, index) => ({ id, spaceId, title: `Blocked ${index}`, status: "blocked" })));
  await db.insert(issueRelations).values([
    { spaceId, issueId: publicIds[2 % publicCount]!, relatedIssueId: blockedIds[0]!, type: "blocks" as const },
    { spaceId, issueId: unreadablePrivateIds[0]!, relatedIssueId: blockedIds[0]!, type: "blocks" as const },
    { spaceId, issueId: ownedPrivateIds[1]!, relatedIssueId: blockedIds[1]!, type: "blocks" as const },
  ]);

  const foreignPrivateId = randomUUID();
  const foreignIds = [randomUUID(), foreignPrivateId];
  await db.insert(issues).values([
    { id: foreignIds[0]!, spaceId: foreignSpaceId, title: "Foreign open", status: "todo" },
    { id: foreignPrivateId, spaceId: foreignSpaceId, title: "Foreign private", status: "todo", visibility: "private",
      privacyRootIssueId: foreignPrivateId, createdByUserId: outsiderUserId },
  ]);
  const missingIds = [randomUUID(), randomUUID()];

  // Open tasks the task-bounded low-trust agent may read; the private one in its boundary stays unreadable.
  const boundedTaskIds = [2, 5, 7].map((index) => publicIds[index % publicCount]!);
  await db.update(agents).set({ permissions: { trustPreset: "low_trust_review",
    authorizationPolicy: { trustBoundary: { mode: "low_trust_review", spaceId, issueIds: [...boundedTaskIds, grantedPrivateIds[1]!] } } },
  }).where(eq(agents.id, lowTrustAgentId));
  await db.update(agents).set({ permissions: { trustPreset: "low_trust_review",
    authorizationPolicy: { trustBoundary: { mode: "low_trust_review", spaceId, rootIssueId: boundaryRootId } } },
  }).where(eq(agents.id, lowTrustRootAgentId));

  const runId = randomUUID();
  await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId: readerAgentId, status: "running", contextSnapshot: { issueId: publicIds[0]! } });

  const operator = (role: (typeof roles)[number], source: AuthorizationActor["source"] = "session"): AuthorizationActor => ({
    type: "operator", source, userId: users[role], spaceIds: [spaceId],
    memberships: [{ spaceId, membershipRole: role, status: "active" }], isInstanceAdmin: false,
  });
  const agent = (agentId: string, extra: Partial<AuthorizationActor> = {}): AuthorizationActor => ({
    type: "agent", agentId, spaceId, source: "agent_key", ...extra,
  });
  const actors: Record<IssueReadVisibilityActorName, AuthorizationActor> = {
    "operator owner": operator("owner"),
    "operator admin": operator("admin"),
    "operator operator": operator("operator"),
    "operator viewer": operator("viewer"),
    "operator member": operator("member"),
    "operator key operator": operator("operator", "operator_key"),
    "cloud tenant owner": operator("owner", "cloud_tenant"),
    "cloud tenant viewer": operator("viewer", "cloud_tenant"),
    "instance admin": { ...operator("admin"), isInstanceAdmin: true },
    "local implicit operator": { type: "operator", source: "local_implicit", userId: "local-operator", spaceIds: [spaceId], isInstanceAdmin: true },
    "operator without membership": { type: "operator", source: "session", userId: outsiderUserId, spaceIds: [foreignSpaceId],
      memberships: [{ spaceId: foreignSpaceId, membershipRole: "owner", status: "active" }], isInstanceAdmin: false },
    "agent key": agent(readerAgentId),
    "assignee agent key": agent(assigneeAgentId),
    "agent run for owner": agent(readerAgentId, { source: "agent_jwt", runId, onBehalfOfUserId: users.owner,
      onBehalfOfMemberships: [{ spaceId, membershipRole: "owner", status: "active" }] }),
    "agent run for operator": agent(readerAgentId, { source: "agent_jwt", runId, onBehalfOfUserId: users.operator,
      onBehalfOfMemberships: [{ spaceId, membershipRole: "operator", status: "active" }] }),
    "agent run for viewer": agent(readerAgentId, { source: "agent_jwt", runId, onBehalfOfUserId: users.viewer,
      onBehalfOfMemberships: [{ spaceId, membershipRole: "viewer", status: "active" }] }),
    "agent run for owner, membership read from the database": agent(assigneeAgentId, { source: "agent_jwt", onBehalfOfUserId: users.owner }),
    "agent run for a user without membership": agent(readerAgentId, { source: "agent_jwt", runId, onBehalfOfUserId: outsiderUserId }),
    "agent authorized by operator": agent(readerAgentId, { authorizingUserId: users.operator }),
    "agent authorized by owner for owner": agent(assigneeAgentId, { onBehalfOfUserId: users.owner, authorizingUserId: users.owner,
      onBehalfOfMemberships: [{ spaceId, membershipRole: "owner", status: "active" }] }),
    "low-trust agent bounded to tasks": agent(lowTrustAgentId),
    "low-trust agent bounded to a subtree": agent(lowTrustRootAgentId),
    "agent of another space": { type: "agent", agentId: foreignAgentId, spaceId: foreignSpaceId, source: "agent_key" },
    "unauthenticated": { type: "none", source: "none" },
  };

  const spaceIssueIds = [
    ...publicIds, ...ownedPrivateIds, ...grantedPrivateIds, ...assignedPrivateIds, ...unreadablePrivateIds,
    ...privateProjectIssueIds, ...blockedIds, hiddenId,
  ];
  return {
    spaceId, foreignSpaceId, users, outsiderUserId, strangerUserId,
    readerAgentId, assigneeAgentId, lowTrustAgentId, lowTrustRootAgentId, foreignAgentId, runId,
    openProjectId, privateProjectId,
    publicIds, boundaryRootId, boundaryChildId, boundedTaskIds, ownedPrivateIds, grantedPrivateIds, assignedPrivateIds, unreadablePrivateIds,
    privateProjectIssueIds, blockedIds, hiddenId, foreignIds, missingIds, spaceIssueIds,
    /** Every ID a caller might ask for, readable or not. */
    allIds: [...spaceIssueIds, ...foreignIds, ...missingIds],
    actors,
  };
}
