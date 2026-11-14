DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decision_queues_id_space_uq' AND conrelid = 'public.decision_queues'::regclass) THEN
		ALTER TABLE "decision_queue_items" DROP CONSTRAINT IF EXISTS "decision_queue_items_queue_space_fk";
		DROP INDEX IF EXISTS "decision_queues_id_space_uq";
		ALTER TABLE "decision_queues" ADD CONSTRAINT "decision_queues_id_space_uq" UNIQUE("id","space_id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decision_queue_items_queue_space_fk' AND conrelid = 'public.decision_queue_items'::regclass) THEN
		ALTER TABLE "decision_queue_items" ADD CONSTRAINT "decision_queue_items_queue_space_fk" FOREIGN KEY ("queue_id","space_id") REFERENCES "public"."decision_queues"("id","space_id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
