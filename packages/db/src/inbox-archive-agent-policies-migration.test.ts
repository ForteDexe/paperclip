import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyPendingMigrations, inspectMigrations } from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const INBOX_ARCHIVE_AGENT_POLICIES_MIGRATION = "0172_inbox_archive_agent_policies.sql";

const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createTempDatabase(): Promise<string> {
  const db = await startEmbeddedPostgresTestDatabase("outpost-inbox-archive-policies-");
  cleanups.push(db.cleanup);
  return db.connectionString;
}

async function migrationHash(): Promise<string> {
  const content = await fs.promises.readFile(
    new URL(`./migrations/${INBOX_ARCHIVE_AGENT_POLICIES_MIGRATION}`, import.meta.url),
    "utf8",
  );
  return createHash("sha256").update(content).digest("hex");
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres inbox archive policy migration tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("inbox archive agent policy migration", () => {
  it(
    "upgrades legacy archives and round-trips attribution and unique policies",
    async () => {
      const connectionString = await createTempDatabase();
      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      const spaceId = randomUUID();
      const agentId = randomUUID();
      const deletedAgentId = randomUUID();
      const issueId = randomUUID();
      const runId = randomUUID();
      const legacyArchiveId = randomUUID();
      const agentArchiveId = randomUUID();

      try {
        const hash = await migrationHash();
        await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
        await sql`DROP TABLE IF EXISTS "user_inbox_agent_policies"`;
        await sql`ALTER TABLE "issue_inbox_archives" DROP CONSTRAINT IF EXISTS "issue_inbox_archives_archived_by_agent_id_agents_id_fk"`;
        await sql`ALTER TABLE "issue_inbox_archives" DROP CONSTRAINT IF EXISTS "issue_inbox_archives_archived_by_run_id_heartbeat_runs_id_fk"`;
        await sql`ALTER TABLE "issue_inbox_archives" DROP CONSTRAINT IF EXISTS "issue_inbox_archives_archived_by_actor_type_check"`;
        await sql`ALTER TABLE "issue_inbox_archives" DROP COLUMN IF EXISTS "archived_by_agent_id"`;
        await sql`ALTER TABLE "issue_inbox_archives" DROP COLUMN IF EXISTS "archived_by_run_id"`;
        await sql`ALTER TABLE "issue_inbox_archives" DROP COLUMN IF EXISTS "archived_by_actor_type"`;

        await sql`
          INSERT INTO "spaces" ("id", "name", "issue_prefix")
          VALUES (${spaceId}, 'Inbox migration space', 'IAM')
        `;
        await sql`
          INSERT INTO "agents" ("id", "space_id", "name", "role", "adapter_type", "adapter_config")
          VALUES (${agentId}, ${spaceId}, 'Inbox agent', 'engineer', 'process', '{}'::jsonb)
        `;
        await sql`
          INSERT INTO "agents" ("id", "space_id", "name", "role", "adapter_type", "adapter_config")
          VALUES (${deletedAgentId}, ${spaceId}, 'Deleted inbox agent', 'engineer', 'process', '{}'::jsonb)
        `;
        await sql`
          INSERT INTO "issues" ("id", "space_id", "title", "identifier")
          VALUES (${issueId}, ${spaceId}, 'Legacy inbox issue', 'IAM-1')
        `;
        await sql`
          INSERT INTO "heartbeat_runs" ("id", "space_id", "agent_id", "status")
          VALUES (${runId}, ${spaceId}, ${agentId}, 'succeeded')
        `;
        await sql`
          INSERT INTO "issue_inbox_archives" ("id", "space_id", "issue_id", "user_id")
          VALUES (${legacyArchiveId}, ${spaceId}, ${issueId}, 'legacy-user')
        `;
      } finally {
        await sql.end();
      }

      expect(await inspectMigrations(connectionString)).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: [INBOX_ARCHIVE_AGENT_POLICIES_MIGRATION],
      });

      await applyPendingMigrations(connectionString);

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const legacyRows = await verifySql<{
          archived_by_actor_type: string;
          archived_by_agent_id: string | null;
          archived_by_run_id: string | null;
        }[]>`
          SELECT "archived_by_actor_type", "archived_by_agent_id", "archived_by_run_id"
          FROM "issue_inbox_archives"
          WHERE "id" = ${legacyArchiveId}
        `;
        expect(legacyRows).toEqual([{
          archived_by_actor_type: "user",
          archived_by_agent_id: null,
          archived_by_run_id: null,
        }]);

        await verifySql`
          INSERT INTO "issue_inbox_archives" (
            "id",
            "space_id",
            "issue_id",
            "user_id",
            "archived_by_actor_type",
            "archived_by_agent_id",
            "archived_by_run_id"
          )
          VALUES (${agentArchiveId}, ${spaceId}, ${issueId}, 'agent-managed-user', 'agent', ${agentId}, ${runId})
        `;
        const agentRows = await verifySql<{
          archived_by_actor_type: string;
          archived_by_agent_id: string;
          archived_by_run_id: string;
        }[]>`
          SELECT "archived_by_actor_type", "archived_by_agent_id", "archived_by_run_id"
          FROM "issue_inbox_archives"
          WHERE "id" = ${agentArchiveId}
        `;
        expect(agentRows).toEqual([{
          archived_by_actor_type: "agent",
          archived_by_agent_id: agentId,
          archived_by_run_id: runId,
        }]);

        await verifySql`
          INSERT INTO "user_inbox_agent_policies" (
            "space_id",
            "user_id",
            "mode",
            "allowed_agent_ids"
          )
          VALUES (${spaceId}, 'agent-managed-user', 'allowlist', ${verifySql.json([agentId, deletedAgentId])})
        `;
        const policies = await verifySql<{
          mode: string;
          allowed_agent_ids: string[];
        }[]>`
          SELECT "mode", "allowed_agent_ids"
          FROM "user_inbox_agent_policies"
          WHERE "space_id" = ${spaceId}
            AND "user_id" = 'agent-managed-user'
        `;
        expect(policies).toEqual([{
          mode: "allowlist",
          allowed_agent_ids: [agentId, deletedAgentId],
        }]);

        await verifySql`DELETE FROM "agents" WHERE "id" = ${deletedAgentId}`;
        const policiesAfterAgentDeletion = await verifySql<{
          allowed_agent_ids: string[];
        }[]>`
          SELECT "allowed_agent_ids"
          FROM "user_inbox_agent_policies"
          WHERE "space_id" = ${spaceId}
            AND "user_id" = 'agent-managed-user'
        `;
        expect(policiesAfterAgentDeletion).toEqual([{ allowed_agent_ids: [agentId] }]);

        await expect(verifySql`
          INSERT INTO "user_inbox_agent_policies" ("space_id", "user_id", "mode")
          VALUES (${spaceId}, 'agent-managed-user', 'disabled')
        `).rejects.toMatchObject({ code: "23505" });
      } finally {
        await verifySql.end();
      }

      expect((await inspectMigrations(connectionString)).status).toBe("upToDate");
    },
    30_000,
  );
});
