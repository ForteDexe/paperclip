ALTER TABLE "spaces" ADD COLUMN "workspace_root" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "workspace_root_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_workspace_root_key_idx" ON "spaces" USING btree ("workspace_root_key");