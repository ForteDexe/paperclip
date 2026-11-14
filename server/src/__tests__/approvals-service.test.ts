import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalService } from "../services/approvals.ts";
import { approvals, spaces, issueApprovals } from "@outpost/db";

vi.mock("../services/budgets.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/budgets.js")>(),
  budgetService: () => ({ deliverPendingEnforcement: vi.fn(async () => {}) }),
  budgetServiceInTransaction: () => ({ upsertPolicy: vi.fn(async () => {}) }),
}));

const mockAgentService = vi.hoisted(() => ({
  activatePendingApproval: vi.fn(),
  getById: vi.fn(async () => ({ id: "agent-1" })),
  create: vi.fn(),
  terminate: vi.fn(),
}));

const mockNotifyCreateApproved = vi.hoisted(() => vi.fn());

vi.mock("../modules/agent-lifecycle/adapters/records.js", () => ({
  agentRecords: vi.fn(() => ({ ...mockAgentService, rejectPendingCreation: mockAgentService.terminate })),
}));

vi.mock("../services/create-hook.js", () => ({
  notifyCreateApproved: mockNotifyCreateApproved,
}));

type ApprovalRecord = {
  id: string;
  spaceId: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  requestedByAgentId: string | null;
  requestedByUserId?: string | null;
};

function createApproval(status: string): ApprovalRecord {
  return {
    id: "approval-1",
    spaceId: "space-1",
    type: "create_agent",
    status,
    payload: { agentId: "agent-1" },
    requestedByAgentId: "requester-1",
  };
}

function createDbStub(selectResults: ApprovalRecord[][], updateResults: ApprovalRecord[]) {
  const pendingSelectResults = [...selectResults];
  let inTransaction = false;
  const selectWhere = vi.fn(async () => (inTransaction ? pendingSelectResults.shift() : pendingSelectResults[0]) ?? []);
  const from = vi.fn((table) => table === issueApprovals
    ? { where: async () => [] }
    : table === spaces
    ? { where: () => ({ for: async () => [{ id: "space-1" }] }) }
    : { where: selectWhere });
  const select = vi.fn((fields?: { id?: unknown }) => fields?.id === approvals.id
    ? { from: () => ({ where: () => ({ for: async () => [{ id: "approval-1" }] }) }) }
    : { from });

  const returning = vi.fn(async () => updateResults);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  const db = { select, update, transaction: vi.fn(async (callback: (db: unknown) => Promise<unknown>) => {
    const outerTransaction = inTransaction;
    inTransaction = true;
    try { return await callback(db); } finally { inTransaction = outerTransaction; }
  }) };
  return { db, selectWhere, returning };
}

describe("approvalService resolution idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.activatePendingApproval.mockResolvedValue({ agent: { id: "agent-1" }, activated: true });
    mockAgentService.create.mockResolvedValue({ id: "agent-1" });
    mockAgentService.terminate.mockResolvedValue(undefined);
    mockNotifyCreateApproved.mockResolvedValue(undefined);
  });

  it("treats repeated approve retries as no-ops after another worker resolves the approval", async () => {
    const dbStub = createDbStub(
      [[createApproval("pending")], [createApproval("approved")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "operator", "ship it");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("approved");
    expect(mockAgentService.activatePendingApproval).not.toHaveBeenCalled();
    expect(mockNotifyCreateApproved).not.toHaveBeenCalled();
  });

  it("treats repeated reject retries as no-ops after another worker resolves the approval", async () => {
    const dbStub = createDbStub(
      [[createApproval("pending")], [createApproval("rejected")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.reject("approval-1", "operator", "not now");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("rejected");
    expect(mockAgentService.terminate).not.toHaveBeenCalled();
  });

  it("still performs side effects when the resolution update is newly applied", async () => {
    const approved = createApproval("approved");
    const dbStub = createDbStub([[createApproval("pending")]], [approved]);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "operator", "ship it");

    expect(result.applied).toBe(true);
    expect(mockAgentService.activatePendingApproval).toHaveBeenCalledWith("agent-1", approved.payload, approved.requestedByUserId);
    expect(mockNotifyCreateApproved).toHaveBeenCalledTimes(1);
  });

  it("does not notify the adapter when the approval transaction fails to commit", async () => {
    const approved = createApproval("approved");
    const dbStub = createDbStub([[createApproval("pending")]], [approved]);
    dbStub.db.transaction.mockImplementationOnce(async callback => {
      await callback(dbStub.db);
      throw new Error("commit failed");
    });
    await expect(approvalService(dbStub.db as any).approve("approval-1", "operator")).rejects.toThrow("commit failed");
    expect(mockNotifyCreateApproved).not.toHaveBeenCalled();
  });

  it.each([
    { requestedByAgentId: "requester-1", requestedByUserId: "on-behalf-user", expectedCreator: null },
    { requestedByAgentId: null, requestedByUserId: "original-creator", expectedCreator: "original-creator" },
  ])("creates a legacy approved create with its original human attribution ($expectedCreator)", async ({ requestedByAgentId, requestedByUserId, expectedCreator }) => {
    const approved = {
      ...createApproval("approved"),
      requestedByAgentId,
      requestedByUserId,
      payload: {
        name: "New Agent",
        adapterType: "codex_local",
        adapterConfig: {
          env: {
            API_KEY: {
              type: "secret_ref",
              secretId: "secret-1",
              version: "latest",
            },
          },
        },
      },
    };
    const dbStub = createDbStub([[{ ...createApproval("pending"), payload: approved.payload }]], [approved]);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "operator", "ship it");

    expect(result.applied).toBe(true);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({
        adapterType: "codex_local",
        adapterConfig: approved.payload.adapterConfig,
      }),
      { runnerResolved: true, createdByUserId: expectedCreator, responsibleUserId: requestedByUserId },
    );
  });
});

describe("approvalService.findOpenCreationApprovalForAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the open create approval the space/type/status/agentId filter yields", async () => {
    const match = {
      ...createApproval("pending"),
      id: "approval-match",
      payload: { agentId: "agent-1" },
    };
    // The space, type, open-status and payload->>'agentId' predicates run in
    // SQL, so the DB hands back only the matching row.
    const dbStub = createDbStub([[match]], []);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.findOpenCreationApprovalForAgent("space-1", "agent-1");

    expect(result?.id).toBe("approval-match");
    expect(dbStub.selectWhere).toHaveBeenCalledTimes(1);
  });

  it("returns null when no open approval matches the agent", async () => {
    const dbStub = createDbStub([[]], []);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.findOpenCreationApprovalForAgent("space-1", "agent-1");

    expect(result).toBeNull();
  });
});
