-- One-shot dedup of any pre-existing managed sandbox rows duplicated per space.
-- Keeps the oldest row per (space_id) where driver='sandbox' AND metadata.managedByOutpost is true.
-- Scoped to Outpost-managed rows only: tenant-created sandbox envs (without the marker) are untouched.
DO $$
DECLARE
  deleted_count integer;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY space_id
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM environments
    WHERE driver = 'sandbox'
      AND (metadata ->> 'managedByOutpost')::boolean = true
  ),
  deleted AS (
    DELETE FROM environments
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;

  IF deleted_count > 0 THEN
    RAISE NOTICE 'environments_space_managed_sandbox_idx dedup removed % duplicate managed-sandbox row(s)', deleted_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_space_managed_sandbox_idx"
  ON "environments" ("space_id")
  WHERE driver = 'sandbox' AND (metadata ->> 'managedByOutpost')::boolean = true;
