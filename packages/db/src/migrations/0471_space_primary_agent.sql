-- paperclip:migration-compat requires_staging: Backfills one primary agent and materializes legacy lead authority while the new server is deployed.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "primary_agent_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_primary_agent_id_idx" ON "companies" USING btree ("primary_agent_id");
--> statement-breakpoint
UPDATE "companies" AS "company"
SET "primary_agent_id" = COALESCE(
  (
    SELECT "preference"."primary_agent_id"
    FROM "user_company_preferences" AS "preference"
    WHERE "preference"."company_id" = "company"."id"
      AND "preference"."primary_agent_id" IS NOT NULL
    ORDER BY "preference"."updated_at" DESC
    LIMIT 1
  ),
  (
    SELECT "agent"."id"
    FROM "agents" AS "agent"
    WHERE "agent"."company_id" = "company"."id"
      AND "agent"."status" NOT IN ('terminated', 'pending_approval')
    ORDER BY
      CASE WHEN "agent"."role" = 'ceo' THEN 0 ELSE 1 END,
      "agent"."created_at",
      "agent"."id"
    LIMIT 1
  )
);
--> statement-breakpoint
UPDATE "agents"
SET "permissions" = jsonb_set(
  COALESCE("permissions", '{}'::jsonb),
  '{canCreateAgents}',
  'true'::jsonb,
  true
)
WHERE "role" = 'ceo'
  AND NOT (COALESCE("permissions", '{}'::jsonb) ? 'canCreateAgents');
