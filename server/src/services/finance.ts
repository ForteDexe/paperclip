import { and, desc, eq, getTableColumns, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { agents, costEvents, financeEvents, goals, heartbeatRuns, issues, projects } from "@outpost/db";
import { notFound, unprocessable, conflict } from "../errors.js";

import { resolveCostDateRange, type CostDateRange as FinanceDateRange } from "./cost-date-range.js";
import { createFinanceEventSchema, normalizeCents, subtractCents, type MoneyInput } from "@outpost/shared";
import { receiptFingerprint } from "./receipt-fingerprint.js";
import { withAccountingTransaction } from "./accounting-transaction.js";
import { logActivity, type LogActivityInput, type ActivityPublication } from "./activity-log.js";
export type { CostDateRange as FinanceDateRange } from "./cost-date-range.js";

async function assertBelongsToSpace(
  db: Db,
  table: any,
  id: string,
  spaceId: string,
  label: string,
) {
  const row = await db
    .select()
    .from(table)
    .where(eq(table.id, id))
    .then((rows) => rows[0] ?? null);

  if (!row) throw notFound(`${label} not found`);
  if ((row as unknown as { spaceId: string }).spaceId !== spaceId) {
    throw unprocessable(`${label} does not belong to space`);
  }
}

function rangeConditions(spaceId: string, range?: FinanceDateRange) {
  range = resolveCostDateRange(range);
  const conditions: ReturnType<typeof eq>[] = [eq(financeEvents.spaceId, spaceId)];
  if (range?.from) conditions.push(gte(financeEvents.occurredAt, range.from));
  if (range?.to) conditions.push(lte(financeEvents.occurredAt, range.to));
  return conditions;
}

export async function createFinanceEventInTransaction(tx: Db, publications: ActivityPublication[], spaceId: string, data: Omit<typeof financeEvents.$inferInsert, "spaceId" | "receiptHash" | "amountCents"> & { amountCents: MoneyInput }, actor?: Pick<LogActivityInput, "actorType" | "actorId" | "agentId">) {
      const db = tx;
      const parsed = createFinanceEventSchema.safeParse({ ...data, occurredAt: data.occurredAt.toISOString() });
      if (!parsed.success) throw unprocessable("Invalid finance receipt", parsed.error.flatten());
      const values = { ...parsed.data, amountCents: normalizeCents(parsed.data.amountCents), occurredAt: new Date(parsed.data.occurredAt) };
      const receiptHash = receiptFingerprint(values);
      let legacyHash: string | null = null;
      try { if (normalizeCents(Number(values.amountCents)) === values.amountCents) legacyHash = receiptFingerprint({ ...values, amountCents: Number(values.amountCents) }); } catch { /* Decimal exceeds the legacy number range. */ }
      if (values.idempotencyKey) {
        const [existing] = await db.select().from(financeEvents).where(and(eq(financeEvents.spaceId, spaceId), eq(financeEvents.idempotencyKey, values.idempotencyKey)));
        if (existing) {
          if (existing.receiptHash !== receiptHash && existing.receiptHash !== legacyHash) throw conflict("Idempotency key already used for a different finance receipt");
          const [exact] = await db.select({ amount: sql<string>`${financeEvents.amountCents}::text` }).from(financeEvents).where(eq(financeEvents.id, existing.id));
          return { ...existing, amountCentsExact: normalizeCents(exact.amount) };
        }
      }
      if (data.agentId) await assertBelongsToSpace(db, agents, data.agentId, spaceId, "Agent");
      if (data.issueId) await assertBelongsToSpace(db, issues, data.issueId, spaceId, "Issue");
      if (data.projectId) await assertBelongsToSpace(db, projects, data.projectId, spaceId, "Project");
      if (data.goalId) await assertBelongsToSpace(db, goals, data.goalId, spaceId, "North Star");
      if (data.heartbeatRunId) await assertBelongsToSpace(db, heartbeatRuns, data.heartbeatRunId, spaceId, "Heartbeat run");
      if (data.costEventId) await assertBelongsToSpace(db, costEvents, data.costEventId, spaceId, "Cost event");

      const event = await db
        .insert(financeEvents)
        .values({
          ...values, amountCents: sql`${values.amountCents}::numeric`, spaceId, receiptHash, id: data.id,
        })
        .returning()
        .then((rows) => rows[0]);

      await logActivity(db, {
        spaceId, actorType: actor?.actorType ?? "system", actorId: actor?.actorId ?? "finance_accounting", agentId: actor?.agentId,
        action: "finance_event.reported", entityType: "finance_event", entityId: event.id,
        details: { amountCents: event.amountCents, amountCentsExact: values.amountCents, currency: event.currency, biller: event.biller, eventKind: event.eventKind, direction: event.direction },
      }, publications);
      return { ...event, amountCentsExact: values.amountCents };
}

export function financeService(db: Db) {
  const debitExpr = sql<string>`coalesce(sum(case when ${financeEvents.direction} = 'debit' and ${financeEvents.metadataJson}->>'source' is distinct from 'provider_cost_report' then ${financeEvents.amountCents} else 0 end), 0)`;
  const creditExpr = sql<string>`coalesce(sum(case when ${financeEvents.direction} = 'credit' and ${financeEvents.metadataJson}->>'source' is distinct from 'provider_cost_report' then ${financeEvents.amountCents} else 0 end), 0)`;
  const estimatedDebitExpr = sql<string>`coalesce(sum(case when ${financeEvents.direction} = 'debit' and ${financeEvents.estimated} = true and ${financeEvents.metadataJson}->>'source' is distinct from 'provider_cost_report' then ${financeEvents.amountCents} else 0 end), 0)`;

  return {
    createEvent: async (spaceId: string, data: Omit<typeof financeEvents.$inferInsert, "spaceId" | "receiptHash" | "amountCents"> & { amountCents: MoneyInput }, actor?: Pick<LogActivityInput, "actorType" | "actorId" | "agentId">) => withAccountingTransaction(db, spaceId, (tx, publications) => createFinanceEventInTransaction(tx, publications, spaceId, data, actor)),

    summary: async (spaceId: string, range?: FinanceDateRange) => {
      const conditions = rangeConditions(spaceId, range);
      const rows = await db
        .select({
          currency: financeEvents.currency,
          providerReportedCentsExact: sql<string>`coalesce(sum(case when ${financeEvents.metadataJson}->>'source' = 'provider_cost_report' then case when ${financeEvents.direction} = 'credit' then -${financeEvents.amountCents} else ${financeEvents.amountCents} end else 0 end), 0)::text`,
          debitCents: sql<number>`${debitExpr}::double precision`,
          debitCentsExact: sql<string>`${debitExpr}::text`,
          creditCents: sql<number>`${creditExpr}::double precision`,
          creditCentsExact: sql<string>`${creditExpr}::text`,
          estimatedDebitCents: sql<number>`${estimatedDebitExpr}::double precision`,
          estimatedDebitCentsExact: sql<string>`${estimatedDebitExpr}::text`,
          eventCount: sql<number>`count(*)::int`,
        })
        .from(financeEvents)
        .where(and(...conditions))
        .groupBy(financeEvents.currency)
        .orderBy(financeEvents.currency);
      const row = rows.find((row) => row.currency === "USD");

      return {
        spaceId,
        currency: "USD" as const,
        providerReportedCentsExact: normalizeCents(row?.providerReportedCentsExact ?? 0),
        providerReportedCents: Number(row?.providerReportedCentsExact ?? 0),
        currencies: rows.map((row) => ({ ...row, netCents: Number(subtractCents(row.debitCentsExact, row.creditCentsExact)), netCentsExact: subtractCents(row.debitCentsExact, row.creditCentsExact) })),
        debitCents: Number(row?.debitCents ?? 0),
        creditCents: Number(row?.creditCents ?? 0),
        netCents: Number(subtractCents(row?.debitCentsExact ?? 0, row?.creditCentsExact ?? 0)),
        netCentsExact: subtractCents(row?.debitCentsExact ?? 0, row?.creditCentsExact ?? 0),
        debitCentsExact: normalizeCents(row?.debitCentsExact ?? 0),
        creditCentsExact: normalizeCents(row?.creditCentsExact ?? 0),
        estimatedDebitCentsExact: normalizeCents(row?.estimatedDebitCentsExact ?? 0),
        estimatedDebitCents: Number(row?.estimatedDebitCents ?? 0),
        eventCount: Number(row?.eventCount ?? 0),
      };
    },

    byBiller: async (spaceId: string, range?: FinanceDateRange) => {
      const conditions = rangeConditions(spaceId, range);
      conditions.push(sql`${financeEvents.metadataJson}->>'source' is distinct from 'provider_cost_report'`);
      return db
        .select({
          currency: financeEvents.currency,
          biller: financeEvents.biller,
          debitCents: sql<number>`${debitExpr}::double precision`,
          debitCentsExact: sql<string>`${debitExpr}::text`,
          creditCents: sql<number>`${creditExpr}::double precision`,
          creditCentsExact: sql<string>`${creditExpr}::text`,
          estimatedDebitCents: sql<number>`${estimatedDebitExpr}::double precision`,
          estimatedDebitCentsExact: sql<string>`${estimatedDebitExpr}::text`,
          eventCount: sql<number>`count(*)::int`,
          kindCount: sql<number>`count(distinct ${financeEvents.eventKind})::int`,
          netCents: sql<number>`(${debitExpr} - ${creditExpr})::double precision`,
          netCentsExact: sql<string>`(${debitExpr} - ${creditExpr})::text`,
        })
        .from(financeEvents)
        .where(and(...conditions))
        .groupBy(financeEvents.biller, financeEvents.currency)
        .orderBy(desc(sql`(${debitExpr} - ${creditExpr})::double precision`), financeEvents.biller);
    },

    byKind: async (spaceId: string, range?: FinanceDateRange) => {
      const conditions = rangeConditions(spaceId, range);
      conditions.push(sql`${financeEvents.metadataJson}->>'source' is distinct from 'provider_cost_report'`);
      return db
        .select({
          currency: financeEvents.currency,
          eventKind: financeEvents.eventKind,
          debitCents: sql<number>`${debitExpr}::double precision`,
          debitCentsExact: sql<string>`${debitExpr}::text`,
          creditCents: sql<number>`${creditExpr}::double precision`,
          creditCentsExact: sql<string>`${creditExpr}::text`,
          estimatedDebitCents: sql<number>`${estimatedDebitExpr}::double precision`,
          estimatedDebitCentsExact: sql<string>`${estimatedDebitExpr}::text`,
          eventCount: sql<number>`count(*)::int`,
          billerCount: sql<number>`count(distinct ${financeEvents.biller})::int`,
          netCents: sql<number>`(${debitExpr} - ${creditExpr})::double precision`,
          netCentsExact: sql<string>`(${debitExpr} - ${creditExpr})::text`,
        })
        .from(financeEvents)
        .where(and(...conditions))
        .groupBy(financeEvents.eventKind, financeEvents.currency)
        .orderBy(desc(sql`(${debitExpr} - ${creditExpr})::double precision`), financeEvents.eventKind);
    },

    list: async (spaceId: string, range?: FinanceDateRange, limit: number = 100) => {
      const conditions = rangeConditions(spaceId, range);
      return db
        .select({ ...getTableColumns(financeEvents), amountCentsExact: sql<string>`${financeEvents.amountCents}::text` })
        .from(financeEvents)
        .where(and(...conditions))
        .orderBy(desc(financeEvents.occurredAt), desc(financeEvents.createdAt))
        .limit(limit);
    },
  };
}
