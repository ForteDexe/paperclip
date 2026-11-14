CREATE TABLE IF NOT EXISTS "document_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "starred_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- outpost:migration-safety-ignore large-create-index-not-concurrently: Drizzle migrations run transactionally, so CONCURRENTLY is unavailable; this index is created with the new empty membership table for user-scoped starred ordering.
CREATE INDEX IF NOT EXISTS "document_memberships_space_user_starred_idx"
  ON "document_memberships" USING btree ("space_id", "user_id", "starred_at");--> statement-breakpoint
-- outpost:migration-safety-ignore large-create-index-not-concurrently: Drizzle migrations run transactionally, so CONCURRENTLY is unavailable; this uniqueness index is created with the new empty membership table to make star upserts idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "document_memberships_space_user_document_uq"
  ON "document_memberships" USING btree ("space_id", "user_id", "document_id");
