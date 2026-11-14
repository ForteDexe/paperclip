CREATE INDEX IF NOT EXISTS "heartbeat_runs_space_ctx_taskkey_created_idx" ON "heartbeat_runs" USING btree ("space_id", ("context_snapshot" ->> 'taskKey'), "created_at" DESC);
