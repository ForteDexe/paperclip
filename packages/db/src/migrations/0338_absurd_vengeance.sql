CREATE TABLE IF NOT EXISTS "execution_workspace_repository_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"root_key" text NOT NULL,
	"canonical_cwd" text NOT NULL,
	"kind" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"issue_id" uuid,
	"agent_id" uuid,
	"responsible_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'execution_workspace_repository_access'::regclass AND conname = 'execution_workspace_repository_access_space_id_spaces_id_fk'::name) THEN
    ALTER TABLE "execution_workspace_repository_access" ADD CONSTRAINT "execution_workspace_repository_access_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_workspace_repository_access_scope_idx" ON "execution_workspace_repository_access" USING btree ("space_id","root_key","kind","scope_id");