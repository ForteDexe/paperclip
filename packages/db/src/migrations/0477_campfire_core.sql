-- outpost:migration-compat requires_staging: Campfire copies plugin-owned rows into built-in tables and retires the plugin before the new server starts.

CREATE TABLE IF NOT EXISTS "campfire_agent_sessions" (
	"room_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campfire_agent_sessions_room_id_agent_id_pk" PRIMARY KEY("room_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campfire_message_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campfire_message_mentions" (
	"message_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	CONSTRAINT "campfire_message_mentions_message_id_agent_id_pk" PRIMARY KEY("message_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campfire_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"room_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_agent_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campfire_room_members" (
	"room_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campfire_room_members_room_id_agent_id_pk" PRIMARY KEY("room_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campfire_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_agent_sessions_room_id_campfire_rooms_id_fk') THEN ALTER TABLE "campfire_agent_sessions" ADD CONSTRAINT "campfire_agent_sessions_room_id_campfire_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."campfire_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_agent_sessions_space_id_spaces_id_fk') THEN ALTER TABLE "campfire_agent_sessions" ADD CONSTRAINT "campfire_agent_sessions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_agent_sessions_agent_id_agents_id_fk') THEN ALTER TABLE "campfire_agent_sessions" ADD CONSTRAINT "campfire_agent_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_agent_sessions_session_id_agent_task_sessions_id_fk') THEN ALTER TABLE "campfire_agent_sessions" ADD CONSTRAINT "campfire_agent_sessions_session_id_agent_task_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_task_sessions"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_message_deliveries_message_id_campfire_messages_id_fk') THEN ALTER TABLE "campfire_message_deliveries" ADD CONSTRAINT "campfire_message_deliveries_message_id_campfire_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."campfire_messages"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_message_deliveries_agent_id_agents_id_fk') THEN ALTER TABLE "campfire_message_deliveries" ADD CONSTRAINT "campfire_message_deliveries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_message_mentions_message_id_campfire_messages_id_fk') THEN ALTER TABLE "campfire_message_mentions" ADD CONSTRAINT "campfire_message_mentions_message_id_campfire_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."campfire_messages"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_message_mentions_agent_id_agents_id_fk') THEN ALTER TABLE "campfire_message_mentions" ADD CONSTRAINT "campfire_message_mentions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_messages_room_id_campfire_rooms_id_fk') THEN ALTER TABLE "campfire_messages" ADD CONSTRAINT "campfire_messages_room_id_campfire_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."campfire_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_messages_space_id_spaces_id_fk') THEN ALTER TABLE "campfire_messages" ADD CONSTRAINT "campfire_messages_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_messages_author_agent_id_agents_id_fk') THEN ALTER TABLE "campfire_messages" ADD CONSTRAINT "campfire_messages_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_room_members_room_id_campfire_rooms_id_fk') THEN ALTER TABLE "campfire_room_members" ADD CONSTRAINT "campfire_room_members_room_id_campfire_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."campfire_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_room_members_space_id_spaces_id_fk') THEN ALTER TABLE "campfire_room_members" ADD CONSTRAINT "campfire_room_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_room_members_agent_id_agents_id_fk') THEN ALTER TABLE "campfire_room_members" ADD CONSTRAINT "campfire_room_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campfire_rooms_space_id_spaces_id_fk') THEN ALTER TABLE "campfire_rooms" ADD CONSTRAINT "campfire_rooms_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campfire_agent_sessions_session_uniq" ON "campfire_agent_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campfire_deliveries_message_agent_uniq" ON "campfire_message_deliveries" USING btree ("message_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campfire_deliveries_status_idx" ON "campfire_message_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campfire_messages_room_seq_uniq" ON "campfire_messages" USING btree ("room_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campfire_messages_room_seq_idx" ON "campfire_messages" USING btree ("room_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campfire_room_members_space_agent_uniq" ON "campfire_room_members" USING btree ("space_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campfire_room_members_room_handle_uniq" ON "campfire_room_members" USING btree ("room_id","handle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campfire_rooms_space_name_uniq" ON "campfire_rooms" USING btree ("space_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campfire_rooms_space_updated_idx" ON "campfire_rooms" USING btree ("space_id","updated_at");
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('plugin_campfire_c1a2fb4ac8.rooms') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.campfire_rooms (id, space_id, name, created_at, updated_at)
      SELECT id, space_id, name, created_at, updated_at FROM plugin_campfire_c1a2fb4ac8.rooms
      ON CONFLICT (id) DO NOTHING';
    EXECUTE 'INSERT INTO public.campfire_room_members (room_id, space_id, agent_id, handle, joined_at)
      SELECT room_id, space_id, agent_id, handle, joined_at FROM plugin_campfire_c1a2fb4ac8.room_members
      ON CONFLICT (room_id, agent_id) DO NOTHING';
    EXECUTE 'INSERT INTO public.campfire_messages (id, seq, room_id, space_id, author_kind, author_agent_id, body, created_at)
      SELECT id, seq, room_id, space_id, author_kind, author_agent_id, body, created_at FROM plugin_campfire_c1a2fb4ac8.messages
      ON CONFLICT (id) DO NOTHING';
    EXECUTE 'INSERT INTO public.campfire_message_mentions (message_id, agent_id)
      SELECT message_id, agent_id FROM plugin_campfire_c1a2fb4ac8.message_mentions
      ON CONFLICT (message_id, agent_id) DO NOTHING';
    EXECUTE 'INSERT INTO public.campfire_message_deliveries (id, message_id, agent_id, status, run_id, error, created_at, finished_at)
      SELECT id, message_id, agent_id, status,
             CASE WHEN run_id ~ ''^[0-9a-fA-F-]{36}$'' THEN run_id::uuid ELSE NULL END,
             error, created_at, finished_at
        FROM plugin_campfire_c1a2fb4ac8.message_deliveries
      ON CONFLICT (id) DO NOTHING';
    EXECUTE 'INSERT INTO public.campfire_agent_sessions (room_id, space_id, agent_id, session_id, status, created_at, updated_at)
      SELECT room_id, space_id, agent_id, session_id::uuid, status, created_at, updated_at
        FROM plugin_campfire_c1a2fb4ac8.agent_sessions
       WHERE session_id ~ ''^[0-9a-fA-F-]{36}$''
         AND EXISTS (SELECT 1 FROM public.agent_task_sessions s WHERE s.id = session_id::uuid)
      ON CONFLICT (room_id, agent_id) DO NOTHING';
    PERFORM setval(
      pg_get_serial_sequence('public.campfire_messages', 'seq'),
      GREATEST(COALESCE((SELECT max(seq) FROM public.campfire_messages), 1), 1),
      true
    );
  END IF;
END $$;
--> statement-breakpoint
UPDATE "plugins"
   SET "status" = 'uninstalled', "updated_at" = now()
 WHERE "plugin_key" = 'forted.campfire' AND "status" <> 'uninstalled';
