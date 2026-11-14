import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { activityLog, agentApiKeys, agentCommentary, agents, authUsers, spaces, spaceMemberships, heartbeatRuns, issues, nativeRunResults, principalPermissionGrants } from "@outpost/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { submitAgentCommentary } from "../services/agent-commentary.js";
import { OutpostRunnerToolAuthority } from "../services/native-runtime/outpost-runner-tool-authority.js";
import { isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";
import { startRunnerApiTestServer } from "./helpers/runner-api-server.js";
import { ensureNativeCompletionContract } from "../services/native-runtime/completion-contracts.js";
import { agentCommentaryRoutes } from "../routes/agent-commentary.js";
import { errorHandler } from "../middleware/error-handler.js";
import { agentService } from "../services/agents.js";
import { spaceService } from "../services/space-service.js";
import { NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS } from "../lib/agent-permissions.js";

describe("internal agent commentary through both transports", () => {
  let server: Awaited<ReturnType<typeof startRunnerApiTestServer>>;
  let home: string;
  const oldHome = process.env.OUTPOST_HOME;
  const oldSecret = process.env.OUTPOST_AGENT_JWT_SECRET;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "outpost-commentary-"));
    process.env.OUTPOST_HOME = home;
    process.env.OUTPOST_AGENT_JWT_SECRET = randomUUID();
    server = await startRunnerApiTestServer();
  }, 90_000);
  afterAll(async () => {
    await server?.close();
    if (oldHome === undefined) delete process.env.OUTPOST_HOME; else process.env.OUTPOST_HOME = oldHome;
    if (oldSecret === undefined) delete process.env.OUTPOST_AGENT_JWT_SECRET; else process.env.OUTPOST_AGENT_JWT_SECRET = oldSecret;
    if (home) await rm(home, { recursive: true, force: true });
  });
  type Fixture = Awaited<ReturnType<typeof server.fixture>>;
  const input = { body: "The tool returned success before the write finished. Please wait for persistence.", idempotencyKey: "one" };
  const rows = (f: Fixture) => server.db.select().from(agentCommentary).where(eq(agentCommentary.runId, f.runId));
  async function legacy() {
    const f = await server.fixture();
    await server.db.update(heartbeatRuns).set({ runtimeMode: "legacy", nativeIssueId: null }).where(eq(heartbeatRuns.id, f.runId));
    await server.db.update(agents).set({ adapterType: "codex_local" }).where(eq(agents.id, f.agentId));
    return { ...f, token: createLocalAgentJwt(f.agentId, f.spaceId, "codex_local", f.runId)! };
  }
  async function post(f: Fixture & { token: string }, value: unknown, spaceId = f.spaceId) {
    return fetch(`${server.apiUrl}/api/spaces/${spaceId}/agent-commentary`, {
      method: "POST", headers: { authorization: `Bearer ${f.token}`, "X-Outpost-Run-Id": f.runId, "Content-Type": "application/json" }, body: JSON.stringify(value),
    });
  }

  it("can reapply the generated migration without losing data", async () => {
    const f = await legacy();
    await post(f, { ...input, kind: "complaint" });
    const migration = await readFile(new URL("../../../packages/db/src/migrations/0310_agent_commentary.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await server.db.execute(sql.raw(statement));
    }
    expect(await rows(f)).toHaveLength(1);
  });

  it.each(["standard", "ask", "planning"] as const)("exposes native feedback in %s and persists only feedback plus a content-free audit", async (mode) => {
    const f = await server.fixture({ mode });
    const authority = new OutpostRunnerToolAuthority(server.db, { ...f, workMode: mode });
    expect(authority.definitions().map(t => t.name)).toEqual(expect.arrayContaining(["submit_complaint", "submit_suggestion"]));
    const before = await f.snapshot();
    for (const tool of ["submit_complaint", "submit_suggestion"]) {
      const result = await authority.execute({ tool, callId: tool, arguments: { ...input, idempotencyKey: tool } });
      expect(result).toMatchObject({ kind: tool === "submit_complaint" ? "complaint" : "suggestion", replayed: false });
      expect(JSON.stringify(result)).not.toContain(input.body);
    }
    expect(await rows(f)).toEqual(expect.arrayContaining([
      expect.objectContaining({ spaceId: f.spaceId, agentId: f.agentId, issueId: f.issueId, body: input.body, kind: "complaint" }),
      expect.objectContaining({ kind: "suggestion" }),
    ]));
    const after = await f.snapshot();
    expect(after.issues).toEqual(before.issues);
    expect(after.comments).toEqual(before.comments);
    const [run] = await server.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(run.resultJson).toBeNull();
    const audit = await server.db.select().from(activityLog).where(and(eq(activityLog.runId, f.runId), eq(activityLog.action, "agent.commentary_submitted")));
    expect(audit).toHaveLength(2);
    expect(audit.every(a => Object.keys(a.details ?? {}).join() === "kind")).toBe(true);
  });

  it("deduplicates concurrent replay, rejects changed content, and imposes no suggestion quota", async () => {
    const f = await server.fixture();
    const submit = (args = input) => f.authority.execute({ tool: "submit_suggestion", callId: randomUUID(), arguments: args });
    const results = await Promise.all([submit(), submit(), submit()]) as Array<{ id: string; replayed: boolean }>;
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    expect(results.filter(r => !r.replayed)).toHaveLength(1);
    await expect(submit({ ...input, body: "different" })).rejects.toThrow(/different content/);
    for (let i = 0; i < 4; i++) await submit({ ...input, idempotencyKey: `new-${i}` });
    expect(await rows(f)).toHaveLength(5);
    expect(await server.db.select().from(activityLog).where(and(eq(activityLog.runId, f.runId), eq(activityLog.action, "agent.commentary_submitted")))).toHaveLength(5);
  });

  it("accepts document-sized text without truncation and redacts credential syntax", async () => {
    const f = await legacy();
    const body = "🙂".repeat(262_144);
    expect((await post(f, { ...input, kind: "suggestion", body })).status).toBe(201);
    expect((await rows(f))[0].body).toBe(body);
    expect((await post(f, { ...input, kind: "suggestion", body: body + "!" })).status).toBe(400);
    const secretBody = "It printed Authorization: Bearer sk-test-very-sensitive-credential before failing.";
    expect((await post(f, { ...input, kind: "complaint", body: secretBody, idempotencyKey: "secret" })).status).toBe(201);
    expect((await rows(f)).find(r => r.idempotencyKey === "secret")?.body).not.toContain("sk-test-very-sensitive-credential");
  });

  it("rejects spoofed input, cross-space HTTP access, operator access, and missing authentication", async () => {
    const f = await legacy();
    for (const spoof of [{ agentId: f.agentId }, { issueId: f.issueId }, { runId: f.runId }, { spaceId: f.spaceId }, { body: " \n" }]) {
      expect((await post(f, { ...input, kind: "complaint", ...spoof })).status).toBe(400);
    }
    expect((await post(f, { ...input, kind: "complaint" }, f.foreignSpaceId)).status).toBe(403);
    expect((await fetch(`${server.apiUrl}/api/spaces/${f.spaceId}/agent-commentary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, kind: "complaint" }) })).status).toBe(401);
    const operatorApp = express();
    operatorApp.use(express.json(), (req, _res, next) => { req.actor = { type: "operator", source: "local_implicit", userId: "operator" }; next(); });
    operatorApp.use("/api", agentCommentaryRoutes(server.db));
    operatorApp.use(errorHandler);
    expect((await request(operatorApp).post(`/api/spaces/${f.spaceId}/agent-commentary`).send({ ...input, kind: "complaint" })).status).toBe(403);
    await expect(submitAgentCommentary(server.db, { ...f, spaceId: f.foreignSpaceId }, { ...input, kind: "complaint" })).rejects.toThrow(/authenticated/);
    expect(await rows(f)).toHaveLength(0);
  });

  it("lets an agent read only its own commentary unless granted commentary:view, and names the human page when denied", async () => {
    const f = await legacy();
    expect((await post(f, { ...input, kind: "complaint" })).status).toBe(201);
    const [own] = await rows(f);
    const [space] = await server.db.select({ issuePrefix: spaces.issuePrefix }).from(spaces).where(eq(spaces.id, f.spaceId));
    const get = (path: string, spaceId = f.spaceId) => fetch(`${server.apiUrl}/api/spaces/${spaceId}/agent-commentary${path}`, { headers: { Authorization: `Bearer ${f.token}` } });
    const denied = async (response: Response) => {
      expect(response.status).toBe(403);
      const body = await response.json() as { error: string; remediation?: string };
      expect(body.error).toBe("Operator access required");
      expect(body.remediation).toContain(`[Commentary](/${space!.issuePrefix}/activity/commentary)`);
    };
    // Reading other agents' commentary is never a default agent grant.
    expect(NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS).not.toContain("commentary:view");
    // Default: other agents' feedback and the full list are denied; its own is readable.
    await denied(await get(""));
    await denied(await get(`?agentId=${randomUUID()}`));
    await denied(await get(`/${randomUUID()}`));
    const mine = await get(`?agentId=${f.agentId}`);
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { items: Array<{ id: string }> }).items.map(row => row.id)).toEqual([own!.id]);
    expect((await get(`/${own!.id}`)).status).toBe(200);
    // Another space's request fails on space access, with no page path.
    const foreign = await get("", f.foreignSpaceId);
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { remediation?: string }).remediation).toBeUndefined();
    // The explicit grant allows reading everyone's commentary.
    await server.db.insert(spaceMemberships).values({ spaceId: f.spaceId, principalType: "agent", principalId: f.agentId, status: "active", membershipRole: "member" }).onConflictDoNothing();
    await server.db.insert(principalPermissionGrants).values({ spaceId: f.spaceId, principalType: "agent", principalId: f.agentId, permissionKey: "commentary:view" });
    expect((await get("")).status).toBe(200);
  });

  it.each(["cancelled", "succeeded", "failed"])("rejects submissions and replay after the run is %s", async (status) => {
    const f = await legacy();
    expect((await post(f, { ...input, kind: "complaint" })).status).toBe(201);
    await server.db.update(heartbeatRuns).set({ status }).where(eq(heartbeatRuns.id, f.runId));
    expect((await post(f, { ...input, kind: "complaint" })).status).toBe(403);
    expect(await rows(f)).toHaveLength(1);
  });

  it("rejects native spoofing and paused agents without changing task state", async () => {
    const f = await server.fixture();
    await expect(f.authority.execute({ tool: "submit_complaint", callId: "spoof", arguments: { ...input, kind: "suggestion" } })).rejects.toThrow(/accepts only/);
    await server.db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.agentId));
    await expect(f.authority.execute({ tool: "submit_complaint", callId: "paused", arguments: input })).rejects.toThrow(/not_authorized/);
    expect(await rows(f)).toHaveLength(0);
  });

  it.each(["jwt", "api_key"])("rejects new feedback and replay with %s after Stop revokes a still-running legacy run", async (credential) => {
    const f = await legacy();
    if (credential === "api_key") {
      f.token = `pcp_${randomUUID()}`;
      const responsibleUserId = randomUUID();
      await server.db.insert(authUsers).values({ id: responsibleUserId, name: "Feedback key owner", email: `${responsibleUserId}@fixture.invalid`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
      await server.db.insert(spaceMemberships).values({ spaceId: f.spaceId, principalType: "user", principalId: responsibleUserId, status: "active", membershipRole: "member" });
      await server.db.insert(agentApiKeys).values({ spaceId: f.spaceId, agentId: f.agentId, responsibleUserId, name: "feedback", keyHash: createHash("sha256").update(f.token).digest("hex") });
    }
    expect((await post(f, { ...input, kind: "complaint" })).status).toBe(201);
    await server.db.update(heartbeatRuns).set({ resultJson: { executionCancellation: { state: "requested" } } }).where(eq(heartbeatRuns.id, f.runId));
    for (const idempotencyKey of [input.idempotencyKey, "after-stop"]) {
      const body = { ...input, kind: "complaint", idempotencyKey };
      expect((await post(f, body)).status).toBe(403);
      // The persistence boundary must also reject a request whose middleware
      // authenticated before Stop committed the revocation.
      await expect(submitAgentCommentary(server.db, f, body)).rejects.toThrow(/no longer authorized/);
    }
    expect(await rows(f)).toHaveLength(1);
    expect(await server.db.select().from(activityLog).where(and(eq(activityLog.runId, f.runId), eq(activityLog.action, "agent.commentary_submitted")))).toHaveLength(1);
  });

  it("rejects revoked legacy credentials, replaced run ownership, and specialized review tools", async () => {
    const f = await legacy();
    const token = `pcp_${randomUUID()}`;
    await server.db.insert(agentApiKeys).values({ spaceId: f.spaceId, agentId: f.agentId, name: "revoked", keyHash: createHash("sha256").update(token).digest("hex"), revokedAt: new Date() });
    expect((await post({ ...f, token }, { ...input, kind: "complaint" })).status).toBe(401);
    const native = await server.fixture();
    const replacementId = randomUUID();
    await server.db.insert(heartbeatRuns).values({ id: replacementId, spaceId: native.spaceId, agentId: native.agentId, status: "running", invocationSource: "on_demand" });
    await server.db.update(issues).set({ executionRunId: replacementId }).where(eq(issues.id, native.issueId));
    await expect(native.authority.execute({ tool: "submit_suggestion", callId: "stale", arguments: input })).rejects.toThrow();
    const reviewer = new OutpostRunnerToolAuthority(server.db, { ...native, nativeReview: { nativeReviewInteractionId: randomUUID(), nativeReviewDecisionId: randomUUID() } });
    expect(reviewer.definitions().map(t => t.name)).not.toContain("submit_complaint");
    expect(reviewer.definitions().map(t => t.name)).not.toContain("submit_suggestion");
    await expect(reviewer.execute({ tool: "submit_complaint", callId: "review", arguments: input })).rejects.toThrow();
    expect(await rows(f)).toHaveLength(0);
    expect(await rows(native)).toHaveLength(0);
  });

  it("rejects native feedback after an accepted finish even while the provider is still running", async () => {
    const f = await server.fixture();
    const { row: contract } = await ensureNativeCompletionContract({ db: server.db, spaceId: f.spaceId, issue: { id: f.issueId, title: "Test", description: null }, actorId: "test" });
    await server.db.update(heartbeatRuns).set({ completionContractId: contract.id }).where(eq(heartbeatRuns.id, f.runId));
    await server.db.insert(nativeRunResults).values({
      spaceId: f.spaceId, issueId: f.issueId, runId: f.runId, completionContractId: contract.id,
      serverFingerprint: randomUUID(), schemaStatus: "accepted", resultJson: {}, canonicalSha256: "test",
    });
    await expect(f.authority.execute({ tool: "submit_complaint", callId: "late", arguments: input })).rejects.toThrow(/before finishing/);
    expect(await rows(f)).toHaveLength(0);
  });

  it("retains feedback after task deletion and removes it with the run", async () => {
    const f = await legacy();
    await post(f, { ...input, kind: "complaint" });
    await server.db.delete(issues).where(eq(issues.id, f.issueId));
    expect((await rows(f))[0].issueId).toBeNull();
    await server.db.delete(activityLog).where(eq(activityLog.runId, f.runId));
    await server.db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(await rows(f)).toHaveLength(0);
  });

  it.each(["agent", "space"])("uses existing %s deletion handling", async (owner) => {
    const f = await legacy();
    // A taskless run also verifies optional issue attribution, without unrelated
    // fixture approval records that deliberately prevent deleting their author.
    const agentId = randomUUID(), runId = randomUUID();
    await server.db.insert(agents).values({ id: agentId, spaceId: f.spaceId, name: "Feedback author", adapterType: "codex_local", status: "active" });
    await server.db.insert(heartbeatRuns).values({ id: runId, spaceId: f.spaceId, agentId, status: "running", invocationSource: "on_demand" });
    await submitAgentCommentary(server.db, { spaceId: f.spaceId, agentId, runId }, { ...input, kind: "complaint" });
    expect((await rows({ ...f, runId }))[0].issueId).toBeNull();
    if (owner === "agent") {
      await server.db.update(agents).set({ lifecycleState: "terminated", status: "terminated" }).where(eq(agents.id, agentId));
      await agentService(server.db).remove(agentId);
    }
    else await spaceService(server.db).remove(f.spaceId);
    expect(await rows({ ...f, runId })).toHaveLength(0);
  });

  it("rolls back feedback when its audit insert fails and sanitizes the database error", async () => {
    const f = await legacy();
    await server.db.execute(sql.raw(`CREATE FUNCTION fail_commentary_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'agent.commentary_submitted' THEN RAISE EXCEPTION 'private database canary'; END IF; RETURN NEW; END $$`));
    await server.db.execute(sql.raw(`CREATE TRIGGER fail_commentary_audit BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION fail_commentary_audit()`));
    try {
      const response = await post(f, { ...input, kind: "complaint" });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/private database canary|The tool returned/);
      expect(await rows(f)).toHaveLength(0);
      const [run] = await server.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
      expect(run.status).toBe("running");
    } finally {
      await server.db.execute(sql.raw("DROP TRIGGER fail_commentary_audit ON activity_log"));
      await server.db.execute(sql.raw("DROP FUNCTION fail_commentary_audit()"));
    }
  });

  it("runs the legacy stdin helper and handles failure silently without exposing its body", async () => {
    const f = await legacy();
    const helper = fileURLToPath(new URL("../../../skills/outpost/scripts/submit-agent-commentary.mjs", import.meta.url));
    const body = "Quotes, `backticks`, $(printf should-not-run), and emoji 😭 stay text.\n";
    async function run(apiUrl: string) {
      return new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [helper, "complaint", "helper-one"], { env: { ...process.env, OUTPOST_API_URL: apiUrl, OUTPOST_API_KEY: f.token, OUTPOST_SPACE_ID: f.spaceId, OUTPOST_RUN_ID: f.runId }, stdio: "pipe" });
        let out = "", err = "";
        child.stdout.on("data", c => out += c); child.stderr.on("data", c => err += c);
        child.on("error", reject); child.on("close", code => resolve({ code, out, err }));
        child.stdin.end(body);
      });
    }
    expect(await run(server.apiUrl)).toEqual({ code: 0, out: "Feedback stored.\n", err: "" });
    expect(await run(server.apiUrl + "/api/")).toEqual({ code: 0, out: "Feedback stored.\n", err: "" });
    expect(await rows(f)).toHaveLength(1);
    expect((await rows(f))[0].body).toBe(body);
    const failed = await run("http://127.0.0.1:1");
    expect(failed).toMatchObject({ code: 0, out: "" });
    expect(failed.err).toContain("continue the primary task");
    expect(failed.err).not.toContain(f.token);
    expect(failed.err).not.toContain(body);
    expect(isSecretSensitiveHttpRequest("POST", `/api/spaces/${f.spaceId}/agent-commentary`)).toBe(true);
  });
});
