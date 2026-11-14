import type { Db } from "@outpost/db";
import { describe, expect, it, vi } from "vitest";
import { registerBudgetEnforcementWork } from "../services/budget-enforcement-worker.js";
import {
  budgetServiceInTransaction,
  deliverBudgetEnforcement,
  flushBudgetEvaluationWorkPage,
  hasPendingBudgetEnforcement,
  nextBudgetReconciliationAt,
  reconcileDueBudgetPolicies,
} from "../services/budgets.js";

const databaseThatMustNotBeRead = new Proxy({}, {
  get(_target, property) {
    throw new Error(`disabled budget path read database property ${String(property)}`);
  },
}) as Db;

describe("Outpost monetary policy compatibility", () => {
  it("never gates admission or evaluates a monetary scope", async () => {
    const service = budgetServiceInTransaction(databaseThatMustNotBeRead);

    await expect(service.evaluateAdmission("company", "agent", { projectId: "project" })).resolves.toEqual({
      block: null,
      policies: [],
      observations: [],
    });
    await expect(service.getInvocationBlock("company", "agent", { projectId: "project" })).resolves.toBeNull();
    await expect(service.reconcileScope("company", "agent", "agent")).resolves.toBeNull();
    await expect(service.evaluateAffectedScopes("company", "agent", "project")).resolves.toBeUndefined();
  });

  it("does not inspect or deliver legacy monetary work", async () => {
    const cancelWorkForScope = vi.fn();

    await expect(hasPendingBudgetEnforcement(databaseThatMustNotBeRead)).resolves.toBe(false);
    await expect(nextBudgetReconciliationAt(databaseThatMustNotBeRead)).resolves.toBeNull();
    await expect(flushBudgetEvaluationWorkPage(databaseThatMustNotBeRead)).resolves.toEqual({ consumed: 0, nextCursor: null });
    await expect(reconcileDueBudgetPolicies(databaseThatMustNotBeRead)).resolves.toEqual({ nextCursor: null });
    await expect(deliverBudgetEnforcement(databaseThatMustNotBeRead, { cancelWorkForScope })).resolves.toBeUndefined();
    expect(cancelWorkForScope).not.toHaveBeenCalled();
  });

  it("does not register the monetary enforcement worker", async () => {
    const register = vi.fn();
    const worker = registerBudgetEnforcementWork(databaseThatMustNotBeRead, { register } as never, {
      cancelWorkForScope: vi.fn(),
    });

    expect(register).not.toHaveBeenCalled();
    await expect(worker.ready).resolves.toBeUndefined();
    await expect(worker.stop()).resolves.toBeUndefined();
  });
});
