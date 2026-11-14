-- Drop the two retired per-space settings. "brand_color" only tinted the
-- generated space icon, which now always derives its hue from the space
-- name, and "attachment_max_bytes" duplicated the deployment-level
-- OUTPOST_ATTACHMENT_MAX_BYTES cap that already bounds every upload. Both
-- columns lost their last reader when the settings were removed.
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "attachment_max_bytes";--> statement-breakpoint
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "brand_color";
