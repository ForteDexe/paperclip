DROP INDEX "issues_space_identifier_idx";--> statement-breakpoint

-- Rebuild issue prefixes to be space-specific and globally unique.
-- Base prefix is first 3 letters of space name (A-Z only), fallback "CMP".
-- Duplicate bases receive deterministic letter suffixes: PAP, PAPA, PAPAA, ...
WITH ranked_spaces AS (
  SELECT
    c.id,
    COALESCE(NULLIF(SUBSTRING(REGEXP_REPLACE(UPPER(c.name), '[^A-Z]', '', 'g') FROM 1 FOR 3), ''), 'CMP') AS base_prefix,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(SUBSTRING(REGEXP_REPLACE(UPPER(c.name), '[^A-Z]', '', 'g') FROM 1 FOR 3), ''), 'CMP')
      ORDER BY c.created_at, c.id
    ) AS prefix_rank
  FROM spaces c
)
UPDATE spaces c
SET issue_prefix = CASE
  WHEN ranked_spaces.prefix_rank = 1 THEN ranked_spaces.base_prefix
  ELSE ranked_spaces.base_prefix || REPEAT('A', (ranked_spaces.prefix_rank - 1)::integer)
END
FROM ranked_spaces
WHERE c.id = ranked_spaces.id;--> statement-breakpoint

-- Reassign issue numbers sequentially per space to guarantee uniqueness.
WITH numbered_issues AS (
  SELECT
    i.id,
    ROW_NUMBER() OVER (PARTITION BY i.space_id ORDER BY i.created_at, i.id) AS issue_number
  FROM issues i
)
UPDATE issues i
SET issue_number = numbered_issues.issue_number
FROM numbered_issues
WHERE i.id = numbered_issues.id;--> statement-breakpoint

-- Rebuild identifiers from normalized prefix + issue number.
UPDATE issues i
SET identifier = c.issue_prefix || '-' || i.issue_number
FROM spaces c
WHERE c.id = i.space_id;--> statement-breakpoint

-- Sync counters to the largest issue number currently assigned per space.
UPDATE spaces c
SET issue_counter = COALESCE((
  SELECT MAX(i.issue_number)
  FROM issues i
  WHERE i.space_id = c.id
), 0);--> statement-breakpoint

CREATE UNIQUE INDEX "spaces_issue_prefix_idx" ON "spaces" USING btree ("issue_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_identifier_idx" ON "issues" USING btree ("identifier");
