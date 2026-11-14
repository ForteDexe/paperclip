CREATE TABLE IF NOT EXISTS "skill_package_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"archive_key" text NOT NULL,
	"manifest_key" text NOT NULL,
	"delete_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ALTER COLUMN "file_inventory" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ADD COLUMN IF NOT EXISTS "storage" jsonb;--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ADD COLUMN IF NOT EXISTS "upload" jsonb;--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ADD COLUMN IF NOT EXISTS "restore" jsonb;--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ADD COLUMN IF NOT EXISTS "migration_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ADD COLUMN IF NOT EXISTS "maintenance_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ADD COLUMN IF NOT EXISTS "restore_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_skill_versions" ADD COLUMN IF NOT EXISTS "package_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "space_skill_versions" ADD COLUMN IF NOT EXISTS "package_file_map" jsonb;--> statement-breakpoint
ALTER TABLE "space_skill_versions" ADD COLUMN IF NOT EXISTS "migration_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_package_deletions_due_idx" ON "skill_package_deletions" USING btree ("delete_after","id");--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "space_skill_versions" ADD CONSTRAINT "space_skill_versions_package_snapshot_id_space_skill_repository_snapshots_id_fk" FOREIGN KEY ("package_snapshot_id") REFERENCES "public"."space_skill_repository_snapshots"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_snapshots_migration_idx" ON "space_skill_repository_snapshots" USING btree ("migration_at") WHERE "space_skill_repository_snapshots"."migration_at" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_snapshots_maintenance_idx" ON "space_skill_repository_snapshots" USING btree ("maintenance_at") WHERE "space_skill_repository_snapshots"."maintenance_at" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_versions_migration_idx" ON "space_skill_versions" USING btree ("migration_at") WHERE "space_skill_versions"."migration_at" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_versions_package_snapshot_idx" ON "space_skill_versions" USING btree ("package_snapshot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_versions_repository_snapshot_idx" ON "space_skill_versions" USING btree ("repository_snapshot_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_queue_skill_package_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storage IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.storage->>'archiveKey' IS DISTINCT FROM NEW.storage->>'archiveKey') THEN
    INSERT INTO skill_package_deletions(space_id, provider, archive_key, manifest_key, delete_after)
    VALUES (OLD.space_id, OLD.storage->>'provider', OLD.storage->>'archiveKey', OLD.storage->>'manifestKey', now() + interval '30 days');
  END IF;
  IF OLD.upload IS NOT NULL AND (TG_OP = 'DELETE' OR (
    OLD.upload->>'token' IS DISTINCT FROM NEW.upload->>'token'
    AND OLD.upload->>'archiveKey' IS DISTINCT FROM NEW.storage->>'archiveKey'
  )) THEN
    INSERT INTO skill_package_deletions(space_id, provider, archive_key, manifest_key, delete_after)
    VALUES (OLD.space_id, OLD.upload->>'provider', OLD.upload->>'archiveKey', OLD.upload->>'manifestKey',
      greatest(now() + interval '1 hour', (OLD.upload->>'expiresAt')::timestamptz));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS skill_package_deletion_receipts ON space_skill_repository_snapshots;
--> statement-breakpoint
CREATE TRIGGER skill_package_deletion_receipts AFTER UPDATE OF storage, upload OR DELETE
ON space_skill_repository_snapshots FOR EACH ROW EXECUTE FUNCTION outpost_queue_skill_package_deletion();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_schedule_skill_package_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'space_skills' THEN
    version_id := OLD.current_version_id;
    IF version_id IS NOT NULL AND (TG_OP = 'DELETE' OR version_id IS DISTINCT FROM NEW.current_version_id) THEN
      UPDATE space_skill_repository_snapshots SET maintenance_at = now() + interval '30 days'
        WHERE id IN (SELECT repository_snapshot_id FROM space_skill_versions WHERE id = version_id
                     UNION SELECT package_snapshot_id FROM space_skill_versions WHERE id = version_id);
    END IF;
  ELSE
    UPDATE space_skill_repository_snapshots SET maintenance_at = now() + interval '1 day'
      WHERE id = OLD.repository_snapshot_id OR id = OLD.package_snapshot_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS skill_package_current_cleanup ON space_skills;
--> statement-breakpoint
CREATE TRIGGER skill_package_current_cleanup AFTER UPDATE OF current_version_id OR DELETE ON space_skills
FOR EACH ROW EXECUTE FUNCTION outpost_schedule_skill_package_cleanup();
--> statement-breakpoint
DROP TRIGGER IF EXISTS skill_package_version_cleanup ON space_skill_versions;
--> statement-breakpoint
CREATE TRIGGER skill_package_version_cleanup AFTER DELETE ON space_skill_versions
FOR EACH ROW EXECUTE FUNCTION outpost_schedule_skill_package_cleanup();
