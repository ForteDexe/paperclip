import { and, eq } from "drizzle-orm";
import { adapterAuthSessions, type Db } from "@outpost/db";
import type { AgentAdapterType } from "@outpost/shared";
import { forbidden } from "../errors.js";
import { aiConnectionService } from "./ai-connections.js";
import {
  SETUP_TOKEN_STORAGE_FAILED,
  SetupTokenSessionError,
  transitionSetupTokenSessionToStored,
  type SetupTokenSecretWriter,
} from "./setup-token-session.js";

export async function completeSetupTokenAiConnection(
  db: Db,
  { scope, sessionId, token }: Parameters<SetupTokenSecretWriter>[0],
) {
  if (!scope.aiConnection) throw new SetupTokenSessionError(500, SETUP_TOKEN_STORAGE_FAILED);
  const [session] = await db.select({ id: adapterAuthSessions.id }).from(adapterAuthSessions).where(and(
    eq(adapterAuthSessions.publicSessionId, sessionId),
    eq(adapterAuthSessions.spaceId, scope.spaceId),
    eq(adapterAuthSessions.startedByUserId, scope.ownerUserId),
    eq(adapterAuthSessions.adapterType, scope.adapterType as AgentAdapterType),
  ));
  if (!session) throw forbidden("Login session ownership mismatch");
  return aiConnectionService(db).save(scope.spaceId, scope.ownerUserId, scope.aiConnection, token, {
    id: session.id,
    complete: async (tx) => {
      const transitioned = await transitionSetupTokenSessionToStored(tx, {
        sessionId, spaceId: scope.spaceId, ownerUserId: scope.ownerUserId, adapterType: scope.adapterType,
      });
      if (!transitioned) throw new SetupTokenSessionError(500, SETUP_TOKEN_STORAGE_FAILED);
    },
  }, undefined, scope.managementContext);
}
