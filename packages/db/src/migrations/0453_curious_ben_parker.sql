CREATE INDEX CONCURRENTLY IF NOT EXISTS "heartbeat_runs_space_native_workspace_idx" ON "heartbeat_runs" USING btree ("space_id",("runner_profile_json"->'nativeWorkspaceSync'->>'workspaceId'));
