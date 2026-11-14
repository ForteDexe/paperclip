CREATE TABLE IF NOT EXISTS "native_runner_checkpoints" (
	"space_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"part" text NOT NULL,
	"material" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_runner_checkpoints_run_id_part_pk" PRIMARY KEY("run_id","part")
);
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "native_runner_checkpoints" ADD CONSTRAINT "native_runner_checkpoints_space_id_issue_id_run_id_heartbeat_runs_space_id_native_issue_id_id_fk" FOREIGN KEY ("space_id","issue_id","run_id") REFERENCES "public"."heartbeat_runs"("space_id","native_issue_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "native_runner_checkpoints_headers_idx" ON "native_runner_checkpoints" USING btree ("run_id") WHERE "native_runner_checkpoints"."part" = 'header';
