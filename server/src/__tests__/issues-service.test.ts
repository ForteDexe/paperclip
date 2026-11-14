import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  spaces,
  spaceMemberships,
  createDb,
  documentRevisions,
  documents,
  environments,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  instanceSettings,
  issueComments,
  issueInboxArchives,
  issueDocuments,
  issueAccessGrants,
  issuePlanDecompositions,
  issueReadStates,
  issueRecoveryActions,
  issueRelations,
  issueThreadInteractions,
  issueWorkProducts,
  issues,
  projectWorkspaces,
  projectAccessMembers,
  projects,
  workspaceOperations,
  toolApplications,
  toolConnections,
  toolOauthStates,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import type { IssueBlockerAttention, IssueRelationIssueSummary } from "@outpost/shared";
import { instanceSettingsService } from "../services/instance-settings.ts";
import {
  clampIssueListLimit,
  deriveIssueCommentRunLogAttribution,
  MAX_CHILD_ISSUES_CREATED_BY_HELPER,
  ISSUE_LIST_MAX_LIMIT,
  issueService,
  readIssueCommentRunLogText,
} from "../services/issues.ts";
import { getRunLogStore } from "../services/run-log-store.js";
import * as nativeRunLogRecovery from "../services/native-runtime/native-run-log-recovery.js";
import { terminalizeLegacyExecution } from "../services/legacy-execution-recovery.js";
import { settleUnrecoverableExecutions } from "../services/execution-recovery-resolution.js";
import {
  WORKSPACE_WORKTREE_REQUIRES_PROJECT_CODE,
  WORKSPACE_WORKTREE_REQUIRES_PROJECT_MESSAGE,
  WORKSPACE_WORKTREE_REQUIRES_PROJECT_REMEDIATION,
} from "../services/execution-workspace-policy.ts";
import { buildAgentMentionHref, buildProjectMentionHref, MAX_ISSUE_REQUEST_DEPTH, type IssueWorkMode } from "@outpost/shared";

import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function seedIssueSpace(db: ReturnType<typeof createDb>, spaceId: string) {
  await db.insert(spaces).values({
    id: spaceId,
    name: "Outpost",
    issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    requireOperatorApprovalForNewAgents: false,
  });
}

async function seedWorkspaceProject(db: ReturnType<typeof createDb>, spaceId: string, projectId: string) {
  await db.insert(projects).values({
    id: projectId,
    spaceId,
    name: "Workspace project",
    status: "in_progress",
  });
}

async function seedCodexCoder(db: ReturnType<typeof createDb>, spaceId: string, agentId: string) {
  await db.insert(agents).values({
    id: agentId,
    spaceId,
    name: "CodexCoder",
    role: "engineer",
    status: "active",
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

// list() adds these fields at runtime. The declared return type collapses the
// union of its result shapes to the base row.
type IssueListRow = Awaited<ReturnType<ReturnType<typeof issueService>["list"]>>[number] & {
  lastActivityAt?: Date | null;
  blockedBy?: IssueRelationIssueSummary[];
  blockerAttention?: IssueBlockerAttention;
  descriptionTruncated?: boolean;
};

describe("issue list limit helpers", () => {
  it("clamps untrusted issue-list limits to the server maximum", () => {
    expect(clampIssueListLimit(0)).toBe(1);
    expect(clampIssueListLimit(25.9)).toBe(25);
    expect(clampIssueListLimit(ISSUE_LIST_MAX_LIMIT + 10)).toBe(ISSUE_LIST_MAX_LIMIT);
  });
});

describeEmbeddedPostgres("issueService run attachment artifacts", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("registers a run-produced attachment as an attachment-backed artifact work product", async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-run-attachment-artifact-");
    const db = createDb(tempDb.connectionString);
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: "ART",
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "ArtifactAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Artifact registration",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, status: "running" });

    const attachment = await issueService(db).createAttachment({
      issueId,
      issueCommentId: null,
      provider: "local_disk",
      objectKey: "issues/artifact/screenshot.png",
      contentType: "image/png",
      byteSize: 128,
      sha256: "a".repeat(64),
      originalFilename: "screenshot.png",
      createdByAgentId: agentId,
      createdByRunId: runId,
    });

    const artifact = await db
      .select()
      .from(issueWorkProducts)
      .where(eq(issueWorkProducts.externalId, attachment.id))
      .then((rows) => rows[0]);
    expect(artifact).toMatchObject({
      spaceId,
      issueId,
      type: "artifact",
      provider: "outpost",
      title: "screenshot.png",
      createdByRunId: runId,
      metadata: {
        attachmentId: attachment.id,
        contentType: "image/png",
        byteSize: 128,
        contentPath: `/api/attachments/${attachment.id}/content`,
        openPath: `/api/attachments/${attachment.id}/content`,
        downloadPath: `/api/attachments/${attachment.id}/content?download=1`,
        originalFilename: "screenshot.png",
      },
    });
  }, 20_000);
});

describe("readIssueCommentRunLogText", () => {
  it("does not read after a timed-out native repair", async () => {
    const repair = vi.spyOn(nativeRunLogRecovery, "recoverSettledNativeRunLog").mockImplementationOnce((_db, _store, _ref, _redaction, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
    }));
    const read = vi.spyOn(getRunLogStore(), "read").mockResolvedValue({ content: "too late" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = readIssueCommentRunLogText({ logStore: "s3_segments", logRef: "space/agent/run", logBytes: null }, {} as ReturnType<typeof createDb>);
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toBe("");
      expect(read).not.toHaveBeenCalled();
    } finally {
      await pending;
      vi.useRealTimers();
      repair.mockRestore();
      read.mockRestore();
    }
  });
  it("keeps published evidence when a concurrent native repair wins ownership", async () => {
    const repair = vi.spyOn(nativeRunLogRecovery, "recoverSettledNativeRunLog").mockRejectedValueOnce(new Error("The output journal is owned by another writer"));
    const read = vi.spyOn(getRunLogStore(), "read").mockResolvedValueOnce({ content: "published evidence" });
    try {
      await expect(readIssueCommentRunLogText({ logStore: "s3_segments", logRef: "space/agent/run", logBytes: null }, {} as ReturnType<typeof createDb>)).resolves.toBe("published evidence");
      expect(read).toHaveBeenCalledOnce();
    } finally {
      repair.mockRestore();
      read.mockRestore();
    }
  });
  it("cancels timed-out storage reads so later listings can recover", async () => {
    let active = 0;
    const cleanups: Array<() => void> = [];
    const read = vi.spyOn(getRunLogStore(), "read").mockImplementation((_handle, options) =>
      new Promise((_resolve, reject) => {
        active += 1;
        let settled = false;
        const abort = () => {
          if (settled) return;
          settled = true;
          active -= 1;
          reject(new DOMException("Read aborted", "AbortError"));
        };
        cleanups.push(abort);
        options?.signal?.addEventListener("abort", abort, { once: true });
      }),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const run = { runId: "run", logStore: "local_file", logRef: "test/run.ndjson", logBytes: null };
    const firstBatch = Array.from({ length: 8 }, () => readIssueCommentRunLogText(run));
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await Promise.all(firstBatch)).toEqual(Array(8).fill(""));
      expect(active).toBe(0);
      read.mockResolvedValueOnce({ content: "storage recovered" });
      await expect(readIssueCommentRunLogText(run)).resolves.toBe("storage recovered");
      expect(read).toHaveBeenCalledTimes(9);
    } finally {
      for (const cleanup of cleanups) cleanup();
      await Promise.allSettled(firstBatch);
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
      read.mockRestore();
    }
  });

  it("keeps readable attribution evidence for concurrent listings", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = vi.spyOn(getRunLogStore(), "read").mockImplementation(async () => {
      await gate;
      return { content: "comment id: legacy-comment" };
    });
    const run = { runId: "run", logStore: "local_file", logRef: "test/run.ndjson", logBytes: null };
    const listings = Array.from({ length: 2 }, () =>
      Promise.all(Array.from({ length: 8 }, () => readIssueCommentRunLogText(run))),
    );
    try {
      release();
      for (const listing of listings) {
        expect(await listing).toEqual(Array(8).fill("comment id: legacy-comment"));
      }
      expect(read).toHaveBeenCalledTimes(16);
    } finally {
      release();
      await Promise.allSettled(listings);
      read.mockRestore();
    }
  });

  it.each([null, 128])("keeps partial attribution evidence when storage fails with logBytes=%s", async (logBytes) => {
    const read = vi.spyOn(getRunLogStore(), "read").mockRejectedValue(new Error("Storage gateway unavailable"));
    const run = { runId: "run", logStore: "local_file", logRef: "test/run.ndjson", logBytes };
    try {
      await expect(readIssueCommentRunLogText(run)).resolves.toBe("");
      read.mockResolvedValueOnce({ content: "earlier evidence", nextOffset: 16 });
      await expect(readIssueCommentRunLogText(run)).resolves.toBe("earlier evidence");
    } finally {
      read.mockRestore();
    }
  });

  it("bounds reads that ignore cancellation and stops late pagination after the deadline", async () => {
    let release!: (value: { content: string; nextOffset: number }) => void;
    const stalled = new Promise<{ content: string; nextOffset: number }>((resolve) => {
      release = resolve;
    });
    const read = vi.spyOn(getRunLogStore(), "read")
      .mockResolvedValueOnce({ content: "earlier evidence", nextOffset: 16 })
      .mockReturnValueOnce(stalled);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let result: string | undefined;
    const pending = readIssueCommentRunLogText({
      runId: "run", logStore: "local_file", logRef: "test/run.ndjson", logBytes: null,
    }).then((value) => { result = value; });
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(result).toBe("earlier evidence");
      expect(read.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
      release({ content: "too late", nextOffset: 24 });
      await pending;
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(2);
      expect(result).toBe("earlier evidence");
    } finally {
      release({ content: "", nextOffset: 0 });
      await pending.catch(() => {});
      vi.useRealTimers();
      read.mockRestore();
    }
  });

  it.each([null, 128, 0])("reads existing attribution markers with logBytes=%s", async (logBytes) => {
    const commentId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();
    const read = vi.spyOn(getRunLogStore(), "read")
      .mockResolvedValueOnce({ content: "comment id: ", nextOffset: 12 })
      .mockResolvedValueOnce({ content: commentId + "\n" });
    try {
      const logContent = await readIssueCommentRunLogText({
        runId, logStore: "local_file", logRef: "test/run.ndjson", logBytes,
      });
      const derived = deriveIssueCommentRunLogAttribution(
        [{
          id: commentId,
          authorAgentId: null,
          authorUserId: "local-operator",
          createdByRunId: null,
          createdAt: new Date("2020-01-01T00:00:01Z"),
        }],
        [{
          runId,
          agentId,
          createdAt: new Date("2020-01-01T00:00:00Z"),
          startedAt: new Date("2020-01-01T00:00:00Z"),
          finishedAt: new Date("2020-01-01T00:00:02Z"),
          logContent,
        }],
      );
      if (logBytes === 0) {
        expect(read).not.toHaveBeenCalled();
        expect(derived.size).toBe(0);
      } else {
        expect(read).toHaveBeenCalledTimes(2);
        expect(read.mock.calls[1]?.[1]?.offset).toBe(12);
        expect(derived.get(commentId)).toEqual({
          derivedAuthorAgentId: agentId,
          derivedCreatedByRunId: runId,
          derivedAuthorSource: "run_log_comment_post",
        });
      }
    } finally {
      read.mockRestore();
    }
  });
});

describe("deriveIssueCommentRunLogAttribution", () => {
  it("recovers agent attribution from run logs that printed the posted comment id", () => {
    const commentId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();

    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: null,
          authorUserId: "user-1",
          createdByRunId: null,
          createdAt: new Date("2026-05-11T18:55:40.090Z"),
        },
      ],
      [
        {
          runId,
          agentId,
          createdAt: new Date("2026-05-11T18:51:56.246Z"),
          startedAt: new Date("2026-05-11T18:51:56.257Z"),
          finishedAt: new Date("2026-05-11T18:55:45.600Z"),
          logContent: `comment id: ${commentId}\n`,
        },
      ],
    );

    expect(derived.get(commentId)).toEqual({
      derivedAuthorAgentId: agentId,
      derivedCreatedByRunId: runId,
      derivedAuthorSource: "run_log_comment_post",
    });
  });

  it("resolves directly from the comment's own run id without reading logs", () => {
    const commentId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();

    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: null,
          authorUserId: "local-operator",
          createdByRunId: runId,
          createdAt: new Date("2026-05-11T18:55:40.090Z"),
        },
      ],
      [
        {
          runId,
          agentId,
          createdAt: new Date("2026-05-11T18:51:56.246Z"),
          startedAt: new Date("2026-05-11T18:51:56.257Z"),
          finishedAt: new Date("2026-05-11T18:55:45.600Z"),
          logContent: "",
        },
      ],
    );

    expect(derived.get(commentId)).toEqual({
      derivedAuthorAgentId: agentId,
      derivedCreatedByRunId: runId,
      derivedAuthorSource: "run_id",
    });
  });

  it("does NOT attribute on run-window overlap alone — timing is not a lossless signal (option A)", () => {
    // A human operator comment can land inside an agent's run window; since both are
    // stored as `local-operator`, a timing-only guess would mis-attribute it. So a
    // single overlapping run with no run-id and no log marker stays unresolved.
    const commentId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();

    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: null,
          authorUserId: "local-operator",
          createdByRunId: null,
          createdAt: new Date("2026-05-11T18:55:40.090Z"),
        },
      ],
      [
        {
          runId,
          agentId,
          createdAt: new Date("2026-05-11T18:51:56.246Z"),
          startedAt: new Date("2026-05-11T18:51:56.257Z"),
          finishedAt: new Date("2026-05-11T18:55:45.600Z"),
          logContent: "posted results without echoing the comment id",
        },
      ],
    );

    expect(derived.has(commentId)).toBe(false);
  });

  it("does not guess when multiple agent runs overlap and no log proves the author", () => {
    const commentId = randomUUID();
    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: null,
          authorUserId: "local-operator",
          createdByRunId: null,
          createdAt: new Date("2026-05-11T18:55:40.090Z"),
        },
      ],
      [
        {
          runId: randomUUID(),
          agentId: randomUUID(),
          createdAt: new Date("2026-05-11T18:51:56.246Z"),
          startedAt: new Date("2026-05-11T18:51:56.257Z"),
          finishedAt: new Date("2026-05-11T18:55:45.600Z"),
          logContent: "no comment id here",
        },
        {
          runId: randomUUID(),
          agentId: randomUUID(),
          createdAt: new Date("2026-05-11T18:54:00.000Z"),
          startedAt: new Date("2026-05-11T18:54:00.000Z"),
          finishedAt: new Date("2026-05-11T18:56:00.000Z"),
          logContent: "also nothing",
        },
      ],
    );

    expect(derived.has(commentId)).toBe(false);
  });

  it("does NOT attribute on same-agent run-window overlap alone (option A)", () => {
    // Even when every overlapping run is the same agent, timing alone cannot
    // prove the comment was the agent's vs a human operator comment during the run.
    const commentId = randomUUID();
    const agentId = randomUUID();

    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: null,
          authorUserId: "local-operator",
          createdByRunId: null,
          createdAt: new Date("2026-06-29T17:41:59.916Z"),
        },
      ],
      [
        {
          runId: randomUUID(),
          agentId,
          createdAt: new Date("2026-06-29T17:41:26.116Z"),
          startedAt: new Date("2026-06-29T17:41:26.116Z"),
          finishedAt: new Date("2026-06-29T17:46:33.794Z"),
          logContent: "no comment id here",
        },
        {
          runId: randomUUID(),
          agentId,
          createdAt: new Date("2026-06-29T17:40:09.531Z"),
          startedAt: new Date("2026-06-29T17:40:09.531Z"),
          finishedAt: new Date("2026-06-29T17:46:33.794Z"),
          logContent: "also nothing",
        },
      ],
    );

    expect(derived.has(commentId)).toBe(false);
  });

  it("never reattributes a comment that already has a stored agent author", () => {
    const commentId = randomUUID();
    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: randomUUID(),
          authorUserId: null,
          createdByRunId: null,
          createdAt: new Date("2026-05-11T18:55:40.090Z"),
        },
      ],
      [
        {
          runId: randomUUID(),
          agentId: randomUUID(),
          createdAt: new Date("2026-05-11T18:51:56.246Z"),
          startedAt: new Date("2026-05-11T18:51:56.257Z"),
          finishedAt: new Date("2026-05-11T18:55:45.600Z"),
          logContent: "",
        },
      ],
    );

    expect(derived.has(commentId)).toBe(false);
  });
});

