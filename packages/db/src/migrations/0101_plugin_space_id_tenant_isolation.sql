DROP INDEX "plugin_entities_external_idx";--> statement-breakpoint
ALTER TABLE "plugin_entities" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "plugin_job_runs" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "plugin_logs" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "plugin_webhook_deliveries" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "plugin_entities" ADD CONSTRAINT "plugin_entities_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_logs" ADD CONSTRAINT "plugin_logs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_webhook_deliveries" ADD CONSTRAINT "plugin_webhook_deliveries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugin_entities_space_idx" ON "plugin_entities" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "plugin_job_runs_space_idx" ON "plugin_job_runs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "plugin_logs_space_idx" ON "plugin_logs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "plugin_webhook_deliveries_space_idx" ON "plugin_webhook_deliveries" USING btree ("space_id");--> statement-breakpoint
ALTER TABLE "plugin_entities" ADD CONSTRAINT "plugin_entities_external_idx" UNIQUE NULLS NOT DISTINCT("space_id","plugin_id","entity_type","external_id");