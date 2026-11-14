CREATE UNIQUE INDEX IF NOT EXISTS "issues_onboarding_first_task_uq"
  ON "issues" USING btree ("space_id")
  WHERE "origin_kind" = 'onboarding_first_task';
