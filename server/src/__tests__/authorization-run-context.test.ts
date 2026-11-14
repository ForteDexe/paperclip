import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agents, spaces, spaceMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, projects, type Db } from '@outpost/db';
import { LOW_TRUST_REVIEW_PRESET } from '@outpost/shared';
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from './helpers/embedded-postgres.js';
import { authorizationService } from '../services/authorization.js';

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)('authorization run context transfer', () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let client: ReturnType<typeof createDb>['$client'];
  let db: Db;
  let recording = false;
  let jsonBytes: number[] = [];
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase('outpost-authorization-context-');
    db = createDb(database.connectionString, { maxConnections: 1 });
    client = db.$client;
    client.options.transform.value.from = (value, column) => {
      if (recording && column?.type === 3802 && value !== null) jsonBytes.push(Buffer.byteLength(JSON.stringify(value)));
      return value;
    };
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  beforeEach(() => { recording = false; jsonBytes = []; });
  afterAll(async () => { await client?.end({ timeout: 5 }); await database?.cleanup(); });

  async function seed() {
    const spaceId = randomUUID(), agentId = randomUUID(), projectId = randomUUID(), runId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: 'Context transfer', issuePrefix: `CT${spaceId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, spaceId, name: 'Reader', role: 'engineer', adapterType: 'process' });
    await db.insert(projects).values({ id: projectId, spaceId, name: 'Allowed project' });
    await db.insert(spaceMemberships).values({ spaceId, principalType: 'agent', principalId: agentId, status: 'active', membershipRole: 'member' });
    const actor = { type: 'agent' as const, source: 'agent_jwt' as const, spaceId, agentId, runId };
    return { spaceId, agentId, projectId, runId, actor };
  }

  it('retains saved run restrictions without transferring unrelated context', async () => {
    const fixture = await seed();
    await db.insert(heartbeatRuns).values({ id: fixture.runId, spaceId: fixture.spaceId, agentId: fixture.agentId,
      contextSnapshot: { contextPadding: 'unrelated'.repeat(32_768), executionPolicy: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: { trustBoundary: { mode: LOW_TRUST_REVIEW_PRESET, projectIds: [fixture.projectId] } },
      } } });
    recording = true;
    expect(await authorizationService(db).projectDiscoveryCandidateIds(fixture.actor, fixture.spaceId)).toEqual([fixture.projectId]);
    expect(jsonBytes.length).toBeGreaterThan(0);
    expect(Math.max(...jsonBytes)).toBeLessThan(1024);
  });

  it('keeps batched saved policy checks below the context transfer budget', async () => {
    const fixture = await seed();
    await db.insert(heartbeatRuns).values({ id: fixture.runId, spaceId: fixture.spaceId, agentId: fixture.agentId,
      contextSnapshot: { contextPadding: 'unrelated'.repeat(32_768), executionPolicy: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: { trustBoundary: { mode: LOW_TRUST_REVIEW_PRESET, projectIds: [fixture.projectId] } },
      } } });
    recording = true;
    const decisions = await authorizationService(db).decideReads(fixture.actor,
      [{ type: 'project', spaceId: fixture.spaceId, projectId: fixture.projectId }]);
    expect(decisions.map(decision => decision.allowed)).toEqual([true]);
    expect(jsonBytes.length).toBeGreaterThan(0);
    expect(Math.max(...jsonBytes)).toBeLessThan(1024);
  });

  it.each([undefined, null, [], 'invalid', 42, true, {}])('keeps the standard fallback for saved policy %j', async executionPolicy => {
    const fixture = await seed();
    await db.insert(heartbeatRuns).values({ id: fixture.runId, spaceId: fixture.spaceId, agentId: fixture.agentId,
      contextSnapshot: { contextPadding: 'unrelated'.repeat(32_768), executionPolicy } });
    recording = true;
    expect(await authorizationService(db).projectDiscoveryCandidateIds(fixture.actor, fixture.spaceId)).toBeNull();
    expect(jsonBytes.length).toBeGreaterThan(0);
    expect(Math.max(...jsonBytes)).toBeLessThan(1024);
  });

  it.each([null, [], 'legacy', 42, true])('keeps the standard fallback for context container %j', async context => {
    const fixture = await seed();
    await db.insert(heartbeatRuns).values({ id: fixture.runId, spaceId: fixture.spaceId, agentId: fixture.agentId });
    await db.execute(sql`update ${heartbeatRuns} set context_snapshot=${JSON.stringify(context)}::jsonb
      where ${heartbeatRuns.id}=${fixture.runId} and ${heartbeatRuns.spaceId}=${fixture.spaceId}`);
    expect(await authorizationService(db).projectDiscoveryCandidateIds(fixture.actor, fixture.spaceId)).toBeNull();
  });

  it.each(['space', 'agent'])('does not take policy from another %s identity', async mismatch => {
    const fixture = await seed(), other = await seed();
    if (mismatch === 'agent') await db.update(agents).set({ spaceId: fixture.spaceId }).where(eq(agents.id, other.agentId));
    await db.insert(heartbeatRuns).values({ id: other.runId,
      spaceId: mismatch === 'space' ? other.spaceId : fixture.spaceId, agentId: other.agentId,
      contextSnapshot: { contextPadding: 'unrelated'.repeat(32_768), executionPolicy: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: { trustBoundary: { mode: LOW_TRUST_REVIEW_PRESET, projectIds: [other.projectId] } },
      } } });
    recording = true;
    expect(await authorizationService(db).projectDiscoveryCandidateIds({ ...fixture.actor, runId: other.runId }, fixture.spaceId)).toBeNull();
    expect(Math.max(...jsonBytes)).toBeLessThan(1024);
  });

  it.each(['issueId', 'taskId'])('retains the direct-parent report for legacy context key %s', async key => {
    const fixture = await seed(), parentId = randomUUID(), childId = randomUUID();
    await db.insert(issues).values({ id: parentId, spaceId: fixture.spaceId, projectId: fixture.projectId, title: 'Parent' });
    await db.insert(issues).values({ id: childId, spaceId: fixture.spaceId, projectId: fixture.projectId, parentId,
      assigneeAgentId: fixture.agentId, title: 'Child' });
    await db.insert(heartbeatRuns).values({ id: fixture.runId, spaceId: fixture.spaceId, agentId: fixture.agentId,
      contextSnapshot: { [key]: childId, contextPadding: 'unrelated'.repeat(32_768) } });
    await db.update(issues).set({ checkoutRunId: fixture.runId }).where(eq(issues.id, childId));
    recording = true;
    const decision = await authorizationService(db).decide({ actor: fixture.actor, action: 'issue:comment',
      resource: { type: 'issue', spaceId: fixture.spaceId, projectId: fixture.projectId, issueId: parentId } });
    expect(decision).toMatchObject({ allowed: true, reason: 'allow_direct_parent_report' });
    expect(jsonBytes.length).toBeGreaterThan(0);
    expect(Math.max(...jsonBytes)).toBeLessThan(1024);
  });
});
