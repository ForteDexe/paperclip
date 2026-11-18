import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Issue, OutpostPluginManifestV1 } from "@outpost/shared";
import { createTestHarness } from "../../../packages/plugins/sdk/src/testing.js";

function manifest(capabilities: OutpostPluginManifestV1["capabilities"]): OutpostPluginManifestV1 {
  return {
    id: "outpost.test-orchestration",
    apiVersion: 1,
    version: "0.1.0",
    displayName: "Test Orchestration",
    description: "Test plugin",
    author: "Outpost",
    categories: ["automation"],
    capabilities,
    entrypoints: { worker: "./dist/worker.js" },
  };
}

function issue(input: Partial<Issue> & Pick<Issue, "id" | "spaceId" | "title">): Issue {
  const now = new Date();
  return {
    workMode: "standard",
    runIntent: "manual",
    reviewPolicy: null,
    responsibleUserId: null,
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: null,
    identifier: null,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

describe("plugin SDK orchestration contract", () => {
  it("supports expanded issue create fields and relation helpers", async () => {
    const spaceId = randomUUID();
    const blockerIssueId = randomUUID();
    const harness = createTestHarness({
      manifest: manifest(["issues.create", "issue.relations.read", "issue.relations.write", "issue.subtree.read"]),
    });
    harness.seed({
      issues: [issue({ id: blockerIssueId, spaceId, title: "Blocker" })],
    });

    const created = await harness.ctx.issues.create({
      spaceId,
      title: "Generated issue",
      status: "todo",
      assigneeUserId: "operator-user",
      billingCode: "mission:alpha",
      originId: "mission-alpha",
      blockedByIssueIds: [blockerIssueId],
    });

    expect(created.originKind).toBe("plugin:outpost.test-orchestration");
    expect(created.originId).toBe("mission-alpha");
    expect(created.billingCode).toBe("mission:alpha");
    expect(created.assigneeUserId).toBe("operator-user");

    await expect(harness.ctx.issues.relations.get(created.id, spaceId)).resolves.toEqual({
      blockedBy: [
        expect.objectContaining({
          id: blockerIssueId,
          title: "Blocker",
        }),
      ],
      blocks: [],
    });

    await expect(harness.ctx.issues.relations.removeBlockers(created.id, [blockerIssueId], spaceId)).resolves.toEqual({
      blockedBy: [],
      blocks: [],
    });

    await expect(harness.ctx.issues.relations.addBlockers(created.id, [blockerIssueId], spaceId)).resolves.toEqual({
      blockedBy: [expect.objectContaining({ id: blockerIssueId })],
      blocks: [],
    });

    await expect(
      harness.ctx.issues.getSubtree(created.id, spaceId, { includeRelations: true }),
    ).resolves.toMatchObject({
      rootIssueId: created.id,
      issueIds: [created.id],
      relations: {
        [created.id]: {
          blockedBy: [expect.objectContaining({ id: blockerIssueId })],
        },
      },
    });
  });

  it("enforces plugin origin namespaces in the test harness", async () => {
    const spaceId = randomUUID();
    const harness = createTestHarness({
      manifest: manifest(["issues.create", "issues.update", "issues.read"]),
    });

    const created = await harness.ctx.issues.create({
      spaceId,
      title: "Generated issue",
      originKind: "plugin:outpost.test-orchestration:feature",
    });

    expect(created.originKind).toBe("plugin:outpost.test-orchestration:feature");
    await expect(
      harness.ctx.issues.list({
        spaceId,
        originKind: "plugin:outpost.test-orchestration:feature",
      }),
    ).resolves.toHaveLength(1);
    await expect(
      harness.ctx.issues.create({
        spaceId,
        title: "Spoofed issue",
        originKind: "plugin:other.plugin:feature",
      }),
    ).rejects.toThrow("Plugin may only use originKind values under plugin:outpost.test-orchestration");
    await expect(
      harness.ctx.issues.update(
        created.id,
        { originKind: "plugin:other.plugin:feature" },
        spaceId,
      ),
    ).rejects.toThrow("Plugin may only use originKind values under plugin:outpost.test-orchestration");
  });

  it("supports generic plugin operation issue visibility in the test harness", async () => {
    const spaceId = randomUUID();
    const harness = createTestHarness({
      manifest: manifest(["issues.create"]),
    });

    const created = await harness.ctx.issues.create({
      spaceId,
      title: "Background operation",
      surfaceVisibility: "plugin_operation",
      originId: "operation-1",
    });

    expect(created.originKind).toBe("plugin:outpost.test-orchestration:operation");
    expect(created.originId).toBe("operation-1");
  });

  it("enforces checkout and wakeup capabilities in the test harness", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const checkedOutIssueId = randomUUID();
    const harness = createTestHarness({
      manifest: manifest(["issues.checkout", "issues.wakeup", "issues.read"]),
    });
    harness.seed({
      issues: [
        issue({
          id: checkedOutIssueId,
          spaceId,
          title: "Checked out",
          status: "in_progress",
          assigneeAgentId: agentId,
          checkoutRunId: runId,
        }),
      ],
    });

    await expect(
      harness.ctx.issues.assertCheckoutOwner({
        issueId: checkedOutIssueId,
        spaceId,
        actorAgentId: agentId,
        actorRunId: runId,
      }),
    ).resolves.toMatchObject({
      issueId: checkedOutIssueId,
      checkoutRunId: runId,
    });

    await expect(
      harness.ctx.issues.requestWakeup(checkedOutIssueId, spaceId, {
        reason: "mission_advance",
      }),
    ).resolves.toMatchObject({ queued: true });

    await expect(
      harness.ctx.issues.requestWakeups([checkedOutIssueId], spaceId, {
        reason: "mission_advance",
        idempotencyKeyPrefix: "mission:alpha",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        issueId: checkedOutIssueId,
        queued: true,
      }),
    ]);
  });

  it("rejects wakeups when blockers are unresolved", async () => {
    const spaceId = randomUUID();
    const blockerIssueId = randomUUID();
    const blockedIssueId = randomUUID();
    const harness = createTestHarness({
      manifest: manifest(["issues.wakeup", "issues.read"]),
    });
    harness.seed({
      issues: [
        issue({ id: blockerIssueId, spaceId, title: "Unresolved blocker", status: "todo" }),
        issue({
          id: blockedIssueId,
          spaceId,
          title: "Blocked work",
          status: "todo",
          assigneeAgentId: randomUUID(),
          blockedBy: [
            {
              id: blockerIssueId,
              identifier: null,
              title: "Unresolved blocker",
              status: "todo",
              priority: "medium",
              assigneeAgentId: null,
              assigneeUserId: null,
            },
          ],
        }),
      ],
    });

    await expect(
      harness.ctx.issues.requestWakeup(blockedIssueId, spaceId),
    ).rejects.toThrow("Issue is blocked by unresolved blockers");
  });
});
