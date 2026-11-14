CREATE TABLE "space_transfer_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor_key" text NOT NULL,
	"container_ref" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"manifest_sha256" text,
	"manifest" jsonb,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"blob_count" integer DEFAULT 0 NOT NULL,
	"completed_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_transfer_runs" ADD CONSTRAINT "space_transfer_runs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_transfer_runs_space_idx" ON "space_transfer_runs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_transfer_runs_idempotency_direction_idx" ON "space_transfer_runs" USING btree ("idempotency_key","direction");--> statement-breakpoint
CREATE INDEX "space_transfer_runs_actor_status_idx" ON "space_transfer_runs" USING btree ("actor_key","status");