async function ensureIssueRelationsTable(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "issue_relations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "space_id" uuid NOT NULL,
      "issue_id" uuid NOT NULL,
      "related_issue_id" uuid NOT NULL,
      "type" text NOT NULL,
      "created_by_agent_id" uuid,
      "created_by_user_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `));
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueService.list participantAgentId", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-service-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  it("rejects stale monitor cancellation under the task lock and preserves saved policy settings", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Monitor cancellation", issuePrefix: "MCL", requireOperatorApprovalForNewAgents: false });
    const oldPolicy = {
      mode: "normal" as const, commentRequired: true, stages: [],
      monitor: { nextCheckAt: "2026-10-10T12:00:00.000Z", notes: "Check status", scheduledBy: "operator" as const },
    };
    const savedPolicy = {
      ...oldPolicy,
      stages: [{ type: "review" as const, approvalsNeeded: 1 as const, participants: [{ type: "user" as const, userId: "reviewer" }] }],
      maxReviewRounds: 4,
      authorizationPolicy: { assignmentPolicy: { mode: "protected" as const } },
    };
    await db.insert(issues).values({ id: issueId, spaceId, title: "Monitored task", executionPolicy: oldPolicy });
    await svc.update(issueId, { executionPolicy: savedPolicy });
    const { monitor: _oldMonitor, ...staleCancellation } = oldPolicy;
    await expect(svc.update(issueId, { executionPolicy: staleCancellation, expectedExecutionPolicy: oldPolicy }))
      .rejects.toMatchObject({ status: 409 });
    expect((await svc.getById(issueId))?.executionPolicy).toEqual(savedPolicy);
    const { monitor: _savedMonitor, ...cancellation } = savedPolicy;
    await svc.update(issueId, { executionPolicy: cancellation, expectedExecutionPolicy: savedPolicy });
    expect((await svc.getById(issueId))?.executionPolicy).toEqual(cancellation);
    await expect(svc.update(issueId, { executionPolicy: null, expectedExecutionPolicy: null }))
      .rejects.toMatchObject({ status: 409 });
    expect((await svc.getById(issueId))?.executionPolicy).toEqual(cancellation);
  });

  it("promotes prepared backlog tasks only at the observed status version", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, spaceId, title: "Prepared task", status: "backlog" });
    const original = (await svc.getById(issueId))!;
    const results = await Promise.allSettled([
      svc.update(issueId, { status: "todo", expectedStatusVersion: original.statusVersion }),
      svc.update(issueId, { status: "todo", expectedStatusVersion: original.statusVersion }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason)
      .toMatchObject({ status: 409, details: { code: "issue_status_version_changed" } });
    expect(await svc.getById(issueId)).toMatchObject({ status: "todo", statusVersion: original.statusVersion + 1 });
  });

  it("rejects guarded writes outside backlog promotion without changing the task", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, spaceId, title: "Active task", status: "in_progress" });
    const original = (await svc.getById(issueId))!;
    await expect(svc.update(issueId, { status: "todo", expectedStatusVersion: original.statusVersion }))
      .rejects.toMatchObject({ status: 409 });
    await expect(svc.update(issueId, { status: "todo", expectedStatusVersion: original.statusVersion, title: "Replaced" }))
      .rejects.toMatchObject({ status: 422 });
    expect(await svc.getById(issueId)).toMatchObject({ title: "Active task", status: "in_progress", statusVersion: original.statusVersion });
  });

  it.each(["status", "assignment"])("rejects a prepared promotion after a %s decision returns to its old value", async (change) => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, agentId);
    await seedCodexCoder(db, spaceId, otherAgentId);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, spaceId, title: "Prepared task", status: "backlog", assigneeAgentId: agentId });
    const original = (await svc.getById(issueId))!;
    if (change === "status") {
      await svc.update(issueId, { status: "cancelled" });
      await svc.update(issueId, { status: "backlog" });
    } else {
      await svc.update(issueId, { assigneeAgentId: otherAgentId });
      await svc.update(issueId, { assigneeAgentId: agentId });
    }
    const current = (await svc.getById(issueId))!;
    expect(current.statusVersion).toBeGreaterThan(original.statusVersion);
    await expect(svc.update(issueId, { status: "todo", expectedStatusVersion: original.statusVersion }))
      .rejects.toMatchObject({ status: 409, details: { code: "issue_status_version_changed" } });
    expect((await svc.getById(issueId))!).toMatchObject({ status: "backlog", assigneeAgentId: agentId, statusVersion: current.statusVersion });
  });

  it.each(["release", "force release", "direct agent round trip", "direct human round trip"])(
    "invalidates a prepared promotion after %s", async (change) => {
      const spaceId = randomUUID();
      const agentId = randomUUID();
      const otherAgentId = randomUUID();
      await seedIssueSpace(db, spaceId);
      await seedCodexCoder(db, spaceId, agentId);
      await seedCodexCoder(db, spaceId, otherAgentId);
      const issueId = randomUUID();
      const humanAssignment = change === "direct human round trip";
      await db.insert(issues).values({
        id: issueId, spaceId, title: "Prepared ownership", status: "backlog",
        assigneeAgentId: humanAssignment ? null : agentId,
        assigneeUserId: humanAssignment ? "original-owner" : null,
      });
      const original = (await svc.getById(issueId))!;
      if (change === "release") {
        await svc.release(issueId, agentId);
      } else if (change === "force release") {
        await svc.adminForceRelease(issueId, { clearAssignee: true });
      } else if (humanAssignment) {
        await db.update(issues).set({ assigneeUserId: "another-owner" }).where(eq(issues.id, issueId));
        await db.update(issues).set({ assigneeUserId: "original-owner" }).where(eq(issues.id, issueId));
      } else {
        await db.update(issues).set({ assigneeAgentId: otherAgentId }).where(eq(issues.id, issueId));
        await db.update(issues).set({ assigneeAgentId: agentId }).where(eq(issues.id, issueId));
      }
      const current = (await svc.getById(issueId))!;
      expect(current.statusVersion).toBe(original.statusVersion + (change.startsWith("direct") ? 2 : 1));
      await expect(svc.update(issueId, { status: "todo", expectedStatusVersion: original.statusVersion }))
        .rejects.toMatchObject({ status: 409, details: { code: "issue_status_version_changed" } });
      expect(await svc.getById(issueId)).toMatchObject({
        status: "backlog", assigneeAgentId: current.assigneeAgentId,
        assigneeUserId: current.assigneeUserId, statusVersion: current.statusVersion,
      });
    },
  );

  it("keeps a prepared version when the stored assignee is unchanged", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, agentId);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, spaceId, title: "Same owner", status: "backlog", assigneeAgentId: agentId });
    const original = (await svc.getById(issueId))!;
    await db.update(issues).set({ assigneeAgentId: agentId, assigneeUserId: null }).where(eq(issues.id, issueId));
    expect((await svc.getById(issueId))?.statusVersion).toBe(original.statusVersion);
    await expect(svc.update(issueId, { status: "todo", expectedStatusVersion: original.statusVersion }))
      .resolves.toMatchObject({ status: "todo", statusVersion: original.statusVersion + 1 });
  });

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueThreadInteractions);
    await db.delete(issueRelations);
    await db.delete(issueDocuments);
    await db.delete(issueInboxArchives);
    await db.delete(issueReadStates);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(documents);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(spaceMemberships);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAssignableAgentSpace() {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);
    return spaceId;
  }

  it("does not treat passive issue activity as touching it, but includes real user mutations", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const issueId = randomUUID();
    const userId = "operator-user";

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Issue viewed without participation",
      status: "todo",
      priority: "medium",
    });
    await svc.markRead(spaceId, issueId, userId);
    await db.insert(activityLog).values([
      {
        spaceId,
        actorType: "user",
        actorId: userId,
        action: "issue.read_marked",
        entityType: "issue",
        entityId: issueId,
      },
      {
        spaceId,
        actorType: "user",
        actorId: userId,
        action: "issue.file_resource_content_read",
        entityType: "issue",
        entityId: issueId,
      },
      {
        spaceId,
        actorType: "user",
        actorId: userId,
        action: "issue.file_resource_download_denied",
        entityType: "issue",
        entityId: issueId,
      },
      {
        spaceId,
        actorType: "user",
        actorId: userId,
        action: "issue.tree_control_previewed",
        entityType: "issue",
        entityId: issueId,
      },
    ]);

    await expect(svc.list(spaceId, { touchedByUserId: userId })).resolves.toEqual([]);

    await db.insert(activityLog).values({
      spaceId,
      actorType: "user",
      actorId: userId,
      action: "issue.comment_cancelled",
      entityType: "issue",
      entityId: issueId,
    });

    await expect(svc.list(spaceId, { touchedByUserId: userId })).resolves.toEqual([
      expect.objectContaining({ id: issueId }),
    ]);
  });

  it("ignores historical reader-attributed recovery cleanup without hiding explicit recovery decisions", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const userId = "operator-user";
    const old = new Date("2026-03-26T10:00:00Z");
    const recent = new Date("2026-03-26T15:00:00Z");
    const variants = [
      { id: randomUUID(), details: { source: "source_revalidation", trigger: "read_projection" }, counts: false },
      { id: randomUUID(), details: null, counts: true },
      { id: randomUUID(), details: { outcome: "restored" }, counts: true },
      { id: randomUUID(), details: { source: "source_revalidation", trigger: "issue_update" }, counts: true },
    ];
    await db.insert(issues).values(variants.map(({ id }) => ({
      id, spaceId, title: "Recovery audit", status: "done", updatedAt: old,
    })));
    await db.insert(activityLog).values(variants.map(({ id, details }) => ({
      spaceId, actorType: "user", actorId: userId, action: "issue.recovery_action_resolved",
      entityType: "issue", entityId: id, details, createdAt: recent,
    })));
    await db.insert(issueComments).values(variants.map(({ id }) => ({
      spaceId, issueId: id, authorUserId: "other-user", body: "An older update", createdAt: old,
    })));

    const expectedIds = variants.filter(v => v.counts).map(v => v.id).sort();
    expect((await svc.list(spaceId, { touchedByUserId: userId })).map(v => v.id).sort()).toEqual(expectedIds);
    expect(await svc.countUnreadTouchedByUser(spaceId, userId)).toBe(expectedIds.length);
    const rows = await svc.list(spaceId, {}) as IssueListRow[];
    for (const variant of variants) {
      expect(rows.find(v => v.id === variant.id)?.lastActivityAt).toEqual(variant.counts ? recent : old);
    }
    // Audit evidence is preserved, including the wrongly attributed old row.
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(variants.length);
  });

  function agentRow(spaceId: string, input: {
    id: string;
    name: string;
    status?: string;
    reportsTo?: string | null;
  }) {
    return {
      id: input.id,
      spaceId,
      name: input.name,
      role: "engineer",
      status: input.status ?? "active",
      reportsTo: input.reportsTo ?? null,
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    };
  }

  it("rejects direct terminated assignees with structured conflict details", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const terminatedAgentId = randomUUID();
    await db.insert(agents).values(agentRow(spaceId, {
      id: terminatedAgentId,
      name: "TerminatedCoder",
      status: "terminated",
    }));

    await expect(svc.create(spaceId, {
      title: "Do not assign this",
      description: null,
      status: "todo",
      priority: "medium",
      assigneeAgentId: terminatedAgentId,
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "agent_not_assignable",
        reason: "assignee_terminated",
        assigneeAgentId: terminatedAgentId,
      },
    });
  });

  it("rejects invalid ancestor-chain assignees and preserves the existing assignment", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const activeAgentId = randomUUID();
    const terminatedManagerId = randomUUID();
    const blockedAgentId = randomUUID();
    await db.insert(agents).values([
      agentRow(spaceId, { id: activeAgentId, name: "ActiveCoder" }),
      agentRow(spaceId, {
        id: terminatedManagerId,
        name: "TerminatedManager",
        status: "terminated",
      }),
      agentRow(spaceId, {
        id: blockedAgentId,
        name: "BlockedCoder",
        reportsTo: terminatedManagerId,
      }),
    ]);
    const issue = await svc.create(spaceId, {
      title: "Keep current assignment",
      description: null,
      status: "todo",
      priority: "medium",
      assigneeAgentId: activeAgentId,
    });

    await expect(svc.update(issue.id, {
      assigneeAgentId: blockedAgentId,
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "agent_not_assignable",
        reason: "ancestor_terminated",
        assigneeAgentId: blockedAgentId,
        invalidAncestorAgentId: terminatedManagerId,
      },
    });

    const persisted = await db
      .select({ assigneeAgentId: issues.assigneeAgentId })
      .from(issues)
      .where(eq(issues.id, issue.id))
      .then((rows) => rows[0] ?? null);
    expect(persisted?.assigneeAgentId).toBe(activeAgentId);
  });

  it("rejects checkout by a terminated agent before assigning the issue", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const terminatedAgentId = randomUUID();
    await db.insert(agents).values(agentRow(spaceId, {
      id: terminatedAgentId,
      name: "TerminatedCheckoutCoder",
      status: "terminated",
    }));
    const issue = await svc.create(spaceId, {
      title: "Checkout must stay unassigned",
      description: null,
      status: "todo",
      priority: "medium",
      assigneeAgentId: null,
    });

    await expect(svc.checkout(issue.id, terminatedAgentId, ["todo"], randomUUID()))
      .rejects.toMatchObject({
        status: 409,
        details: {
          code: "agent_not_assignable",
          reason: "assignee_terminated",
          assigneeAgentId: terminatedAgentId,
        },
      });

    const persisted = await db
      .select({ assigneeAgentId: issues.assigneeAgentId, status: issues.status })
      .from(issues)
      .where(eq(issues.id, issue.id))
      .then((rows) => rows[0] ?? null);
    expect(persisted).toMatchObject({
      assigneeAgentId: null,
      status: "todo",
    });
  });

  it("expires a pending connection and its OAuth state when reassigned to a user without a status change", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(agents).values(agentRow(spaceId, { id: agentId, name: "ConnectionRequester" }));
    await db.insert(spaceMemberships).values({
      spaceId, principalType: "user", principalId: userId, status: "active", membershipRole: "member",
    });
    const issue = await svc.create(spaceId, {
      title: "Waiting for a connection", status: "in_review", priority: "medium", assigneeAgentId: agentId,
    });
    const [application] = await db.insert(toolApplications).values({
      spaceId, name: "Connection app", type: "mcp_http",
    }).returning();
    const [connection] = await db.insert(toolConnections).values({
      spaceId, applicationId: application!.id, name: "Notion", uid: randomUUID(),
      transport: "mcp_remote", authKind: "oauth",
    }).returning();
    const [interaction] = await db.insert(issueThreadInteractions).values({
      spaceId, issueId: issue.id, kind: "connection_intent", status: "pending",
      createdByAgentId: agentId, addresseeUserId: "local-operator",
      payload: {
        version: 1, serviceSlug: "notion", serviceName: "Notion",
        requestingAgentId: agentId, requestingAgentName: "ConnectionRequester", phase: "authorizing",
      },
    }).returning();
    // A second pending request on the same issue asks for an AI account. The
    // expiry must tell the two apart: only the AI one blocks the run.
    const [aiInteraction] = await db.insert(issueThreadInteractions).values({
      spaceId, issueId: issue.id, kind: "connection_intent", status: "pending",
      createdByAgentId: agentId, addresseeUserId: "local-operator",
      payload: {
        version: 1, purpose: "ai", serviceSlug: "connection:claude_local",
        serviceName: "Claude", requestingAgentId: agentId,
        requestingAgentName: "ConnectionRequester", phase: "authorizing",
      },
    }).returning();
    const oauthState = randomUUID();
    await db.insert(toolOauthStates).values({
      state: oauthState, spaceId, connectionId: connection!.id, issueId: issue.id,
      interactionId: interaction!.id, codeVerifier: "test-verifier",
      createdByActorType: "user", createdByActorId: "local-operator",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const updated = await svc.update(issue.id, {
      assigneeAgentId: null, assigneeUserId: userId, actorUserId: "local-operator",
    });
    expect(updated).toMatchObject({ status: "in_review", assigneeAgentId: null, assigneeUserId: userId });
    await expect(db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interaction!.id)))
      .resolves.toEqual([expect.objectContaining({
        status: "expired",
        result: {
          version: 1,
          outcome: "expired",
          reason: "The task was reassigned before the connection request was answered, so the Notion connection is still not connected. Reconnect it or choose an available connection.",
        },
        resolvedAt: expect.any(Date),
      })]);
    await expect(db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, aiInteraction!.id)))
      .resolves.toEqual([expect.objectContaining({
        status: "expired",
        result: {
          version: 1,
          outcome: "expired",
          reason: "The task was reassigned before the connection request was answered, so the AI account is still not connected. Reconnect it or choose an available connection.",
        },
      })]);
    await expect(db.select().from(toolOauthStates).where(eq(toolOauthStates.state, oauthState))).resolves.toEqual([]);
  });

  it("expires pending thread interactions on any service-level terminal transition", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const issue = await svc.create(spaceId, {
      title: "Close me with a pending card",
      description: null,
      status: "todo",
      priority: "medium",
    });
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      spaceId,
      issueId: issue.id,
      kind: "ask_user_questions",
      status: "pending",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        questions: [{
          id: "scope",
          prompt: "Pick one",
          selectionMode: "single",
          options: [{ id: "a", label: "A" }],
        }],
      } as never,
    });

    // Direct service callers (tree control, recovery, pipelines, status cards)
    // never pass through the HTTP routes, so the expiry must fire here.
    const updated = await svc.update(issue.id, { status: "cancelled", actorUserId: "local-operator" });
    expect(updated?.status).toBe("cancelled");

    const interaction = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, interactionId))
      .then((rows) => rows[0] ?? null);
    expect(interaction).toMatchObject({
      status: "expired",
      resolvedByUserId: "local-operator",
    });
    expect(interaction?.result).toMatchObject({ version: 1, outcome: "issue_closed" });
    expect(interaction?.resolvedAt).not.toBeNull();

    const logged = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "issue.thread_interaction_expired"));
    expect(logged).toHaveLength(1);
    // details.source is dot-separated and trips the JWT-shaped redaction
    // heuristic in sanitizeRecord, so assert the identifying fields instead.
    expect(logged[0]?.details).toMatchObject({
      interactionId,
      interactionKind: "ask_user_questions",
      interactionStatus: "expired",
    });
  });

  it("expires superseded interactions when human comments are added through the service", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const issue = await svc.create(spaceId, {
      title: "Answer with a comment",
      description: null,
      status: "in_review",
      priority: "medium",
    });
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      spaceId,
      issueId: issue.id,
      kind: "ask_user_questions",
      status: "pending",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        supersedeOnUserComment: true,
        questions: [{
          id: "scope",
          prompt: "Pick one",
          selectionMode: "single",
          options: [{ id: "a", label: "A" }],
        }],
      } as never,
    });

    const comment = await svc.addComment(issue.id, "Use option A", { userId: "local-operator" });

    const interaction = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, interactionId))
      .then((rows) => rows[0] ?? null);
    expect(interaction).toMatchObject({
      status: "expired",
      resolvedByUserId: "local-operator",
    });
    expect(interaction?.result).toMatchObject({
      expirationReason: "superseded_by_comment",
      commentId: comment.id,
    });

    const logged = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "issue.thread_interaction_expired"));
    expect(logged).toHaveLength(1);
    expect(logged[0]?.details).toMatchObject({
      interactionId,
      interactionKind: "ask_user_questions",
      interactionStatus: "expired",
    });
  });

  it("keeps interactions pending when the operator concierge adds a comment", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const issue = await svc.create(spaceId, {
      title: "Concierge reply",
      description: null,
      status: "in_review",
      priority: "medium",
    });
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      spaceId,
      issueId: issue.id,
      kind: "ask_user_questions",
      status: "pending",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        supersedeOnUserComment: true,
        questions: [{
          id: "scope",
          prompt: "Pick one",
          selectionMode: "single",
          options: [{ id: "a", label: "A" }],
        }],
      } as never,
    });

    await svc.addComment(issue.id, "Automated concierge reply", {
      userId: "operator-concierge",
    });

    const interaction = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, interactionId))
      .then((rows) => rows[0] ?? null);
    expect(interaction).toMatchObject({
      status: "pending",
      resolvedByUserId: null,
      result: null,
    });

    const logged = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "issue.thread_interaction_expired"));
    expect(logged).toHaveLength(0);
  });

  it("rejects moving an existing terminated assignment into progress without clearing it", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const assigneeAgentId = randomUUID();
    await db.insert(agents).values(agentRow(spaceId, {
      id: assigneeAgentId,
      name: "SoonTerminatedCoder",
    }));
    const issue = await svc.create(spaceId, {
      title: "Do not restart after termination",
      description: null,
      status: "todo",
      priority: "medium",
      assigneeAgentId,
    });
    await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, assigneeAgentId));

    await expect(svc.update(issue.id, {
      status: "in_progress",
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "agent_not_assignable",
        reason: "assignee_terminated",
        assigneeAgentId,
      },
    });

    const persisted = await db
      .select({ assigneeAgentId: issues.assigneeAgentId, status: issues.status })
      .from(issues)
      .where(eq(issues.id, issue.id))
      .then((rows) => rows[0] ?? null);
    expect(persisted).toMatchObject({
      assigneeAgentId,
      status: "todo",
    });
  });

  it("resolves only structured same-space agent mentions", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const otherSpaceId = await seedAssignableAgentSpace();
    const localAgentId = randomUUID();
    const foreignAgentId = randomUUID();

    await db.insert(agents).values([
      agentRow(spaceId, { id: localAgentId, name: "LocalAgent" }),
      agentRow(otherSpaceId, { id: foreignAgentId, name: "ForeignAgent" }),
    ]);

    const mentions = await svc.findMentionedAgents(
      spaceId,
      [
        `hello [@LocalAgent](${buildAgentMentionHref(localAgentId)})`,
        `and [@ForeignAgent](${buildAgentMentionHref(foreignAgentId)})`,
      ].join(" "),
    );

    expect(mentions).toEqual([localAgentId]);
  });

  it("does not wake agents from raw @name text without a structured mention", async () => {
    const spaceId = await seedAssignableAgentSpace();
    const localAgentId = randomUUID();

    await db.insert(agents).values([
      agentRow(spaceId, { id: localAgentId, name: "LocalAgent" }),
    ]);

    await expect(svc.findMentionedAgents(spaceId, "@LocalAgent please inspect this"))
      .resolves.toEqual([]);
  });

  it("returns issues an agent participated in across the supported signals", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(agents).values([
      {
        id: agentId,
        spaceId,
        name: "CodexCoder",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        spaceId,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    const assignedIssueId = randomUUID();
    const createdIssueId = randomUUID();
    const commentedIssueId = randomUUID();
    const activityIssueId = randomUUID();
    const excludedIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: assignedIssueId,
        spaceId,
        title: "Assigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        createdByAgentId: otherAgentId,
      },
      {
        id: createdIssueId,
        spaceId,
        title: "Created issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
      {
        id: commentedIssueId,
        spaceId,
        title: "Commented issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
      },
      {
        id: activityIssueId,
        spaceId,
        title: "Activity issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
      },
      {
        id: excludedIssueId,
        spaceId,
        title: "Excluded issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
        assigneeAgentId: otherAgentId,
      },
    ]);

    await db.insert(issueComments).values({
      spaceId,
      issueId: commentedIssueId,
      authorAgentId: agentId,
      body: "Investigating this issue.",
    });

    await db.insert(activityLog).values({
      spaceId,
      actorType: "agent",
      actorId: agentId,
      action: "issue.updated",
      entityType: "issue",
      entityId: activityIssueId,
      agentId,
      details: { changed: true },
    });

    const result = await svc.list(spaceId, { participantAgentId: agentId });
    const resultIds = new Set(result.map((issue) => issue.id));

    expect(resultIds).toEqual(new Set([
      assignedIssueId,
      createdIssueId,
      commentedIssueId,
      activityIssueId,
    ]));
    expect(resultIds.has(excludedIssueId)).toBe(false);
  });

  it("combines participation filtering with search", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await seedCodexCoder(db, spaceId, agentId);

    const matchedIssueId = randomUUID();
    const otherIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: matchedIssueId,
        spaceId,
        title: "Invoice reconciliation",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
      {
        id: otherIssueId,
        spaceId,
        title: "Weekly planning",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
    ]);

    const result = await svc.list(spaceId, {
      participantAgentId: agentId,
      q: "invoice",
    });

    expect(result.map((issue) => issue.id)).toEqual([matchedIssueId]);
  });

  it("filters and counts unassigned issues with assigneeAgentId='null'", async () => {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    const assignedIssueId = randomUUID();
    const unassignedIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(agents).values({
      id: assigneeAgentId,
      spaceId,
      name: "Assignee",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values([
      {
        id: assignedIssueId,
        spaceId,
        title: "Assigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
      {
        id: unassignedIssueId,
        spaceId,
        title: "Unassigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: null,
      },
    ]);

    const result = await svc.list(spaceId, { assigneeAgentId: "null" });
    expect(result.map((issue) => issue.id)).toEqual([unassignedIssueId]);
    await expect(svc.count(spaceId, { assigneeAgentId: "null" })).resolves.toBe(1);
  });

  it("filters and counts only issues assigned to the requested UUID", async () => {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    const otherAgentId = randomUUID();
    const assignedIssueId = randomUUID();
    const otherIssueId = randomUUID();
    const unassignedIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(agents).values([
      {
        id: assigneeAgentId,
        spaceId,
        name: "Assignee",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        spaceId,
        name: "Other",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(issues).values([
      {
        id: assignedIssueId,
        spaceId,
        title: "Assigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
      {
        id: otherIssueId,
        spaceId,
        title: "Other issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: otherAgentId,
      },
      {
        id: unassignedIssueId,
        spaceId,
        title: "Unassigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: null,
      },
    ]);

    const result = await svc.list(spaceId, { assigneeAgentId });
    expect(result.map((issue) => issue.id)).toEqual([assignedIssueId]);
    await expect(svc.count(spaceId, { assigneeAgentId })).resolves.toBe(1);
  });

  it("rejects malformed assigneeAgentId filters in list and count", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await db.insert(issues).values({
      id: randomUUID(),
      spaceId,
      title: "Any issue",
      status: "todo",
      priority: "medium",
    });

    await expect(
      svc.list(spaceId, { assigneeAgentId: "not-a-uuid" }),
    ).rejects.toThrow(/assigneeAgentId/i);
    await expect(
      svc.count(spaceId, { assigneeAgentId: "not-a-uuid" }),
    ).rejects.toThrow(/assigneeAgentId/i);
  });

  it("applies result limits to issue search", async () => {
    const spaceId = randomUUID();

    await seedIssueSpace(db, spaceId);

    const exactIdentifierId = randomUUID();
    const titleMatchId = randomUUID();
    const descriptionMatchId = randomUUID();

    await db.insert(issues).values([
      {
        id: exactIdentifierId,
        spaceId,
        issueNumber: 42,
        identifier: "PAP-42",
        title: "Completely unrelated",
        status: "todo",
        priority: "medium",
      },
      {
        id: titleMatchId,
        spaceId,
        title: "Search ranking issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: descriptionMatchId,
        spaceId,
        title: "Another item",
        description: "Contains the search keyword",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(spaceId, {
      q: "search",
      limit: 2,
    });

    expect(result.map((issue) => issue.id)).toEqual([titleMatchId, descriptionMatchId]);
  });

  it("filters issues by whether they have a plan document", async () => {
    const spaceId = randomUUID();
    const withPlanId = randomUUID();
    const withoutPlanId = randomUUID();
    const otherDocumentId = randomUUID();
    const planDocumentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: withPlanId,
        spaceId,
        title: "Issue with plan",
        status: "todo",
        priority: "medium",
      },
      {
        id: withoutPlanId,
        spaceId,
        title: "Issue without plan",
        status: "todo",
        priority: "medium",
      },
    ]);

    await db.insert(documents).values([
      {
        id: planDocumentId,
        spaceId,
        title: null,
        format: "markdown",
        latestBody: "# Plan",
      },
      {
        id: otherDocumentId,
        spaceId,
        title: "Notes",
        format: "markdown",
        latestBody: "# Notes",
      },
    ]);

    await db.insert(issueDocuments).values([
      {
        spaceId,
        issueId: withPlanId,
        documentId: planDocumentId,
        key: "plan",
      },
      {
        spaceId,
        issueId: withoutPlanId,
        documentId: otherDocumentId,
        key: "notes",
      },
    ]);

    const withPlan = await svc.list(spaceId, { hasPlanDocument: true });
    const withoutPlan = await svc.list(spaceId, { hasPlanDocument: false });

    expect(withPlan.map((issue) => issue.id)).toEqual([withPlanId]);
    expect(withoutPlan.map((issue) => issue.id)).toEqual([withoutPlanId]);
  });

  it("can page issues by most recently updated before priority", async () => {
    const spaceId = randomUUID();
    const oldCriticalIssueId = randomUUID();
    const recentMediumIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: oldCriticalIssueId,
        spaceId,
        title: "Old critical issue",
        status: "todo",
        priority: "critical",
        updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      },
      {
        id: recentMediumIssueId,
        spaceId,
        title: "Recent medium issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-05-17T21:12:29.993Z"),
      },
    ]);

    const result = await svc.list(spaceId, {
      limit: 1,
      sortField: "updated",
      sortDir: "desc",
    });

    expect(result.map((issue) => issue.id)).toEqual([recentMediumIssueId]);
  });

  it("ranks direct description matches ahead of comment-only matches", async () => {
    const spaceId = randomUUID();
    const commentMatchId = randomUUID();
    const descriptionMatchId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: commentMatchId,
        spaceId,
        title: "Comment match",
        status: "todo",
        priority: "medium",
      },
      {
        id: descriptionMatchId,
        spaceId,
        title: "Description match",
        description: "Contains pull/3303 in the description",
        status: "todo",
        priority: "medium",
      },
    ]);

    await db.insert(issueComments).values({
      spaceId,
      issueId: commentMatchId,
      body: "Reference: https://github.com/paperclipai/paperclip/pull/3303",
    });

    const result = await svc.list(spaceId, {
      q: "pull/3303",
      limit: 2,
      includeRoutineExecutions: true,
    });

    expect(result.map((issue) => issue.id)).toEqual([descriptionMatchId, commentMatchId]);
  });

  it("filters issue lists to the full descendant tree for a root issue", async () => {
    const spaceId = randomUUID();
    const rootId = randomUUID();
    const childId = randomUUID();
    const grandchildId = randomUUID();
    const siblingId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: rootId,
        spaceId,
        title: "Root",
        status: "todo",
        priority: "medium",
      },
      {
        id: childId,
        spaceId,
        parentId: rootId,
        title: "Child",
        status: "todo",
        priority: "medium",
      },
      {
        id: grandchildId,
        spaceId,
        parentId: childId,
        title: "Grandchild",
        status: "todo",
        priority: "medium",
      },
      {
        id: siblingId,
        spaceId,
        title: "Sibling",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(spaceId, { descendantOf: rootId });

    expect(new Set(result.map((issue) => issue.id))).toEqual(new Set([childId, grandchildId]));
  });

  it("combines descendant filtering with search", async () => {
    const spaceId = randomUUID();
    const rootId = randomUUID();
    const childId = randomUUID();
    const grandchildId = randomUUID();
    const outsideMatchId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: rootId,
        spaceId,
        title: "Root",
        status: "todo",
        priority: "medium",
      },
      {
        id: childId,
        spaceId,
        parentId: rootId,
        title: "Relevant parent",
        status: "todo",
        priority: "medium",
      },
      {
        id: grandchildId,
        spaceId,
        parentId: childId,
        title: "Needle grandchild",
        status: "todo",
        priority: "medium",
      },
      {
        id: outsideMatchId,
        spaceId,
        title: "Needle outside",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(spaceId, { descendantOf: rootId, q: "needle" });

    expect(result.map((issue) => issue.id)).toEqual([grandchildId]);
  });

  it("accepts issue identifiers with alphanumeric prefixes through getById", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: "PC1A2",
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      issueNumber: 1064,
      identifier: "PC1A2-1064",
      title: "Feedback votes error",
      status: "todo",
      priority: "medium",
      createdByUserId: "user-1",
    });

    const issue = await svc.getById("pc1a2-1064");

    expect(issue).toEqual(
      expect.objectContaining({
        id: issueId,
        identifier: "PC1A2-1064",
      }),
    );
  });

  it("returns null instead of throwing for malformed non-uuid issue refs", async () => {
    await expect(svc.getById("not-a-uuid")).resolves.toBeNull();
  });
  it("filters issues by execution workspace id", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const targetWorkspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const linkedIssueId = randomUUID();
    const otherLinkedIssueId = randomUUID();
    const unlinkedIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(executionWorkspaces).values([
      {
        id: targetWorkspaceId,
        spaceId,
        projectId,
        mode: "shared_workspace",
        strategyType: "project_primary",
        name: "Target workspace",
        status: "active",
        providerType: "local_fs",
      },
      {
        id: otherWorkspaceId,
        spaceId,
        projectId,
        mode: "shared_workspace",
        strategyType: "project_primary",
        name: "Other workspace",
        status: "active",
        providerType: "local_fs",
      },
    ]);

    await db.insert(issues).values([
      {
        id: linkedIssueId,
        spaceId,
        projectId,
        title: "Linked issue",
        status: "todo",
        priority: "medium",
        executionWorkspaceId: targetWorkspaceId,
      },
      {
        id: otherLinkedIssueId,
        spaceId,
        projectId,
        title: "Other linked issue",
        status: "todo",
        priority: "medium",
        executionWorkspaceId: otherWorkspaceId,
      },
      {
        id: unlinkedIssueId,
        spaceId,
        projectId,
        title: "Unlinked issue",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(spaceId, { executionWorkspaceId: targetWorkspaceId });

    expect(result.map((issue) => issue.id)).toEqual([linkedIssueId]);
  });

  it("filters issues by generic workspace id across execution and project workspace links", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const executionLinkedIssueId = randomUUID();
    const projectLinkedIssueId = randomUUID();
    const otherIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Feature workspace",
      sourceType: "local_path",
      visibility: "default",
      isPrimary: false,
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Execution workspace",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values([
      {
        id: executionLinkedIssueId,
        spaceId,
        projectId,
        projectWorkspaceId,
        title: "Execution linked issue",
        status: "done",
        priority: "medium",
        executionWorkspaceId,
      },
      {
        id: projectLinkedIssueId,
        spaceId,
        projectId,
        projectWorkspaceId,
        title: "Project linked issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: otherIssueId,
        spaceId,
        projectId,
        title: "Other issue",
        status: "todo",
        priority: "medium",
      },
    ]);

    const executionResult = await svc.list(spaceId, { workspaceId: executionWorkspaceId });
    const projectResult = await svc.list(spaceId, { workspaceId: projectWorkspaceId });

    expect(executionResult.map((issue) => issue.id)).toEqual([executionLinkedIssueId]);
    expect(projectResult.map((issue) => issue.id).sort()).toEqual([executionLinkedIssueId, projectLinkedIssueId].sort());
  });

  it("hides plugin operation issues from default lists and inbox-style filters while preserving explicit retrieval", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const normalIssueId = randomUUID();
    const pluginVisibleIssueId = randomUUID();
    const operationIssueId = randomUUID();
    const typedOperationIssueId = randomUUID();
    const legacyContentMachineOperationIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Plugin Runner",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Plugin operations",
      status: "in_progress",
    });
    await db.insert(issues).values([
      {
        id: normalIssueId,
        spaceId,
        title: "Normal issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
      },
      {
        id: pluginVisibleIssueId,
        spaceId,
        title: "Plugin-visible issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:outpost.missions:feature",
      },
      {
        id: operationIssueId,
        spaceId,
        projectId,
        title: "Plugin operation issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:outpost.missions:operation",
        originId: "mission-alpha:operation-1",
      },
      {
        id: typedOperationIssueId,
        spaceId,
        projectId,
        title: "Typed plugin operation issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:outpost.missions:operation:evaluation",
        originId: "mission-alpha:operation-2",
      },
      {
        id: legacyContentMachineOperationIssueId,
        spaceId,
        projectId,
        title: "Legacy Content Machine operation issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:outpost.content-machine:evaluation",
        originId: "content-machine-operation-1",
      },
    ]);

    const defaultIssueIds = (await svc.list(spaceId)).map((issue) => issue.id);
    expect(defaultIssueIds).toContain(normalIssueId);
    expect(defaultIssueIds).toContain(pluginVisibleIssueId);
    expect(defaultIssueIds).not.toContain(operationIssueId);
    expect(defaultIssueIds).not.toContain(typedOperationIssueId);
    expect(defaultIssueIds).not.toContain(legacyContentMachineOperationIssueId);

    const inboxIssueIds = (await svc.list(spaceId, {
      assigneeAgentId: agentId,
      status: "todo,in_progress,blocked",
      includeRoutineExecutions: true,
    })).map((issue) => issue.id);
    expect(inboxIssueIds).toContain(normalIssueId);
    expect(inboxIssueIds).not.toContain(operationIssueId);
    expect(inboxIssueIds).not.toContain(typedOperationIssueId);
    expect(inboxIssueIds).not.toContain(legacyContentMachineOperationIssueId);

    await expect(svc.list(spaceId, { originKind: "plugin:outpost.missions:operation" }))
      .resolves.toEqual([expect.objectContaining({ id: operationIssueId })]);
    await expect(svc.list(spaceId, { originId: "mission-alpha:operation-1" }))
      .resolves.toEqual([expect.objectContaining({ id: operationIssueId })]);
    await expect(svc.list(spaceId, { originKindPrefix: "plugin:outpost.missions:operation" }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: operationIssueId }),
        expect.objectContaining({ id: typedOperationIssueId }),
      ]));

    const projectIssueIds = (await svc.list(spaceId, { projectId })).map((issue) => issue.id);
    expect(projectIssueIds).toContain(operationIssueId);
    expect(projectIssueIds).toContain(typedOperationIssueId);
    expect(projectIssueIds).toContain(legacyContentMachineOperationIssueId);

    const advancedIssueIds = (await svc.list(spaceId, { includePluginOperations: true })).map((issue) => issue.id);
    expect(advancedIssueIds).toContain(operationIssueId);
    expect(advancedIssueIds).toContain(typedOperationIssueId);
    expect(advancedIssueIds).toContain(legacyContentMachineOperationIssueId);
  });

  it("excludes plugin operation issues from unread inbox counts", async () => {
    const spaceId = randomUUID();
    const userId = "operator-user";
    const otherUserId = "other-user";
    const normalIssueId = randomUUID();
    const operationIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await db.insert(issues).values([
      {
        id: normalIssueId,
        spaceId,
        title: "Normal touched issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
      },
      {
        id: operationIssueId,
        spaceId,
        title: "Plugin operation touched issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        originKind: "plugin:outpost.missions:operation",
      },
    ]);
    await db.insert(issueComments).values([
      {
        spaceId,
        issueId: normalIssueId,
        authorUserId: otherUserId,
        body: "Unread normal update.",
      },
      {
        spaceId,
        issueId: operationIssueId,
        authorUserId: otherUserId,
        body: "Unread operation update.",
      },
    ]);

    await expect(svc.countUnreadTouchedByUser(spaceId, userId, "todo")).resolves.toBe(1);
    await expect(svc.countUnreadTouchedByUser(spaceId, userId, ["todo", "in_progress"])).resolves.toBe(1);
  });

  it("accepts array-form status filters in list and count", async () => {
    const spaceId = randomUUID();
    const todoIssueId = randomUUID();
    const inProgressIssueId = randomUUID();
    const doneIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await db.insert(issues).values([
      {
        id: todoIssueId,
        spaceId,
        title: "Todo issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: inProgressIssueId,
        spaceId,
        title: "In-progress issue",
        status: "in_progress",
        priority: "medium",
      },
      {
        id: doneIssueId,
        spaceId,
        title: "Done issue",
        status: "done",
        priority: "medium",
      },
    ]);

    const resultIds = (await svc.list(spaceId, { status: ["todo", "in_progress"] }))
      .map((issue) => issue.id);

    expect(resultIds).toEqual(expect.arrayContaining([todoIssueId, inProgressIssueId]));
    expect(resultIds).not.toContain(doneIssueId);
    await expect(svc.count(spaceId, { status: ["todo", "in_progress"] })).resolves.toBe(2);
  });

  it("hides archived inbox issues until new external activity arrives", async () => {
    const spaceId = randomUUID();
    const userId = "user-1";
    const otherUserId = "user-2";

    await seedIssueSpace(db, spaceId);

    const visibleIssueId = randomUUID();
    const archivedIssueId = randomUUID();
    const resurfacedIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: visibleIssueId,
        spaceId,
        title: "Visible issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: archivedIssueId,
        spaceId,
        title: "Archived issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T11:00:00.000Z"),
        updatedAt: new Date("2026-03-26T11:00:00.000Z"),
      },
      {
        id: resurfacedIssueId,
        spaceId,
        title: "Resurfaced issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);

    await svc.archiveInbox(spaceId, archivedIssueId, userId, new Date("2026-03-26T12:30:00.000Z"));
    await svc.archiveInbox(spaceId, resurfacedIssueId, userId, new Date("2026-03-26T13:00:00.000Z"));

    await db.insert(issueComments).values({
      spaceId,
      issueId: resurfacedIssueId,
      authorUserId: otherUserId,
      body: "This should bring the issue back into Mine.",
      createdAt: new Date("2026-03-26T13:30:00.000Z"),
      updatedAt: new Date("2026-03-26T13:30:00.000Z"),
    });

    const archivedFiltered = await svc.list(spaceId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });

    expect(archivedFiltered.map((issue) => issue.id)).toEqual([
      resurfacedIssueId,
      visibleIssueId,
    ]);

    await svc.unarchiveInbox(spaceId, archivedIssueId, userId);

    const afterUnarchive = await svc.list(spaceId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });

    expect(new Set(afterUnarchive.map((issue) => issue.id))).toEqual(new Set([
      visibleIssueId,
      archivedIssueId,
      resurfacedIssueId,
    ]));
  });

  it("resurfaces archived issues only for user-attention events", async () => {
    const spaceId = randomUUID();
    const userId = "user-1";
    const otherUserId = "user-2";
    const agentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Worker",
      role: "engineer",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    });

    const issueIds = {
      updatedAt: randomUUID(),
      agentComment: randomUUID(),
      derivedAgentComment: randomUUID(),
      systemComment: randomUUID(),
      suggestTasks: randomUUID(),
      askQuestions: randomUUID(),
      requestConfirmation: randomUUID(),
      inReview: randomUUID(),
      blocked: randomUUID(),
      done: randomUUID(),
      humanComment: randomUUID(),
      mention: randomUUID(),
      unarchived: randomUUID(),
    };

    await db.insert(issues).values(Object.entries(issueIds).map(([title, id]) => ({
      id,
      spaceId,
      title,
      status: "todo",
      priority: "medium" as const,
      createdByUserId: userId,
      createdAt: new Date("2026-03-26T10:00:00.000Z"),
      updatedAt: new Date("2026-03-26T10:00:00.000Z"),
    })));

    const archivedAt = new Date("2026-03-26T12:00:00.000Z");
    for (const issueId of Object.values(issueIds)) {
      await svc.archiveInbox(spaceId, issueId, userId, archivedAt);
    }

    const listVisibleIds = async () => new Set((await svc.list(spaceId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    })).map((issue) => issue.id));

    await expect(listVisibleIds()).resolves.toEqual(new Set());

    await db
      .update(issues)
      .set({ status: "in_progress", updatedAt: new Date("2026-03-26T13:00:00.000Z") })
      .where(eq(issues.id, issueIds.updatedAt));

    await db.insert(issueComments).values([
      {
        spaceId,
        issueId: issueIds.agentComment,
        authorAgentId: agentId,
        body: "Agent progress update",
        createdAt: new Date("2026-03-26T13:00:00.000Z"),
        updatedAt: new Date("2026-03-26T13:00:00.000Z"),
      },
      {
        spaceId,
        issueId: issueIds.derivedAgentComment,
        authorUserId: "local-operator",
        derivedAuthorAgentId: agentId,
        derivedAuthorSource: "run_log_comment_post",
        body: "Legacy agent-attributed progress update",
        createdAt: new Date("2026-03-26T13:00:00.000Z"),
        updatedAt: new Date("2026-03-26T13:00:00.000Z"),
      },
      {
        spaceId,
        issueId: issueIds.systemComment,
        body: "System lifecycle update",
        createdAt: new Date("2026-03-26T13:00:00.000Z"),
        updatedAt: new Date("2026-03-26T13:00:00.000Z"),
      },
      {
        spaceId,
        issueId: issueIds.humanComment,
        authorUserId: otherUserId,
        body: "A human needs your attention",
        createdAt: new Date("2026-03-26T13:00:00.000Z"),
        updatedAt: new Date("2026-03-26T13:00:00.000Z"),
      },
      {
        spaceId,
        issueId: issueIds.mention,
        authorAgentId: agentId,
        body: "Please review this, [Viewer](user://user-1)",
        createdAt: new Date("2026-03-26T13:00:00.000Z"),
        updatedAt: new Date("2026-03-26T13:00:00.000Z"),
      },
    ]);

    await db.insert(issueThreadInteractions).values({
      spaceId,
      issueId: issueIds.suggestTasks,
      kind: "suggest_tasks",
      payload: { version: 1, tasks: [{ clientKey: "follow-up", title: "Follow up" }] },
      createdByAgentId: agentId,
      createdAt: new Date("2026-03-26T13:00:00.000Z"),
      updatedAt: new Date("2026-03-26T13:00:00.000Z"),
    });
    await db.insert(issueThreadInteractions).values({
      spaceId,
      issueId: issueIds.askQuestions,
      kind: "ask_user_questions",
      payload: {
        version: 1,
        questions: [{ id: "scope", prompt: "Which scope?", selectionMode: "single", options: [] }],
      },
      createdByAgentId: agentId,
      createdAt: new Date("2026-03-26T13:00:00.000Z"),
      updatedAt: new Date("2026-03-26T13:00:00.000Z"),
    });
    await db.insert(issueThreadInteractions).values({
      spaceId,
      issueId: issueIds.requestConfirmation,
      kind: "request_confirmation",
      payload: { version: 1, prompt: "Proceed?" },
      createdByAgentId: agentId,
      createdAt: new Date("2026-03-26T13:00:00.000Z"),
      updatedAt: new Date("2026-03-26T13:00:00.000Z"),
    });

    await db.insert(activityLog).values([
      [issueIds.inReview, "in_review"],
      [issueIds.blocked, "blocked"],
      [issueIds.done, "done"],
    ].map(([issueId, status]) => ({
      spaceId,
      actorType: "agent",
      actorId: agentId,
      agentId,
      action: "issue.updated",
      entityType: "issue",
      entityId: issueId,
      details: { status, _previous: { status: "in_progress" } },
      createdAt: new Date("2026-03-26T13:00:00.000Z"),
    })));

    await svc.unarchiveInbox(spaceId, issueIds.unarchived, userId);

    const expectedVisible = new Set([
      issueIds.suggestTasks,
      issueIds.askQuestions,
      issueIds.requestConfirmation,
      issueIds.inReview,
      issueIds.blocked,
      issueIds.done,
      issueIds.humanComment,
      issueIds.mention,
      issueIds.unarchived,
    ]);
    await expect(listVisibleIds()).resolves.toEqual(expectedVisible);

    await svc.archiveInbox(
      spaceId,
      issueIds.humanComment,
      userId,
      new Date("2026-03-26T14:00:00.000Z"),
    );
    expectedVisible.delete(issueIds.humanComment);

    await expect(listVisibleIds()).resolves.toEqual(expectedVisible);
  });

  it("sorts and exposes last activity from comments and non-local issue activity logs", async () => {
    const spaceId = randomUUID();
    const olderIssueId = randomUUID();
    const commentIssueId = randomUUID();
    const activityIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: olderIssueId,
        spaceId,
        title: "Older issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: commentIssueId,
        spaceId,
        title: "Comment activity issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: activityIssueId,
        spaceId,
        title: "Logged activity issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
    ]);

    await db.insert(issueComments).values({
      spaceId,
      issueId: commentIssueId,
      body: "New comment without touching issue.updatedAt",
      createdAt: new Date("2026-03-26T11:00:00.000Z"),
      updatedAt: new Date("2026-03-26T11:00:00.000Z"),
    });

    await db.insert(activityLog).values([
      {
        spaceId,
        actorType: "system",
        actorId: "system",
        action: "issue.document_updated",
        entityType: "issue",
        entityId: activityIssueId,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
      },
      {
        spaceId,
        actorType: "user",
        actorId: "user-1",
        action: "issue.read_marked",
        entityType: "issue",
        entityId: olderIssueId,
        createdAt: new Date("2026-03-26T13:00:00.000Z"),
      },
    ]);

    const result = await svc.list(spaceId, {}) as IssueListRow[];

    expect(result.map((issue) => issue.id)).toEqual([
      activityIssueId,
      commentIssueId,
      olderIssueId,
    ]);
    expect(result.find((issue) => issue.id === activityIssueId)?.lastActivityAt?.toISOString()).toBe(
      "2026-03-26T12:00:00.000Z",
    );
    expect(result.find((issue) => issue.id === commentIssueId)?.lastActivityAt?.toISOString()).toBe(
      "2026-03-26T11:00:00.000Z",
    );
    expect(result.find((issue) => issue.id === olderIssueId)?.lastActivityAt?.toISOString()).toBe(
      "2026-03-26T10:00:00.000Z",
    );
  });

  it("paginates earlier comments in descending order from an anchor comment", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const firstCommentId = randomUUID();
    const anchorCommentId = randomUUID();
    const latestCommentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Paged comments issue",
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values([
      {
        id: firstCommentId,
        spaceId,
        issueId,
        body: "First comment",
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: anchorCommentId,
        spaceId,
        issueId,
        body: "Anchor comment",
        createdAt: new Date("2026-03-26T11:00:00.000Z"),
        updatedAt: new Date("2026-03-26T11:00:00.000Z"),
      },
      {
        id: latestCommentId,
        spaceId,
        issueId,
        body: "Latest comment",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);

    const comments = await svc.listComments(issueId, {
      afterCommentId: anchorCommentId,
      order: "desc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([firstCommentId]);
  });

  it("paginates later comments in ascending order from an anchor comment", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const firstCommentId = randomUUID();
    const anchorCommentId = randomUUID();
    const latestCommentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Paged comments issue",
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values([
      {
        id: firstCommentId,
        spaceId,
        issueId,
        body: "First comment",
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: anchorCommentId,
        spaceId,
        issueId,
        body: "Anchor comment",
        createdAt: new Date("2026-03-26T11:00:00.000Z"),
        updatedAt: new Date("2026-03-26T11:00:00.000Z"),
      },
      {
        id: latestCommentId,
        spaceId,
        issueId,
        body: "Latest comment",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);

    const comments = await svc.listComments(issueId, {
      afterCommentId: anchorCommentId,
      order: "asc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([latestCommentId]);
  });

  it("returns no comments for an anchor cursor that is not a UUID", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Malformed cursor issue",
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values({
      id: commentId,
      spaceId,
      issueId,
      body: "Only comment",
      createdAt: new Date("2026-03-26T10:00:00.000Z"),
      updatedAt: new Date("2026-03-26T10:00:00.000Z"),
    });

    const comments = await svc.listComments(issueId, {
      afterCommentId: commentId.slice(0, 8),
      order: "asc",
      limit: 50,
    });

    expect(comments).toEqual([]);
  });

  it("lists user comments when derived run attribution scans a timestamp window", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await seedCodexCoder(db, spaceId, agentId);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Comments issue",
      status: "todo",
      priority: "medium",
    });

    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      spaceId,
      agentId,
      contextSnapshot: { issueId },
      createdAt: new Date("2026-05-12T22:58:00.000Z"),
      startedAt: new Date("2026-05-12T22:58:00.000Z"),
      finishedAt: new Date("2026-05-12T23:14:00.000Z"),
    });

    await db.insert(issueComments).values({
      id: commentId,
      spaceId,
      issueId,
      authorUserId: "user-1",
      body: "Comment should be visible",
      createdAt: new Date("2026-05-12T23:00:00.000Z"),
      updatedAt: new Date("2026-05-12T23:00:00.000Z"),
    });

    const comments = await svc.listComments(issueId, {
      order: "desc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([commentId]);
    expect(comments[0]?.body).toBe("Comment should be visible");
  });

  it("lists user comments when a candidate attribution run log is missing", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await seedCodexCoder(db, spaceId, agentId);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Comments issue with missing run log",
      status: "todo",
      priority: "medium",
    });

    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      spaceId,
      agentId,
      contextSnapshot: { issueId },
      createdAt: new Date("2026-05-12T22:58:00.000Z"),
      startedAt: new Date("2026-05-12T22:58:00.000Z"),
      finishedAt: new Date("2026-05-12T23:14:00.000Z"),
      logStore: "local_file",
      logRef: "missing/run-log.ndjson",
      logBytes: 128,
    });

    await db.insert(issueComments).values({
      id: commentId,
      spaceId,
      issueId,
      authorUserId: "user-1",
      body: "Comment should still be visible",
      createdAt: new Date("2026-05-12T23:00:00.000Z"),
      updatedAt: new Date("2026-05-12T23:00:00.000Z"),
    });

    const comments = await svc.listComments(issueId, {
      order: "desc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([commentId]);
    expect(comments[0]?.body).toBe("Comment should still be visible");
    expect(comments[0]?.metadata).toBeNull();
  });

  it("includes blockedBy summaries on list rows in one batched pass", async () => {
    const spaceId = randomUUID();
    const blockerId = randomUUID();
    const blockedId = randomUUID();
    const unblockedId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: blockerId,
        spaceId,
        title: "Blocker issue",
        status: "todo",
        priority: "high",
      },
      {
        id: blockedId,
        spaceId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
      },
      {
        id: unblockedId,
        spaceId,
        title: "Unblocked issue",
        status: "todo",
        priority: "medium",
      },
    ]);

    await db.insert(issueRelations).values({
      spaceId,
      issueId: blockerId,
      relatedIssueId: blockedId,
      type: "blocks",
    });

    const defaultResult = await svc.list(spaceId) as IssueListRow[];
    expect(defaultResult.find((issue) => issue.id === blockedId)?.blockedBy).toBeUndefined();

    const result = await svc.list(spaceId, { includeBlockedBy: true }) as IssueListRow[];
    const byId = new Map(result.map((issue) => [issue.id, issue]));

    expect(byId.get(blockedId)?.blockedBy).toEqual([
      expect.objectContaining({
        id: blockerId,
        identifier: null,
        title: "Blocker issue",
        status: "todo",
        priority: "high",
      }),
    ]);
    expect(byId.get(blockerId)?.blockedBy).toEqual([]);
    expect(byId.get(unblockedId)?.blockedBy).toEqual([]);
  });

  it("trims large list payloads and preserves description preview boundaries", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const longDescription = "x".repeat(5_000);
    const exactPreviewId = randomUUID();
    const nullDescriptionId = randomUUID();
    const multibyteBoundaryId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(issues).values([
      {
        id: issueId,
        spaceId,
        title: "Large issue",
        description: longDescription,
        status: "todo",
        priority: "medium",
        executionPolicy: { stages: Array.from({ length: 20 }, (_, index) => ({ index, kind: "review", notes: "y".repeat(400) })) },
        executionState: { history: Array.from({ length: 20 }, (_, index) => ({ index, body: "z".repeat(400) })) },
        executionWorkspaceSettings: { notes: "w".repeat(2_000) },
      },
      {
        id: exactPreviewId, spaceId, title: "Exact preview issue",
        description: "x".repeat(1200), status: "todo", priority: "medium",
      },
      {
        id: nullDescriptionId, spaceId, title: "Null description issue",
        description: null, status: "todo", priority: "medium",
      },
      {
        id: multibyteBoundaryId, spaceId, title: "Multibyte boundary issue",
        description: `${"x".repeat(1199)}— still valid after truncation`,
        status: "todo", priority: "medium",
      },
    ]);

    const byId = new Map((await svc.list(spaceId) as IssueListRow[]).map((issue) => [issue.id, issue]));
    const result = byId.get(issueId);

    expect(result).toBeTruthy();
    expect(result?.description).toHaveLength(1200);
    expect(result?.descriptionTruncated).toBe(true);
    expect(result?.executionPolicy).toBeNull();
    expect(result?.executionState).toBeNull();
    expect(result?.executionWorkspaceSettings).toBeNull();

    expect(byId.get(exactPreviewId)?.description).toHaveLength(1200);
    expect(byId.get(exactPreviewId)?.descriptionTruncated).toBe(false);
    expect(byId.get(nullDescriptionId)?.description).toBeNull();
    expect(byId.get(nullDescriptionId)?.descriptionTruncated).toBe(false);
    expect(byId.get(multibyteBoundaryId)?.description).toHaveLength(1200);
    expect(byId.get(multibyteBoundaryId)?.description?.endsWith("—")).toBe(true);
    expect(byId.get(multibyteBoundaryId)?.descriptionTruncated).toBe(true);
  });
});

