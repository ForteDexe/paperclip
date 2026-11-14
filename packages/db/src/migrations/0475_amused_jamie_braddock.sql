ALTER TABLE "chat_voice_sessions" DROP CONSTRAINT "chat_voice_sessions_authority_check";--> statement-breakpoint
UPDATE "chat_voice_sessions"
SET "caller_authority" = 'local_operator'
WHERE "caller_authority" = 'local_board';--> statement-breakpoint
UPDATE "chat_actions"
SET "kind" = 'slack_operator_message'
WHERE "kind" = 'slack_board_message';--> statement-breakpoint
UPDATE "chat_actions"
SET "result" = jsonb_set("result", '{code}', '"slack_operator_work_not_authorized"'::jsonb)
WHERE "result"->>'code' = 'slack_board_work_not_authorized';--> statement-breakpoint
ALTER TABLE "chat_voice_sessions" ADD CONSTRAINT "chat_voice_sessions_authority_check" CHECK ("chat_voice_sessions"."caller_authority" in ('member', 'instance_admin', 'local_operator', 'guest_intake', 'pending_approval'));
