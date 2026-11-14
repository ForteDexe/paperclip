CREATE TABLE IF NOT EXISTS "budget_evaluation_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"agent_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN IF NOT EXISTS "evaluation_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "budget_evaluation_work" ADD CONSTRAINT "budget_evaluation_work_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_evaluation_work_space_pending_idx" ON "budget_evaluation_work" USING btree ("space_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_evaluation_work_agent_pending_idx" ON "budget_evaluation_work" USING btree ("space_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_evaluation_work_project_pending_idx" ON "budget_evaluation_work" USING btree ("space_id","project_id","created_at");