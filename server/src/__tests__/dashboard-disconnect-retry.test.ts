import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@outpost/db";
import { dashboardService } from "../services/dashboard.js";

const { overview } = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock("../services/budgets.js", () => ({
  budgetService: () => ({ overview }),
}));

const spaceId = "00000000-0000-4000-8000-000000000001";
const dialect = new PgDialect();

function disconnected(code = "CONNECTION_CLOSED") {
  const cause = Object.assign(new Error(`write ${code}`), { code });
  return new Error("Failed query", { cause });
}

function fixture(failures: Error[] = [], options: {
  missingSpace?: boolean;
  readFailures?: Record<string, Error[]>;
  activityFailures?: Error[];
} = {}) {
  const reads: string[] = [];
  const spaceParameters: unknown[][] = [];
  const parameters = new Map<string, unknown[][]>();
  let spaceAttempts = 0;
  const select = vi.fn(() => ({
    from(table: Parameters<typeof getTableName>[0]) {
      const name = getTableName(table);
      let condition: SQL | undefined;
      const query = {
        where(value: SQL) { condition = value; return query; },
        groupBy() { return query; },
        then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            reads.push(name);
            const attempts = parameters.get(name) ?? [];
            const failure = options.readFailures?.[name]?.[attempts.length];
            attempts.push(dialect.sqlToQuery(condition!).params);
            parameters.set(name, attempts);
            if (failure) throw failure;
            if (name === "spaces") {
              spaceParameters.push(dialect.sqlToQuery(condition!).params);
              const failure = failures[spaceAttempts++];
              if (failure) throw failure;
              return options.missingSpace ? [] : [{ id: spaceId, budgetMonthlyCents: 10_000 }];
            }
            if (name === "agents") return [{ status: "idle", count: 2 }];
            if (name === "issues") return [{ status: "in_progress", count: 1 }];
            if (name === "approvals") return [{ count: 3 }];
            if (name === "cost_events") return [{ monthSpend: 125 }];
            throw new Error(`Unexpected dashboard read: ${name}`);
          }).then(resolve, reject);
        },
      };
      return query;
    },
  }));
  const activityQueries: SQL[] = [];
  const execute = vi.fn(async (query: SQL) => {
    const failure = options.activityFailures?.[activityQueries.length];
    activityQueries.push(query);
    if (failure) throw failure;
    return [{ date: new Date().toISOString().slice(0, 10), status: "succeeded", count: 2 }];
  });
  const db = { select, execute } as unknown as Db;
  return { service: dashboardService(db), reads, spaceParameters, parameters, select, execute, activityQueries };
}

beforeEach(() => {
  overview.mockReset().mockResolvedValue({
    activeIncidents: [], pendingApprovalCount: 0, pausedAgentCount: 0, pausedProjectCount: 0,
  });
});

