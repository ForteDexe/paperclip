ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "monitor_next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "monitor_wake_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "monitor_last_triggered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "monitor_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "monitor_notes" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "monitor_scheduled_by" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_space_monitor_due_idx" ON "issues" USING btree ("space_id","monitor_next_check_at");
