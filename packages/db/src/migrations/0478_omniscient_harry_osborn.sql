-- outpost:migration-compat requires_staging: R&D checkpoint normalizes removed Ask and Plan task modes before the new server starts.
ALTER TABLE "issues" ADD COLUMN "run_intent" text DEFAULT 'manual' NOT NULL;
UPDATE "issues" SET "work_mode" = 'standard' WHERE "work_mode" IN ('ask', 'planning');
