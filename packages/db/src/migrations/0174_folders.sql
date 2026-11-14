CREATE TABLE IF NOT EXISTS "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_skills" ADD COLUMN IF NOT EXISTS "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "folder_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'folders_space_id_spaces_id_fk'
	) THEN
		ALTER TABLE "folders" ADD CONSTRAINT "folders_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'space_skills_folder_id_folders_id_fk'
	) THEN
		ALTER TABLE "space_skills" ADD CONSTRAINT "space_skills_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'routines_folder_id_folders_id_fk'
	) THEN
		ALTER TABLE "routines" ADD CONSTRAINT "routines_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_space_kind_position_idx" ON "folders" USING btree ("space_id","kind","position","name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folders_space_kind_name_uq" ON "folders" USING btree ("space_id","kind","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_skills_space_folder_idx" ON "space_skills" USING btree ("space_id","folder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routines_space_folder_idx" ON "routines" USING btree ("space_id","folder_id");
