// Local SQL benchmark for the run liveness backfill candidate lookup.
// Usage: pnpm --filter @outpost/server exec tsx ../scripts/benchmark-run-liveness-backfill.ts --baseline-ref=<pre-fix sha>
// The baseline query is the pre-fix builder from activity.ts, copied verbatim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, or, sql } from "../server/node_modules/drizzle-orm/index.js";
import { activityLog, agents, spaces, createDb, heartbeatRuns, issues, startEmbeddedPostgresTestDatabase, type Db }
  from "../packages/db/src/index.js";
import { missingRunLivenessCandidatesQuery } from "../server/src/services/run-liveness-backfill-query.js";

type Query = { sql: string; params: unknown[] };
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const baselineRef = process.argv.find(arg => arg.startsWith("--baseline-ref="))?.slice(15);
assert.ok(baselineRef, "Pass a pinned pre-fix --baseline-ref");
const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const baselineRevision = git("rev-parse", "--verify", `${baselineRef}^{commit}`);
const baselineSource = git("show", `${baselineRevision}:server/src/services/activity.ts`);
assert.ok(baselineSource.includes("${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,\n            sql`exists ("),
  "Baseline revision must contain the pre-fix candidate query");

function baselineQuery(db: Db, spaceId: string, issueId: string, limit: number) {
  return db
    .select({
      id: heartbeatRuns.id, spaceId: heartbeatRuns.spaceId, status: heartbeatRuns.status,
      contextSnapshot: heartbeatRuns.contextSnapshot, resultJson: heartbeatRuns.resultJson,
      stdoutExcerpt: heartbeatRuns.stdoutExcerpt, stderrExcerpt: heartbeatRuns.stderrExcerpt, error: heartbeatRuns.error,
      errorCode: heartbeatRuns.errorCode, continuationAttempt: heartbeatRuns.continuationAttempt,
    })
    .from(heartbeatRuns)
    .where(and(
      eq(heartbeatRuns.spaceId, spaceId),
      isNull(heartbeatRuns.livenessState),
      sql`${heartbeatRuns.status} not in ('queued', 'running')`,
      or(
        sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
        sql`exists (
          select 1
          from ${activityLog}
          where ${activityLog.spaceId} = ${spaceId}
            and ${activityLog.entityType} = 'issue'
            and ${activityLog.entityId} = ${issueId}
            and ${activityLog.runId} = ${heartbeatRuns.id}
        )`,
      ),
    ))
    .limit(limit);
}

const fixtures = [
  { name: "clean issue, many unclassified runs elsewhere", unclassifiedElsewhere: 6000, classified: 30000, activity: 300000, targetMissing: 0 },
  { name: "issue with 3 missing, many unclassified runs elsewhere", unclassifiedElsewhere: 6000, classified: 30000, activity: 300000, targetMissing: 3 },
  { name: "issue with 25 missing (more than one batch)", unclassifiedElsewhere: 6000, classified: 30000, activity: 300000, targetMissing: 25 },
  { name: "small control", unclassifiedElsewhere: 50, classified: 500, activity: 2000, targetMissing: 3 },
];

