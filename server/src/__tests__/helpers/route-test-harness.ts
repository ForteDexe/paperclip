import { randomUUID } from "node:crypto";
import express, { type Router } from "express";
import { isNotNull } from "drizzle-orm";
import {
  spaces,
  spaceMemberships,
  createDb,
  issues,
  principalPermissionGrants,
} from "@outpost/db";
import { afterAll, afterEach, beforeAll, describe } from "vitest";
import { errorHandler } from "../../middleware/index.js";
import { ensureHumanRoleDefaultGrants } from "../../services/principal-access-compatibility.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./embedded-postgres.js";

type Db = ReturnType<typeof createDb>;

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();

/** `describe` on hosts that can run embedded Postgres, `describe.skip` elsewhere. */
export const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

export type EmbeddedPostgresContext = { readonly db: Db };

/**
 * Registers the embedded Postgres lifecycle for the enclosing `describe`. Read
 * `.db` from inside a test; it is unavailable until `beforeAll` has run.
 */
export function useEmbeddedPostgres(
  prefix: string,
  opts: { resetEach?: (db: Db) => Promise<void> } = {},
): EmbeddedPostgresContext {
  let db: Db | null = null;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(prefix);
    db = createDb(tempDb.connectionString);
  }, 20_000);

  if (opts.resetEach) {
    const resetEach = opts.resetEach;
    afterEach(async () => {
      if (db) await resetEach(db);
    });
  }

  afterAll(async () => {
    // End this suite's client before the cluster stops. `tempDb.cleanup()`
    // also ends every client registered against this cluster, so this call
    // is redundant defense in depth — it keeps the shutdown order visible
    // here, not just inside the fixture.
    await db?.$client.end({ timeout: 1 }).catch(() => {});
    await tempDb?.cleanup();
    tempDb = null;
    db = null;
  });

  return {
    get db() {
      if (!db) throw new Error("embedded Postgres is not started yet — read .db inside a test");
      return db;
    },
  };
}

export type OperatorActor = {
  type: "operator";
  source: string;
  userId: string;
  spaceIds: string[];
  memberships: { spaceId: string; membershipRole: string; status: string }[];
  isInstanceAdmin: boolean;
};

export type SeededSpace = { spaceId: string; userId: string; actor: OperatorActor };

/** Creates a space whose operator user holds space-scoped read and write grants. */
export async function seedSpaceWithBoardAccess(db: Db, name: string): Promise<SeededSpace> {
  const spaceId = randomUUID();
  const userId = `user-${randomUUID()}`;
  await db.insert(spaces).values({
    id: spaceId,
    name: `${name} ${spaceId}`,
    issuePrefix: `T${spaceId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
    requireOperatorApprovalForNewAgents: false,
  });
  await db.insert(spaceMemberships).values({
    spaceId,
    principalType: "user",
    principalId: userId,
    status: "active",
    membershipRole: "owner",
    updatedAt: new Date(),
  });
  await ensureHumanRoleDefaultGrants(db, {
    spaceId,
    principalId: userId,
    membershipRole: "owner",
    grantedByUserId: null,
  });
  return {
    spaceId,
    userId,
    actor: {
      type: "operator",
      source: "session",
      userId,
      spaceIds: [spaceId],
      memberships: [{ spaceId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false,
    },
  };
}

type RouterFactory = (db: Db, storage: never) => Router;

/** Mounts route modules under `/api` behind a fixed actor, with the real error handler. */
export function routeApp(db: Db, actor: OperatorActor, ...routerFactories: RouterFactory[]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  for (const factory of routerFactories) {
    app.use("/api", factory(db, {} as never));
  }
  app.use(errorHandler);
  return app;
}

/**
 * Clears the space and issue fixtures seeded by `seedSpaceWithBoardAccess`.
 * Suites that seed other tables need their own reset.
 */
export async function resetSpaceIssueFixtures(db: Db) {
  await db.delete(issues).where(isNotNull(issues.parentId));
  await db.delete(issues);
  await db.delete(principalPermissionGrants);
  await db.delete(spaceMemberships);
  await db.delete(spaces);
}