describeEmbeddedPostgres("issueService.findOpenAncestorCreatedByAgent", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-ancestor-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedChain() {
    const spaceId = randomUUID();
    const delegatorId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Chain Co",
      issuePrefix: `C${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: delegatorId,
      spaceId,
      name: "Delegator",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const rootId = randomUUID();
    const midId = randomUUID();
    await db.insert(issues).values([
      {
        id: rootId,
        spaceId,
        title: "Root task",
        status: "in_progress",
        priority: "medium",
        issueNumber: 1,
        identifier: "CHAIN-1",
      },
      {
        id: midId,
        spaceId,
        title: "Delegated review",
        status: "in_progress",
        priority: "medium",
        parentId: rootId,
        createdByAgentId: delegatorId,
        issueNumber: 2,
        identifier: "CHAIN-2",
      },
    ]);
    return { spaceId, delegatorId, rootId, midId };
  }

  it("finds an open ancestor created by the agent, at any depth", async () => {
    const { delegatorId, midId } = await seedChain();

    const direct = await svc.findOpenAncestorCreatedByAgent(midId, delegatorId);
    expect(direct?.id).toBe(midId);

    const other = await svc.findOpenAncestorCreatedByAgent(midId, randomUUID());
    expect(other).toBeNull();
  });

  it("ignores closed ancestors created by the agent", async () => {
    const { delegatorId, midId } = await seedChain();
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, midId));

    expect(await svc.findOpenAncestorCreatedByAgent(midId, delegatorId)).toBeNull();
  });

  it("finds the ancestor through an arbitrarily deep chain", async () => {
    const { spaceId, delegatorId, midId } = await seedChain();
    // Extend the chain 60 levels below the delegator-created ancestor so the
    // match sits far above the new child's parent.
    let parentId = midId;
    const descendants: (typeof issues.$inferInsert)[] = [];
    for (let index = 0; index < 60; index += 1) {
      const childId = randomUUID();
      descendants.push({
        id: childId,
        spaceId,
        title: `Deep child ${index}`,
        status: "in_progress",
        priority: "medium",
        parentId,
        issueNumber: index + 10,
        identifier: `CHAIN-${index + 10}`,
      });
      parentId = childId;
    }

    await db.insert(issues).values(descendants);

    const found = await svc.findOpenAncestorCreatedByAgent(parentId, delegatorId);
    expect(found?.id).toBe(midId);
  });

  it("terminates on a corrupted parent-graph cycle", async () => {
    const { delegatorId, rootId, midId } = await seedChain();
    // Corrupt the graph: root's parent points back at mid.
    await db.update(issues).set({ parentId: midId }).where(eq(issues.id, rootId));

    const found = await svc.findOpenAncestorCreatedByAgent(midId, delegatorId);
    expect(found?.id).toBe(midId);
    expect(await svc.findOpenAncestorCreatedByAgent(midId, randomUUID())).toBeNull();
  });
});

describeEmbeddedPostgres("issueService.create workspace inheritance", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-create-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(environments);
    await db.delete(instanceSettings);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("gives a child its own workspace and keeps only the parent's strategy when child workspace fields are omitted", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
      sharedWorkspaceKey: "workspace-key",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
      providerRef: `/tmp/${executionWorkspaceId}`,
    });

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        workspaceRuntime: { profile: "agent" },
      },
    });

    const child = await svc.create(spaceId, {
      parentId: parentIssueId,
      projectId,
      title: "Child issue",
    });

    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(child.executionWorkspaceId).toBeNull();
    expect(child.executionWorkspacePreference).toBeNull();
    expect(child.executionWorkspaceSettings).toEqual({
      mode: "isolated_workspace",
      workspaceRuntime: { profile: "agent" },
    });
  });

  it("inherits responsible user for agent-created child issues", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const responsibleUserId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Coder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const parent = await svc.create(spaceId, {
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      createdByUserId: responsibleUserId,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      responsibleUserId,
      contextSnapshot: { issueId: parent.id },
    });

    const child = await svc.create(spaceId, {
      parentId: parent.id,
      title: "Agent-created child",
      createdByAgentId: agentId,
      actorRunId: runId,
    });

    expect(parent.responsibleUserId).toBe(responsibleUserId);
    expect(child.responsibleUserId).toBe(responsibleUserId);
  });

  it("creates children under a private issue in the same private subtree", async () => {
    const spaceId = randomUUID();
    const parentIssueId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Private subtree space",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      title: "Private root",
      visibility: "private",
      privacyRootIssueId: parentIssueId,
    });

    const child = await svc.create(spaceId, {
      parentId: parentIssueId,
      title: "Inherited private child",
      visibility: "open",
    });

    expect(child.visibility).toBe("private");
    expect(child.privacyRootIssueId).toBe(parentIssueId);
  });

  it("creates one personal private project and parks private tasks there", async () => {
    const spaceId = randomUUID();
    const responsibleUserId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Personal private tasks space",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });

    const [first, second] = await Promise.all([
      svc.create(spaceId, {
        title: "First personal private task",
        visibility: "private",
        createdByUserId: responsibleUserId,
      }),
      svc.create(spaceId, {
        title: "Second personal private task",
        visibility: "private",
        createdByUserId: responsibleUserId,
      }),
    ]);

    const personalProjects = await db.select().from(projects)
      .where(eq(projects.personalOwnerUserId, responsibleUserId));
    expect(personalProjects).toHaveLength(1);
    expect(personalProjects[0]).toMatchObject({
      spaceId,
      name: "My private tasks",
      visibility: "private",
    });
    expect(first.projectId).toBe(personalProjects[0]!.id);
    expect(second.projectId).toBe(personalProjects[0]!.id);
    expect(first.privacyRootIssueId).toBe(first.id);
    expect(second.privacyRootIssueId).toBe(second.id);
    await expect(db.select().from(projectAccessMembers)
      .where(eq(projectAccessMembers.projectId, personalProjects[0]!.id)))
      .resolves.toEqual([
        expect.objectContaining({ subjectType: "user", subjectId: responsibleUserId }),
      ]);
  });

  it("keeps a responsible human and grants an agent access to its explicitly private task", async () => {
    const spaceId = randomUUID();
    const responsibleUserId = randomUUID();
    const creatorAgentId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Agent private task space",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(agents).values({
      id: creatorAgentId,
      spaceId,
      name: "Private task creator",
      role: "engineer",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const issue = await svc.create(spaceId, {
      title: "Agent email scratch task",
      visibility: "private",
      createdByAgentId: creatorAgentId,
      actorResponsibleUserId: responsibleUserId,
    });

    expect(issue.responsibleUserId).toBe(responsibleUserId);
    const personalProject = await db.select().from(projects)
      .where(eq(projects.id, issue.projectId!))
      .then((rows) => rows[0]!);
    expect(personalProject.personalOwnerUserId).toBe(responsibleUserId);
    await expect(db.select().from(projectAccessMembers)
      .where(eq(projectAccessMembers.projectId, personalProject.id)))
      .resolves.toEqual([
        expect.objectContaining({ subjectType: "user", subjectId: responsibleUserId }),
      ]);
    await expect(db.select().from(issueAccessGrants)
      .where(eq(issueAccessGrants.issueId, issue.id)))
      .resolves.toEqual([
        expect.objectContaining({
          subjectType: "agent",
          subjectId: creatorAgentId,
          source: "explicit",
        }),
      ]);
  });

  it("only honors explicit responsibleUserId for trusted issue create callers", async () => {
    const spaceId = randomUUID();
    const creatorUserId = randomUUID();
    const requestedResponsibleUserId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const untrusted = await svc.create(spaceId, {
      title: "Untrusted explicit responsible user",
      createdByUserId: creatorUserId,
      responsibleUserId: requestedResponsibleUserId,
    });
    const trusted = await svc.create(spaceId, {
      title: "Trusted explicit responsible user",
      createdByUserId: creatorUserId,
      responsibleUserId: requestedResponsibleUserId,
      trustExplicitResponsibleUserId: true,
    });

    expect(untrusted.responsibleUserId).toBe(creatorUserId);
    expect(trusted.responsibleUserId).toBe(requestedResponsibleUserId);
  });

  it("derives responsible user from authenticated actor context without trusting issue body", async () => {
    const spaceId = randomUUID();
    const actorResponsibleUserId = randomUUID();
    const requestedResponsibleUserId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const issue = await svc.create(spaceId, {
      title: "Actor-context responsible user",
      responsibleUserId: requestedResponsibleUserId,
      actorResponsibleUserId,
    });

    expect(issue.responsibleUserId).toBe(actorResponsibleUserId);
  });

  it("does not stamp the assignee default environment onto new issues", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const assigneeEnvironmentId = randomUUID();
    const assigneeAgentId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      {
        id: assigneeEnvironmentId,
        name: "QA E2B",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
    ]);

    await db.insert(agents).values({
      id: assigneeAgentId,
      spaceId,
      name: "QA E2B Codex",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      defaultEnvironmentId: assigneeEnvironmentId,
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Workspace project",
      status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    const issue = await svc.create(spaceId, {
      projectId,
      assigneeAgentId,
      title: "Environment matrix: e2b / codex_local",
      status: "todo",
      priority: "medium",
    });

    expect(issue.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });
  });

  it("ignores legacy project environment selection when creating new issues", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const projectEnvironmentId = randomUUID();
    const assigneeEnvironmentId = randomUUID();
    const assigneeAgentId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      {
        id: projectEnvironmentId,
        name: "QA SSH",
        driver: "ssh",
        status: "active",
        config: {},
      },
      {
        id: assigneeEnvironmentId,
        name: "QA E2B",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
    ]);

    await db.insert(agents).values({
      id: assigneeAgentId,
      spaceId,
      name: "QA E2B Codex",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      defaultEnvironmentId: assigneeEnvironmentId,
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Workspace project",
      status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
        environmentId: projectEnvironmentId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    const issue = await svc.create(spaceId, {
      projectId,
      assigneeAgentId,
      title: "Environment matrix: e2b / codex_local",
      status: "todo",
      priority: "medium",
    });

    expect(issue.executionWorkspaceSettings).toEqual({ mode: "shared_workspace" });
  });

  it("does not rewrite execution workspace settings on reassignment", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const firstEnvironmentId = randomUUID();
    const secondEnvironmentId = randomUUID();
    const firstAgentId = randomUUID();
    const secondAgentId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      {
        id: firstEnvironmentId,
        name: "QA SSH",
        driver: "ssh",
        status: "active",
        config: {},
      },
      {
        id: secondEnvironmentId,
        name: "QA E2B",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
    ]);

    await db.insert(agents).values([
      {
        id: firstAgentId,
        spaceId,
        name: "QA SSH Codex",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        defaultEnvironmentId: firstEnvironmentId,
        permissions: {},
      },
      {
        id: secondAgentId,
        spaceId,
        name: "QA E2B Codex",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        defaultEnvironmentId: secondEnvironmentId,
        permissions: {},
      },
    ]);

    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Workspace project",
      status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    const created = await svc.create(spaceId, {
      projectId,
      assigneeAgentId: firstAgentId,
      title: "Environment matrix: ssh / codex_local",
      status: "todo",
      priority: "medium",
    });

    expect(created.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });

    const reassigned = await svc.update(created.id, {
      assigneeAgentId: secondAgentId,
    });

    expect(reassigned).not.toBeNull();
    expect(reassigned!.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });
  });

  it("strips legacy environmentId values from execution workspace settings updates", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const firstEnvironmentId = randomUUID();
    const secondEnvironmentId = randomUUID();
    const operatorEnvironmentId = randomUUID();
    const firstAgentId = randomUUID();
    const secondAgentId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      { id: firstEnvironmentId, name: "Env 1", driver: "ssh", status: "active", config: {} },
      { id: secondEnvironmentId, name: "Env 2", driver: "sandbox", status: "active", config: { provider: "e2b" } },
      { id: operatorEnvironmentId, name: "Operator pick", driver: "ssh", status: "active", config: {} },
    ]);

    await db.insert(agents).values([
      {
        id: firstAgentId, spaceId, name: "First agent", role: "engineer", status: "active",
        adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {},
        defaultEnvironmentId: firstEnvironmentId, permissions: {},
      },
      {
        id: secondAgentId, spaceId, name: "Second agent", role: "engineer", status: "active",
        adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {},
        defaultEnvironmentId: secondEnvironmentId, permissions: {},
      },
    ]);

    await db.insert(projects).values({
      id: projectId, spaceId, name: "Workspace project", status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId, spaceId, projectId, name: "Primary workspace", isPrimary: true,
    });

    const created = await svc.create(spaceId, {
      projectId,
      assigneeAgentId: firstAgentId,
      title: "Operator overrides env then reassigns",
      status: "todo",
      priority: "medium",
    });

    const overridden = await svc.update(created.id, {
      executionWorkspaceSettings: {
        mode: "shared_workspace",
        environmentId: operatorEnvironmentId,
      },
    });
    expect(overridden!.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });

    const reassigned = await svc.update(created.id, {
      assigneeAgentId: secondAgentId,
    });
    expect(reassigned!.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });
  });

  it("keeps explicit workspace fields instead of inheriting the parent linkage", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const parentProjectWorkspaceId = randomUUID();
    const parentExecutionWorkspaceId = randomUUID();
    const explicitProjectWorkspaceId = randomUUID();
    const explicitExecutionWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values([
      {
        id: parentProjectWorkspaceId,
        spaceId,
        projectId,
        name: "Parent workspace",
      },
      {
        id: explicitProjectWorkspaceId,
        spaceId,
        projectId,
        name: "Explicit workspace",
      },
    ]);

    await db.insert(executionWorkspaces).values([
      {
        id: parentExecutionWorkspaceId,
        spaceId,
        projectId,
        projectWorkspaceId: parentProjectWorkspaceId,
        mode: "isolated_workspace",
        strategyType: "git_worktree",
        name: "Parent worktree",
        status: "active",
        providerType: "git_worktree",
      },
      {
        id: explicitExecutionWorkspaceId,
        spaceId,
        projectId,
        projectWorkspaceId: explicitProjectWorkspaceId,
        mode: "shared_workspace",
        strategyType: "project_primary",
        name: "Explicit shared workspace",
        status: "active",
        providerType: "local_fs",
      },
    ]);

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId,
      projectWorkspaceId: parentProjectWorkspaceId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId: parentExecutionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
      },
    });

    const child = await svc.create(spaceId, {
      parentId: parentIssueId,
      projectId,
      title: "Child issue",
      projectWorkspaceId: explicitProjectWorkspaceId,
      executionWorkspaceId: explicitExecutionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "shared_workspace",
      },
    });

    expect(child.projectWorkspaceId).toBe(explicitProjectWorkspaceId);
    expect(child.executionWorkspaceId).toBe(explicitExecutionWorkspaceId);
    expect(child.executionWorkspacePreference).toBe("reuse_existing");
    expect(child.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });
  });

  it("inherits project and strategy, not the realized workspace, from an explicit source issue without creating a parent-child relationship", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const sourceIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "operator_branch",
      strategyType: "git_worktree",
      name: "Operator branch",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values({
      id: sourceIssueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Source issue",
      status: "todo",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "operator_branch",
      },
    });

    const followUp = await svc.create(spaceId, {
      projectId,
      title: "Follow-up issue",
      inheritExecutionWorkspaceFromIssueId: sourceIssueId,
    });

    expect(followUp.parentId).toBeNull();
    expect(followUp.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(followUp.executionWorkspaceId).toBeNull();
    expect(followUp.executionWorkspacePreference).toBeNull();
    expect(JSON.stringify(followUp.executionWorkspaceSettings ?? {})).not.toContain("operator_branch");
  });

  it("createChild applies parent defaults, acceptance criteria, an independent workspace, and optional parent blocker chaining", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const goalId = randomUUID();
    const parentIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(goals).values({
      id: goalId,
      spaceId,
      title: "Ship child helpers",
      level: "task",
      status: "active",
    });

    await db.insert(projects).values({
      id: projectId,
      spaceId,
      goalId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
      providerRef: `/tmp/${executionWorkspaceId}`,
    });

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: 1,
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
      },
    });

    const { issue: child, parentBlockerAdded } = await svc.createChild(parentIssueId, {
      title: "Child helper",
      status: "todo",
      description: "Implement the helper.",
      acceptanceCriteria: ["Uses the parent issue as parentId", "Reuses the parent execution workspace"],
      blockParentUntilDone: true,
    });

    expect(parentBlockerAdded).toBe(true);
    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectId).toBe(projectId);
    expect(child.goalId).toBe(goalId);
    expect(child.requestDepth).toBe(2);
    expect(child.description).toContain("## Acceptance Criteria");
    expect(child.description).toContain("- Uses the parent issue as parentId");
    expect(child.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(child.executionWorkspaceId).toBeNull();
    expect(child.executionWorkspacePreference).toBeNull();

    const parentRelations = await svc.getRelationSummaries(parentIssueId);
    expect(parentRelations.blockedBy).toEqual([
      expect.objectContaining({
        id: child.id,
        title: "Child helper",
      }),
    ]);
  });

  it("createChild preserves strategy-only workspace intent without realizing the parent workspace", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const environmentId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Accepted plan parent",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        environmentId,
        workspaceStrategy: {
          type: "git_worktree",
          baseRef: "origin/master",
          branchTemplate: "{{issue.identifier}}-{{slug}}",
        },
      },
    });

    const { issue: child } = await svc.createChild(parentIssueId, {
      title: "Accepted plan child",
      status: "todo",
      priority: "medium",
      executionWorkspaceInheritanceMode: "strategy_only",
    });

    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectId).toBe(projectId);
    expect(child.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(child.executionWorkspaceId).toBeNull();
    expect(child.executionWorkspacePreference).toBeNull();
    expect(child.executionWorkspaceSettings).toEqual({
      mode: "isolated_workspace",
      environmentId,
      workspaceStrategy: {
        type: "git_worktree",
        baseRef: "origin/master",
        branchTemplate: "{{issue.identifier}}-{{slug}}",
      },
    });
  });

  it("createChild targeting another project does not forward the parent project workspace", async () => {
    const spaceId = randomUUID();
    const parentProjectId = randomUUID();
    const targetProjectId = randomUUID();
    const parentIssueId = randomUUID();
    const parentProjectWorkspaceId = randomUUID();
    const targetProjectWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values([
      { id: parentProjectId, spaceId, name: "Outpost App", status: "in_progress" },
      { id: targetProjectId, spaceId, name: "Outpost ID", status: "in_progress" },
    ]);

    await db.insert(projectWorkspaces).values([
      {
        id: parentProjectWorkspaceId,
        spaceId,
        projectId: parentProjectId,
        name: "outpost",
        isPrimary: true,
      },
      {
        id: targetProjectWorkspaceId,
        spaceId,
        projectId: targetProjectId,
        name: "outpost-id",
        isPrimary: true,
      },
    ]);

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId: parentProjectId,
      projectWorkspaceId: parentProjectWorkspaceId,
      title: "Google Workspace MCP",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        workspaceStrategy: { type: "git_worktree", baseRef: "origin/master" },
      },
    });

    const { issue: child } = await svc.createChild(parentIssueId, {
      title: "Implement the Outpost ID connect broker",
      status: "todo",
      priority: "medium",
      projectId: targetProjectId,
      executionWorkspaceInheritanceMode: "strategy_only",
    });

    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectId).toBe(targetProjectId);
    expect(child.projectWorkspaceId).toBe(targetProjectWorkspaceId);
  });

  it("clamps helper-created child requestDepth to the safe maximum", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const goalId = randomUUID();
    const parentIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      spaceId,
      title: "Ship child helpers",
      level: "task",
      status: "active",
    });

    await db.insert(projects).values({
      id: projectId,
      spaceId,
      goalId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: MAX_ISSUE_REQUEST_DEPTH,
    });

    const { issue: child } = await svc.createChild(parentIssueId, {
      title: "Child helper",
      status: "todo",
      requestDepth: MAX_ISSUE_REQUEST_DEPTH + 100,
    });

    expect(child.requestDepth).toBe(MAX_ISSUE_REQUEST_DEPTH);
  });

  it("counts only non-terminal children toward the helper child limit", async () => {
    const spaceId = randomUUID();
    const parentIssueId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      title: "Recurring coordinator",
      status: "in_progress",
      priority: "high",
    });

    const terminalChildren = Array.from(
      { length: MAX_CHILD_ISSUES_CREATED_BY_HELPER },
      (_, index) => ({
        id: randomUUID(),
        spaceId,
        parentId: parentIssueId,
        title: `Terminal child ${index + 1}`,
        status: index % 2 === 0 ? "done" as const : "cancelled" as const,
        priority: "medium" as const,
      }),
    );
    const activeChildren = Array.from(
      { length: MAX_CHILD_ISSUES_CREATED_BY_HELPER - 1 },
      (_, index) => ({
        id: randomUUID(),
        spaceId,
        parentId: parentIssueId,
        title: `Active child ${index + 1}`,
        status: "todo" as const,
        priority: "medium" as const,
      }),
    );
    await db.insert(issues).values([...terminalChildren, ...activeChildren]);

    const { issue: finalActiveChild } = await svc.createChild(parentIssueId, {
      title: "Final active child",
      status: "todo",
    });

    expect(finalActiveChild.parentId).toBe(parentIssueId);
    await expect(svc.createChild(parentIssueId, {
      title: "Over active limit",
      status: "todo",
    })).rejects.toThrow(
      `Parent issue already has the maximum ${MAX_CHILD_ISSUES_CREATED_BY_HELPER} active child issues for this helper`,
    );
  });
});

const dependencyTestDatabaseUrl = resolveExternalTestDatabaseUrl("OUTPOST_ISSUE_DEPENDENCIES_TEST_DATABASE_URL");
(dependencyTestDatabaseUrl ? describe : describeEmbeddedPostgres)("issueService blockers and dependency wake readiness", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (!dependencyTestDatabaseUrl) tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-blockers-");
    db = createDb(dependencyTestDatabaseUrl ?? tempDb!.connectionString, { maxConnections: 6 });
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(workspaceOperations);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
    await tempDb?.cleanup();
  });

  async function seedSharedWorkspaceDependency() {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const blockerId = randomUUID();
    const dependentId = randomUUID();
    const foreignIssueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await db.insert(agents).values({
      id: assigneeAgentId,
      spaceId,
      name: "QA",
      role: "qa",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Shared workspace project",
      status: "in_progress",
    });
    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Shared workspace",
      sourceType: "local_path",
      visibility: "default",
      isPrimary: true,
    });
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Shared exec workspace",
      status: "active",
      providerType: "git_worktree",
    });
    await db.insert(issues).values([
      {
        id: blockerId,
        spaceId,
        projectId,
        identifier: "PAP-15043",
        title: "Predecessor",
        status: "done",
        priority: "medium",
        executionWorkspaceId,
      },
      {
        id: dependentId,
        spaceId,
        projectId,
        identifier: "PAP-15046",
        title: "Dependent",
        status: "blocked",
        priority: "medium",
        assigneeAgentId,
      },
      {
        id: foreignIssueId,
        spaceId,
        projectId,
        identifier: "PAP-15125",
        title: "Foreign in-flight issue",
        status: "in_progress",
        priority: "medium",
        executionWorkspaceId,
      },
    ]);
    await svc.update(dependentId, { blockedByIssueIds: [blockerId] });

    return {
      spaceId,
      assigneeAgentId,
      projectId,
      projectWorkspaceId,
      executionWorkspaceId,
      blockerId,
      dependentId,
      foreignIssueId,
    };
  }

  it("returns authoritative update receipts for row fields and blocker relations", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const blockerId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await db.insert(issues).values([
      {
        id: issueId,
        spaceId,
        title: "Receipt issue",
        description: "old description",
        status: "todo",
        priority: "medium",
      },
      {
        id: blockerId,
        spaceId,
        title: "Blocker",
        status: "todo",
        priority: "high",
      },
    ]);

    const fieldUpdate = await svc.update(issueId, {
      title: "Receipt issue",
      priority: "high",
      description: "new description",
    });
    expect(fieldUpdate?.changes).toEqual({
      priority: { from: "medium", to: "high" },
      description: { from: "old description", to: "new description", updated: true },
    });

    const blockersSet = await svc.update(issueId, { blockedByIssueIds: [blockerId, blockerId] });
    expect(blockersSet?.blockedByIssueIds).toEqual([blockerId]);
    expect(blockersSet?.changes.blockedByIssueIds).toEqual({ from: [], to: [blockerId] });

    const blockersCleared = await svc.update(issueId, { blockedByIssueIds: [] });
    expect(blockersCleared?.blockedByIssueIds).toEqual([]);
    expect(blockersCleared?.changes.blockedByIssueIds).toEqual({ from: [blockerId], to: [] });

    await db.update(issues).set({
      title: "Concurrent receipt issue",
      priority: "medium",
    }).where(eq(issues.id, issueId));
    const [titleUpdate, priorityUpdate] = await Promise.all([
      svc.update(issueId, { title: "Concurrent title" }),
      svc.update(issueId, { priority: "high" }),
    ]);
    expect(titleUpdate?.changes).toEqual({
      title: { from: "Concurrent receipt issue", to: "Concurrent title" },
    });
    expect(priorityUpdate?.changes).toEqual({
      priority: { from: "medium", to: "high" },
    });
  });

  it("persists blocked-by relations and exposes both blockedBy and blocks summaries", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const blockerId = randomUUID();
    const blockedId = randomUUID();
    await db.insert(issues).values([
      {
        id: blockerId,
        spaceId,
        title: "Blocker",
        status: "todo",
        priority: "high",
      },
      {
        id: blockedId,
        spaceId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
      },
    ]);

    await svc.update(blockedId, {
      blockedByIssueIds: [blockerId],
    });

    const blockerRelations = await svc.getRelationSummaries(blockerId);
    const blockedRelations = await svc.getRelationSummaries(blockedId);

    expect(blockerRelations.blocks.map((relation) => relation.id)).toEqual([blockedId]);
    expect(blockedRelations.blockedBy.map((relation) => relation.id)).toEqual([blockerId]);
  });

  it("returns blocked-by summaries on newly created issues", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const blockerId = randomUUID();
    await db.insert(issues).values({
      id: blockerId,
      spaceId,
      title: "Blocker",
      status: "todo",
      priority: "high",
    });

    const created = await svc.create(spaceId, {
      title: "Blocked issue",
      status: "blocked",
      priority: "medium",
      blockedByIssueIds: [blockerId],
    });

    expect(created.blockedBy.map((relation) => relation.id)).toEqual([blockerId]);
    expect(created.blockedBy[0]).toEqual(expect.objectContaining({
      title: "Blocker",
      status: "todo",
      priority: "high",
    }));
    expect(created.blocks).toEqual([]);
  });

  it("returns blocked-by summaries on newly created child issues", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const parentId = randomUUID();
    const blockerId = randomUUID();
    await db.insert(issues).values([
      {
        id: parentId,
        spaceId,
        title: "Parent",
        status: "todo",
        priority: "medium",
      },
      {
        id: blockerId,
        spaceId,
        title: "Blocker",
        status: "todo",
        priority: "high",
      },
    ]);

    const { issue: child } = await svc.createChild(parentId, {
      title: "Blocked child issue",
      status: "blocked",
      priority: "medium",
      blockedByIssueIds: [blockerId],
    });

    expect(child.parentId).toBe(parentId);
    expect(child.blockedBy.map((relation) => relation.id)).toEqual([blockerId]);
    expect(child.blocks).toEqual([]);
  });

  it("returns blocks summaries when child creation blocks the parent", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const parentId = randomUUID();
    await db.insert(issues).values({
      id: parentId,
      spaceId,
      title: "Parent",
      status: "todo",
      priority: "medium",
    });

    const { issue: child } = await svc.createChild(parentId, {
      title: "Parent-blocking child",
      status: "todo",
      priority: "medium",
      blockParentUntilDone: true,
    });

    expect(child.blocks.map((relation) => relation.id)).toEqual([parentId]);
    expect(child.blocks[0]).toEqual(expect.objectContaining({
      title: "Parent",
      status: "todo",
      priority: "medium",
    }));
    expect(child.blockedBy).toEqual([]);
  });

  it("adds terminal blockers to immediate blocked-by summaries", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const issueA = randomUUID();
    const issueB = randomUUID();
    const issueC = randomUUID();
    const issueD = randomUUID();
    await db.insert(issues).values([
      { id: issueA, spaceId, identifier: "PAP-1", title: "Issue A", status: "blocked", priority: "medium" },
      { id: issueB, spaceId, identifier: "PAP-2", title: "Issue B", status: "blocked", priority: "medium" },
      { id: issueC, spaceId, identifier: "PAP-3", title: "Issue C", status: "blocked", priority: "medium" },
      { id: issueD, spaceId, identifier: "PAP-4", title: "Issue D", status: "todo", priority: "high" },
    ]);

    await svc.update(issueC, { blockedByIssueIds: [issueD] });
    await svc.update(issueB, { blockedByIssueIds: [issueC] });
    await svc.update(issueA, { blockedByIssueIds: [issueB] });

    const relations = await svc.getRelationSummaries(issueA);

    expect(relations.blockedBy).toHaveLength(1);
    expect(relations.blockedBy[0]).toMatchObject({
      id: issueB,
      identifier: "PAP-2",
      title: "Issue B",
      terminalBlockers: [
        expect.objectContaining({
          id: issueD,
          identifier: "PAP-4",
          title: "Issue D",
          status: "todo",
          priority: "high",
        }),
      ],
    });
  });

  it("rejects blocking cycles", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const issueA = randomUUID();
    const issueB = randomUUID();
    await db.insert(issues).values([
      { id: issueA, spaceId, title: "Issue A", status: "todo", priority: "medium" },
      { id: issueB, spaceId, title: "Issue B", status: "todo", priority: "medium" },
    ]);

    await svc.update(issueA, { blockedByIssueIds: [issueB] });

    await expect(
      svc.update(issueB, { blockedByIssueIds: [issueA] }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("names the existing order in a blocking-cycle denial and keeps it", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const website = randomUUID();
    const design = randomUUID();
    const copy = randomUUID();
    await db.insert(issues).values([
      { id: website, spaceId, identifier: "COM-1", title: "Website", status: "backlog", priority: "medium" },
      { id: design, spaceId, identifier: "COM-2", title: "Design", status: "backlog", priority: "medium" },
      // The intermediate issue's title must not appear: the caller may not be able to read it.
      { id: copy, spaceId, identifier: "COM-3", title: "Private launch copy", status: "backlog", priority: "medium" },
    ]);
    await svc.update(design, { blockedByIssueIds: [website] });

    const direct = await svc
      .update(website, { blockedByIssueIds: [design] })
      .catch((error: unknown) => error);
    expect(direct).toMatchObject({
      status: 422,
      message:
        "Blocking relations cannot contain cycles: COM-2 waits for COM-1, so COM-1 cannot also wait for COM-2. " +
        "No dependencies were changed and the existing ones are kept. " +
        "Do not remove or reverse an existing dependency to make this fit; ask whoever requested the change which order they want and change dependencies only after they choose.",
      details: {
        code: "blocking_cycle",
        issueId: website,
        requestedBlockerIssueId: design,
        existingChain: [
          { id: website, identifier: "COM-1" },
          { id: design, identifier: "COM-2" },
        ],
      },
    });

    await svc.update(copy, { blockedByIssueIds: [design] });
    const transitive = await svc
      .update(website, { blockedByIssueIds: [copy] })
      .catch((error: unknown) => error);
    expect((transitive as Error).message).toContain(
      "COM-2 waits for COM-1, and COM-3 waits for COM-2, so COM-1 cannot also wait for COM-3.",
    );
    expect(JSON.stringify({ message: (transitive as Error).message, details: (transitive as { details?: unknown }).details }))
      .not.toMatch(/Website|Design|Private launch copy/);

    expect((await svc.getRelationSummaries(design)).blockedBy.map((relation) => relation.id)).toEqual([website]);
    expect((await svc.getRelationSummaries(website)).blockedBy).toEqual([]);
  });

  it("only returns dependents once every blocker is done", async () => {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, assigneeAgentId);

    const blockerA = randomUUID();
    const blockerB = randomUUID();
    const blockedIssueId = randomUUID();
    await db.insert(issues).values([
      { id: blockerA, spaceId, title: "Blocker A", status: "done", priority: "medium", executionWorkspaceId: null },
      { id: blockerB, spaceId, title: "Blocker B", status: "todo", priority: "medium", executionWorkspaceId: null },
      {
        id: blockedIssueId,
        spaceId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
        assigneeAgentId,
      },
    ]);

    await svc.update(blockedIssueId, { blockedByIssueIds: [blockerA, blockerB] });

    expect(await svc.listWakeableBlockedDependents(blockerA)).toEqual([]);

    await svc.update(blockerB, { status: "done" });

    const wakeable = await svc.listWakeableBlockedDependents(blockerA);
    expect(wakeable).toEqual([
      expect.objectContaining({
        id: blockedIssueId,
        assigneeAgentId,
        blockerIssueIds: expect.arrayContaining([blockerA, blockerB]),
      }),
    ]);
    expect(wakeable[0]?.blockerIssueIds).toHaveLength(2);
  });

  it("treats done blockers on a shared workspace as ready while a foreign issue is in-flight", async () => {
    const {
      spaceId,
      executionWorkspaceId,
      blockerId,
      dependentId,
      foreignIssueId,
    } = await seedSharedWorkspaceDependency();

    await db.insert(workspaceOperations).values({
      spaceId,
      executionWorkspaceId,
      issueId: foreignIssueId,
      phase: "worktree_prepare",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:00:00.000Z"),
    });

    await expect(svc.listWakeableBlockedDependents(blockerId)).resolves.toEqual([
      expect.objectContaining({
        id: dependentId,
        blockerIssueIds: [blockerId],
      }),
    ]);
    await expect(svc.getDependencyReadiness(dependentId)).resolves.toMatchObject({
      isDependencyReady: true,
      pendingFinalizeBlockerIssueIds: [],
      unresolvedBlockerIssueIds: [],
    });
  });

  it("keeps dependents blocked on unattributed workspace operations for the blocker workspace", async () => {
    const {
      spaceId,
      executionWorkspaceId,
      blockerId,
      dependentId,
    } = await seedSharedWorkspaceDependency();

    await db.insert(workspaceOperations).values({
      spaceId,
      executionWorkspaceId,
      issueId: null,
      phase: "worktree_prepare",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:00:00.000Z"),
    });

    await expect(svc.listWakeableBlockedDependents(blockerId)).resolves.toEqual([]);
    await expect(svc.getDependencyReadiness(dependentId)).resolves.toMatchObject({
      isDependencyReady: false,
      pendingFinalizeBlockerIssueIds: [blockerId],
      unresolvedBlockerIssueIds: [blockerId],
    });

    await db.insert(workspaceOperations).values({
      spaceId,
      executionWorkspaceId,
      issueId: null,
      phase: "workspace_finalize",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:05:00.000Z"),
    });

    await expect(svc.listWakeableBlockedDependents(blockerId)).resolves.toEqual([
      expect.objectContaining({
        id: dependentId,
        blockerIssueIds: [blockerId],
      }),
    ]);
    await expect(svc.getDependencyReadiness(dependentId)).resolves.toMatchObject({
      isDependencyReady: true,
      pendingFinalizeBlockerIssueIds: [],
      unresolvedBlockerIssueIds: [],
    });
  });

  it("gates dependents on the blocker's own workspace-finalize barrier until sync-back succeeds", async () => {
    const {
      spaceId,
      executionWorkspaceId,
      blockerId,
      dependentId,
      foreignIssueId,
      assigneeAgentId,
    } = await seedSharedWorkspaceDependency();

    // The blocker touched its workspace but has not yet recorded
    // workspace_finalize — the dependent must NOT wake.
    await db.insert(workspaceOperations).values({
      spaceId,
      executionWorkspaceId,
      issueId: blockerId,
      phase: "worktree_prepare",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:00:00.000Z"),
    });

    expect(await svc.listWakeableBlockedDependents(blockerId)).toEqual([]);
    await expect(svc.getDependencyReadiness(dependentId)).resolves.toMatchObject({
      isDependencyReady: false,
      pendingFinalizeBlockerIssueIds: [blockerId],
      unresolvedBlockerIssueIds: [blockerId],
    });

    // A failed finalize must keep the gate closed.
    await db.insert(workspaceOperations).values({
      spaceId,
      executionWorkspaceId,
      issueId: blockerId,
      phase: "workspace_finalize",
      status: "failed",
      startedAt: new Date("2026-05-23T22:05:00.000Z"),
    });
    expect(await svc.listWakeableBlockedDependents(blockerId)).toEqual([]);
    const pendingDependent = (await svc.list(spaceId, { status: "blocked" }) as IssueListRow[])
      .find((issue) => issue.id === dependentId);
    expect(pendingDependent?.blockerAttention).toMatchObject({
      state: "needs_attention",
      unresolvedBlockerCount: 1,
      attentionBlockerCount: 1,
      pendingFinalizeBlockerIssueIds: [blockerId],
      sampleBlockerIdentifier: "PAP-15043",
    });
    await expect(
      svc.checkout(dependentId, assigneeAgentId, ["blocked"], null),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        unresolvedBlockerIssueIds: [blockerId],
        unresolvedBlockers: [{
          issueId: blockerId,
          identifier: "PAP-15043",
          title: "Predecessor",
          reason: "pending_finalize",
        }],
      },
    });

    // A later successful finalize on the same workspace, even when attributed
    // to another issue, proves the shared branch is coherent past the failure.
    await db.insert(workspaceOperations).values({
      spaceId,
      executionWorkspaceId,
      issueId: foreignIssueId,
      phase: "workspace_finalize",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:10:00.000Z"),
    });
    await db.insert(workspaceOperations).values({
      spaceId,
      executionWorkspaceId,
      issueId: null,
      phase: "worktree_prepare",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:15:00.000Z"),
    });

    await expect(svc.listWakeableBlockedDependents(blockerId)).resolves.toEqual([
      expect.objectContaining({
        id: dependentId,
        assigneeAgentId,
        blockerIssueIds: [blockerId],
      }),
    ]);
    await expect(svc.getDependencyReadiness(dependentId)).resolves.toMatchObject({
      isDependencyReady: true,
      pendingFinalizeBlockerIssueIds: [],
    });
  });

  it.each(["covered", "foreign-run", "unfinished", "failed-finalize", "late-finish", "later-operation"])(
    "requires a successful owning finalize to cover a nested snapshot: %s", async kind => {
      const f = await seedSharedWorkspaceDependency();
      const runId = randomUUID(), foreignRunId = randomUUID();
      await db.insert(heartbeatRuns).values([runId, foreignRunId].map(id => ({
        id, spaceId: f.spaceId, agentId: f.assigneeAgentId, status: "succeeded",
      })));
      const started = new Date("2026-05-23T22:00:00.000Z");
      const finished = new Date("2026-05-23T22:00:02.000Z");
      await db.insert(workspaceOperations).values([
        { spaceId: f.spaceId, executionWorkspaceId: f.executionWorkspaceId, issueId: f.blockerId,
          heartbeatRunId: runId, phase: "workspace_finalize",
          status: kind === "failed-finalize" ? "failed" : "succeeded", startedAt: started, finishedAt: finished },
        { spaceId: f.spaceId, executionWorkspaceId: f.executionWorkspaceId, issueId: f.blockerId,
          heartbeatRunId: kind === "foreign-run" ? foreignRunId : runId, phase: "remote_workspace_snapshot",
          status: kind === "unfinished" ? "running" : "succeeded",
          startedAt: new Date(started.getTime() + 100),
          finishedAt: kind === "unfinished" ? null : new Date(finished.getTime() + (kind === "late-finish" ? 100 : -100)) },
        ...(kind === "later-operation" ? [{
          spaceId: f.spaceId, executionWorkspaceId: f.executionWorkspaceId, issueId: f.blockerId,
          heartbeatRunId: runId, phase: "worktree_prepare", status: "succeeded",
          startedAt: new Date(finished.getTime() + 100), finishedAt: new Date(finished.getTime() + 200),
        }] : []),
      ]);
      const ready = kind === "covered";
      expect((await svc.listWakeableBlockedDependents(f.blockerId)).map(issue => issue.id))
        .toEqual(ready ? [f.dependentId] : []);
      await expect(svc.getDependencyReadiness(f.dependentId)).resolves.toMatchObject({
        isDependencyReady: ready,
        pendingFinalizeBlockerIssueIds: ready ? [] : [f.blockerId],
      });
      const listed = (await svc.list(f.spaceId, { status: "blocked" }) as IssueListRow[]).find(issue => issue.id === f.dependentId);
      expect(listed?.blockerAttention?.pendingFinalizeBlockerIssueIds ?? []).toEqual(ready ? [] : [f.blockerId]);
    },
  );

  it("reports dependency readiness for blocked issue chains", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const blockerId = randomUUID();
    const blockedId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, spaceId, title: "Blocker", status: "todo", priority: "medium" },
      { id: blockedId, spaceId, title: "Blocked", status: "todo", priority: "medium" },
    ]);
    await svc.update(blockedId, { blockedByIssueIds: [blockerId] });

    await expect(svc.getDependencyReadiness(blockedId)).resolves.toMatchObject({
      issueId: blockedId,
      blockerIssueIds: [blockerId],
      unresolvedBlockerIssueIds: [blockerId],
      unresolvedBlockerCount: 1,
      allBlockersDone: false,
      isDependencyReady: false,
    });

    await svc.update(blockerId, { status: "done" });

    await expect(svc.getDependencyReadiness(blockedId)).resolves.toMatchObject({
      issueId: blockedId,
      blockerIssueIds: [blockerId],
      unresolvedBlockerIssueIds: [],
      unresolvedBlockerCount: 0,
      allBlockersDone: true,
      isDependencyReady: true,
    });
  });

  it("unblocks a source issue when a liveness escalation recovery issue is marked done", async () => {
    const spaceId = randomUUID();
    await seedIssueSpace(db, spaceId);

    const sourceIssueId = randomUUID();
    const recoveryIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: sourceIssueId,
        spaceId,
        title: "Source issue",
        status: "blocked",
        priority: "medium",
      },
      {
        id: recoveryIssueId,
        spaceId,
        title: "Liveness escalation issue",
        status: "in_progress",
        priority: "high",
        originKind: "harness_liveness_escalation",
        originId: `harness_liveness:${spaceId}:${sourceIssueId}:invalid_review_participant:none`,
      },
    ]);

    await svc.update(sourceIssueId, {
      blockedByIssueIds: [recoveryIssueId],
    });
    await expect(svc.getRelationSummaries(sourceIssueId)).resolves.toMatchObject({
      blockedBy: [expect.objectContaining({ id: recoveryIssueId })],
    });

    await svc.update(recoveryIssueId, {
      status: "done",
    });

    await expect(svc.getRelationSummaries(sourceIssueId)).resolves.toMatchObject({
      blockedBy: [],
    });
  });

  it("rejects execution when unresolved blockers remain", async () => {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, assigneeAgentId);

    const blockerId = randomUUID();
    const blockedId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, spaceId, identifier: "PAP-1", title: "Blocker", status: "todo", priority: "medium" },
      {
        id: blockedId,
        spaceId,
        title: "Blocked",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
    ]);
    await svc.update(blockedId, { blockedByIssueIds: [blockerId] });

    await expect(
      svc.update(blockedId, { status: "in_progress" }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      svc.checkout(blockedId, assigneeAgentId, ["todo", "blocked"], null),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        unresolvedBlockerIssueIds: [blockerId],
        unresolvedBlockers: [{
          issueId: blockerId,
          identifier: "PAP-1",
          title: "Blocker",
          reason: "not_done",
        }],
      },
    });
  });

  it("wakes parents only when all direct children are terminal", async () => {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, assigneeAgentId);

    const parentId = randomUUID();
    const childA = randomUUID();
    const childB = randomUUID();
    await db.insert(issues).values([
      {
        id: parentId,
        spaceId,
        title: "Parent issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
      {
        id: childA,
        spaceId,
        parentId,
        title: "Child A",
        status: "done",
        priority: "medium",
        // Give the children distinct, ordered issue numbers. The service
        // sorts direct children by issueNumber, then createdAt. A batched
        // insert gives every row in the statement the same defaultNow()
        // createdAt, so without a distinct issueNumber the two children
        // tie on both sort keys and the database is free to return them
        // in either order.
        issueNumber: 1,
      },
      {
        id: childB,
        spaceId,
        parentId,
        title: "Child B",
        status: "blocked",
        priority: "medium",
        issueNumber: 2,
      },
    ]);

    expect(await svc.getWakeableParentAfterChildCompletion(parentId)).toBeNull();

    await svc.update(childB, { status: "cancelled" });

    expect(await svc.getWakeableParentAfterChildCompletion(parentId)).toMatchObject({
      id: parentId,
      assigneeAgentId,
      childIssueIds: [childA, childB],
      childIssueSummaries: [
        expect.objectContaining({ id: childA, title: "Child A", status: "done" }),
        expect.objectContaining({ id: childB, title: "Child B", status: "cancelled" }),
      ],
      childIssueSummaryTruncated: false,
    });
  });
});

describeEmbeddedPostgres("issueService.create workspace inheritance", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-create-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("preserves the parent project when a generic child create inherits workspace strategy", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
      },
    });

    const child = await svc.create(spaceId, {
      parentId: parentIssueId,
      title: "Generic child issue",
    });

    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectId).toBe(projectId);
    expect(child.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(child.executionWorkspaceId).toBeNull();
  });

  it("uses the target project's own workspaces for a cross-project child instead of inheriting the parent's", async () => {
    const spaceId = randomUUID();
    const parentProjectId = randomUUID();
    const targetProjectId = randomUUID();
    const parentIssueId = randomUUID();
    const parentProjectWorkspaceId = randomUUID();
    const targetProjectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values([
      { id: parentProjectId, spaceId, name: "Outpost App", status: "in_progress" },
      { id: targetProjectId, spaceId, name: "Outpost ID", status: "in_progress" },
    ]);

    await db.insert(projectWorkspaces).values([
      {
        id: parentProjectWorkspaceId,
        spaceId,
        projectId: parentProjectId,
        name: "outpost",
        isPrimary: true,
      },
      {
        id: targetProjectWorkspaceId,
        spaceId,
        projectId: targetProjectId,
        name: "outpost-id",
        isPrimary: true,
      },
    ]);

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId: parentProjectId,
      projectWorkspaceId: parentProjectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values({
      id: parentIssueId,
      spaceId,
      projectId: parentProjectId,
      projectWorkspaceId: parentProjectWorkspaceId,
      title: "Google Workspace MCP",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: { mode: "isolated_workspace" },
    });

    const child = await svc.create(spaceId, {
      parentId: parentIssueId,
      projectId: targetProjectId,
      title: "Implement the Outpost ID connect broker",
    });

    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectId).toBe(targetProjectId);
    expect(child.projectWorkspaceId).toBe(targetProjectWorkspaceId);
    expect(child.executionWorkspaceId).not.toBe(executionWorkspaceId);
  });

  it("rejects explicitly pinned isolated git worktrees without a project or reusable workspace", async () => {
    const spaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await expect(svc.create(spaceId, {
      title: "Projectless isolated worktree",
      status: "todo",
      priority: "medium",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        workspaceStrategy: { type: "git_worktree" },
      },
    })).rejects.toMatchObject({
      status: 422,
      message: WORKSPACE_WORKTREE_REQUIRES_PROJECT_MESSAGE,
      details: {
        code: WORKSPACE_WORKTREE_REQUIRES_PROJECT_CODE,
        remediation: WORKSPACE_WORKTREE_REQUIRES_PROJECT_REMEDIATION,
      },
    });
  });

  it("does not reject ambiguous inherited git-worktree settings before dispatch", async () => {
    const spaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    const issue = await svc.create(spaceId, {
      title: "Ambiguous inherited worktree",
      status: "todo",
      priority: "medium",
      executionWorkspaceSettings: {
        mode: "inherit",
        workspaceStrategy: { type: "git_worktree" },
      },
    });

    expect(issue.executionWorkspaceSettings).toEqual({
      mode: "inherit",
      workspaceStrategy: { type: "git_worktree" },
    });
  });

  it("inherits project and strategy, not the realized workspace, from an explicit source issue without creating a parent-child relationship", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const sourceIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "operator_branch",
      strategyType: "git_worktree",
      name: "Operator branch",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values({
      id: sourceIssueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Source issue",
      status: "todo",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "operator_branch",
      },
    });

    const followUp = await svc.create(spaceId, {
      title: "Follow-up issue",
      inheritExecutionWorkspaceFromIssueId: sourceIssueId,
    });

    expect(followUp.parentId).toBeNull();
    expect(followUp.projectId).toBe(projectId);
    expect(followUp.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(followUp.executionWorkspaceId).toBeNull();
    expect(followUp.executionWorkspacePreference).toBeNull();
    expect(JSON.stringify(followUp.executionWorkspaceSettings ?? {})).not.toContain("operator_branch");
  });

  it("preserves projectless organization when an update adds workspace linkage", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const issueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Projectless issue",
      status: "todo",
      priority: "medium",
    });

    const updated = await svc.update(issueId, {
      projectWorkspaceId,
    });

    expect(updated?.projectId).toBeNull();
    expect(updated?.projectWorkspaceId).toBe(projectWorkspaceId);
  });

  it("rejects updates that pin a projectless issue to an isolated git worktree", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Workspace Coder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const issue = await svc.create(spaceId, {
      title: "Assign then isolate",
      status: "todo",
      priority: "medium",
    });

    await expect(svc.update(issue.id, {
      assigneeAgentId: agentId,
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        workspaceStrategy: { type: "git_worktree" },
      },
    })).rejects.toMatchObject({
      status: 422,
      message: WORKSPACE_WORKTREE_REQUIRES_PROJECT_MESSAGE,
      details: {
        code: WORKSPACE_WORKTREE_REQUIRES_PROJECT_CODE,
        remediation: WORKSPACE_WORKTREE_REQUIRES_PROJECT_REMEDIATION,
      },
    });
  });

  it("syncs reused execution workspace config when issue workspace settings are updated", async () => {
    const spaceId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const issueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await seedWorkspaceProject(db, spaceId, projectId);

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      spaceId,
      projectId,
      name: "Primary workspace",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      spaceId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
      metadata: {
        config: {
          environmentId: "env-old",
          provisionCommand: "bash ./scripts/provision-old.sh",
          teardownCommand: "bash ./scripts/teardown-old.sh",
          workspaceRuntime: { profile: "old" },
        },
      },
    });

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      projectId,
      projectWorkspaceId,
      title: "Recovery issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        environmentId: "env-old",
        workspaceStrategy: {
          type: "git_worktree",
          provisionCommand: "bash ./scripts/provision-old.sh",
          teardownCommand: "bash ./scripts/teardown-old.sh",
        },
        workspaceRuntime: { profile: "old" },
      },
    });

    await svc.update(issueId, {
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        environmentId: "env-new",
        workspaceStrategy: {
          type: "cloud_sandbox",
          provisionCommand: "bash ./scripts/provision-new.sh",
          teardownCommand: "bash ./scripts/teardown-new.sh",
        },
        workspaceRuntime: { profile: "new" },
      },
    });

    const workspace = await db
      .select({ metadata: executionWorkspaces.metadata })
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.id, executionWorkspaceId))
      .then((rows) => rows[0] ?? null);

    expect(workspace?.metadata).toMatchObject({
      config: {
        environmentId: null,
        provisionCommand: "bash ./scripts/provision-new.sh",
        runtimeProvisionCommand: null,
        teardownCommand: "bash ./scripts/teardown-new.sh",
        cleanupCommand: null,
        workspaceRuntime: { profile: "new" },
        desiredState: null,
        serviceStates: null,
      },
    });
  });
});

describeEmbeddedPostgres("issueService.findMentionedProjectIds", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-mentioned-projects-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("can skip comment-body scans for bounded issue detail reads", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const titleProjectId = randomUUID();
    const commentProjectId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(projects).values([
      {
        id: titleProjectId,
        spaceId,
        name: "Title project",
        status: "in_progress",
      },
      {
        id: commentProjectId,
        spaceId,
        name: "Comment project",
        status: "in_progress",
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: `Link [Title](${buildProjectMentionHref(titleProjectId)})`,
      description: null,
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values({
      spaceId,
      issueId,
      body: `Comment link [Comment](${buildProjectMentionHref(commentProjectId)})`,
    });

    expect(await svc.findMentionedProjectIds(issueId, { includeCommentBodies: false })).toEqual([titleProjectId]);
    expect(await svc.findMentionedProjectIds(issueId)).toEqual([
      titleProjectId,
      commentProjectId,
    ]);
  });

  it("returns multiple same-space mentions in order, deduped", async () => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const firstProjectId = randomUUID();
    const secondProjectId = randomUUID();
    const thirdProjectId = randomUUID();

    await seedIssueSpace(db, spaceId);

    await db.insert(projects).values([
      { id: firstProjectId, spaceId, name: "First project", status: "in_progress" },
      { id: secondProjectId, spaceId, name: "Second project", status: "in_progress" },
      { id: thirdProjectId, spaceId, name: "Third project", status: "in_progress" },
    ]);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title:
        `See [First](${buildProjectMentionHref(firstProjectId)}) and ` +
        `[Second](${buildProjectMentionHref(secondProjectId)})`,
      description: null,
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values({
      spaceId,
      issueId,
      // Repeats the first mention (deduped) and introduces a third.
      body:
        `Also [First again](${buildProjectMentionHref(firstProjectId)}) and ` +
        `[Third](${buildProjectMentionHref(thirdProjectId)})`,
    });

    expect(await svc.findMentionedProjectIds(issueId)).toEqual([
      firstProjectId,
      secondProjectId,
      thirdProjectId,
    ]);
  });

  it("filters out a mention from another space", async () => {
    const spaceId = randomUUID();
    const foreignSpaceId = randomUUID();
    const issueId = randomUUID();
    const sameSpaceProjectId = randomUUID();
    const foreignProjectId = randomUUID();

    await db.insert(spaces).values([
      {
        id: spaceId,
        name: "Outpost",
        issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
      {
        id: foreignSpaceId,
        name: "Other space",
        issuePrefix: `F${foreignSpaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
    ]);

    await db.insert(projects).values([
      { id: sameSpaceProjectId, spaceId, name: "Same-space project", status: "in_progress" },
      { id: foreignProjectId, spaceId: foreignSpaceId, name: "Foreign project", status: "in_progress" },
    ]);

    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title:
        `Ours [Same](${buildProjectMentionHref(sameSpaceProjectId)}) and ` +
        `theirs [Foreign](${buildProjectMentionHref(foreignProjectId)})`,
      description: null,
      status: "todo",
      priority: "medium",
    });

    expect(await svc.findMentionedProjectIds(issueId)).toEqual([sameSpaceProjectId]);
  });
});

