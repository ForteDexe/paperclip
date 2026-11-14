import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { appearanceForPalette } from "@outpost/shared";
import { agents, spaces, costEvents, createDb, heartbeatRuns, issues, nativeRunFinalizations } from "@outpost/db";
import { costDataQualityReport, RECEIPT_WAIT_MS } from "../services/cost-data-quality.js";
import { accountingIntegrityService } from "../services/accounting-integrity.js";
import { costService } from "../services/costs.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const now = new Date("2026-10-09T13:00:00Z");
describe("actionable cost data quality", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("outpost-cost-quality-");
    db = createDb(database.connectionString);
  }, 90_000);
  afterAll(async () => { await database?.cleanup(); });

  async function space() {
    const spaceId = randomUUID(), agentId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Costs", issuePrefix: `Q${spaceId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Codie", role: "engineer", adapterType: "codex_local" });
    return { spaceId, agentId };
  }
  async function event(owner: Awaited<ReturnType<typeof space>>, overrides: Partial<typeof costEvents.$inferInsert> = {}) {
    const [row] = await db.insert(costEvents).values({ ...owner, provider: "openai", model: "gpt-6-astra", billingType: "metered_api", costStatus: "unpriced", costCents: 0, occurredAt: now, ...overrides }).returning();
    return row;
  }
  async function run(owner: Awaited<ReturnType<typeof space>>, overrides: Partial<typeof heartbeatRuns.$inferInsert> = {}) {
    const [row] = await db.insert(heartbeatRuns).values({ ...owner, status: "failed", costAccountingPending: true, createdAt: now, finishedAt: now, usageJson: { accountingReceiptReady: false }, ...overrides }).returning();
    return row;
  }

  it("distinguishes billing, model and price gaps, excluding normal subscription/credit/fixed usage", async () => {
    const owner = await space();
    const unknown = await event(owner, { billingType: "unknown", costStatus: "reported", costCents: 21 });
    const missingModel = await event(owner, { model: "unknown" });
    const missingPrice = await event(owner);
    await event(owner, { billingType: "subscription_included" });
    await event(owner, { billingType: "credits", costStatus: "reported" });
    await event(owner, { billingType: "fixed", costStatus: "reported" });
    await event(owner, { costStatus: "estimated", costCents: 3 });
    const report = await costDataQualityReport(db, owner.spaceId, true, undefined, now);
    expect(report.events).toHaveLength(3);
    expect(report.events.every(row => row.occurredAt === now.toISOString())).toBe(true);
    expect(report.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: unknown.id, reason: "unknown_billing", agentName: "Codie" }),
      expect.objectContaining({ id: missingModel.id, reason: "missing_model" }),
      expect.objectContaining({ id: missingPrice.id, reason: "missing_price" }),
    ]));
    const summary = await costService(db).summary(owner.spaceId, { allTime: true });
    expect(summary.unknownBillingEventCount).toBe(1);
    expect(summary.spendCents).toBe(24); // Unknown billing retains its reported dollars.
    expect(summary.unpricedEventCount).toBe(2); // Included subscription usage is not a price gap.
    const providerRows = await costService(db).byProvider(owner.spaceId, { allTime: true });
    expect(providerRows.reduce((count, row) => count + row.eventCount!, 0)).toBe(7);
    expect(providerRows.reduce((count, row) => count + row.estimatedEventCount!, 0)).toBe(1);
    expect(providerRows.reduce((count, row) => count + row.unpricedEventCount!, 0)).toBe(2);
    expect(await costService(db).byBiller(owner.spaceId, { allTime: true })).toEqual([
      expect.objectContaining({ eventCount: 7, estimatedEventCount: 1, unpricedEventCount: 2, costCents: 24 }),
    ]);
  });

  it("uses sparse ordered indexes for old gaps behind thousands of healthy records", async () => {
    const owner = await space();
    await db.execute(sql`insert into cost_events (space_id,agent_id,provider,model,billing_type,cost_status,cost_cents,occurred_at)
      select ${owner.spaceId}::uuid,${owner.agentId}::uuid,'openai','gpt-6-astra','metered_api','reported',1,
        ${now.toISOString()}::timestamptz - n * interval '1 second' from generate_series(1,5000) n`);
    await db.execute(sql`insert into heartbeat_runs (space_id,agent_id,status,created_at,finished_at,cost_accounting_pending)
      select ${owner.spaceId}::uuid,${owner.agentId}::uuid,'succeeded',${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz - n * interval '1 second',false from generate_series(1,5000) n`);
    const old = new Date(now.getTime() - 10_000_000);
    await event(owner, { occurredAt: old });
    await event(owner, { occurredAt: old, billingType: "unknown", costStatus: "reported" });
    await run(owner, { finishedAt: old });
    await db.execute(sql`analyze cost_events`);
    await db.execute(sql`analyze heartbeat_runs`);
    const plans: string[] = [];
    // Explain the actual production statements, with the normal planner enabled.
    const explainingDb = new Proxy(db, {
      get(target, key) {
        if (key === "transaction") return (work: (tx: typeof db) => Promise<unknown>, options: Parameters<typeof db.transaction>[1]) =>
          target.transaction(tx => work(new Proxy(tx, {
            get(transaction, property) {
              if (property === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
                plans.push(JSON.stringify(await transaction.execute(sql`explain (analyze, buffers, format json) ${query}`)));
                return transaction.execute(query);
              };
              const value = Reflect.get(transaction, property);
              return typeof value === "function" ? value.bind(transaction) : value;
            },
          }) as unknown as typeof db), options);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const report = await costDataQualityReport(explainingDb, owner.spaceId, false, { allTime: true }, now);
    expect(report.events).toHaveLength(2);
    expect(report.runs).toHaveLength(1);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toContain("cost_events_data_quality_idx");
    expect(plans[1]).toContain("heartbeat_runs_cost_data_quality_idx");
    expect(plans.join(" ")).not.toContain("Rows Removed by Filter\":5000");
  });

  it("enforces space and period boundaries, including month-to-date and inclusive endpoints", async () => {
    const owner = await space(), other = await space();
    const start = new Date("2026-10-01T00:00:00Z");
    const first = await event(owner, { occurredAt: start });
    const last = await event(owner);
    const past = await event(owner, { occurredAt: new Date(start.getTime() - 1) });
    await event(owner, { occurredAt: new Date(now.getTime() + 1) });
    await event(other);
    await run(other);
    expect((await costDataQualityReport(db, owner.spaceId, false, undefined, now)).events.map(row => row.id)).toEqual([last.id, first.id]);
    expect((await costDataQualityReport(db, owner.spaceId, true, { from: start, to: now }, now)).events).toHaveLength(2);
    expect((await costDataQualityReport(db, owner.spaceId, true, { from: new Date(past.occurredAt), to: new Date(past.occurredAt) }, now)).events.map(row => row.id)).toEqual([past.id]);
    const all = await costDataQualityReport(db, owner.spaceId, false, { allTime: true }, now);
    expect(all.events).toHaveLength(4);
    expect(all.runs).toEqual([]);
    expect(all.canRetry).toBe(false);
    await expect(costDataQualityReport(db, randomUUID(), true)).rejects.toThrow("Space not found");
  });

  it("includes the agent's saved appearance for both pricing and receipt gaps", async () => {
    const owner = await space();
    const appearance = appearanceForPalette("deep-tide");
    await db.update(agents).set({ appearance }).where(eq(agents.id, owner.agentId));
    await event(owner);
    await run(owner);
    const report = await costDataQualityReport(db, owner.spaceId, true, undefined, now);
    expect(report.events[0].agentAppearance).toEqual(appearance);
    expect(report.runs[0].agentAppearance).toEqual(appearance);
  });

  it("changes waiting copy at fifteen minutes without settling or mutating the run", async () => {
    const owner = await space();
    const pending = await run(owner, { accountingLastError: "SECRET provider command", resultJson: { credential: "SECRET" } });
    expect((await costDataQualityReport(db, owner.spaceId, true, undefined, now)).runs[0].reason).toBe("waiting_for_receipt");
    const report = await costDataQualityReport(db, owner.spaceId, true, undefined, new Date(now.getTime() + RECEIPT_WAIT_MS));
    expect(report.runs[0].reason).toBe("receipt_unavailable");
    expect(Object.keys(report.runs[0]).sort()).toEqual(["agentId", "agentName", "agentAppearance", "id", "model", "occurredAt", "provider", "reason", "runId"].sort());
    expect(JSON.stringify(report)).not.toContain("SECRET");
    const [saved] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, pending.id));
    expect(saved.costAccountingPending).toBe(true);
    expect(saved.costAccountedAt).toBeNull();
    expect(saved.accountingAttemptCount).toBe(0);
  });

  it("offers retry only at the writer's proven receipt boundary", async () => {
    const owner = await space();
    const ready = await run(owner, { usageJson: { accountingReceiptReady: true } });
    const noWork = await run(owner, { usageJson: { accountingReceiptReady: false, accountingProviderWorkStarted: false } });
    const resultProof = await run(owner, { resultJson: { executionRecovery: { providerWorkStarted: false } } });
    const captureFailed = await run(owner, { usageJson: { accountingReceiptReady: true, accountingCaptureFailed: true, accountingProviderWorkStarted: false } });
    const invalidProof = await run(owner, { usageJson: { accountingReceiptReady: false, accountingProviderWorkStarted: "false" } });
    const acknowledged = await run(owner, { costAccountedAt: now });
    await run(owner, { status: "running" });
    await run(owner, { status: "queued" });
    await run(owner, { costAccountingPending: false });
    const report = await costDataQualityReport(db, owner.spaceId, true, undefined, now);
    expect(report.runs).toHaveLength(6);
    for (const row of [ready, noWork, resultProof, acknowledged]) expect(report.runs.find(item => item.id === row.id)?.reason).toBe("retryable");
    expect(report.runs.find(item => item.id === captureFailed.id)?.reason).toBe("waiting_for_receipt");
    expect(report.runs.find(item => item.id === invalidProof.id)?.reason).toBe("waiting_for_receipt");
    const integrity = accountingIntegrityService(db);
    // A failed capture is never certified free. Before the accounting closure
    // bound it stays pending; past it, its known usage settles as unpriced.
    await db.update(heartbeatRuns).set({ finishedAt: new Date() }).where(eq(heartbeatRuns.id, captureFailed.id));
    expect(await integrity.retry(owner.spaceId, captureFailed.id, "operator")).toEqual({ accounted: false });
    expect(await integrity.retry(owner.spaceId, noWork.id, "operator")).toEqual({ accounted: true });
    expect(await db.select().from(costEvents).where(eq(costEvents.spaceId, owner.spaceId))).toEqual([]);
    await db.update(heartbeatRuns).set({ finishedAt: now }).where(eq(heartbeatRuns.id, captureFailed.id));
    expect(await integrity.retry(owner.spaceId, captureFailed.id, "operator")).toEqual({ accounted: true });
    const charges = await db.select().from(costEvents).where(eq(costEvents.spaceId, owner.spaceId));
    expect(charges.map(charge => [charge.heartbeatRunId, charge.costStatus])).toEqual([[captureFailed.id, "unpriced"]]);
  });

  it("does not offer retry while a native coordinator can still resume provider work", async () => {
    const owner = await space();
    const [issue] = await db.insert(issues).values({ spaceId: owner.spaceId, title: "Native task" }).returning();
    const pending = await run(owner, { nativeIssueId: issue.id, runtimeMode: "native", usageJson: { accountingReceiptReady: true } });
    await db.insert(nativeRunFinalizations).values({ spaceId: owner.spaceId, runId: pending.id, issueId: issue.id, phase: "recovering" });
    expect((await costDataQualityReport(db, owner.spaceId, true, undefined, now)).runs[0].reason).toBe("waiting_for_receipt");
    expect(await accountingIntegrityService(db).retry(owner.spaceId, pending.id, "operator")).toEqual({ accounted: false });
    await db.update(nativeRunFinalizations).set({ phase: "terminal_failure" }).where(eq(nativeRunFinalizations.runId, pending.id));
    expect((await costDataQualityReport(db, owner.spaceId, true, undefined, now)).runs[0].reason).toBe("retryable");
  });

  it("exposes acknowledged late receipt debt through existing run and retry metadata", async () => {
    const owner = await space(), other = await space();
    const pending = await run(owner, { costAccountedAt: now, accountingLastError: "late_usage_requires_reconciliation",
      usageJson: { accountingReceiptReady: true, accountingLateReceiptPending: true,
        accountingLateReceiptId: randomUUID(), privateProviderPayload: "PRIVATE LATE RECEIPT" } });
    const report = await costDataQualityReport(db, owner.spaceId, true, undefined, now);
    expect(report.canRetry).toBe(true);
    expect(report.runs).toEqual([expect.objectContaining({ id: pending.id, runId: pending.id, reason: "retryable" })]);
    expect(JSON.stringify(report)).not.toContain("PRIVATE LATE RECEIPT");
    expect((await costDataQualityReport(db, owner.spaceId, false, undefined, now)).canRetry).toBe(false);
    expect((await costDataQualityReport(db, other.spaceId, true, undefined, now)).runs).toEqual([]);
    const summary = await costService(db).summary(owner.spaceId, { from: new Date("2026-10-01T00:00:00Z"), to: now });
    expect(summary.pendingRunCount).toBe(1);
    expect(summary.pricingComplete).toBe(false);
    const health = await accountingIntegrityService(db).health(owner.spaceId);
    expect(health.pendingRunCount).toBe(1);
    expect(health.items).toEqual([expect.objectContaining({ runId: pending.id, state: "retryable",
      lastError: "late_usage_requires_reconciliation" })]);
    const [saved] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, pending.id));
    expect(saved.costAccountedAt?.toISOString()).toBe(now.toISOString());
    expect(saved.costAccountingPending).toBe(true);
    expect(saved.usageJson?.accountingLateReceiptPending).toBe(true);
  });

  it("bounds each category independently and reports truncation", async () => {
    const owner = await space();
    for (let i = 0; i < 26; i++) {
      await event(owner, { occurredAt: new Date(now.getTime() - i * 1000) });
      await run(owner, { finishedAt: new Date(now.getTime() - i * 1000) });
    }
    const report = await costDataQualityReport(db, owner.spaceId, true, undefined, now);
    expect(report.events).toHaveLength(25);
    expect(report.runs).toHaveLength(25);
    expect(report.hasMoreEvents).toBe(true);
    expect(report.hasMoreRuns).toBe(true);
    expect(new Date(report.events[24].occurredAt).getTime()).toBe(now.getTime() - 24_000);
  });

  it("retry cannot invent a missing receipt; a late receipt is recorded exactly once", async () => {
    const owner = await space();
    const pending = await run(owner);
    const integrity = accountingIntegrityService(db);
    expect(await integrity.retry(owner.spaceId, pending.id, "operator")).toEqual({ accounted: false });
    expect((await db.select().from(costEvents).where(eq(costEvents.spaceId, owner.spaceId)))).toEqual([]);
    await db.update(heartbeatRuns).set({ usageJson: { accountingReceiptReady: true, provider: "openai", biller: "openai", billingType: "metered_api", model: "gpt-6-astra", costUsd: 0.21, inputTokens: 10, outputTokens: 2 } }).where(eq(heartbeatRuns.id, pending.id));
    expect((await costDataQualityReport(db, owner.spaceId, true, { allTime: true }, now)).runs[0].reason).toBe("retryable");
    expect(await integrity.retry(owner.spaceId, pending.id, "operator")).toEqual({ accounted: true });
    expect(await integrity.retry(owner.spaceId, pending.id, "operator")).toEqual({ accounted: false });
    const charges = await db.select().from(costEvents).where(eq(costEvents.spaceId, owner.spaceId));
    expect(charges).toHaveLength(1);
    expect(charges[0].costCents).toBe(21);
    expect((await costDataQualityReport(db, owner.spaceId, true, { allTime: true }, now)).runs).toEqual([]);
    const other = await space();
    await expect(integrity.retry(other.spaceId, pending.id, "operator")).rejects.toThrow("Accounting run not found");
  });
});
