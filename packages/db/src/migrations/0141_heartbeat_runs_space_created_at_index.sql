-- outpost:migration-compat requires_staging: Pre-release Space schema reset; no previous release is supported during this migration rewrite.
CREATE INDEX IF NOT EXISTS "heartbeat_runs_space_created_at_desc_idx"
  ON "heartbeat_runs" USING btree ("space_id", "created_at" DESC);
