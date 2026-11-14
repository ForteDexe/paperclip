CREATE TABLE "issue_inbox_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "operator_api_keys_key_hash_idx";--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_inbox_archives_space_issue_idx" ON "issue_inbox_archives" USING btree ("space_id","issue_id");--> statement-breakpoint
CREATE INDEX "issue_inbox_archives_space_user_idx" ON "issue_inbox_archives" USING btree ("space_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_inbox_archives_space_issue_user_idx" ON "issue_inbox_archives" USING btree ("space_id","issue_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_api_keys_key_hash_idx" ON "operator_api_keys" USING btree ("key_hash");