CREATE INDEX IF NOT EXISTS "issue_create_idempotency_keys_space_created_at_idx"
  ON "issue_create_idempotency_keys" USING btree ("space_id", "created_at");
