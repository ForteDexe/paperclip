import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  activityLog, agents, agentWakeupRequests, authUsers,
  caseHandoffs, cases, spaceMemberships, chatActions,
  chatConversations, chatEndpoints, chatMessageLinks, chatPublications,
  spaces, completionContracts, documentRevisions, documents,
  issueDocuments, type Db, nativeRunFinalizations, nativeRunResults,
  statusDecisions, statusDecisionEffects, workAssessments, heartbeatRunEvents,
  heartbeatRuns, issueComments, issueQuestionResponseDeliveries, issueThreadInteractions,
  issues, toolApplications, toolConnections,
} from "@outpost/db";

// This owns only fixture data. Each test retains its worker, clock and quiet
// assertions, and must stop the worker before cleanup.
export function createChatMilestoneFixtures(db: Db) {
  const fixtureSpaces: string[] = [];
  const fixtureUsers: string[] = [];
  async function create(spaceId: string = randomUUID()) {
    const agentId = randomUUID(), issueId = randomUUID(), endpointId = randomUUID(), conversationId = randomUUID(), commentId = randomUUID(), userId = randomUUID();
    if (!fixtureSpaces.includes(spaceId)) {
      fixtureSpaces.push(spaceId);
      await db.insert(spaces).values({ id: spaceId, name: "Milestones", issuePrefix: `M${spaceId.slice(0, 7)}` });
    }
    fixtureUsers.push(userId);
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Maya", adapterType: "outpost_runner" });
    await db.insert(issues).values({ id: issueId, spaceId, title: "Chat task", status: "in_progress", assigneeAgentId: agentId, responsibleUserId: userId });
    const applicationId = randomUUID(), connectionId = randomUUID();
    await db.insert(toolApplications).values({ id: applicationId, spaceId, name: `Chat ${applicationId}`, type: "chat" });
    await db.insert(toolConnections).values({ id: connectionId, spaceId, applicationId, name: "Chat", uid: connectionId, transport: "chat_sdk", connectionPurpose: "channel", enabled: true, status: "active" });
    await db.insert(chatEndpoints).values({ id: endpointId, spaceId, connectionId, assignedAgentId: agentId, publicId: endpointId, provider: "slack", status: "active" });
    await db.insert(chatConversations).values({ id: conversationId, spaceId, endpointId, issueId, externalConversationId: conversationId, externalThreadId: conversationId, externalLabel: "Chat" });
    await db.insert(issueComments).values({ id: commentId, spaceId, issueId, authorType: "user", body: "Start work" });
    await db.insert(chatMessageLinks).values({ spaceId, endpointId, conversationId, commentId, providerMessageId: commentId, direction: "inbound" });
    return { spaceId, agentId, issueId, endpointId, conversationId, commentId, userId };
  }
  async function cleanup() {
    for (const spaceId of fixtureSpaces.splice(0)) {
      await db.delete(activityLog).where(eq(activityLog.spaceId, spaceId));
      await db.delete(caseHandoffs).where(eq(caseHandoffs.spaceId, spaceId));
      await db.delete(cases).where(eq(cases.spaceId, spaceId));
      await db.delete(chatActions).where(eq(chatActions.spaceId, spaceId));
      await db.delete(chatMessageLinks).where(eq(chatMessageLinks.spaceId, spaceId));
      await db.delete(chatPublications).where(eq(chatPublications.spaceId, spaceId));
      await db.delete(chatConversations).where(eq(chatConversations.spaceId, spaceId));
      await db.delete(chatEndpoints).where(eq(chatEndpoints.spaceId, spaceId));
      await db.delete(issueQuestionResponseDeliveries).where(eq(issueQuestionResponseDeliveries.spaceId, spaceId));
      await db.delete(issueThreadInteractions).where(eq(issueThreadInteractions.spaceId, spaceId));
      await db.delete(issueComments).where(eq(issueComments.spaceId, spaceId));
      await db.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.spaceId, spaceId));
      await db.delete(nativeRunFinalizations).where(eq(nativeRunFinalizations.spaceId, spaceId));
      await db.delete(statusDecisionEffects).where(eq(statusDecisionEffects.spaceId, spaceId));
      await db.delete(statusDecisions).where(eq(statusDecisions.spaceId, spaceId));
      await db.delete(workAssessments).where(eq(workAssessments.spaceId, spaceId));
      await db.delete(nativeRunResults).where(eq(nativeRunResults.spaceId, spaceId));
      await db.delete(heartbeatRuns).where(eq(heartbeatRuns.spaceId, spaceId));
      await db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, spaceId));
      await db.delete(completionContracts).where(eq(completionContracts.spaceId, spaceId));
      await db.delete(issueDocuments).where(eq(issueDocuments.spaceId, spaceId));
      await db.delete(documentRevisions).where(eq(documentRevisions.spaceId, spaceId));
      await db.delete(documents).where(eq(documents.spaceId, spaceId));
      await db.delete(issues).where(eq(issues.spaceId, spaceId));
      await db.delete(agents).where(eq(agents.spaceId, spaceId));
      await db.delete(spaceMemberships).where(eq(spaceMemberships.spaceId, spaceId));
      await db.delete(spaces).where(eq(spaces.id, spaceId));
    }
    for (const userId of fixtureUsers.splice(0)) await db.delete(authUsers).where(eq(authUsers.id, userId));
  }
  return { create, cleanup };
}
