CREATE TABLE IF NOT EXISTS "tool_mcp_gateways" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "profile_id" uuid NOT NULL,
  "agent_id" uuid,
  "project_id" uuid,
  "issue_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_mcp_gateway_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL,
  "gateway_id" uuid NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_mcp_gateways_space_id_spaces_id_fk') THEN
    ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_mcp_gateways_profile_id_tool_profiles_id_fk') THEN
    ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_profile_id_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tool_profiles"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_mcp_gateways_agent_id_agents_id_fk') THEN
    ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_mcp_gateways_project_id_projects_id_fk') THEN
    ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_mcp_gateways_issue_id_issues_id_fk') THEN
    ALTER TABLE "tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_mcp_gateway_tokens_space_id_spaces_id_fk') THEN
    ALTER TABLE "tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_mcp_gateway_tokens_gateway_id_tool_mcp_gateways_id_fk') THEN
    ALTER TABLE "tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_mcp_gateways_space_idx" ON "tool_mcp_gateways" USING btree ("space_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_mcp_gateways_space_status_idx" ON "tool_mcp_gateways" USING btree ("space_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_mcp_gateways_profile_idx" ON "tool_mcp_gateways" USING btree ("space_id", "profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_mcp_gateways_space_slug_uq" ON "tool_mcp_gateways" USING btree ("space_id", "slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_mcp_gateways_space_name_uq" ON "tool_mcp_gateways" USING btree ("space_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_mcp_gateway_tokens_token_hash_uq" ON "tool_mcp_gateway_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_mcp_gateway_tokens_gateway_idx" ON "tool_mcp_gateway_tokens" USING btree ("space_id", "gateway_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_mcp_gateway_tokens_space_expires_idx" ON "tool_mcp_gateway_tokens" USING btree ("space_id", "expires_at");
