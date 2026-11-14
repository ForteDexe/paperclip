-- Scope plugin configuration rows by space before re-enabling plugin secret
-- refs. Legacy rows were instance-global; preserve only rows with an
-- unambiguous space owner and fail closed when a row is ambiguous.

ALTER TABLE "plugin_config"
  ADD COLUMN IF NOT EXISTS "space_id" uuid;--> statement-breakpoint

WITH binding_owner AS (
  SELECT
    pc."id" AS config_id,
    min(csb."space_id"::text)::uuid AS space_id,
    count(DISTINCT csb."space_id") AS space_count
  FROM "plugin_config" pc
  JOIN "space_secret_bindings" csb
    ON csb."target_type" = 'plugin'
   AND csb."target_id" = pc."plugin_id"::text
  GROUP BY pc."id"
)
UPDATE "plugin_config" pc
SET "space_id" = bo."space_id"
FROM binding_owner bo
WHERE pc."space_id" IS NULL
  AND bo."config_id" = pc."id"
  AND bo."space_count" = 1;--> statement-breakpoint

WITH single_space AS (
  SELECT min("id"::text)::uuid AS space_id, count(*) AS space_count
  FROM "spaces"
)
UPDATE "plugin_config" pc
SET "space_id" = sc."space_id"
FROM single_space sc
WHERE pc."space_id" IS NULL
  AND sc."space_count" = 1;--> statement-breakpoint

DROP INDEX IF EXISTS "plugin_config_plugin_id_idx";--> statement-breakpoint

WITH unbound_config AS (
  SELECT pc.*
  FROM "plugin_config" pc
  WHERE pc."space_id" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "space_secret_bindings" csb
      WHERE csb."target_type" = 'plugin'
        AND csb."target_id" = pc."plugin_id"::text
    )
), primary_space AS (
  SELECT min("id"::text)::uuid AS space_id
  FROM "spaces"
)
INSERT INTO "plugin_config" (
  "plugin_id",
  "space_id",
  "config_json",
  "last_error",
  "created_at",
  "updated_at"
)
SELECT
  uc."plugin_id",
  c."id",
  uc."config_json",
  uc."last_error",
  uc."created_at",
  uc."updated_at"
FROM unbound_config uc
CROSS JOIN "spaces" c
CROSS JOIN primary_space pc
WHERE c."id" <> pc."space_id";--> statement-breakpoint

WITH primary_space AS (
  SELECT min("id"::text)::uuid AS space_id
  FROM "spaces"
)
UPDATE "plugin_config" pc
SET "space_id" = primary_space."space_id"
FROM primary_space
WHERE pc."space_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "space_secret_bindings" csb
    WHERE csb."target_type" = 'plugin'
      AND csb."target_id" = pc."plugin_id"::text
  );--> statement-breakpoint

DO $$
DECLARE
  unresolved_count integer;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM "plugin_config"
  WHERE "space_id" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION 'Cannot assign space_id for % plugin_config row(s); resolve ambiguous plugin secret bindings before applying migration 0164', unresolved_count;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "plugin_config"
  ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plugin_config_space_id_spaces_id_fk'
  ) THEN
    ALTER TABLE "plugin_config"
      ADD CONSTRAINT "plugin_config_space_id_spaces_id_fk"
      FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "plugin_config_plugin_space_idx"
  ON "plugin_config" USING btree ("plugin_id", "space_id");
