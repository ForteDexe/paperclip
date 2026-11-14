import type { Db } from "@outpost/db";
import type { OperatorBootstrap } from "@outpost/shared";
import { operatorAuthService } from "./operator-auth.js";
import { spaceService } from "./space-service.js";

/** The actor has already authenticated and resolved current space authority. */
export async function loadOperatorBootstrap(db: Db, principal: {
  userId: string;
  spaceIds: readonly string[];
}): Promise<OperatorBootstrap> {
  const [spaces, access] = await Promise.all([
    spaceService(db).list(),
    operatorAuthService(db).resolveOperatorAccess(principal.userId),
  ]);
  const accessible = new Set(principal.spaceIds);
  return {
    userId: principal.userId,
    // Match /spaces?scope=accessible: directory visibility through instance
    // admin alone does not grant entry to a space's inbox or tasks.
    spaces: spaces.filter((space) => accessible.has(space.id)),
    operatorAccess: {
      userId: principal.userId,
      isInstanceAdmin: access.isInstanceAdmin,
      spaceIds: access.spaceIds,
    },
  };
}
