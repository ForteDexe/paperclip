CREATE TABLE "space_skill_import_budgets" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"available_bytes" integer DEFAULT 536870912 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_skill_import_budgets" ADD CONSTRAINT "space_skill_import_budgets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;