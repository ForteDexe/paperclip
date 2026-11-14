ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "harness_kind" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_space_harness_kind_idx" ON "issues" USING btree ("space_id","harness_kind");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "space_skill_test_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "name" text NOT NULL,
  "content" text NOT NULL,
  "created_by" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "space_skill_test_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "input_id" uuid,
  "input_snapshot" text NOT NULL,
  "skill_version_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "agent_config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "issue_id" uuid NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "output_document_key" text DEFAULT 'output' NOT NULL,
  "output_snapshot" text DEFAULT '' NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_inputs" ADD CONSTRAINT "space_skill_test_inputs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_inputs" ADD CONSTRAINT "space_skill_test_inputs_skill_id_space_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."space_skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_runs" ADD CONSTRAINT "space_skill_test_runs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_runs" ADD CONSTRAINT "space_skill_test_runs_skill_id_space_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."space_skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_runs" ADD CONSTRAINT "space_skill_test_runs_input_id_space_skill_test_inputs_id_fk" FOREIGN KEY ("input_id") REFERENCES "public"."space_skill_test_inputs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_runs" ADD CONSTRAINT "space_skill_test_runs_skill_version_id_space_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."space_skill_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_runs" ADD CONSTRAINT "space_skill_test_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_runs" ADD CONSTRAINT "space_skill_test_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_test_inputs_space_skill_name_idx" ON "space_skill_test_inputs" USING btree ("space_id","skill_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_test_inputs_space_skill_active_idx" ON "space_skill_test_inputs" USING btree ("space_id","skill_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_test_runs_space_skill_created_idx" ON "space_skill_test_runs" USING btree ("space_id","skill_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "space_skill_test_runs_space_issue_idx" ON "space_skill_test_runs" USING btree ("space_id","issue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_test_runs_space_input_created_idx" ON "space_skill_test_runs" USING btree ("space_id","input_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_test_runs_space_status_idx" ON "space_skill_test_runs" USING btree ("space_id","status");
