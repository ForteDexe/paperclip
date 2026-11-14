CREATE TABLE IF NOT EXISTS "ai_connection_pools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"config" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_connection_pools_space_id_uq" UNIQUE("space_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connection_router_cursors" (
	"pool_id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"last_member_id" text,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connection_task_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_key" text NOT NULL,
	"selection" jsonb NOT NULL,
	"member" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_secrets" ADD COLUMN IF NOT EXISTS "ai_session_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_pools" ADD CONSTRAINT "ai_connection_pools_id_tool_connections_id_fk" FOREIGN KEY ("id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_pools" ADD CONSTRAINT "ai_connection_pools_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_pools" ADD CONSTRAINT "ai_connection_pools_space_connection_fk" FOREIGN KEY ("space_id","id") REFERENCES "public"."tool_connections"("space_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_router_cursors" ADD CONSTRAINT "ai_connection_router_cursors_pool_id_ai_connection_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."ai_connection_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_router_cursors" ADD CONSTRAINT "ai_connection_router_cursors_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_router_cursors" ADD CONSTRAINT "ai_connection_router_cursors_space_pool_fk" FOREIGN KEY ("space_id","pool_id") REFERENCES "public"."ai_connection_pools"("space_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_task_pins" ADD CONSTRAINT "ai_connection_task_pins_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_task_pins" ADD CONSTRAINT "ai_connection_task_pins_pool_id_ai_connection_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."ai_connection_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_task_pins" ADD CONSTRAINT "ai_connection_task_pins_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_task_pins" ADD CONSTRAINT "ai_connection_task_pins_space_pool_fk" FOREIGN KEY ("space_id","pool_id") REFERENCES "public"."ai_connection_pools"("space_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ai_connection_task_pins" ADD CONSTRAINT "ai_connection_task_pins_space_agent_fk" FOREIGN KEY ("space_id","agent_id") REFERENCES "public"."agents"("space_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_connection_task_pins_affinity_uq" ON "ai_connection_task_pins" USING btree ("space_id","pool_id","agent_id","task_key");