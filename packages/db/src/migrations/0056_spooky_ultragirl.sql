CREATE TABLE "space_user_sidebar_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"project_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sidebar_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"space_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_user_sidebar_preferences" ADD CONSTRAINT "space_user_sidebar_preferences_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_user_sidebar_preferences_space_idx" ON "space_user_sidebar_preferences" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_user_sidebar_preferences_user_idx" ON "space_user_sidebar_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_user_sidebar_preferences_space_user_uq" ON "space_user_sidebar_preferences" USING btree ("space_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sidebar_preferences_user_uq" ON "user_sidebar_preferences" USING btree ("user_id");