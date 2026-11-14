import { and, eq, lt, or, isNull } from "drizzle-orm";
import { aiSubscriptions, aiSubscriptionConnections, type Db } from "@outpost/db";
import { aiConnectionService } from "./ai-connections.js";
import { subscriptionService, subscriptionSession, type SubscriptionConnection } from "./subscriptions.js";
import { probeSubscriptionIdentity } from "./subscription-identity.js";
import { logger } from "../middleware/logger.js";
import { tooManyRequests } from "../errors.js";
import { trackIdleWork } from "./task-admission.js";

const jobs = new WeakMap<Db, Map<string, Promise<void>>>();
const discovery = new WeakMap<Db, Map<string, Promise<void>>>();
const REFRESH_MS = 6 * 60 * 60 * 1000;

/** Cached metadata refresh only. Never exchanges tokens or blocks a run/page on a provider. */
export function refreshSubscriptionConnection(db: Db, input: SubscriptionConnection, id: string, request: typeof fetch = fetch): Promise<void> {
  let active = jobs.get(db);
  if (!active) jobs.set(db, active = new Map());
  const existing = active.get(id);
  if (existing) return existing;
  // Bound provider concurrency across all spaces on this instance. Dashboard
  // discovery waits below; opportunistic run observations remain due when busy.
  if (active.size >= 4) return Promise.resolve();
  const task = trackIdleWork((async () => {
    const [claimed] = await db.update(aiSubscriptions).set({ lastCheckedAt: new Date() }).where(and(
      eq(aiSubscriptions.spaceId, input.spaceId), eq(aiSubscriptions.id, id),
      or(isNull(aiSubscriptions.lastCheckedAt), lt(aiSubscriptions.lastCheckedAt, new Date(Date.now() - REFRESH_MS))),
    )).returning({ id: aiSubscriptions.id });
    if (!claimed) return;
    try {
      const observation = await probeSubscriptionIdentity(input.spaceId, input.provider, input.credential, request);
      // A later execution/reconnect may now use another account. Never replace
      // that binding with a slow response for the previous credential.
      const [binding] = await db.select().from(aiSubscriptionConnections).where(and(eq(aiSubscriptionConnections.spaceId, input.spaceId), eq(aiSubscriptionConnections.grantId, input.grantId)));
      if (binding?.credentialKey !== observation.credentialKey) return;
      await subscriptionService(db).register(input, observation);
    } catch {
      await db.update(aiSubscriptions).set({ refreshStatus: "unavailable" }).where(and(eq(aiSubscriptions.spaceId, input.spaceId), eq(aiSubscriptions.id, id)));
    }
  })().catch(() => {
    // No raw provider/credential errors are logged or returned to a user.
    logger.warn({ spaceId: input.spaceId, subscriptionId: id }, "Subscription observation could not be saved");
  }).finally(() => active!.delete(id)));
  active.set(id, task);
  return task;
}

export function refreshSpaceSubscriptions(db: Db, spaceId: string, userId: string): Promise<void> {
  let active = discovery.get(db);
  if (!active) discovery.set(db, active = new Map());
  const key = `${spaceId}:${userId}`;
  const existing = active.get(key);
  if (existing) return existing;
  if (active.size >= 20) throw tooManyRequests("Subscription account checks are busy. Try again shortly.");
  const task = trackIdleWork((async () => {
    const service = aiConnectionService(db);
    // Uses the existing credential audience. Being a space admin does not
    // authorize probing another member's personal credentials.
    for (const row of await service.subscriptionAccounts(spaceId, userId)) {
      if (row.summary.status !== "connected") continue;
      try {
        const session = await subscriptionSession(db, spaceId, row.grant.credentialSecretRefs);
        const credential = await service.credential(row);
        const input: SubscriptionConnection = { spaceId, connectionId: row.connection.id, grantId: row.grant.id,
          provider: row.summary.provider, name: row.connection.name, ownerUserId: row.grant.subjectUserId, credential, session };
        const id = await subscriptionService(db).register(input);
        // Accepted discovery must not silently skip an account. At most twenty
        // discovery tasks can wait here; never create an unbounded provider queue.
        // Recheck after each completion because another discovery may take a slot.
        let providers = jobs.get(db);
        while (providers && providers.size >= 4 && !providers.has(id)) {
          await Promise.race(providers.values());
          providers = jobs.get(db);
        }
        await refreshSubscriptionConnection(db, input, id);
      } catch {
        logger.warn({ spaceId, connectionId: row.connection.id }, "Subscription discovery unavailable for a connection");
      }
    }
  })().catch(() => logger.warn({ spaceId }, "Subscription discovery unavailable"))
    .finally(() => active!.delete(key)));
  active.set(key, task);
  return task;
}
