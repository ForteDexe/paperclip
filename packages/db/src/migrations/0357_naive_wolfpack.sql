CREATE TABLE IF NOT EXISTS "space_observability" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"revision" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"destination" jsonb NOT NULL,
	"capture" jsonb NOT NULL,
	"credentials_secret_id" uuid,
	"header_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_test" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "space_observability" ADD CONSTRAINT "space_observability_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "space_observability" ADD CONSTRAINT "space_observability_credentials_secret_id_space_secrets_id_fk" FOREIGN KEY ("credentials_secret_id") REFERENCES "public"."space_secrets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
