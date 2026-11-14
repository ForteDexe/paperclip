-- outpost:migration-compat requires_staging: Pre-release Space schema reset; no previous release is supported during this migration rewrite.
CREATE INDEX IF NOT EXISTS "issues_space_updated_idx" ON "issues" ("space_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_space_created_idx" ON "issues" ("space_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_space_priority_idx" ON "issues" ("space_id","priority");
