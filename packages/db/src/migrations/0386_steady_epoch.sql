CREATE INDEX CONCURRENTLY IF NOT EXISTS "tool_action_requests_space_interaction_idx" ON "tool_action_requests" USING btree ("space_id","interaction_id");
