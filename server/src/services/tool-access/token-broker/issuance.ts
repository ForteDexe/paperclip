import type { ToolAccessMutationDb } from "../types.js";
import type { Db } from "@outpost/db";
import { connectionTokenIssuances } from "@outpost/db";
import type { ConnectionTokenIssuanceOutcome, ConnectionTokenIssuancePath } from "@outpost/shared";
import { logActivity } from "../../activity-log.js";

import type { ToolAccessAudit } from "../audit.js";
export function createTokenIssuanceRecorder(db: Db, audit: ToolAccessAudit) {
  async function recordConnectionTokenIssuance(
    input: {
      spaceId: string;
      applicationId: string | null;
      connectionId: string;
      agentId: string;
      runId: string | null;
      issueId: string | null;
      projectId: string | null;
      responsibleUserId: string | null;
      path: ConnectionTokenIssuancePath;
      requestedScope: string[];
      issuedScope: string[];
      ttlSeconds: number | null;
      expiresAt: Date | null;
      tokenHash: string | null;
      outcome: ConnectionTokenIssuanceOutcome;
      errorCode?: string | null;
      metadata?: Record<string, unknown>;
    },
    dbClient: ToolAccessMutationDb = db,
  ) {
    await dbClient.insert(connectionTokenIssuances).values({
      spaceId: input.spaceId,
      applicationId: input.applicationId,
      connectionId: input.connectionId,
      agentId: input.agentId,
      runId: input.runId,
      issueId: input.issueId,
      projectId: input.projectId,
      responsibleUserId: input.responsibleUserId,
      path: input.path,
      requestedScope: input.requestedScope,
      issuedScope: input.issuedScope,
      ttlSeconds: input.ttlSeconds,
      expiresAt: input.expiresAt,
      tokenHash: input.tokenHash,
      outcome: input.outcome,
      errorCode: input.errorCode ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async function auditConnectionTokenIssuance(input: {
    spaceId: string;
    connectionId: string;
    agentId: string;
    runId: string;
    path: ConnectionTokenIssuancePath;
    outcome: ConnectionTokenIssuanceOutcome;
    reasonCode?: string | null;
    details?: Record<string, unknown>;
  }) {
    const success = input.outcome === "success";
    await audit({
      spaceId: input.spaceId,
      connectionId: input.connectionId,
      action: success ? "connection_token.minted" : "connection_token.denied",
      outcome: success ? "success" : "failure",
      reasonCode: input.reasonCode ?? null,
      actor: { actorType: "agent", actorId: input.agentId },
      details: {
        path: input.path,
        outcome: input.outcome,
        runId: input.runId,
        ...(input.details ?? {}),
      },
    });
    await logActivity(db, {
      spaceId: input.spaceId,
      actorType: "agent",
      actorId: input.agentId,
      agentId: input.agentId,
      runId: input.runId,
      action: success ? "connection_token.minted" : "connection_token.denied",
      entityType: "tool_connection",
      entityId: input.connectionId,
      details: {
        path: input.path,
        outcome: input.outcome,
        reasonCode: input.reasonCode ?? null,
        ...(input.details ?? {}),
      },
    });
  }
  return { recordConnectionTokenIssuance, auditConnectionTokenIssuance };
}
