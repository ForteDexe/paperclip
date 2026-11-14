CREATE TABLE IF NOT EXISTS "space_skill_mutation_receipts" (
	"space_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'space_skill_mutation_receipts_space_id_spaces_id_fk'
      AND conrelid = 'space_skill_mutation_receipts'::regclass) THEN
    ALTER TABLE "space_skill_mutation_receipts" ADD CONSTRAINT "space_skill_mutation_receipts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "space_skill_mutation_receipts_key_idx" ON "space_skill_mutation_receipts" USING btree ("space_id","key");
