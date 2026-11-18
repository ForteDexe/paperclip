import { describe, expect, it } from "vitest";
import { CapabilityMockControlPlaneAdapter } from "./capability-mock-control-plane-adapter.js";

describe("mock backlog task creation", () => {
  it.each([false, true])("preserves an explicit hold and dependencies (blocked=%s)", async blocked => {
    const adapter = new CapabilityMockControlPlaneAdapter();
    const base = adapter.snapshot();
    await adapter.start();
    await adapter.openFixtureRun({ identity: { runId: "run-1", sessionId: "session-1", spaceId: base.space.id, issueId: base.tasks[0]!.id, agentId: base.actors[0]!.id }, backendKind: "mock", sourceInstanceId: "backlog-test", capabilities: ["delegation:tasks:create"] });
    const call = { runId: "run-1", idempotencyKey: "later", command: { kind: "create_task" as const, title: "Later", status: "backlog" as const, assigneeActorId: base.actors[0]!.id, blockedByTaskIds: blocked ? [base.tasks[0]!.id] : [] } };
    const receipt = await adapter.applyCommand(call);
    await adapter.applyCommand(call);
    const state = adapter.snapshot();
    expect(state.tasks).toHaveLength(base.tasks.length + 1);
    expect(state.tasks.find(task => task.title === "Later")).toMatchObject({ status: "backlog", executionRunId: null, startedAt: null });
    expect(receipt.scheduledWakeIds).toEqual([]);
    expect(state.wakes).toEqual(base.wakes);
    expect(state.blockers).toHaveLength(base.blockers.length + (blocked ? 1 : 0));
  });

  it("creates the initial Task Record before returning the task receipt", async () => {
    const adapter = new CapabilityMockControlPlaneAdapter();
    const base = adapter.snapshot();
    await adapter.start();
    await adapter.openFixtureRun({ identity: { runId: "run-1", sessionId: "session-1", spaceId: base.space.id, issueId: base.tasks[0]!.id, agentId: base.actors[0]!.id }, backendKind: "mock", sourceInstanceId: "task-record-test", capabilities: ["delegation:tasks:create"] });

    const receipt = await adapter.applyCommand({
      runId: "run-1",
      idempotencyKey: "with-task-record",
      command: {
        kind: "create_task",
        title: "Task with record",
        status: "backlog",
        initialTaskRecord: {
          version: 2,
          intent: "Create the agreed task.",
          features: [],
          constraintsAndNonGoals: [],
          decisions: [],
          openQuestions: [],
          nextStep: null,
          resultsAndVerification: [],
        },
      },
    });

    const state = adapter.snapshot();
    const createdTask = state.tasks.find(task => task.title === "Task with record")!;
    expect(receipt.entityRefs).toContain(`task:${createdTask.id}`);
    expect(state.documents.find(document => document.taskId === createdTask.id && document.key === "working-spec"))
      .toMatchObject({
        title: "Task Record",
        revisions: [expect.objectContaining({
          revision: 1,
          body: JSON.stringify({
            version: 2,
            intent: "Create the agreed task.",
            features: [],
            constraintsAndNonGoals: [],
            decisions: [],
            openQuestions: [],
            nextStep: null,
            resultsAndVerification: [],
          }),
        })],
      });
  });
});
