ALTER TABLE "issue_thread_interactions" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_thread_interactions_space_issue_idempotency_uq"
  ON "issue_thread_interactions" USING btree ("space_id","issue_id","idempotency_key")
  WHERE "issue_thread_interactions"."idempotency_key" IS NOT NULL;
