CREATE TABLE "space_skill_repository_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"file_inventory" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_skill_sources" ADD COLUMN "package_mode" text DEFAULT 'skills' NOT NULL;--> statement-breakpoint
ALTER TABLE "space_skill_sources" ADD COLUMN "repository_package" jsonb;--> statement-breakpoint
ALTER TABLE "space_skill_versions" ADD COLUMN "repository_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "space_skill_versions" ADD COLUMN "repository_skill_path" text;--> statement-breakpoint
ALTER TABLE "space_skill_repository_snapshots" ADD CONSTRAINT "space_skill_repository_snapshots_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "space_skill_repository_snapshots_content_idx" ON "space_skill_repository_snapshots" USING btree ("space_id","content_hash");--> statement-breakpoint
ALTER TABLE "space_skill_versions" ADD CONSTRAINT "space_skill_versions_repository_snapshot_id_space_skill_repository_snapshots_id_fk" FOREIGN KEY ("repository_snapshot_id") REFERENCES "public"."space_skill_repository_snapshots"("id") ON DELETE restrict ON UPDATE no action;