import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  jsonb,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { completionContracts } from "./completion_contracts.js";
import { nativeRunResults } from "./native_run_results.js";

export const workAssessments = pgTable(
  "work_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    issueId: uuid("issue_id").notNull(),
    runId: uuid("run_id").notNull(),
    turnId: text("turn_id"),
    contractId: uuid("contract_id").notNull(),
    resultId: uuid("result_id").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    triggerRef: text("trigger_ref"),
    triggerCapability: text("trigger_capability"),
    triggerActorSpaceId: uuid("trigger_actor_space_id").notNull().references(() => spaces.id),
    priorIssueStatus: text("prior_issue_status").notNull(),
    priorStatusVersion: bigint("prior_status_version", { mode: "number" }).notNull(),
    priorDecisionId: uuid("prior_decision_id"),
    policyVersion: text("policy_version").notNull(),
    assessmentJson: jsonb("assessment_json").$type<Record<string, unknown>>().notNull(),
    inputDigest: text("input_digest").notNull(),
    supersedesAssessmentId: uuid("supersedes_assessment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIssueRunIdUq: unique("work_assessments_space_issue_run_id_uq").on(
      table.spaceId,
      table.issueId,
      table.runId,
      table.id,
    ),
    issueSpaceFk: foreignKey({
      columns: [table.spaceId, table.issueId],
      foreignColumns: [issues.spaceId, issues.id],
      name: "work_assessments_issue_space_fk",
    }),
    runOwnerFk: foreignKey({
      columns: [table.spaceId, table.issueId, table.runId],
      foreignColumns: [heartbeatRuns.spaceId, heartbeatRuns.nativeIssueId, heartbeatRuns.id],
      name: "work_assessments_run_owner_fk",
    }),
    contractOwnerFk: foreignKey({
      columns: [table.spaceId, table.issueId, table.contractId],
      foreignColumns: [
        completionContracts.spaceId,
        completionContracts.issueId,
        completionContracts.id,
      ],
      name: "work_assessments_contract_owner_fk",
    }),
    resultOwnerFk: foreignKey({
      columns: [table.spaceId, table.issueId, table.runId, table.resultId],
      foreignColumns: [
        nativeRunResults.spaceId,
        nativeRunResults.issueId,
        nativeRunResults.runId,
        nativeRunResults.id,
      ],
      name: "work_assessments_result_owner_fk",
    }),
    supersedesOwnerFk: foreignKey({
      columns: [table.spaceId, table.issueId, table.runId, table.supersedesAssessmentId],
      foreignColumns: [table.spaceId, table.issueId, table.runId, table.id],
      name: "work_assessments_supersedes_owner_fk",
    }),
    triggerActorSpaceCheck: check(
      "work_assessments_trigger_actor_space_check",
      sql`${table.triggerActorSpaceId} = ${table.spaceId}`,
    ),
    issueInputUq: uniqueIndex("work_assessments_space_issue_input_uq").on(
      table.spaceId,
      table.issueId,
      table.inputDigest,
    ),
  }),
);
