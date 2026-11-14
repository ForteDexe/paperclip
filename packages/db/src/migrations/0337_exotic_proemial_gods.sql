CREATE TABLE IF NOT EXISTS "execution_workspace_repository_roots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"canonical_cwd" text NOT NULL,
	"root_key" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'execution_workspace_repository_roots'::regclass AND conname = 'execution_workspace_repository_roots_space_id_spaces_id_fk'::name) THEN
    ALTER TABLE "execution_workspace_repository_roots" ADD CONSTRAINT "execution_workspace_repository_roots_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_workspace_repository_roots_space_root_idx" ON "execution_workspace_repository_roots" USING btree ("space_id","root_key");
