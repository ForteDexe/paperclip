ALTER TABLE "issue_inbox_archives" ADD COLUMN IF NOT EXISTS "archived_by_actor_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD COLUMN IF NOT EXISTS "archived_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD COLUMN IF NOT EXISTS "archived_by_run_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'issue_inbox_archives_archived_by_agent_id_agents_id_fk'
	) THEN
		ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_archived_by_agent_id_agents_id_fk" FOREIGN KEY ("archived_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'issue_inbox_archives_archived_by_run_id_heartbeat_runs_id_fk'
	) THEN
		ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_archived_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("archived_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'issue_inbox_archives_archived_by_actor_type_check'
	) THEN
		ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_archived_by_actor_type_check" CHECK ("archived_by_actor_type" IN ('user', 'agent'));
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_inbox_agent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"mode" text DEFAULT 'open' NOT NULL,
	"allowed_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_inbox_agent_policies_mode_check" CHECK ("mode" IN ('open', 'allowlist', 'disabled'))
);--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'user_inbox_agent_policies_space_id_spaces_id_fk'
	) THEN
		ALTER TABLE "user_inbox_agent_policies" ADD CONSTRAINT "user_inbox_agent_policies_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_inbox_agent_policies_space_user_uq" ON "user_inbox_agent_policies" USING btree ("space_id", "user_id");