describeEmbeddedPostgres("issueService.clearExecutionRunIfTerminal", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-execution-lock-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedIssueWithRun(status: string | null) {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = status ? randomUUID() : null;

    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, agentId);
    if (runId && status) {
      await db.insert(heartbeatRuns).values({
        id: runId,
        spaceId,
        agentId,
        status,
        invocationSource: "manual",
      });
    }
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Execution lock",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: runId,
      executionAgentNameKey: runId ? "codexcoder" : null,
      executionLockedAt: runId ? new Date() : null,
    });

    return { issueId, runId };
  }

  it("clears execution locks owned by terminal runs", async () => {
    const { issueId } = await seedIssueWithRun("failed");

    await expect(svc.clearExecutionRunIfTerminal(issueId)).resolves.toBe(true);

    const row = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({
      executionRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
    });
  });

  it("does not clear execution locks owned by live runs", async () => {
    const { issueId, runId } = await seedIssueWithRun("running");

    await expect(svc.clearExecutionRunIfTerminal(issueId)).resolves.toBe(false);

    const row = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row?.executionRunId).toBe(runId);
    expect(row?.executionAgentNameKey).toBe("codexcoder");
    expect(row?.executionLockedAt).toBeInstanceOf(Date);
  });

  it("does not update issues without an execution lock", async () => {
    const { issueId } = await seedIssueWithRun(null);

    await expect(svc.clearExecutionRunIfTerminal(issueId)).resolves.toBe(false);

    const row = await db
      .select({ executionRunId: issues.executionRunId, executionLockedAt: issues.executionLockedAt })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({ executionRunId: null, executionLockedAt: null });
  });

  it("does not clear checkout locks when a different execution run is live", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const failedRunId = randomUUID();
    const runningRunId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, agentId);
    await db.insert(heartbeatRuns).values([
      {
        id: failedRunId,
        spaceId,
        agentId,
        status: "failed",
        invocationSource: "manual",
        finishedAt: new Date("2026-06-10T10:05:00.000Z"),
      },
      {
        id: runningRunId,
        spaceId,
        agentId,
        status: "running",
        invocationSource: "manual",
        startedAt: new Date("2026-06-10T10:06:00.000Z"),
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Mixed execution lock",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: failedRunId,
      executionRunId: runningRunId,
      executionAgentNameKey: "codexcoder",
      executionLockedAt: new Date("2026-06-10T10:06:00.000Z"),
    });

    await expect(svc.clearCheckoutRunIfTerminal(issueId)).resolves.toBe(false);

    const row = await db
      .select({
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row?.checkoutRunId).toBe(failedRunId);
    expect(row?.executionRunId).toBe(runningRunId);
    expect(row?.executionAgentNameKey).toBe("codexcoder");
    expect(row?.executionLockedAt).toBeInstanceOf(Date);
  });

  it("does not let stale release clobber a successor checkout lock", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const failedRunId = randomUUID();
    const releasingRunId = randomUUID();
    const successorRunId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, agentId);
    await db.insert(heartbeatRuns).values([
      {
        id: failedRunId,
        spaceId,
        agentId,
        status: "failed",
        invocationSource: "manual",
        finishedAt: new Date("2026-06-10T10:05:00.000Z"),
      },
      {
        id: releasingRunId,
        spaceId,
        agentId,
        status: "running",
        invocationSource: "manual",
        startedAt: new Date("2026-06-10T10:06:00.000Z"),
      },
      {
        id: successorRunId,
        spaceId,
        agentId,
        status: "running",
        invocationSource: "manual",
        startedAt: new Date("2026-06-10T10:07:00.000Z"),
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Race stale release",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: failedRunId,
      executionRunId: failedRunId,
      executionAgentNameKey: "codexcoder",
      executionLockedAt: new Date("2026-06-10T10:00:00.000Z"),
    });

    const [releaseResult, checkoutResult] = await Promise.allSettled([
      svc.release(issueId, agentId, releasingRunId),
      svc.checkout(issueId, agentId, ["todo", "in_progress"], successorRunId),
    ]);

    expect(checkoutResult.status).toBe("fulfilled");
    if (releaseResult.status === "rejected") {
      expect(releaseResult.reason).toMatchObject({ status: 409 });
    }

    const row = await db
      .select({
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toMatchObject({
      status: "in_progress",
      assigneeAgentId: agentId,
      checkoutRunId: successorRunId,
      executionRunId: successorRunId,
    });
  });

  it("checkout refuses to promote a 'done' issue when 'done' is not in expectedStatuses, even with a lingering executionRunId pointer", async () => {
    // Regression for PR #2482 checkout-adoption review finding: the original
    // patch's stale-executionRunId adoption SQL set `status: 'in_progress'`
    // unconditionally, bypassing the caller's expectedStatuses guard. With the
    // guard restored, attempting to take over a 'done' issue with
    // expectedStatuses=['todo'] must fail and leave the row untouched.
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const failedRunId = randomUUID();
    const successorRunId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, agentId);
    await db.insert(heartbeatRuns).values([
      {
        id: failedRunId,
        spaceId,
        agentId,
        status: "failed",
        invocationSource: "manual",
        finishedAt: new Date("2026-06-10T10:05:00.000Z"),
      },
      {
        id: successorRunId,
        spaceId,
        agentId,
        status: "running",
        invocationSource: "manual",
        startedAt: new Date("2026-06-10T10:07:00.000Z"),
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Stale lock on done issue",
      status: "done",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: failedRunId,
      executionAgentNameKey: "codexcoder",
      executionLockedAt: new Date("2026-06-10T10:00:00.000Z"),
      completedAt: new Date("2026-06-10T10:01:00.000Z"),
    });

    await expect(svc.checkout(issueId, agentId, ["todo"], successorRunId))
      .rejects.toMatchObject({ status: 409 });

    const row = await db
      .select({
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        checkoutRunId: issues.checkoutRunId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toMatchObject({
      status: "done",
      assigneeAgentId: agentId,
      checkoutRunId: null,
    });
  });

  it("checkout adoption of a stale checkoutRunId preserves the issue's assigneeUserId", async () => {
    // Regression for PR #2482 checkout-adoption review finding: any adoption
    // helper that re-locks an existing in_progress issue (e.g. when the prior
    // checkout/execution run is terminal) must not strip the row's
    // assigneeUserId. We exercise this via the adoptStaleCheckoutRun path,
    // which fires when checkoutRunId points at a terminal run while
    // executionRunId still points at a different, non-terminal run.
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    const issueId = randomUUID();
    const failedCheckoutRunId = randomUUID();
    const queuedExecutionRunId = randomUUID();
    const successorRunId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await seedCodexCoder(db, spaceId, agentId);
    await db.insert(heartbeatRuns).values([
      {
        id: failedCheckoutRunId,
        spaceId,
        agentId,
        status: "failed",
        invocationSource: "manual",
        finishedAt: new Date("2026-06-10T10:05:00.000Z"),
      },
      {
        id: queuedExecutionRunId,
        spaceId,
        agentId,
        status: "queued",
        invocationSource: "manual",
      },
      {
        id: successorRunId,
        spaceId,
        agentId,
        status: "running",
        invocationSource: "manual",
        startedAt: new Date("2026-06-10T10:07:00.000Z"),
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Stale checkout lock with user co-assignee",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      assigneeUserId: userId,
      checkoutRunId: failedCheckoutRunId,
      executionRunId: queuedExecutionRunId,
      executionAgentNameKey: "codexcoder",
      executionLockedAt: new Date("2026-06-10T10:00:00.000Z"),
    });

    const result = await svc.checkout(issueId, agentId, ["todo", "in_progress"], successorRunId);
    expect(result).toBeTruthy();

    const row = await db
      .select({
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeUserId: issues.assigneeUserId,
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toMatchObject({
      status: "in_progress",
      assigneeAgentId: agentId,
      assigneeUserId: userId,
      checkoutRunId: successorRunId,
      executionRunId: successorRunId,
    });
  });
});

describeEmbeddedPostgres("accepted plan decomposition", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-accepted-plan-decomposition-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issuePlanDecompositions);
    await db.delete(issueThreadInteractions);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAcceptedPlanContext() {
    const spaceId = randomUUID();
    const goalId = randomUUID();
    const assigneeAgentId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await seedCodexCoder(db, spaceId, assigneeAgentId);
    await db.insert(goals).values({
      id: goalId,
      spaceId,
      title: "Accepted plan decomposition",
      level: "task",
      status: "active",
    });

    return { spaceId, goalId, assigneeAgentId };
  }

  async function seedAcceptedPlanIssue(args?: {
    spaceId?: string;
    goalId?: string;
    assigneeAgentId?: string;
    sourceIssueId?: string;
    issueTitle?: string;
    workMode?: IssueWorkMode;
  }) {
    const spaceId = args?.spaceId ?? randomUUID();
    const goalId = args?.goalId ?? randomUUID();
    const assigneeAgentId = args?.assigneeAgentId ?? randomUUID();
    const sourceIssueId = args?.sourceIssueId ?? randomUUID();
    const planDocumentId = randomUUID();
    const acceptedPlanRevisionId = randomUUID();
    const acceptedInteractionId = randomUUID();

    if (!args?.spaceId || !args?.goalId || !args?.assigneeAgentId) {
      await seedIssueSpace(db, spaceId);
      await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
      await seedCodexCoder(db, spaceId, assigneeAgentId);
      await db.insert(goals).values({
        id: goalId,
        spaceId,
        title: "Accepted plan decomposition",
        level: "task",
        status: "active",
      });
    }

    await db.insert(issues).values({
      id: sourceIssueId,
      spaceId,
      goalId,
      title: args?.issueTitle ?? "Planning issue",
      status: "in_progress",
      priority: "medium",
      workMode: args?.workMode ?? "planning",
      assigneeAgentId: assigneeAgentId,
    });
    await db.insert(documents).values({
      id: planDocumentId,
      spaceId,
      title: "Plan",
      format: "markdown",
      latestBody: "Plan body",
      latestRevisionId: acceptedPlanRevisionId,
      latestRevisionNumber: 1,
      createdByAgentId: assigneeAgentId,
      updatedByAgentId: assigneeAgentId,
    });
    await db.insert(documentRevisions).values({
      id: acceptedPlanRevisionId,
      spaceId,
      documentId: planDocumentId,
      revisionNumber: 1,
      title: "Plan",
      format: "markdown",
      body: "Plan body",
      createdByAgentId: assigneeAgentId,
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId: sourceIssueId,
      documentId: planDocumentId,
      key: "plan",
    });
    await db.insert(issueThreadInteractions).values({
      id: acceptedInteractionId,
      spaceId,
      issueId: sourceIssueId,
      kind: "request_confirmation",
      status: "accepted",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        prompt: "Approve this plan?",
        target: {
          type: "issue_document",
          issueId: sourceIssueId,
          documentId: planDocumentId,
          key: "plan",
          revisionId: acceptedPlanRevisionId,
          revisionNumber: 1,
        },
      },
      result: {
        version: 1,
        outcome: "accepted",
      },
      resolvedAt: new Date(),
      createdByUserId: "local-operator",
      resolvedByUserId: "local-operator",
    });

    return { spaceId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId };
  }

  async function getAcceptedPlanClaim(sourceIssueId: string) {
    return db
      .select()
      .from(issuePlanDecompositions)
      .where(eq(issuePlanDecompositions.sourceIssueId, sourceIssueId))
      .then((rows) => rows[0] ?? null);
  }

  it("reuses the same child issue set on repeat decomposition attempts for an accepted plan revision", async () => {
    const { spaceId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();

    const children = [
      {
        title: "Implement the claim table",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
        assigneeAgentId,
      },
      {
        title: "Add decomposition route tests",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const first = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });

    expect(first.decomposition).not.toHaveProperty("requestedChildren");
    expect(first.childIssueIds).toHaveLength(2);
    expect(first.newlyCreatedIssues).toHaveLength(2);
    expect(first.decomposition.status).toBe("completed");

    const second = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });

    expect(second.childIssueIds).toEqual(first.childIssueIds);
    expect(second.newlyCreatedIssues).toHaveLength(0);
    expect(second.decomposition.status).toBe("completed");

    const persistedClaims = await db
      .select()
      .from(issuePlanDecompositions)
      .where(eq(issuePlanDecompositions.sourceIssueId, sourceIssueId));
    expect(persistedClaims).toHaveLength(1);
    expect(persistedClaims[0]?.requestedChildCount).toBe(2);
    expect(persistedClaims[0]?.childIssueIds).toEqual(first.childIssueIds);

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.map((row) => row.id).sort()).toEqual([...first.childIssueIds].sort());

    const spaceIssues = await svc.list(spaceId, { parentId: sourceIssueId });
    expect(spaceIssues).toHaveLength(2);
  });

  it("rejects a different child set for the same accepted plan fingerprint", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();

    await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Implement the claim table",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    await expect(svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Implement the claim table",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
        {
          title: "This duplicate should be rejected",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("allows accepted-plan decomposition on a standard-work issue with an accepted plan document", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue({
      workMode: "standard",
      issueTitle: "Implement after planning",
    });

    const result = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Implement the approved first slice",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    expect(result.childIssueIds).toHaveLength(1);
    expect(result.newlyCreatedIssues).toHaveLength(1);
    expect(result.decomposition.status).toBe("completed");
  });

  it("serializes concurrent accepted-plan retries for the same parent issue without duplicate children", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const children = [
      {
        title: "Persist exact-once decomposition claim",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
      {
        title: "Guard concurrent retry callers",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });
    const claim = await getAcceptedPlanClaim(sourceIssueId);
    expect(claim).not.toBeNull();

    for (const childIssueId of initial.childIssueIds) {
      await db.delete(issues).where(eq(issues.id, childIssueId));
    }
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [],
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const svcA = issueService(db);
    const svcB = issueService(db);
    const [first, second] = await Promise.all([
      svcA.decomposeAcceptedPlan(sourceIssueId, {
        acceptedPlanRevisionId,
        children,
        actorAgentId: assigneeAgentId,
      }),
      svcB.decomposeAcceptedPlan(sourceIssueId, {
        acceptedPlanRevisionId,
        children,
        actorAgentId: assigneeAgentId,
      }),
    ]);

    expect(first.childIssueIds).toEqual(second.childIssueIds);
    expect(first.childIssueIds).toHaveLength(2);
    expect(first.newlyCreatedIssues.length + second.newlyCreatedIssues.length).toBe(2);

    const persistedClaim = await getAcceptedPlanClaim(sourceIssueId);
    expect(persistedClaim?.status).toBe("completed");
    expect(persistedClaim?.childIssueIds).toEqual(first.childIssueIds);

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.map((row) => row.id).sort()).toEqual([...first.childIssueIds].sort());
  });

  it("rejects another planning parent's accepted revision even when both issues share the assignee", async () => {
    const { spaceId, goalId, assigneeAgentId } = await seedAcceptedPlanContext();
    const firstIssue = await seedAcceptedPlanIssue({
      spaceId,
      goalId,
      assigneeAgentId,
      issueTitle: "Earlier accepted plan",
    });
    const secondIssue = await seedAcceptedPlanIssue({
      spaceId,
      goalId,
      assigneeAgentId,
      issueTitle: "Later accepted plan",
    });

    await svc.decomposeAcceptedPlan(firstIssue.sourceIssueId, {
      acceptedPlanRevisionId: firstIssue.acceptedPlanRevisionId,
      children: [
        {
          title: "Decompose the first issue only",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    await expect(svc.decomposeAcceptedPlan(secondIssue.sourceIssueId, {
      acceptedPlanRevisionId: firstIssue.acceptedPlanRevisionId,
      children: [
        {
          title: "This must not land on the second parent",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    })).rejects.toMatchObject({
      status: 422,
    });

    const secondIssueChildren = await db
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.parentId, secondIssue.sourceIssueId));
    expect(secondIssueChildren).toHaveLength(0);
  });

  it("resumes partial child creation under the claimed fingerprint without duplicating completed children", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const children = [
      {
        title: "Create the first child once",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
      {
        title: "Recreate only the missing tail child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });
    const claim = await getAcceptedPlanClaim(sourceIssueId);
    expect(claim).not.toBeNull();

    const [firstChildId, secondChildId] = initial.childIssueIds;
    expect(firstChildId).toBeTruthy();
    expect(secondChildId).toBeTruthy();

    await db.delete(issues).where(eq(issues.id, secondChildId!));
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [firstChildId!],
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const retried = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });

    expect(retried.decomposition.status).toBe("completed");
    expect(retried.childIssueIds[0]).toBe(firstChildId);
    expect(retried.newlyCreatedIssues).toHaveLength(1);
    expect(retried.newlyCreatedIssues[0]?.title).toBe("Recreate only the missing tail child");

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.some((row) => row.id === firstChildId)).toBe(true);
    expect(childrenRows.map((row) => row.title).sort()).toEqual(children.map((child) => child.title).sort());
  });

  it("resumes a partial decomposition after reassignment when only actor metadata changes", async () => {
    const { spaceId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const reassignedAgentId = randomUUID();
    await db.insert(agents).values({
      id: reassignedAgentId,
      spaceId,
      name: "SecondCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const children = [
      {
        title: "Keep the original child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
        createdByAgentId: assigneeAgentId,
        actorAgentId: assigneeAgentId,
      },
      {
        title: "Create only the missing child after reassignment",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
        createdByAgentId: assigneeAgentId,
        actorAgentId: assigneeAgentId,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });
    const claim = await getAcceptedPlanClaim(sourceIssueId);
    const [firstChildId, secondChildId] = initial.childIssueIds;

    expect(claim).not.toBeNull();
    expect(firstChildId).toBeTruthy();
    expect(secondChildId).toBeTruthy();

    await db.delete(issues).where(eq(issues.id, secondChildId!));
    await db
      .update(issues)
      .set({ assigneeAgentId: reassignedAgentId, updatedAt: new Date() })
      .where(eq(issues.id, sourceIssueId));
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [firstChildId!],
        completedAt: null,
        ownerAgentId: assigneeAgentId,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const retried = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: children.map((child) => ({
        ...child,
        createdByAgentId: reassignedAgentId,
        actorAgentId: reassignedAgentId,
      })),
      actorAgentId: reassignedAgentId,
    });

    expect(retried.decomposition.status).toBe("completed");
    expect(retried.decomposition.ownerAgentId).toBe(reassignedAgentId);
    expect(retried.childIssueIds[0]).toBe(firstChildId);
    expect(retried.newlyCreatedIssues).toHaveLength(1);
    expect(retried.newlyCreatedIssues[0]?.title).toBe("Create only the missing child after reassignment");

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title, createdByAgentId: issues.createdByAgentId })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId))
      .orderBy(asc(issues.createdAt), asc(issues.id));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.map((row) => row.id).sort()).toEqual([...retried.childIssueIds].sort());
    expect(childrenRows.find((row) => row.id !== firstChildId)?.createdByAgentId).toBe(reassignedAgentId);
  });

  it("preserves the existing live claim owner when another actor resumes the same fingerprint", async () => {
    const { spaceId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const competingAgentId = randomUUID();
    const liveOwnerRunId = randomUUID();
    const competingRunId = randomUUID();
    await db.insert(agents).values({
      id: competingAgentId,
      spaceId,
      name: "SecondCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values([
      {
        id: liveOwnerRunId,
        spaceId,
        agentId: assigneeAgentId,
        status: "running",
        invocationSource: "manual",
      },
      {
        id: competingRunId,
        spaceId,
        agentId: competingAgentId,
        status: "running",
        invocationSource: "manual",
      },
    ]);

    const children = [
      {
        title: "Keep the first created child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
      {
        title: "Create the missing second child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
      actorRunId: liveOwnerRunId,
    });
    const [firstChildId, secondChildId] = initial.childIssueIds;
    const claim = await getAcceptedPlanClaim(sourceIssueId);

    await db.delete(issues).where(eq(issues.id, secondChildId!));
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [firstChildId!],
        completedAt: null,
        ownerAgentId: assigneeAgentId,
        ownerRunId: liveOwnerRunId,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const retried = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: competingAgentId,
      actorRunId: competingRunId,
    });

    expect(retried.decomposition.status).toBe("completed");
    expect(retried.decomposition.ownerAgentId).toBe(assigneeAgentId);
    expect(retried.decomposition.ownerRunId).toBe(liveOwnerRunId);
  });

  it("lists persisted decompositions with child issue summaries", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();

    const initial = await svc.listAcceptedPlanDecompositions(sourceIssueId);
    expect(initial).toEqual([]);

    const result = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Surface decomposition status in operator UI",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
        {
          title: "Add regression coverage",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    const decompositions = await svc.listAcceptedPlanDecompositions(sourceIssueId);
    expect(decompositions).toHaveLength(1);
    const [record] = decompositions;
    expect(record?.status).toBe("completed");
    expect(record?.acceptedPlanRevisionId).toBe(acceptedPlanRevisionId);
    expect(record?.acceptedPlanRevisionNumber).toBeTypeOf("number");
    expect(record?.childIssues.map((child) => child.id).sort()).toEqual(
      [...result.childIssueIds].sort(),
    );
    expect(record).not.toHaveProperty("requestedChildren");
    expect(record?.childIssues.every((child) => typeof child.title === "string")).toBe(true);
  });
});

