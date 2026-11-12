ALTER TABLE "companies" ADD COLUMN "workspace_root" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "workspace_root_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_workspace_root_key_idx" ON "companies" USING btree ("workspace_root_key");