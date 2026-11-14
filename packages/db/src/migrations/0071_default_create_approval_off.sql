-- outpost:migration-compat requires_staging: Pre-release terminology reset; previous releases are not supported during this schema rewrite.
ALTER TABLE "spaces" ALTER COLUMN "require_operator_approval_for_new_agents" SET DEFAULT false;
