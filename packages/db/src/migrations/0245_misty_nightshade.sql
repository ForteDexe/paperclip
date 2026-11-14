ALTER TABLE "run_identity_contexts" DROP CONSTRAINT IF EXISTS "run_identity_contexts_space_id_spaces_id_fk";
--> statement-breakpoint
ALTER TABLE "run_identity_contexts" ADD CONSTRAINT "run_identity_contexts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;