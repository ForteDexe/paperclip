ALTER TABLE "spaces" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "paused_at" timestamp with time zone;
