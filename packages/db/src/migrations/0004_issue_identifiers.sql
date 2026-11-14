-- Add issue identifier columns to spaces
ALTER TABLE "spaces" ADD COLUMN "issue_prefix" text NOT NULL DEFAULT 'PAP';--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "issue_counter" integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- Add issue identifier columns to issues
ALTER TABLE "issues" ADD COLUMN "issue_number" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "identifier" text;--> statement-breakpoint

-- Backfill existing issues: assign sequential issue_number per space ordered by created_at
WITH numbered AS (
  SELECT id, space_id, ROW_NUMBER() OVER (PARTITION BY space_id ORDER BY created_at ASC) AS rn
  FROM issues
)
UPDATE issues
SET issue_number = numbered.rn,
    identifier = (SELECT issue_prefix FROM spaces WHERE spaces.id = issues.space_id) || '-' || numbered.rn
FROM numbered
WHERE issues.id = numbered.id;--> statement-breakpoint

-- Sync each space's issue_counter to the max assigned number
UPDATE spaces
SET issue_counter = COALESCE(
  (SELECT MAX(issue_number) FROM issues WHERE issues.space_id = spaces.id),
  0
);--> statement-breakpoint

-- Create unique index on (space_id, identifier)
CREATE UNIQUE INDEX "issues_space_identifier_idx" ON "issues" USING btree ("space_id","identifier");
