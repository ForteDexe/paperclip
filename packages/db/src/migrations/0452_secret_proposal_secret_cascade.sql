ALTER TABLE "space_secret_proposals" DROP CONSTRAINT IF EXISTS "space_secret_proposals_secret_id_space_secrets_id_fk";
--> statement-breakpoint
ALTER TABLE "space_secret_proposals" ADD CONSTRAINT "space_secret_proposals_secret_id_space_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."space_secrets"("id") ON DELETE cascade ON UPDATE no action;