describe("dashboard read connection recovery", () => {
  it.each(["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"])(
    "rebuilds the scoped space read after a nested %s cause", async (code) => {
      const test = fixture([disconnected(code)]);
      await expect(test.service.summary(spaceId)).resolves.toMatchObject({
        spaceId,
        agents: { active: 2 },
        tasks: { inProgress: 1 },
        costs: { monthSpendCents: 125, monthBudgetCents: 10_000 },
        pendingApprovals: 3,
      });
      expect(test.spaceParameters).toEqual([[spaceId], [spaceId]]);
      expect(test.reads).toEqual(["spaces", "spaces", "agents", "issues", "approvals", "cost_events"]);
      expect(test.execute).toHaveBeenCalledTimes(1);
      expect(overview).toHaveBeenCalledExactlyOnceWith(spaceId);
    },
  );

  it("can replace two stale pooled connections within the existing retry budget", async () => {
    const test = fixture([disconnected(), disconnected()]);
    await expect(test.service.summary(spaceId)).resolves.toMatchObject({ spaceId });
    expect(test.spaceParameters).toEqual([[spaceId], [spaceId], [spaceId]]);
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it("propagates the final failure after three attempts without starting later work", async () => {
    const failures = [disconnected(), disconnected(), disconnected()];
    const test = fixture(failures);
    await expect(test.service.summary(spaceId)).rejects.toBe(failures[2]);
    expect(test.reads).toEqual(["spaces", "spaces", "spaces"]);
    expect(test.execute).not.toHaveBeenCalled();
    expect(overview).not.toHaveBeenCalled();
  });

  it.each([new Error("write CONNECTION_CLOSED"), disconnected("28P01"), disconnected("23505")])(
    "does not retry message-only, authentication, or constraint errors", async (error) => {
      const test = fixture([error]);
      await expect(test.service.summary(spaceId)).rejects.toBe(error);
      expect(test.reads).toEqual(["spaces"]);
      expect(test.execute).not.toHaveBeenCalled();
      expect(overview).not.toHaveBeenCalled();
    },
  );

  it("retains the missing-space error without retrying", async () => {
    const test = fixture([], { missingSpace: true });
    await expect(test.service.summary(spaceId)).rejects.toMatchObject({ status: 404 });
    expect(test.reads).toEqual(["spaces"]);
    expect(overview).not.toHaveBeenCalled();
  });

  it("does not replay the budget workflow when it loses a connection", async () => {
    const error = disconnected();
    overview.mockRejectedValue(error);
    const test = fixture();
    await expect(test.service.summary(spaceId)).rejects.toBe(error);
    expect(test.spaceParameters).toEqual([[spaceId]]);
    expect(overview).toHaveBeenCalledTimes(1);
  });

  const tables = ["spaces", "agents", "issues", "approvals", "cost_events"];
  it.each(["agents", "issues", "approvals", "cost_events"])("retries only the failed %s read", async (table) => {
    const test = fixture([], { readFailures: { [table]: [disconnected()] } });
    await expect(test.service.summary(spaceId)).resolves.toMatchObject({ spaceId });
    const prefix = tables.slice(0, tables.indexOf(table) + 1);
    const suffix = tables.slice(tables.indexOf(table) + 1);
    expect(test.reads).toEqual([...prefix, table, ...suffix]);
    expect(test.select).toHaveBeenCalledTimes(tables.length + 1);
    const attempts = test.parameters.get(table)!;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toContain(spaceId);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(overview).toHaveBeenCalledExactlyOnceWith(spaceId);
  });

  it.each(["agents", "issues", "approvals", "cost_events"])("stops after the %s read exhausts its budget", async (table) => {
    const failures = [disconnected(), disconnected(), disconnected()];
    const test = fixture([], { readFailures: { [table]: failures } });
    await expect(test.service.summary(spaceId)).rejects.toBe(failures[2]);
    const prefix = tables.slice(0, tables.indexOf(table));
    expect(test.reads).toEqual([...prefix, table, table, table]);
    expect(test.execute).not.toHaveBeenCalled();
    expect(overview).not.toHaveBeenCalled();
  });

  it("rebuilds only the run activity query through two transient disconnects", async () => {
    const test = fixture([], { activityFailures: [disconnected(), disconnected()] });
    const result = await test.service.summary(spaceId);
    expect(result.runActivity.at(-1)).toMatchObject({ succeeded: 2, total: 2 });
    expect(test.reads).toEqual(tables);
    expect(test.select).toHaveBeenCalledTimes(tables.length);
    expect(test.execute).toHaveBeenCalledTimes(3);
    expect(new Set(test.activityQueries).size).toBe(3);
    const queries = test.activityQueries.map((query) => dialect.sqlToQuery(query));
    expect(queries[0].params).toContain(spaceId);
    expect(queries[1]).toEqual(queries[0]);
    expect(queries[2]).toEqual(queries[0]);
    expect(overview).toHaveBeenCalledExactlyOnceWith(spaceId);
  });

  it("propagates the last run activity failure without entering the budget workflow", async () => {
    const failures = [disconnected(), disconnected(), disconnected()];
    const test = fixture([], { activityFailures: failures });
    await expect(test.service.summary(spaceId)).rejects.toBe(failures[2]);
    expect(test.reads).toEqual(tables);
    expect(test.execute).toHaveBeenCalledTimes(3);
    expect(overview).not.toHaveBeenCalled();
  });

  it.each(["agents", "activity"])("does not retry a non-transient %s error", async (read) => {
    const error = disconnected("42501");
    const test = fixture([], read === "agents"
      ? { readFailures: { agents: [error] } }
      : { activityFailures: [error] });
    await expect(test.service.summary(spaceId)).rejects.toBe(error);
    expect(test.reads.filter((table) => table === "agents")).toHaveLength(1);
    expect(test.execute).toHaveBeenCalledTimes(read === "activity" ? 1 : 0);
    expect(overview).not.toHaveBeenCalled();
  });

});