const keepAlive = setInterval(() => {}, 1000);
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
let db: Db | undefined;
try {
  database = await startEmbeddedPostgresTestDatabase("run-liveness-backfill-benchmark-");
  db = createDb(database.connectionString);
  const client = db.$client;
  const [settings] = await client.unsafe("select version(), current_setting('shared_buffers') shared_buffers, current_setting('work_mem') work_mem, current_setting('jit') jit");
  const results = [];
  for (const fixture of fixtures) {
    await client.unsafe("set client_min_messages = warning");
    await client.unsafe("truncate activity_log, heartbeat_runs, issues, agents, spaces cascade");
    const spaceId = randomUUID(), otherSpaceId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(spaces).values([
      { id: spaceId, name: "Fixture", issuePrefix: `L${spaceId.replaceAll("-", "").slice(0, 8)}` },
      { id: otherSpaceId, name: "Decoy", issuePrefix: `D${otherSpaceId.replaceAll("-", "").slice(0, 8)}` },
    ]);
    await db.insert(agents).values([
      { id: agentId, spaceId, name: "Fixture", adapterType: "codex_local" },
      { id: otherAgentId, spaceId: otherSpaceId, name: "Decoy", adapterType: "codex_local" },
    ]);
    await db.insert(issues).values({ id: issueId, spaceId, title: "Target", status: "in_progress", assigneeAgentId: agentId });
    // 400 other issue ids in the same space.
    await client.unsafe(`insert into issues (id, space_id, title, status)
      select gen_random_uuid(), $1, 'Other ' || g, 'todo' from generate_series(1, 400) g`, [spaceId]);
    // Wide, mostly incompressible context: hex digests, about 20 KiB each.
    const blob = `(select string_agg(md5(random()::text || g || s), '') from generate_series(1, 640) s)`;
    const otherIssues = `(select array_agg(id::text order by id) ids from issues where space_id = $1 and id::text <> $4::text)`;
    // Classified runs across the space (the common case).
    await client.unsafe(`insert into heartbeat_runs (space_id, agent_id, status, liveness_state, context_snapshot, created_at)
      select $1, $2, 'succeeded', 'advanced', jsonb_build_object('issueId', other.ids[1 + g % 400]),
        now() - (g || ' seconds')::interval
      from generate_series(1, $3::int) g, ${otherIssues} other`, [spaceId, agentId, fixture.classified, issueId]);
    // Unclassified finished runs of other issues and of no issue. They never match the target issue.
    await client.unsafe(`insert into heartbeat_runs (space_id, agent_id, status, liveness_state, context_snapshot, created_at)
      select $1, $2, case when g % 3 = 0 then 'cancelled' when g % 3 = 1 then 'failed' else 'timed_out' end, null,
        case when g % 4 = 0 then jsonb_build_object('blob', ${blob})
          else jsonb_build_object('issueId', other.ids[1 + g % 400], 'blob', ${blob}) end,
        now() - (g || ' minutes')::interval
      from generate_series(1, $3::int) g, ${otherIssues} other`, [spaceId, agentId, fixture.unclassifiedElsewhere, issueId]);
    // Target issue: classified history, missing rows via context, missing rows linked only by activity,
    // one running run (excluded), and a cross-space decoy naming the same issue id.
    await client.unsafe(`insert into heartbeat_runs (space_id, agent_id, status, liveness_state, context_snapshot)
      select $1, $2, 'succeeded', 'completed', jsonb_build_object('issueId', $3::text, 'blob', ${blob}) from generate_series(1, 40) g`,
      [spaceId, agentId, issueId]);
    const viaContext = Math.ceil(fixture.targetMissing / 2), viaActivity = fixture.targetMissing - viaContext;
    await client.unsafe(`insert into heartbeat_runs (space_id, agent_id, status, liveness_state, context_snapshot)
      select $1, $2, 'failed', null, jsonb_build_object('issueId', $3::text, 'blob', ${blob}) from generate_series(1, $4::int) g`,
      [spaceId, agentId, issueId, viaContext]);
    await client.unsafe(`with runs as (
        insert into heartbeat_runs (space_id, agent_id, status, liveness_state, context_snapshot)
        select $1, $2, 'cancelled', null, jsonb_build_object('blob', ${blob}) from generate_series(1, $4::int) g returning id)
      insert into activity_log (space_id, actor_id, action, entity_type, entity_id, run_id)
      select $1, 'agent', 'issue.updated', 'issue', $3, id from runs`, [spaceId, agentId, issueId, viaActivity]);
    await client.unsafe(`insert into heartbeat_runs (space_id, agent_id, status, liveness_state, context_snapshot)
      values ($1, $2, 'running', null, jsonb_build_object('issueId', $3::text))`, [spaceId, agentId, issueId]);
    await client.unsafe(`insert into heartbeat_runs (space_id, agent_id, status, liveness_state, context_snapshot)
      values ($1, $2, 'failed', null, jsonb_build_object('issueId', $3::text))`, [otherSpaceId, otherAgentId, issueId]);
    // Activity log: about half the rows carry a run id of a run that is not the target issue's.
    // Issue entities spread over the other issues; the target issue has its own history too.
    await client.unsafe(`insert into activity_log (space_id, actor_id, action, entity_type, entity_id, run_id, created_at)
      select $1, 'agent', 'issue.updated', 'issue', other.ids[1 + g % 400],
        case when g % 2 = 0 then runs.ids[1 + g % array_length(runs.ids, 1)] end,
        now() - (g || ' seconds')::interval
      from generate_series(1, $2::int) g, ${otherIssues.replace("$4", "$3")} other,
        (select array_agg(id order by id) ids from heartbeat_runs
          where space_id = $1 and context_snapshot ->> 'issueId' is distinct from $3) runs`,
      [spaceId, fixture.activity, issueId]);
    await client.unsafe(`insert into activity_log (space_id, actor_id, action, entity_type, entity_id, run_id)
      select $1, 'agent', 'issue.comment_added', 'issue', $2, case when g % 2 = 0 then runs.ids[1 + g % 40] end
      from generate_series(1, 200) g, (select array_agg(id order by id) ids from heartbeat_runs
        where space_id = $1 and context_snapshot ->> 'issueId' = $2 and liveness_state = 'completed') runs`,
      [spaceId, issueId]);
    await client.unsafe("vacuum analyze");

    const before = baselineQuery(db, spaceId, issueId, 20).toSQL() as Query;
    const after = missingRunLivenessCandidatesQuery(db, spaceId, issueId, 20).toSQL() as Query;
    const execute = async (query: Query) => client.unsafe(query.sql, query.params as never[]).values();
    // Equivalence on the complete candidate set (no limit), every column, stable order.
    const sortRows = (rows: unknown[][]) => rows.map(row => JSON.stringify(row)).sort();
    const fullBefore = sortRows(await execute(baselineQuery(db, spaceId, issueId, 100000).toSQL() as Query));
    const fullAfter = sortRows(await execute(missingRunLivenessCandidatesQuery(db, spaceId, issueId, 100000).toSQL() as Query));
    assert.deepEqual(fullAfter, fullBefore, "Full candidate set must match on every column");
    assert.equal(fullAfter.length, fixture.targetMissing);
    const limitedAfter = sortRows(await execute(after));
    assert.equal(limitedAfter.length, Math.min(20, fixture.targetMissing));
    assert.ok(limitedAfter.every(row => fullBefore.includes(row)), "Limited batch must come from the baseline candidate set");

    const samples = { baseline: [] as number[], treatment: [] as number[] };
    for (let round = 0; round < 13; round++) {
      for (const arm of round % 2 ? ["treatment", "baseline"] as const : ["baseline", "treatment"] as const) {
        const start = performance.now();
        await execute(arm === "baseline" ? before : after);
        if (round >= 2) samples[arm].push(performance.now() - start);
      }
    }
    const explain = async (query: Query) => {
      const [row] = await client.unsafe(`explain (analyze, buffers, format json) ${query.sql}`, query.params as never[]);
      const plan = (row!["QUERY PLAN"] as Array<{ Plan: Record<string, unknown>; "Execution Time": number }>)[0]!;
      return { executionMs: plan["Execution Time"], sharedHit: plan.Plan["Shared Hit Blocks"], sharedRead: plan.Plan["Shared Read Blocks"] };
    };
    const summarize = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      return { medianMs: +median.toFixed(3), minMs: +sorted[0]!.toFixed(3), maxMs: +sorted.at(-1)!.toFixed(3) };
    };
    const b = summarize(samples.baseline), t = summarize(samples.treatment);
    results.push({ fixture, candidates: fullAfter.length, fullSetEquality: true,
      baseline: { ...b, plan: await explain(before) }, treatment: { ...t, plan: await explain(after) },
      speedup: +(b.medianMs / t.medianMs).toFixed(1) });
  }
  console.log(JSON.stringify({ baselineRevision, treatmentRevision: git("rev-parse", "HEAD"),
    treatmentDirty: git("status", "--porcelain", "--", "server/src/services/activity.ts", "server/src/services/run-liveness-backfill-query.ts") !== "",
    settings, node: process.version, warmupsPerArm: 2, measuredSamplesPerArm: 11, results }, null, 2));
} finally {
  try { await db?.$client.end({ timeout: 0 }); await database?.cleanup(); }
  finally { clearInterval(keepAlive); }
}
