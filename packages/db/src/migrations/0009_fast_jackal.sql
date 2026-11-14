CREATE TABLE "space_secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"material" jsonb NOT NULL,
	"value_sha256" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "space_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'local_encrypted' NOT NULL,
	"external_ref" text,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_secret_versions" ADD CONSTRAINT "space_secret_versions_secret_id_space_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."space_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_secret_versions" ADD CONSTRAINT "space_secret_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_secrets" ADD CONSTRAINT "space_secrets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_secrets" ADD CONSTRAINT "space_secrets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_secret_versions_secret_idx" ON "space_secret_versions" USING btree ("secret_id","created_at");--> statement-breakpoint
CREATE INDEX "space_secret_versions_value_sha256_idx" ON "space_secret_versions" USING btree ("value_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "space_secret_versions_secret_version_uq" ON "space_secret_versions" USING btree ("secret_id","version");--> statement-breakpoint
CREATE INDEX "space_secrets_space_idx" ON "space_secrets" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_secrets_space_provider_idx" ON "space_secrets" USING btree ("space_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "space_secrets_space_name_uq" ON "space_secrets" USING btree ("space_id","name");