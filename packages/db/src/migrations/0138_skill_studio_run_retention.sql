ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "harness_issue_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "harness_issue_deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_test_runs_space_harness_expires_idx" ON "space_skill_test_runs" USING btree ("space_id","harness_issue_expires_at");
