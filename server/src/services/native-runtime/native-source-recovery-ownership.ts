import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import { environmentLeases, nativeRunFinalizations, nativeRunnerCheckpoints, type Db } from "@outpost/db";
import { inspectDurablePrpCheckpointHeader, type DurablePrpCheckpoint } from "../../vendor/outpost-runner/index.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Claims and recovered-source writers lock both coordinators in this order. */
export async function lockSourceRecoveryCoordinators(tx: Transaction, spaceId: string, runIds: readonly string[]) {
  return tx.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.spaceId, spaceId),
    inArray(nativeRunFinalizations.runId, [...new Set(runIds)]))).orderBy(asc(nativeRunFinalizations.runId)).for("update");
}

export async function readNativeSourceConsumers(tx: Transaction, spaceId: string, runId: string) {
  const retired = exists(tx.select({ runId: nativeRunnerCheckpoints.runId }).from(nativeRunnerCheckpoints).where(and(
    eq(nativeRunnerCheckpoints.spaceId, spaceId), eq(nativeRunnerCheckpoints.runId, runId),
    eq(nativeRunnerCheckpoints.part, "header"),
    sql`${nativeRunnerCheckpoints.material}->>'schema' like 'outpost.native-runner-checkpoint-retirement.%'`)));
  return tx.select({ id: environmentLeases.id, metadata: environmentLeases.metadata, retired }).from(environmentLeases).where(and(
    eq(environmentLeases.spaceId, spaceId), eq(environmentLeases.heartbeatRunId, runId),
    sql`${environmentLeases.metadata}->'runnerTaskSourceConsumer' is not null`));
}

/** Physical source consumption revokes the completed controller's late writer. */
export async function assertNativeSourceCheckpointConsumer(tx: Transaction, owner: {
  spaceId: string; runId: string; authorityRunId: string; bootId: string; generation: number;
}, checkpoint?: DurablePrpCheckpoint) {
  const rows = await readNativeSourceConsumers(tx, owner.spaceId, owner.runId);
  if (rows.some(row => row.retired)) throw new Error("native_runner_checkpoint_retired");
  if (!rows.length) return;
  const deny = (): never => { throw new Error("native_runner_checkpoint_owner_lost"); };
  if (owner.runId === owner.authorityRunId || rows.length !== 1 || !checkpoint) return deny();
  const source = rows[0]!, consumer = record(source.metadata?.runnerTaskSourceConsumer);
  if (typeof consumer.leaseId !== "string" || consumer.runId !== owner.authorityRunId) return deny();
  const [lease] = await tx.select().from(environmentLeases).where(and(eq(environmentLeases.spaceId, owner.spaceId),
    eq(environmentLeases.id, consumer.leaseId)));
  const recovery = record(lease?.metadata?.runnerTaskSourceRecovery);
  const header = checkpoint.records.get("header");
  const identity = header ? inspectDurablePrpCheckpointHeader(header) : null;
  const expected = record(recovery.identity);
  if (!lease || lease.heartbeatRunId !== owner.authorityRunId || lease.status !== "active" || lease.releasedAt ||
      lease.expiresAt && lease.expiresAt.getTime() <= Date.now() ||
      recovery.schema !== "outpost.runner.source-recovery.v1" || recovery.sourceLeaseId !== source.id ||
      recovery.consumerLeaseId !== lease.id || recovery.consumerRunId !== owner.authorityRunId ||
      typeof recovery.accountIdentity !== "string" || recovery.accountIdentity !== consumer.accountIdentity ||
      recovery.controllerBootId !== owner.bootId || recovery.controllerGeneration !== owner.generation ||
      ["runnerInstanceId", "environmentLeaseId", "runId", "normalizedSessionId", "turnId", "itemId"].some(key =>
        typeof expected[key] !== "string" || expected[key] !== record(identity)[key] || expected[key] !== record(consumer.identity)[key])) return deny();
}
