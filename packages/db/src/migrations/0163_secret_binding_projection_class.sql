ALTER TABLE "space_secret_bindings" ADD COLUMN IF NOT EXISTS "projection_class" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "space_secret_bindings" ADD COLUMN IF NOT EXISTS "projection_allowlist_key" text;
