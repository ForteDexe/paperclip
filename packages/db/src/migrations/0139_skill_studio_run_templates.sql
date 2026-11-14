CREATE TABLE IF NOT EXISTS "space_skill_test_run_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "body" text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "updated_by_agent_id" uuid,
  "updated_by_user_id" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_run_templates" ADD CONSTRAINT "space_skill_test_run_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_run_templates" ADD CONSTRAINT "space_skill_test_run_templates_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "space_skill_test_run_templates" ADD CONSTRAINT "space_skill_test_run_templates_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skill_test_run_templates_space_active_idx" ON "space_skill_test_run_templates" USING btree ("space_id","deleted_at","name");
--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "template_id" text;
--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "template_name" text;
--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "template_body" text;
--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "rendered_template_body" text;
--> statement-breakpoint
ALTER TABLE "space_skill_test_runs" ADD COLUMN IF NOT EXISTS "harness_issue_description" text DEFAULT '' NOT NULL;
