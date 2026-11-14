import { randomBytes, randomUUID } from "node:crypto";
import { agents, authUsers, spaces, spaceMemberships, createDb, heartbeatRuns, issues, type Db } from "@outpost/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { resolveInstructionActor } from "../services/agent-instruction-authorization.js";
import { readChatControlRecoveryStop } from "../services/chat-control-recovery-stop.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { boundRunIssueId, runTaskContextColumn } from "../services/run-task-binding.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("run authority read projections", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("run-authority-read-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  async function fixture() {
    const spaceId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), userId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Read fixture", issuePrefix: spaceId.slice(0, 8) });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Read agent", adapterType: "process" });
    await db.insert(issues).values({ id: issueId, spaceId, title: "Read task" });
    await db.insert(authUsers).values({ id: userId, name: "Fixture", email: `${userId}@example.invalid`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: userId, status: "active" });
    const payload = randomBytes(128 * 1024).toString("base64");
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId, status: "running", responsibleUserId: userId,
      contextSnapshot: { issueId, prompt: payload }, runnerProfileJson: { instructions: payload }, stdoutExcerpt: payload,
    }).returning();
    return { spaceId, agentId, issueId, userId, run };
  }

  function recordRunReads() {
    const reads: unknown[][] = [];
    const recorded = new Proxy(db, { get(target, key) {
      if (key !== "select") return Reflect.get(target, key);
      return (...fields: Parameters<Db["select"]>) => {
        const builder = target.select(...fields), from = builder.from.bind(builder);
        builder.from = ((...args: Parameters<typeof from>) => {
          const query = from(...args);
          if (args[0] === heartbeatRuns) {
            const execute = query.execute.bind(query);
            query.execute = async (...executeArgs: Parameters<typeof execute>) => {
              const rows = await execute(...executeArgs); reads.push(rows); return rows;
            };
          }
          return query;
        }) as typeof builder.from;
        return builder;
      };
    }});
    return { recorded, reads };
  }

  it("checks ancestry with small responses and still rejects task, agent, and space mismatches", async () => {
    const f = await fixture(), { recorded, reads } = recordRunReads();
    const scope = { spaceId: f.spaceId, agentId: f.agentId, issueId: f.issueId, sourceRunId: f.run.id };
    expect(await readChatControlRecoveryStop(recorded, scope)).toEqual({ kind: "clear" });
    for (const field of ["spaceId", "agentId", "issueId"] as const) {
      expect(await readChatControlRecoveryStop(recorded, { ...scope, [field]: randomUUID() })).toEqual({ kind: "unresolved" });
    }
    expect(reads).toHaveLength(4);
    expect(Buffer.byteLength(JSON.stringify(reads))).toBeLessThan(2048);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id)))[0]).toEqual(f.run);
  });

  it("refreshes instruction identity and membership without loading execution payloads", async () => {
    const f = await fixture();
    await initializeRunIdentity(db, { spaceId: f.spaceId, runId: f.run.id, issueId: f.issueId, responsibleUserId: f.userId, messageIds: [], cause: "fixture" });
    const { recorded, reads } = recordRunReads();
    const actor = { type: "agent" as const, source: "agent_jwt" as const, spaceId: f.spaceId, agentId: f.agentId, runId: f.run.id };
    expect(await resolveInstructionActor(recorded, actor)).toMatchObject({ onBehalfOfUserId: f.userId });
    await db.update(spaceMemberships).set({ status: "suspended" }).where(eq(spaceMemberships.principalId, f.userId));
    await expect(resolveInstructionActor(recorded, actor)).rejects.toThrow(/responsible user is unavailable/);
    await expect(resolveInstructionActor(recorded, { ...actor, agentId: randomUUID() })).rejects.toThrow(/does not match/);
    expect(Buffer.byteLength(JSON.stringify(reads))).toBeLessThan(1024);
  });

  it.each([null, [], "scalar", 42, { issueId: false, taskId: 3 }, { issueId: "", taskId: "fallback" }].map(context => ({ context })))("preserves typed task binding for $context", async ({ context }) => {
    const f = await fixture();
    await db.update(heartbeatRuns).set({ contextSnapshot: context as Record<string, unknown> | null }).where(eq(heartbeatRuns.id, f.run.id));
    const [selected] = await db.select({ contextSnapshot: runTaskContextColumn }).from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(boundRunIssueId(selected)).toBe(boundRunIssueId({ contextSnapshot: context as Record<string, unknown> | null }));
    expect(selected.contextSnapshot.issueId).toEqual((context as Record<string, unknown> | null)?.issueId ?? null);
    expect(selected.contextSnapshot.taskId).toEqual((context as Record<string, unknown> | null)?.taskId ?? null);
  });

  it("keeps native task precedence and complete stored context during identity activation", async () => {
    const f = await fixture();
    await db.update(heartbeatRuns).set({ nativeIssueId: f.issueId, contextSnapshot: { ...f.run.contextSnapshot, issueId: randomUUID() } }).where(eq(heartbeatRuns.id, f.run.id));
    const identity = await initializeRunIdentity(db, { spaceId: f.spaceId, runId: f.run.id, responsibleUserId: f.userId, cause: "fixture" });
    const [issue] = await db.select().from(issues).where(eq(issues.id, f.issueId));
    expect(issue.continuationIdentityContextId).toBe(identity.id);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id)))[0].contextSnapshot?.prompt).toBe(f.run.contextSnapshot?.prompt);
  });

  it.each([42, false, {}, ["invalid"], "not-a-uuid"].map(issueId => ({ issueId })))("rejects malformed legacy identity $issueId even with a native task", async ({ issueId }) => {
    const f = await fixture();
    await db.update(heartbeatRuns).set({ nativeIssueId: f.issueId, contextSnapshot: { issueId } }).where(eq(heartbeatRuns.id, f.run.id));
    await expect(initializeRunIdentity(db, { spaceId: f.spaceId, runId: f.run.id, responsibleUserId: f.userId, cause: "fixture" })).rejects.toThrow(/Run task identity is invalid/);
    const [stored] = await db.select({ identity: heartbeatRuns.activeIdentityContextId }).from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(stored.identity).toBeNull();
  });
});
