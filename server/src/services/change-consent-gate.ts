import type { Db } from "@outpost/db";
import { issueThreadInteractions } from "@outpost/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { RequestConfirmationPayload, RequestConfirmationResult } from "@outpost/shared";
import { forbidden } from "../errors.js";

export const AGENT_PROFILE_CHANGE_CONSENT_FIELDS = ["name", "role", "title", "capabilities"] as const;

type ConsumedRequestConfirmationResult = RequestConfirmationResult & {
  consumedAt?: string | null;
  consumedByRunId?: string | null;
};

export function agentInstructionsChangeTargetKey(agentId: string) {
  return `agent:${agentId}:instructions`;
}

export function agentProfileChangeTargetKey(agentId: string) {
  return `agent:${agentId}:profile`;
}

/** Consent targets that deliver a peer configuration proposal. */
export function agentConfigurationChangeTargetId(key: string): string | null {
  return /^agent:([^:]+):(?:instructions|profile)$/.exec(key)?.[1]
    ?? null;
}

export function skillChangeTargetKey(skillId: string) {
  return `skill:${skillId}`;
}

export function skillSlugChangeTargetKey(slug: string) {
  return `skill-slug:${slug}`;
}

export function skillImportChangeTargetKey(source: string) {
  return `skill-import:${source}`;
}

export function skillsScanProjectsChangeTargetKey() {
  return "skills:scan-projects";
}

export function touchesAgentProfileChangeConsentFields(patchData: Record<string, unknown>) {
  return AGENT_PROFILE_CHANGE_CONSENT_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(patchData, key),
  );
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function payloadHasDisplayedDiff(payload: RequestConfirmationPayload) {
  const details = readNonEmptyString(payload.detailsMarkdown);
  if (!details) return false;
  if (/```diff\b/i.test(details)) return true;
  return /(^|\n)[+-][^\n]+/.test(details);
}

function requestConfirmationResultConsumed(result: RequestConfirmationResult | null) {
  const consumed = result as ConsumedRequestConfirmationResult | null;
  return Boolean(readNonEmptyString(consumed?.consumedByRunId) || readNonEmptyString(consumed?.consumedAt));
}

function markRequestConfirmationResultConsumed(
  result: RequestConfirmationResult,
  actorRunId: string,
  consumedAt: Date,
): ConsumedRequestConfirmationResult {
  return {
    ...result,
    consumedAt: consumedAt.toISOString(),
    consumedByRunId: actorRunId,
  };
}

export function changeConsentGateService(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]) {
  return {
    assertConsented: async (input: {
      spaceId: string;
      actorAgentId: string | null | undefined;
      actorRunId: string | null | undefined;
      targetKeys: string[];
    }): Promise<boolean> => {
      const actorAgentId = readNonEmptyString(input.actorAgentId);
      if (!actorAgentId) return false;

      const actorRunId = readNonEmptyString(input.actorRunId);
      if (!actorRunId) {
        throw forbidden("Agent mutations require a run id", {
          code: "agent_mutation_run_id_required",
        });
      }

      const targetKeys = [...new Set(input.targetKeys.map(readNonEmptyString).filter((key): key is string => Boolean(key)))];
      if (targetKeys.length === 0) {
        throw forbidden("Agent mutation target is not gateable", {
          code: "agent_mutation_target_required",
        });
      }
      const queryTargetKeys = targetKeys;

      const targetKeyPredicate = or(
        ...queryTargetKeys.map((targetKey) =>
          sql`${issueThreadInteractions.payload}->'target'->>'key' = ${targetKey}`,
        ),
      );

      const rows = await db
        .select({
          id: issueThreadInteractions.id,
          sourceRunId: issueThreadInteractions.sourceRunId,
          payload: issueThreadInteractions.payload,
          result: issueThreadInteractions.result,
        })
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.spaceId, input.spaceId),
          eq(issueThreadInteractions.createdByAgentId, actorAgentId),
          eq(issueThreadInteractions.kind, "request_confirmation"),
          eq(issueThreadInteractions.status, "accepted"),
          targetKeyPredicate,
        ))
        .orderBy(desc(issueThreadInteractions.resolvedAt), desc(issueThreadInteractions.createdAt))
        .limit(10);

      const accepted = rows.find((row) => {
        const payload = row.payload as RequestConfirmationPayload;
        const result = row.result as RequestConfirmationResult | null;
        return payload.target?.type === "custom"
          && queryTargetKeys.includes(payload.target.key)
          && result?.outcome === "accepted"
          && !requestConfirmationResultConsumed(result)
          && payloadHasDisplayedDiff(payload)
          && Boolean(row.sourceRunId)
          && row.sourceRunId !== actorRunId;
      });

      if (!accepted) {
        throw forbidden(
          "Agent mutations require an accepted request_confirmation with a displayed diff for this target, "
            + "created in a previous run and not already consumed.",
          {
            code: "agent_mutation_gate_required",
            targetKeys,
          },
        );
      }

      const acceptedResult = accepted.result as RequestConfirmationResult | null;
      if (!acceptedResult) {
        throw forbidden(
          "Agent mutations require an accepted request_confirmation with a displayed diff for this target, "
            + "created in a previous run and not already consumed.",
          {
            code: "agent_mutation_gate_required",
            targetKeys,
          },
        );
      }

      const now = new Date();
      const [consumed] = await db
        .update(issueThreadInteractions)
        .set({
          result: markRequestConfirmationResultConsumed(acceptedResult, actorRunId, now),
          updatedAt: now,
        })
        .where(and(
          eq(issueThreadInteractions.id, accepted.id),
          eq(issueThreadInteractions.spaceId, input.spaceId),
          eq(issueThreadInteractions.createdByAgentId, actorAgentId),
          eq(issueThreadInteractions.kind, "request_confirmation"),
          eq(issueThreadInteractions.status, "accepted"),
          sql`${issueThreadInteractions.result}->>'outcome' = 'accepted'`,
          sql`coalesce(${issueThreadInteractions.result}->>'consumedByRunId', ${issueThreadInteractions.result}->>'consumedAt') is null`,
        ))
        .returning({ id: issueThreadInteractions.id });

      if (!consumed) {
        throw forbidden(
          "Agent mutations require an accepted request_confirmation with a displayed diff for this target, "
            + "created in a previous run and not already consumed.",
          {
            code: "agent_mutation_gate_required",
            targetKeys,
          },
        );
      }

      return true;
    },
  };
}
