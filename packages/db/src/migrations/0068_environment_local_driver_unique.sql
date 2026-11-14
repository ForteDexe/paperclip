DROP INDEX IF EXISTS "environments_space_driver_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_space_driver_idx" ON "environments" USING btree ("space_id","driver") WHERE "driver" = 'local';
