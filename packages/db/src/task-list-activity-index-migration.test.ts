import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { applyPendingMigrations } from "./client.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const indexName = "activity_log_space_entity_created_idx";
const migrationFile = "0414_closed_edwin_jarvis.sql";

(support.supported ? describe : describe.skip)("task-list activity index migration", () => {
  it("repairs an unjournaled invalid index and records one receipt after concurrent replay", async () => {
    const database = await startEmbeddedPostgresTestDatabase("task-activity-index-");
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      const spaces = await sql`INSERT INTO spaces (name,issue_prefix) VALUES ('First','TAI1'),('Second','TAI2') RETURNING id`;
      await sql`INSERT INTO activity_log(space_id,actor_id,action,entity_type,entity_id)
        VALUES (${spaces[0]!.id},'reader','issue.updated','issue','canonical-task')`;
      const content = await readFile(new URL(`./migrations/${migrationFile}`, import.meta.url), "utf8");
      const hash = createHash("sha256").update(content).digest("hex");
      await sql`DELETE FROM drizzle.__drizzle_migrations WHERE hash=${hash}`;
      await sql.unsafe(`DROP INDEX ${indexName}`);
      await expect(sql.unsafe(`CREATE UNIQUE INDEX CONCURRENTLY ${indexName} ON spaces ((true))`)).rejects.toThrow();
      const [invalid] = await sql`SELECT indisvalid FROM pg_index WHERE indexrelid=${indexName}::regclass`;
      expect(invalid!.indisvalid).toBe(false);
      await Promise.all([applyPendingMigrations(database.connectionString), applyPendingMigrations(database.connectionString)]);
      const [rebuilt] = await sql`SELECT indisvalid,indisunique,pg_get_indexdef(indexrelid) definition
        FROM pg_index WHERE indexrelid=${indexName}::regclass`;
      expect(rebuilt!.indisvalid).toBe(true);
      expect(rebuilt!.indisunique).toBe(false);
      expect(rebuilt!.definition).toContain("activity_log");
      expect(rebuilt!.definition).toContain("space_id, entity_type, entity_id, created_at");
      expect(await sql`SELECT entity_id FROM activity_log WHERE space_id=${spaces[0]!.id}`).toEqual([{ entity_id: "canonical-task" }]);
      const [history] = await sql`SELECT count(*)::int count FROM drizzle.__drizzle_migrations WHERE hash=${hash}`;
      expect(history!.count).toBe(1);
      await applyPendingMigrations(database.connectionString);
      const [unchanged] = await sql`SELECT count(*)::int count FROM drizzle.__drizzle_migrations WHERE hash=${hash}`;
      expect(unchanged!.count).toBe(1);
    } finally {
      await sql.end();
      await database.cleanup();
    }
  }, 120_000);
});
