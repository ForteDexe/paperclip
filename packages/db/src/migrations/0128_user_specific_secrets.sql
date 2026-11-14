CREATE TABLE IF NOT EXISTS "user_secret_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text DEFAULT 'local_encrypted' NOT NULL,
	"managed_mode" text DEFAULT 'outpost_managed' NOT NULL,
	"provider_config_id" uuid,
	"provider_metadata" jsonb,
	"usage_guidance" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_secret_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_secret_definition_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"config_path" text NOT NULL,
	"env_key" text NOT NULL,
	"version_selector" text DEFAULT 'latest' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"allow_missing_override" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_secrets" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'space' NOT NULL;
--> statement-breakpoint
ALTER TABLE "space_secrets" ADD COLUMN IF NOT EXISTS "owner_user_id" text;
--> statement-breakpoint
ALTER TABLE "space_secrets" ADD COLUMN IF NOT EXISTS "user_secret_definition_id" uuid;
--> statement-breakpoint
UPDATE "space_secrets"
SET "scope" = 'space'
WHERE "scope" IS NULL;
--> statement-breakpoint
ALTER TABLE "secret_access_events" ALTER COLUMN "secret_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD COLUMN IF NOT EXISTS "user_secret_definition_id" uuid;
--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD COLUMN IF NOT EXISTS "secret_scope" text DEFAULT 'space' NOT NULL;
--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD COLUMN IF NOT EXISTS "responsible_user_id" text;
--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD COLUMN IF NOT EXISTS "credential_owner_user_id" text;
--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD COLUMN IF NOT EXISTS "credential_subject_type" text;
--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD COLUMN IF NOT EXISTS "credential_subject_id" text;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "responsible_user_id" text;
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "responsible_user_id" text;
--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "responsible_user_id" text;
--> statement-breakpoint
ALTER TABLE "routine_revisions" ADD COLUMN IF NOT EXISTS "responsible_user_id" text;
--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "responsible_user_id" text;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_secret_definitions_space_id_spaces_id_fk') THEN
		ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_secret_definitions_provider_config_id_space_secret_provider_configs_id_fk') THEN
		ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_provider_config_id_space_secret_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."space_secret_provider_configs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_secret_definitions_created_by_agent_id_agents_id_fk') THEN
		ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_secret_definitions_updated_by_agent_id_agents_id_fk') THEN
		ALTER TABLE "user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_secret_declarations_space_id_spaces_id_fk') THEN
		ALTER TABLE "user_secret_declarations" ADD CONSTRAINT "user_secret_declarations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_secret_declarations_user_secret_definition_id_user_secret_definitions_id_fk') THEN
		ALTER TABLE "user_secret_declarations" ADD CONSTRAINT "user_secret_declarations_user_secret_definition_id_user_secret_definitions_id_fk" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'space_secrets_user_secret_definition_id_user_secret_definitions_id_fk') THEN
		ALTER TABLE "space_secrets" ADD CONSTRAINT "space_secrets_user_secret_definition_id_user_secret_definitions_id_fk" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secret_access_events_user_secret_definition_id_user_secret_definitions_id_fk') THEN
		ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_user_secret_definition_id_user_secret_definitions_id_fk" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'space_secrets_scope_shape_check') THEN
		ALTER TABLE "space_secrets" ADD CONSTRAINT "space_secrets_scope_shape_check" CHECK (
			("scope" = 'space' AND "owner_user_id" IS NULL AND "user_secret_definition_id" IS NULL)
			OR
			("scope" = 'user' AND "owner_user_id" IS NOT NULL AND "user_secret_definition_id" IS NOT NULL)
		);
	END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "space_secrets_space_name_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "space_secrets_space_key_uq";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_definitions_space_status_idx" ON "user_secret_definitions" USING btree ("space_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_definitions_space_provider_idx" ON "user_secret_definitions" USING btree ("space_id","provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_definitions_provider_config_idx" ON "user_secret_definitions" USING btree ("provider_config_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_secret_definitions_space_key_uq" ON "user_secret_definitions" USING btree ("space_id","key") WHERE "user_secret_definitions"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_declarations_space_idx" ON "user_secret_declarations" USING btree ("space_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_declarations_definition_idx" ON "user_secret_declarations" USING btree ("user_secret_definition_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_declarations_target_idx" ON "user_secret_declarations" USING btree ("space_id","target_type","target_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_declarations_space_required_idx" ON "user_secret_declarations" USING btree ("space_id","required");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_secret_declarations_target_path_uq" ON "user_secret_declarations" USING btree ("space_id","target_type","target_id","config_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_secret_declarations_required_override_idx" ON "user_secret_declarations" USING btree ("space_id","allow_missing_override") WHERE "user_secret_declarations"."allow_missing_override" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_secrets_space_scope_idx" ON "space_secrets" USING btree ("space_id","scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_secrets_space_owner_idx" ON "space_secrets" USING btree ("space_id","owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "space_secrets_user_definition_owner_idx" ON "space_secrets" USING btree ("space_id","user_secret_definition_id","owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "space_secrets_space_name_uq" ON "space_secrets" USING btree ("space_id","name") WHERE "space_secrets"."scope" = 'space' AND "space_secrets"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "space_secrets_space_key_uq" ON "space_secrets" USING btree ("space_id","key") WHERE "space_secrets"."scope" = 'space' AND "space_secrets"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "space_secrets_user_definition_owner_uq" ON "space_secrets" USING btree ("space_id","user_secret_definition_id","owner_user_id") WHERE "space_secrets"."scope" = 'user' AND "space_secrets"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "secret_access_events_user_definition_created_idx" ON "secret_access_events" USING btree ("user_secret_definition_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "secret_access_events_space_credential_owner_idx" ON "secret_access_events" USING btree ("space_id","credential_owner_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_space_responsible_user_idx" ON "issues" USING btree ("space_id","responsible_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_space_responsible_user_idx" ON "heartbeat_runs" USING btree ("space_id","responsible_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routines_space_responsible_user_idx" ON "routines" USING btree ("space_id","responsible_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_revisions_space_responsible_user_idx" ON "routine_revisions" USING btree ("space_id","responsible_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_runs_space_responsible_user_idx" ON "routine_runs" USING btree ("space_id","responsible_user_id","created_at");
