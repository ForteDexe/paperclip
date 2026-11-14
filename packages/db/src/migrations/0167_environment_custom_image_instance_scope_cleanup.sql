-- Keep environment custom image tables aligned with the instance-scoped schema.
-- This is safe for databases that never ran the stale 0158 space-scope repair
-- and repairs databases that did run it before 0158 was neutralized.
DROP INDEX IF EXISTS "environment_custom_image_templates_space_environment_status_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_templates_space_provider_status_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_templates_space_environment_active_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_templates_space_last_used_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_setup_sessions_space_environment_status_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_setup_sessions_space_environment_active_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_setup_sessions_space_template_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_setup_sessions_space_promoted_template_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "environment_custom_image_setup_sessions_space_expires_idx";
--> statement-breakpoint
ALTER TABLE "environment_custom_image_templates"
  DROP CONSTRAINT IF EXISTS "environment_custom_image_templates_space_id_spaces_id_fk";
--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions"
  DROP CONSTRAINT IF EXISTS "environment_custom_image_setup_sessions_space_id_spaces_id_fk";
--> statement-breakpoint
ALTER TABLE "environment_custom_image_templates"
  DROP COLUMN IF EXISTS "space_id";
--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions"
  DROP COLUMN IF EXISTS "space_id";
