import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spaces, createDb, issueLabels, issueRelations, issues, labels } from "@outpost/db";

import { buildExportFidelityReport, collectExportFidelityCounts } from "../services/export-fidelity.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres export fidelity tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("export fidelity counts", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-export-fidelity-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueLabels);
    await db.delete(issueRelations);
    await db.delete(labels);
    await db.delete(issues);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("counts labels, label references, blocker relations, and monitors scoped to the space", async () => {
    const spaceId = randomUUID();
    const otherSpaceId = randomUUID();
    await seedSpace(spaceId);
    await seedSpace(otherSpaceId);

    const issueA = randomUUID();
    const issueB = randomUUID();
    const otherIssue = randomUUID();
    await db.insert(issues).values([
      issueRow({ id: issueA, spaceId, identifier: "LOCAL-1" }),
      issueRow({ id: issueB, spaceId, identifier: "LOCAL-2", monitorScheduledBy: "agent" }),
      issueRow({ id: otherIssue, spaceId: otherSpaceId, identifier: "OTHER-1", monitorScheduledBy: "agent" }),
    ]);

    const labelId = randomUUID();
    const otherLabelId = randomUUID();
    await db.insert(labels).values([
      { id: labelId, spaceId, name: "bug", color: "#ff0000" },
      { id: otherLabelId, spaceId: otherSpaceId, name: "bug", color: "#00ff00" },
    ]);
    await db.insert(issueLabels).values([
      { issueId: issueA, labelId, spaceId },
      { issueId: otherIssue, labelId: otherLabelId, spaceId: otherSpaceId },
    ]);
    await db.insert(issueRelations).values([
      { spaceId, issueId: issueA, relatedIssueId: issueB, type: "blocks" as const },
    ]);

    const counts = await collectExportFidelityCounts(db, spaceId);
    expect(counts).toEqual({
      labelDefinitions: 1,
      issueLabelReferences: 1,
      issueBlockerRelations: 1,
      issueDocuments: 0,
      issueWorkProducts: 0,
      issueAttachments: 0,
      approvals: 0,
      costEvents: 0,
      activityLogEntries: 0,
      issueMonitors: 1,
    });

    const otherCounts = await collectExportFidelityCounts(db, otherSpaceId);
    expect(otherCounts.labelDefinitions).toBe(1);
    expect(otherCounts.issueBlockerRelations).toBe(0);
    expect(otherCounts.issueMonitors).toBe(1);
  });

  it("builds a report whose warnings reflect the collected counts", async () => {
    const spaceId = randomUUID();
    await seedSpace(spaceId);
    const issueId = randomUUID();
    await db.insert(issues).values([issueRow({ id: issueId, spaceId, identifier: "LOCAL-1" })]);
    const labelId = randomUUID();
    await db.insert(labels).values([{ id: labelId, spaceId, name: "bug", color: "#ff0000" }]);
    await db.insert(issueLabels).values([{ issueId, labelId, spaceId }]);

    const report = buildExportFidelityReport(spaceId, await collectExportFidelityCounts(db, spaceId));
    expect(report.schema).toBe("outpost-export-fidelity-v1");
    expect(report.spaceId).toBe(spaceId);
    // Labels travel in the bundle now, so their counts stay informational.
    expect(report.counts.labelDefinitions).toBe(1);
    expect(report.counts.issueLabelReferences).toBe(1);
    expect(report.warnings).toEqual([]);
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
  });

  async function seedSpace(spaceId: string) {
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
  }

  function issueRow(overrides: { id: string; spaceId: string; identifier: string; monitorScheduledBy?: string }) {
    return {
      description: "",
      status: "todo",
      priority: "medium",
      title: overrides.identifier,
      ...overrides,
    };
  }
});
