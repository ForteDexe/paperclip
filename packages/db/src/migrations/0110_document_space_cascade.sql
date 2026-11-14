-- outpost:migration-compat requires_staging: Pre-release Space schema reset; no previous release is supported during this migration rewrite.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'document_revisions_space_id_spaces_id_fk'
	) THEN
		ALTER TABLE "document_revisions" DROP CONSTRAINT "document_revisions_space_id_spaces_id_fk";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'document_revisions_space_id_spaces_id_fk'
	) THEN
		ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'documents_space_id_spaces_id_fk'
	) THEN
		ALTER TABLE "documents" DROP CONSTRAINT "documents_space_id_spaces_id_fk";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "pg_constraint" WHERE "conname" = 'documents_space_id_spaces_id_fk'
	) THEN
		ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