describeEmbeddedPostgres("issueService.assertCheckoutOwner stale checkout adoption", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-checkout-owner-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(spaceMemberships);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedOwnershipIssue(params: {
    checkoutStatus: "running" | "failed" | "timed_out";
    actorRunStatus?: "running" | "failed" | "timed_out" | "succeeded";
    assigneeMatchesActor?: boolean;
  }) {
    const spaceId = randomUUID();
    const assigneeAgentId = randomUUID();
    const actorAgentId = params.assigneeMatchesActor === false ? randomUUID() : assigneeAgentId;
    const staleRunId = randomUUID();
    const actorRunId = randomUUID();
    const issueId = randomUUID();
    const actorRunStatus = params.actorRunStatus ?? "running";

    await seedIssueSpace(db, spaceId);
    const agentRows = [
      {
        id: assigneeAgentId,
        spaceId,
        name: "Assignee",
        role: "engineer" as const,
        status: "active" as const,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ];
    if (actorAgentId !== assigneeAgentId) {
      agentRows.push({
        id: actorAgentId,
        spaceId,
        name: "Actor",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
    }
    await db.insert(agents).values(agentRows);
    await db.insert(heartbeatRuns).values([
      {
        id: staleRunId,
        spaceId,
        agentId: assigneeAgentId,
        status: params.checkoutStatus,
        invocationSource: "manual",
        finishedAt: params.checkoutStatus === "running" ? null : new Date(),
      },
      {
        id: actorRunId,
        spaceId,
        agentId: actorAgentId,
        status: actorRunStatus,
        invocationSource: "manual",
        startedAt: actorRunStatus === "running" ? new Date() : null,
        finishedAt: actorRunStatus === "running" ? null : new Date(),
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Checkout owner recovery",
      status: "in_progress",
      priority: "high",
      assigneeAgentId,
      checkoutRunId: staleRunId,
      executionRunId: staleRunId,
      executionLockedAt: new Date(),
      executionAgentNameKey: "assignee",
    });

    return { issueId, assigneeAgentId, actorAgentId, staleRunId, actorRunId };
  }

  it.each(["succeeded", "failed"])("preserves a human handoff when the outgoing legacy run later %s", async status => {
    const seeded = await seedOwnershipIssue({ checkoutStatus: "failed" });
    const original = await svc.getById(seeded.issueId);
    await db.insert(spaceMemberships).values({
      spaceId: original!.spaceId,
      principalType: "user",
      principalId: "handoff-reviewer",
      status: "active",
    });
    await db.update(heartbeatRuns).set({
      contextSnapshot: { issueId: seeded.issueId },
    }).where(eq(heartbeatRuns.id, seeded.actorRunId));
    await svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId);

    const handoff = await svc.update(seeded.issueId, {
      assigneeAgentId: null,
      assigneeUserId: "handoff-reviewer",
      status: "in_review",
      actorAgentId: seeded.actorAgentId,
      actorRunId: seeded.actorRunId,
    });
    expect(handoff).toMatchObject({
      assigneeAgentId: null,
      assigneeUserId: "handoff-reviewer",
      status: "in_review",
      checkoutRunId: null,
      executionRunId: null,
    });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.actorRunId));
    expect(run!.status).toBe("running");
    await expect(svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId))
      .rejects.toMatchObject({ status: 409 });
    await expect(svc.update(seeded.issueId, {
      title: "Late outgoing edit",
      actorAgentId: seeded.actorAgentId,
      actorRunId: seeded.actorRunId,
    })).rejects.toMatchObject({ status: 403, details: { code: "issue_handed_off" } });

    await terminalizeLegacyExecution({
      db,
      run: run!,
      status,
      fromStatuses: ["running"],
      reconcileIfNeeded: true,
      patch: { finishedAt: new Date(), ...(status === "failed" ? { errorCode: "process_lost" } : {}) },
    });
    await settleUnrecoverableExecutions(db);
    await expect(svc.update(seeded.issueId, {
      status: "done",
      actorAgentId: seeded.actorAgentId,
      actorRunId: seeded.actorRunId,
    })).rejects.toMatchObject({ status: 403, details: { code: "issue_handed_off" } });
    expect(await svc.getById(seeded.issueId)).toMatchObject({
      status: "in_review",
      assigneeAgentId: null,
      assigneeUserId: "handoff-reviewer",
    });
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, seeded.issueId)))
      .toHaveLength(0);
  });

  it("lets the current assignee adopt a stale terminal checkout owner", async () => {
    const seeded = await seedOwnershipIssue({ checkoutStatus: "failed" });

    const ownership = await svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId);

    expect(ownership.checkoutRunId).toBe(seeded.actorRunId);
    expect(ownership.executionRunId).toBe(seeded.actorRunId);
    expect(ownership.adoptedFromRunId).toBeNull();
  });

  it("treats timed_out checkout owners as stale and recoverable", async () => {
    const seeded = await seedOwnershipIssue({ checkoutStatus: "timed_out" });

    const ownership = await svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId);

    expect(ownership.checkoutRunId).toBe(seeded.actorRunId);
    expect(ownership.adoptedFromRunId).toBeNull();
  });

  it("does not allow non-assignees to adopt stale checkout ownership", async () => {
    const seeded = await seedOwnershipIssue({ checkoutStatus: "failed", assigneeMatchesActor: false });

    await expect(
      svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps live checkout owners protected with a 409 conflict", async () => {
    const seeded = await seedOwnershipIssue({ checkoutStatus: "running" });

    await expect(
      svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not let terminal actor runs adopt stale checkout ownership", async () => {
    const seeded = await seedOwnershipIssue({ checkoutStatus: "failed", actorRunStatus: "succeeded" });

    await expect(
      svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId),
    ).rejects.toMatchObject({ status: 409 });

    const row = await db
      .select({
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, seeded.issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({
      checkoutRunId: null,
      executionRunId: null,
    });
  });

  it("adopts unowned checkout after a concurrent stale-checkout clear wins the lock race", async () => {
    const seeded = await seedOwnershipIssue({ checkoutStatus: "failed" });
    await db
      .update(issues)
      .set({
        executionRunId: seeded.actorRunId,
        executionLockedAt: new Date(),
      })
      .where(eq(issues.id, seeded.issueId));

    const rowLocked = deferred<void>();
    const clearCanCommit = deferred<void>();

    const concurrentClear = db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${issues.id} from ${issues} where ${issues.id} = ${seeded.issueId} for update`,
      );
      rowLocked.resolve();
      await clearCanCommit.promise;
      await tx
        .update(issues)
        .set({
          checkoutRunId: null,
          executionRunId: seeded.actorRunId,
          executionLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, seeded.issueId));
    });

    await rowLocked.promise;

    const ownershipPromise = svc.assertCheckoutOwner(seeded.issueId, seeded.actorAgentId, seeded.actorRunId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    clearCanCommit.resolve();
    await concurrentClear;

    const ownership = await ownershipPromise;
    expect(ownership.checkoutRunId).toBe(seeded.actorRunId);
    expect(ownership.executionRunId).toBe(seeded.actorRunId);
    expect(ownership.adoptedFromRunId).toBeNull();

    const row = await db
      .select({
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, seeded.issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({
      checkoutRunId: seeded.actorRunId,
      executionRunId: seeded.actorRunId,
    });
  });

});

describeEmbeddedPostgres("issueService.addComment createdByRunId", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let singleConnectionDb!: ReturnType<typeof createDb>;
  let singleConnectionSvc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let spaceId!: string;
  let agentId!: string;
  let issueId!: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issues-comment-runid-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    singleConnectionDb = createDb(tempDb.connectionString, { maxConnections: 1 });
    singleConnectionSvc = issueService(singleConnectionDb);

    spaceId = randomUUID();
    agentId = randomUUID();
    issueId = randomUUID();

    await seedIssueSpace(db, spaceId);
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "TestAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Test issue",
      status: "todo",
      priority: "medium",
    });
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createdByRunIdFor(commentId: string) {
    return db
      .select({ createdByRunId: issueComments.createdByRunId })
      .from(issueComments)
      .where(eq(issueComments.id, commentId))
      .then((rows) => rows[0]?.createdByRunId ?? null);
  }

  it("keeps addComment transaction reads on a single pooled connection", async () => {
    const comment = await singleConnectionDb.transaction(async (tx) =>
      singleConnectionSvc.addComment(
        issueId,
        "transaction-safe comment",
        {},
        { authorType: "system" },
        tx,
      ),
    );

    expect(comment.body).toBe("transaction-safe comment");
  });

  it("nulls out a non-UUID x-outpost-run-id instead of 500-ing", async () => {
    const comment = await svc.addComment(issueId, "hello from a synthetic run id", {
      runId: "client-request-abc123",
    });

    expect(comment.id).toBeTruthy();
    expect(await createdByRunIdFor(comment.id)).toBeNull();
  });

  it("nulls out a UUID runId absent from heartbeat_runs instead of 500-ing", async () => {
    const comment = await svc.addComment(issueId, "hello from a stale run", {
      runId: randomUUID(),
    });

    expect(comment.id).toBeTruthy();
    expect(await createdByRunIdFor(comment.id)).toBeNull();
  });

  it("preserves a valid runId that exists in heartbeat_runs for the space", async () => {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "running",
    });

    const comment = await svc.addComment(issueId, "hello from a live run", { runId });

    expect(await createdByRunIdFor(comment.id)).toBe(runId);
  });

  it("deduplicates concurrent identical comments from the same run", async () => {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      status: "running",
    });

    const [first, second] = await Promise.all([
      svc.addComment(issueId, "one durable result", { agentId, runId }),
      svc.addComment(issueId, "one durable result", { agentId, runId }),
    ]);

    expect(second.id).toBe(first.id);
    const duplicates = await db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(eq(issueComments.createdByRunId, runId));
    expect(duplicates).toHaveLength(1);
  });
});
