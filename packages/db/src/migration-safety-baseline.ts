export type MigrationSafetyBaselineEntry = {
  readonly id: string;
  readonly rule: string;
  readonly migration: string;
  readonly table: string;
  readonly reason: string;
};

export const MIGRATION_SAFETY_BASELINE = [
  {
    id: "546baf15289633ca",
    rule: "large-create-index-not-concurrently",
    migration: "0000_mature_masked_marvel.sql",
    table: "activity_log",
    reason: "Initial schema history predates the migration-safety guard.",
  },
  {
    id: "2e21c87a27d0ecf3",
    rule: "large-create-index-not-concurrently",
    migration: "0000_mature_masked_marvel.sql",
    table: "issue_comments",
    reason: "Initial schema history predates the migration-safety guard.",
  },
  {
    id: "dcb068a399289a40",
    rule: "large-create-index-not-concurrently",
    migration: "0000_mature_masked_marvel.sql",
    table: "issue_comments",
    reason: "Initial schema history predates the migration-safety guard.",
  },
  {
    id: "14922cb22428e409",
    rule: "large-create-index-not-concurrently",
    migration: "0001_fast_northstar.sql",
    table: "agent_wakeup_requests",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "cfe0eaeee979eab9",
    rule: "large-create-index-not-concurrently",
    migration: "0001_fast_northstar.sql",
    table: "agent_wakeup_requests",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "b86e70ea500d5d9e",
    rule: "large-create-index-not-concurrently",
    migration: "0001_fast_northstar.sql",
    table: "agent_wakeup_requests",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "d12aeab5a11d37fe",
    rule: "large-create-index-not-concurrently",
    migration: "0001_fast_northstar.sql",
    table: "heartbeat_run_events",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "c5db2c734e2f4e54",
    rule: "large-create-index-not-concurrently",
    migration: "0001_fast_northstar.sql",
    table: "heartbeat_run_events",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "5aa34c180ff216b6",
    rule: "large-create-index-not-concurrently",
    migration: "0001_fast_northstar.sql",
    table: "heartbeat_run_events",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "06065c3f2e8bca76",
    rule: "large-create-index-not-concurrently",
    migration: "0003_shallow_quentin_quire.sql",
    table: "activity_log",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "d0cb536e5b329013",
    rule: "large-create-index-not-concurrently",
    migration: "0003_shallow_quentin_quire.sql",
    table: "activity_log",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "f7e8b1bfe3a0f1fe",
    rule: "large-create-index-not-concurrently",
    migration: "0024_far_beast.sql",
    table: "issue_comments",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "b2772ccce01219f2",
    rule: "large-create-index-not-concurrently",
    migration: "0024_far_beast.sql",
    table: "issue_comments",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "2874b94c3f294f53",
    rule: "large-create-index-not-concurrently",
    migration: "0051_young_korg.sql",
    table: "issue_comments",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "7ab5fe6138ec7389",
    rule: "large-create-index-not-concurrently",
    migration: "0060_orange_annihilus.sql",
    table: "issue_reference_mentions",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "7ea55e8e97d219c1",
    rule: "large-create-index-not-concurrently",
    migration: "0060_orange_annihilus.sql",
    table: "issue_reference_mentions",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "83f7b0e29bfaa644",
    rule: "large-create-index-not-concurrently",
    migration: "0060_orange_annihilus.sql",
    table: "issue_reference_mentions",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "efd6352f602c8927",
    rule: "large-create-index-not-concurrently",
    migration: "0060_orange_annihilus.sql",
    table: "issue_reference_mentions",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "a7d3bd30c6d6de0e",
    rule: "large-create-index-not-concurrently",
    migration: "0060_orange_annihilus.sql",
    table: "issue_reference_mentions",
    reason: "Historical migration predates the migration-safety guard.",
  },
  {
    id: "567b97176f9f06c3",
    rule: "large-create-index-not-concurrently",
    migration: "0132_issue_comment_derived_attribution_fast.sql",
    table: "issue_comments",
    reason: "Existing issue-attribution backfill branch uses a temporary support index before this guard landed.",
  },
] as const satisfies readonly MigrationSafetyBaselineEntry[];
