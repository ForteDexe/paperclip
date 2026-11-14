-- outpost:migration-compat requires_staging: Backfills one primary agent and materializes legacy lead authority while the new server is deployed.
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "primary_agent_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spaces_primary_agent_id_idx" ON "spaces" USING btree ("primary_agent_id");
--> statement-breakpoint
UPDATE "spaces" AS "space"
SET "primary_agent_id" = COALESCE(
  (
    SELECT "preference"."primary_agent_id"
    FROM "user_space_preferences" AS "preference"
    WHERE "preference"."space_id" = "space"."id"
      AND "preference"."primary_agent_id" IS NOT NULL
    ORDER BY "preference"."updated_at" DESC
    LIMIT 1
  ),
  (
    SELECT "agent"."id"
    FROM "agents" AS "agent"
    WHERE "agent"."space_id" = "space"."id"
      AND "agent"."status" NOT IN ('terminated', 'pending_approval')
    ORDER BY
      CASE WHEN "agent"."role" = 'lead' THEN 0 ELSE 1 END,
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
WHERE "role" = 'lead'
  AND NOT (COALESCE("permissions", '{}'::jsonb) ? 'canCreateAgents');
