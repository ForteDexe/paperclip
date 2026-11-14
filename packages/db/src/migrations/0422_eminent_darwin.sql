CREATE TABLE IF NOT EXISTS "agent_file_roots" (
	"space_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"generation" uuid NOT NULL,
	"entries" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_file_roots_space_id_agent_id_pk" PRIMARY KEY("space_id","agent_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_file_roots" ADD CONSTRAINT "agent_file_roots_space_id_agent_id_agents_space_id_id_fk" FOREIGN KEY ("space_id","agent_id") REFERENCES "public"."agents"("space_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
