-- paperclip:migration-compat requires_staging: Removes role-seeded CEO creation authority while preserving user-attributed explicit grants.
-- Migration 0471 temporarily materialized the old CEO default. Remove any
-- system-attributed grant for that title and fail its compatibility toggle
-- closed unless a person explicitly granted the permission.
DELETE FROM "principal_permission_grants" AS "grant"
USING "agents" AS "agent"
WHERE "grant"."company_id" = "agent"."company_id"
  AND "grant"."principal_type" = 'agent'
  AND "grant"."principal_id" = "agent"."id"::text
  AND "grant"."permission_key" = 'agents:create'
  AND "grant"."granted_by_user_id" IS NULL
  AND lower("agent"."role") = 'ceo';
--> statement-breakpoint
UPDATE "agents" AS "agent"
SET "permissions" = jsonb_set(
  COALESCE("agent"."permissions", '{}'::jsonb) - 'ceoHiringDeniedBy',
  '{canCreateAgents}',
  'false'::jsonb,
  true
)
WHERE lower("agent"."role") = 'ceo'
  AND COALESCE("agent"."permissions"->>'canCreateAgents', 'false') = 'true'
  AND NOT EXISTS (
    SELECT 1
    FROM "principal_permission_grants" AS "grant"
    WHERE "grant"."company_id" = "agent"."company_id"
      AND "grant"."principal_type" = 'agent'
      AND "grant"."principal_id" = "agent"."id"::text
      AND "grant"."permission_key" = 'agents:create'
      AND "grant"."granted_by_user_id" IS NOT NULL
  );
--> statement-breakpoint
-- Convert every remaining enabled compatibility toggle into the canonical
-- permission model before the server stops treating that JSON field as an
-- authorization source.
INSERT INTO "principal_permission_grants" (
  "company_id",
  "principal_type",
  "principal_id",
  "permission_key",
  "scope",
  "granted_by_user_id",
  "created_at",
  "updated_at"
)
SELECT
  "company_id",
  'agent',
  "id",
  'agents:create',
  NULL,
  NULL,
  now(),
  now()
FROM "agents"
WHERE COALESCE("permissions"->>'canCreateAgents', 'false') = 'true'
ON CONFLICT ("company_id", "principal_type", "principal_id", "permission_key") DO NOTHING;
