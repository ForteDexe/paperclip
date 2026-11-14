import { randomUUID } from "node:crypto";
import { OutpostRunnerToolAuthority } from "./outpost-runner-tool-authority.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { activityLog, spaceSkills, spaceMemberships, heartbeatRuns, issues } from "@outpost/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startRunnerApiTestServer } from "../../__tests__/helpers/runner-api-server.js";
import { spaceSkillPolicyService } from "../space-skill-policy.js";
import { spaceSkillService } from "../space-skills.js";
import { activityService } from "../activity.js";

describe("runner create_skill through the real skill API", () => {
  let server: Awaited<ReturnType<typeof startRunnerApiTestServer>>;
  let home: string;
  const previousSecret = process.env.OUTPOST_AGENT_JWT_SECRET;
  const previousHome = process.env.OUTPOST_HOME;
  beforeAll(async () => {
    process.env.OUTPOST_AGENT_JWT_SECRET = randomUUID();
    home = await mkdtemp(join(tmpdir(), "outpost-create-skill-"));
    process.env.OUTPOST_HOME = home;
    server = await startRunnerApiTestServer();
  }, 60_000);
  afterAll(async () => {
    await server?.close();
    if (previousSecret === undefined) delete process.env.OUTPOST_AGENT_JWT_SECRET;
    else process.env.OUTPOST_AGENT_JWT_SECRET = previousSecret;
    if (previousHome === undefined) delete process.env.OUTPOST_HOME;
    else process.env.OUTPOST_HOME = previousHome;
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function fixture(options: Parameters<typeof server.fixture>[0] = {}) {
    const result = await server.fixture(options);
    await server.db.insert(spaceMemberships).values({ spaceId: result.spaceId, principalType: "agent", principalId: result.agentId, status: "active", membershipRole: "member" });
    return result;
  }

  const args = {
    name: "release-review", description: "Review release notes.", idempotencyKey: "release-review-1",
    markdown: "---\nname: release-review\ndescription: Review release notes.\n---\n\n# Review\nCheck each release note against the change.\n",
  };

  it("creates one skill and one task-feed event across response retries", async () => {
    const testFixture = await fixture();
    expect(testFixture.authority.definitions().some(tool => tool.name === "create_skill")).toBe(true);
    const call = (callId: string) => testFixture.authority.execute({ tool: "create_skill", callId, arguments: args });
    const first = await call("first");
    expect(await call("lost-response-retry")).toEqual(first);
    const skills = await server.db.select().from(spaceSkills).where(eq(spaceSkills.spaceId, testFixture.spaceId));
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: args.name, markdown: args.markdown });
    const service = spaceSkillService(server.db);
    expect((await service.readFile(testFixture.spaceId, skills[0]!.id, "SKILL.md"))?.content).toBe(args.markdown);
    expect(await service.listVersions(testFixture.spaceId, skills[0]!.id)).toHaveLength(1);
    const events = (await activityService(server.db).forIssue(testFixture.issueId)).filter(e => e.action === "space.skill_created");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityId: skills[0]!.id, details: { sourceIssueId: testFixture.issueId, versionId: skills[0]!.currentVersionId } });
    await expect(testFixture.authority.execute({ tool: "create_skill", callId: "conflict", arguments: { ...args, markdown: args.markdown + "Different instructions." } })).rejects.toThrow(/different inputs/);
    expect((await service.readFile(testFixture.spaceId, skills[0]!.id, "SKILL.md"))?.content).toBe(args.markdown);
  });

  it("enforces explicit space policy before a write", async () => {
    const testFixture = await fixture();
    await spaceSkillPolicyService(server.db).replace({ spaceId: testFixture.spaceId, expectedRevision: 0,
      policy: { schemaVersion: 1, defaultEffect: "deny", rules: [] },
      activity: { actorType: "user", actorId: "test-operator" } });
    await expect(testFixture.authority.execute({ tool: "create_skill", callId: "policy-denied", arguments: args })).rejects.toThrow(/space policy/);
    expect(await server.db.select().from(spaceSkills).where(eq(spaceSkills.spaceId, testFixture.spaceId))).toHaveLength(0);
  });

  it("recovers a concurrent or replacement-run retry without creating another skill", async () => {
    const testFixture = await fixture();
    const [first, duplicate] = await Promise.all(["first", "concurrent"].map(callId =>
      testFixture.authority.execute({ tool: "create_skill", callId, arguments: args })));
    expect(duplicate).toEqual(first);

    const replacementRunId = randomUUID();
    await server.db.update(heartbeatRuns).set({ status: "failed" }).where(eq(heartbeatRuns.id, testFixture.runId));
    await server.db.insert(heartbeatRuns).values({
      id: replacementRunId, spaceId: testFixture.spaceId, agentId: testFixture.agentId,
      status: "running", runtimeMode: "native", nativeIssueId: testFixture.issueId,
      invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId: testFixture.issueId },
    });
    await server.db.update(issues).set({ executionRunId: replacementRunId }).where(eq(issues.id, testFixture.issueId));
    const replacement = new OutpostRunnerToolAuthority(server.db, { ...testFixture, runId: replacementRunId });
    expect(await replacement.execute({ tool: "create_skill", callId: "recovered", arguments: args })).toEqual(first);
    await expect(testFixture.authority.execute({ tool: "create_skill", callId: "stale", arguments: args })).rejects.toThrow();
    expect(await server.db.select().from(spaceSkills).where(eq(spaceSkills.spaceId, testFixture.spaceId))).toHaveLength(1);
    expect((await activityService(server.db).forIssue(testFixture.issueId)).filter(e => e.action === "space.skill_created")).toHaveLength(1);
  });

  it("rechecks space policy when a completed call is retried", async () => {
    const testFixture = await fixture();
    await testFixture.authority.execute({ tool: "create_skill", callId: "allowed", arguments: args });
    await spaceSkillPolicyService(server.db).replace({ spaceId: testFixture.spaceId, expectedRevision: 0,
      policy: { schemaVersion: 1, defaultEffect: "deny", rules: [] },
      activity: { actorType: "user", actorId: "test-operator" } });
    await expect(testFixture.authority.execute({ tool: "create_skill", callId: "revoked-retry", arguments: args })).rejects.toThrow(/space policy/);
    expect(await server.db.select().from(spaceSkills).where(eq(spaceSkills.spaceId, testFixture.spaceId))).toHaveLength(1);
  });

  it("does not create skills in planning mode", async () => {
    const testFixture = await fixture({ mode: "planning" });
    expect(new OutpostRunnerToolAuthority(server.db, { ...testFixture, workMode: "planning" }).definitions().some(tool => tool.name === "create_skill")).toBe(false);
    await expect(testFixture.authority.execute({ tool: "create_skill", callId: "plan", arguments: args })).rejects.toThrow();
    expect(await server.db.select().from(spaceSkills).where(eq(spaceSkills.spaceId, testFixture.spaceId))).toHaveLength(0);
  });

  it("isolates space names and creation history", async () => {
    const a = await fixture(), b = await fixture();
    const first = await a.authority.execute({ tool: "create_skill", callId: "a", arguments: args }) as { id: string };
    const second = await b.authority.execute({ tool: "create_skill", callId: "b", arguments: args }) as { id: string };
    expect(first.id).not.toBe(second.id);
    expect(await spaceSkillService(server.db).getById(b.spaceId, first.id)).toBeNull();
    expect(await server.db.select().from(activityLog).where(and(eq(activityLog.spaceId, a.spaceId), eq(activityLog.action, "space.skill_created")))).toHaveLength(1);
  });
});
