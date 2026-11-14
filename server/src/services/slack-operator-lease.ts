import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { chatEndpointLeases, type Db } from "@outpost/db";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const TTL_SECONDS = 90;

export class SlackOperatorLeaseLost extends Error {
  constructor() {
    super("Slack Operator dispatch ownership was lost");
  }
}

/** Serialize one durable Operator action without reserving a database connection
 * during scheduler/provider I/O. Renewal and fenced commits use the existing
 * endpoint-lease table; the action's stable wake key handles uncertain delivery. */
export async function withSlackOperatorLease<T>(
  db: Db,
  scope: {
    spaceId: string;
    endpointId: string;
    actionId: string;
  },
  fetchImpl: typeof fetch,
  operation: (lease: {
    fetch: typeof fetch;
    commit<R>(write: (tx: Transaction) => Promise<R>): Promise<R>;
  }) => Promise<T>,
): Promise<T | undefined> {
  const token = randomUUID();
  const leaseKey = `slack-operator-work:${scope.actionId}`;
  const expiresAt = sql`now() + interval '90 seconds'`;
  const [claimed] = await db
    .insert(chatEndpointLeases)
    .values({
      spaceId: scope.spaceId,
      endpointId: scope.endpointId,
      leaseKey,
      token,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [chatEndpointLeases.endpointId, chatEndpointLeases.leaseKey],
      set: { token, expiresAt, updatedAt: sql`now()` },
      setWhere: and(
        eq(chatEndpointLeases.spaceId, scope.spaceId),
        lte(chatEndpointLeases.expiresAt, sql`now()`),
      ),
    })
    .returning({ id: chatEndpointLeases.id });
  if (!claimed) return;

  const controller = new AbortController();
  let lost = false;
  const ownership = and(
    eq(chatEndpointLeases.id, claimed.id),
    eq(chatEndpointLeases.spaceId, scope.spaceId),
    eq(chatEndpointLeases.token, token),
    gt(chatEndpointLeases.expiresAt, sql`now()`),
  );
  const renew = async (writer: Db | Transaction = db) => {
    if (lost) throw new SlackOperatorLeaseLost();
    try {
      const rows = await writer
        .update(chatEndpointLeases)
        .set({ expiresAt, updatedAt: sql`now()` })
        .where(ownership)
        .returning({ id: chatEndpointLeases.id });
      if (!rows.length) throw new SlackOperatorLeaseLost();
    } catch {
      lost = true;
      controller.abort();
      throw new SlackOperatorLeaseLost();
    }
  };
  let renewal: Promise<void> | undefined;
  const timer = setInterval(
    () => {
      if (renewal) return;
      renewal = renew()
        .catch(() => {})
        .finally(() => {
          renewal = undefined;
        });
    },
    (TTL_SECONDS * 1000) / 3,
  );
  timer.unref?.();
  try {
    return await operation({
      fetch: (async (input, init) => {
        await renew();
        const signal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const response = await fetchImpl(input, {
          ...init,
          signal: signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal,
        });
        await renew();
        return response;
      }) as typeof fetch,
      commit: (write) =>
        db.transaction(async (tx) => {
          // Updating the lease locks it until the short receipt transaction ends.
          await renew(tx);
          return write(tx);
        }),
    });
  } finally {
    clearInterval(timer);
    await renewal;
    await db
      .delete(chatEndpointLeases)
      .where(
        and(
          eq(chatEndpointLeases.id, claimed.id),
          eq(chatEndpointLeases.token, token),
        ),
      );
  }
}
