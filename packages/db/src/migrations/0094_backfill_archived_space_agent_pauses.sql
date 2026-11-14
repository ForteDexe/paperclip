-- outpost:migration-compat requires_staging: Pre-release Space schema reset; no previous release is supported during this migration rewrite.
UPDATE "agents" AS a
SET
  "status" = 'paused',
  "pause_reason" = 'space_archived',
  "paused_at" = now(),
  "updated_at" = now()
FROM "spaces" AS c
WHERE c."id" = a."space_id"
  AND c."status" = 'archived'
  AND a."status" NOT IN ('paused', 'terminated', 'pending_approval');
