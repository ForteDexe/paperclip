ALTER TABLE "user_space_preferences" RENAME COLUMN "primary_agent_id" TO "default_agent_id";--> statement-breakpoint
ALTER TABLE "user_space_preferences" RENAME COLUMN "primary_agent_initialized" TO "default_agent_initialized";--> statement-breakpoint
ALTER TABLE "cli_auth_challenges" DROP CONSTRAINT "cli_auth_challenges_board_api_key_id_board_api_keys_id_fk";
--> statement-breakpoint
ALTER TABLE "user_space_preferences" DROP CONSTRAINT "user_space_preferences_primary_agent_id_agents_id_fk";
--> statement-breakpoint
DROP INDEX "user_space_preferences_primary_agent_idx";--> statement-breakpoint
DROP INDEX "spaces_primary_agent_id_idx";--> statement-breakpoint
ALTER TABLE "spaces" RENAME COLUMN "primary_agent_id" TO "default_agent_id";--> statement-breakpoint
ALTER TABLE "cli_auth_challenges" ADD CONSTRAINT "cli_auth_challenges_operator_api_key_id_operator_api_keys_id_fk" FOREIGN KEY ("operator_api_key_id") REFERENCES "public"."operator_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_space_preferences" ADD CONSTRAINT "user_space_preferences_default_agent_id_agents_id_fk" FOREIGN KEY ("default_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spaces_default_agent_id_idx" ON "spaces" USING btree ("default_agent_id");--> statement-breakpoint
CREATE INDEX "user_space_preferences_default_agent_idx" ON "user_space_preferences" USING btree ("default_agent_id");
