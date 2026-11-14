import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const DECISION_QUEUE_MIGRATIONS = [
  "0198_decision_queues_and_triage.sql",
  "0199_decision_queue_composite_key.sql",
  "0200_yellow_maria_hill.sql",
] as const;

const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function readMigration(fileName: string): Promise<string> {
  return fs.promises.readFile(new URL(`./migrations/${fileName}`, import.meta.url), "utf8");
}

async function reapplyDecisionQueueMigrations(sql: ReturnType<typeof postgres>): Promise<void> {
  for (const fileName of DECISION_QUEUE_MIGRATIONS) {
    await sql.unsafe(await readMigration(fileName));
  }
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping decision queue migration tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("decision queue migrations", () => {
  it(
    "can be reapplied without changing schema or existing data",
    async () => {
      const database = await startEmbeddedPostgresTestDatabase("outpost-decision-queue-migrations-");
      cleanups.push(database.cleanup);
      const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
      const spaceId = randomUUID();
      const queueId = randomUUID();
      const itemId = randomUUID();

      try {
        await sql`
          INSERT INTO "spaces" ("id", "name", "issue_prefix")
          VALUES (${spaceId}, 'Migration Test', 'DQM')
        `;
        await sql`
          INSERT INTO "decision_queues" (
            "id", "space_id", "key", "title", "created_by_type", "created_by_user_id"
          ) VALUES (${queueId}, ${spaceId}, 'migration-test', 'Migration Test', 'user', 'test-user')
        `;
        await sql`
          INSERT INTO "decision_queue_items" (
            "id", "space_id", "queue_id", "source_kind", "source_id", "added_by_type", "added_by_user_id"
          ) VALUES (${itemId}, ${spaceId}, ${queueId}, 'issue', 'DQM-1', 'user', 'test-user')
        `;

        await reapplyDecisionQueueMigrations(sql);
        await reapplyDecisionQueueMigrations(sql);

        const rows = await sql<{ id: string }[]>`
          SELECT "id" FROM "decision_queue_items" WHERE "id" = ${itemId}
        `;
        expect(rows).toEqual([{ id: itemId }]);

        const constraints = await sql<{ conname: string }[]>`
          SELECT "conname"
          FROM "pg_constraint"
          WHERE "conname" IN (
            'decision_queues_id_space_uq',
            'decision_queue_items_queue_space_fk'
          )
          ORDER BY "conname"
        `;
        expect(constraints).toEqual([
          { conname: "decision_queue_items_queue_space_fk" },
          { conname: "decision_queues_id_space_uq" },
        ]);
      } finally {
        await sql.end();
      }
    },
    30_000,
  );
});
