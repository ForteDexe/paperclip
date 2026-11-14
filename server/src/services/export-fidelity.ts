import { and, count, eq, sql } from "drizzle-orm";
import {
  EXPORT_FIDELITY_REPORT_SCHEMA,
  buildExportFidelityWarnings,
  type ExportFidelityCounts,
  type ExportFidelityReport,
} from "@outpost/shared/portability-fidelity";
import type { Db } from "@outpost/db";
import {
  activityLog,
  approvals,
  costEvents,
  issueAttachments,
  issueDocuments,
  issueLabels,
  issueRelations,
  issueWorkProducts,
  issues,
  labels,
} from "@outpost/db";

export async function collectExportFidelityCounts(db: Db, spaceId: string): Promise<ExportFidelityCounts> {
  const [
    labelDefinitions,
    issueLabelReferences,
    issueBlockerRelations,
    issueDocumentCount,
    issueWorkProductCount,
    issueAttachmentCount,
    approvalCount,
    costEventCount,
    activityLogEntries,
    issueMonitors,
  ] = await Promise.all([
    db.select({ count: count() }).from(labels).where(eq(labels.spaceId, spaceId)).then(firstCount),
    db.select({ count: count() }).from(issueLabels).where(eq(issueLabels.spaceId, spaceId)).then(firstCount),
    db
      .select({ count: count() })
      .from(issueRelations)
      .where(and(eq(issueRelations.spaceId, spaceId), eq(issueRelations.type, "blocks")))
      .then(firstCount),
    db.select({ count: count() }).from(issueDocuments).where(eq(issueDocuments.spaceId, spaceId)).then(firstCount),
    db.select({ count: count() }).from(issueWorkProducts).where(eq(issueWorkProducts.spaceId, spaceId)).then(firstCount),
    db.select({ count: count() }).from(issueAttachments).where(eq(issueAttachments.spaceId, spaceId)).then(firstCount),
    db.select({ count: count() }).from(approvals).where(eq(approvals.spaceId, spaceId)).then(firstCount),
    db.select({ count: count() }).from(costEvents).where(eq(costEvents.spaceId, spaceId)).then(firstCount),
    db.select({ count: count() }).from(activityLog).where(eq(activityLog.spaceId, spaceId)).then(firstCount),
    db
      .select({ count: count() })
      .from(issues)
      .where(and(
        eq(issues.spaceId, spaceId),
        sql`(${issues.monitorNextCheckAt} is not null or ${issues.monitorScheduledBy} is not null)`,
      ))
      .then(firstCount),
  ]);
  return {
    labelDefinitions,
    issueLabelReferences,
    issueBlockerRelations,
    issueDocuments: issueDocumentCount,
    issueWorkProducts: issueWorkProductCount,
    issueAttachments: issueAttachmentCount,
    approvals: approvalCount,
    costEvents: costEventCount,
    activityLogEntries,
    issueMonitors,
  };
}

export function buildExportFidelityReport(spaceId: string, counts: ExportFidelityCounts): ExportFidelityReport {
  return {
    schema: EXPORT_FIDELITY_REPORT_SCHEMA,
    spaceId,
    counts,
    warnings: buildExportFidelityWarnings(counts),
    generatedAt: new Date().toISOString(),
  };
}

function firstCount(rows: Array<{ count: number }>): number {
  return rows[0]?.count ?? 0;
}
