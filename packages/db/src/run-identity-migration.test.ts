import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const migrations = [
  "0240_pink_fantastic_four.sql", "0241_conscious_adam_destine.sql",
  "0242_wide_lightspeed.sql", "0243_sleepy_metal_master.sql", "0244_organic_meltdown.sql", "0245_misty_nightshade.sql",
].map((name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), "utf8"));

(support.supported ? describe : describe.skip)("execution identity migration", () => {
  it("can replay without inventing historical authorship or losing accepted contexts", async () => {
    const database = await startEmbeddedPostgresTestDatabase("outpost-identity-migration-");
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      const spaceId = randomUUID(), agentId = randomUUID(), historicalRunId = randomUUID(), runId = randomUUID(), contextId = randomUUID();
      await sql`INSERT INTO spaces (id, name, issue_prefix) VALUES (${spaceId}, 'Identity migration', 'MIG')`;
      await sql`INSERT INTO agents (id, space_id, name, role, adapter_type) VALUES (${agentId}, ${spaceId}, 'Shared', 'engineer', 'codex_local')`;
      await sql`INSERT INTO heartbeat_runs (id, space_id, agent_id, status) VALUES
        (${historicalRunId}, ${spaceId}, ${agentId}, 'succeeded'), (${runId}, ${spaceId}, ${agentId}, 'running')`;
      await sql`INSERT INTO run_identity_contexts (id, space_id, run_id, revision, responsible_user_id, cause, correlation_id, accepted_at)
        VALUES (${contextId}, ${spaceId}, ${runId}, 1, 'person-a', 'instruction', 'dispatch', now())`;
      await sql`UPDATE heartbeat_runs SET active_identity_context_id = ${contextId}, responsible_user_id = 'person-a' WHERE id = ${runId}`;
      for (let pass = 0; pass < 2; pass++) {
        for (const migration of migrations) {
          for (const statement of migration.split('--> statement-breakpoint')) {
            if (statement.trim()) await sql.unsafe(statement);
          }
        }
      }
      const [historical] = await sql`SELECT active_identity_context_id, responsible_user_id FROM heartbeat_runs WHERE id = ${historicalRunId}`;
      expect(historical).toEqual({ active_identity_context_id: null, responsible_user_id: null });
      const contexts = await sql`SELECT id, responsible_user_id FROM run_identity_contexts WHERE space_id = ${spaceId}`;
      expect(contexts).toEqual([{ id: contextId, responsible_user_id: 'person-a' }]);
      const [active] = await sql`SELECT active_identity_context_id FROM heartbeat_runs WHERE id = ${runId}`;
      expect(active.active_identity_context_id).toBe(contextId);
      // Agent removal deletes its run rows, but surviving task continuations
      // must retain attribution. Even replaying the migration set must be safe.
      await sql`DELETE FROM heartbeat_runs WHERE id = ${runId}`;
      for (const migration of migrations) {
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await sql.unsafe(statement);
        }
      }
      const [retained] = await sql`SELECT run_id, responsible_user_id FROM run_identity_contexts WHERE id = ${contextId}`;
      expect(retained).toEqual({ run_id: runId, responsible_user_id: 'person-a' });
      await sql`DELETE FROM heartbeat_runs WHERE space_id = ${spaceId}`;
      await sql`DELETE FROM agents WHERE space_id = ${spaceId}`;
      await sql`DELETE FROM spaces WHERE id = ${spaceId}`;
      expect(await sql`SELECT id FROM run_identity_contexts WHERE id = ${contextId}`).toHaveLength(0);
    } finally {
      await sql.end();
      await database.cleanup();
    }
  }, 30_000);
});
