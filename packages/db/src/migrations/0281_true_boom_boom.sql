CREATE TABLE IF NOT EXISTS "routine_webhook_test_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"delivery_key_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD COLUMN IF NOT EXISTS "setup_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD COLUMN IF NOT EXISTS "last_webhook_delivery" jsonb;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "routine_webhook_test_receipts" ADD CONSTRAINT "routine_webhook_test_receipts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "routine_webhook_test_receipts" ADD CONSTRAINT "routine_webhook_test_receipts_trigger_id_routine_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."routine_triggers"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "routine_webhook_test_receipts_delivery_uq" ON "routine_webhook_test_receipts" USING btree ("trigger_id","delivery_key_hash");
