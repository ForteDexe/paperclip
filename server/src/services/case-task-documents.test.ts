import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, caseDocuments, caseIssueLinks, cases, spaces, createDb, documents, heartbeatRuns, issueDocuments, issues } from "@outpost/db";
import { SYSTEM_ISSUE_DOCUMENT_KEYS } from "@outpost/shared";
import { startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { listCaseTaskDocuments } from "./case-task-documents.js";
import { getCaseExecutionContext } from "./case-context.js";

describe("case task document references", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    vi.stubEnv("OUTPOST_ISSUE_PRIVACY_MODE", "enforce");
    temporary = await startEmbeddedPostgresTestDatabase("case-task-documents-");
    db = createDb(temporary.connectionString);
  });
  afterAll(async () => { vi.unstubAllEnvs(); await temporary?.cleanup(); });

  async function fixture() {
    const spaceId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
    const caseId = randomUUID(), taskId = randomUUID(), linkedId = randomUUID(), privateId = randomUUID(), unrelatedId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Document factory", issuePrefix: `D${spaceId.slice(0, 6)}` });
    await db.insert(agents).values([agentId, otherAgentId].map(id => ({ id, spaceId, name: id, role: "engineer", status: "active", adapterType: "process" })));
    await db.insert(issues).values([
      { id: taskId, spaceId, title: "Primary task", identifier: `${spaceId}-1`, assigneeAgentId: agentId },
      { id: linkedId, spaceId, title: "Linked task", identifier: `${spaceId}-2` },
      { id: privateId, spaceId, title: "Private task", visibility: "private", assigneeAgentId: otherAgentId },
      { id: unrelatedId, spaceId, title: "Unrelated task" },
    ]);
    await db.insert(cases).values({ id: caseId, spaceId, caseNumber: 1, identifier: `${spaceId}-C1`, caseType: "work", title: "Shared findings", workIssueId: taskId });
    await db.insert(caseIssueLinks).values([linkedId, privateId].map(issueId => ({ spaceId, caseId, issueId, role: "reference" })));
    const actor = { type: "agent" as const, spaceId, agentId, keyScope: { kind: "standard" as const } };
    return { spaceId, agentId, caseId, taskId, linkedId, privateId, unrelatedId, actor };
  }
  async function document(spaceId: string, taskId: string, key: string, title: string, quarantined = false) {
    const id = randomUUID(), revisionId = randomUUID();
    await db.insert(documents).values({ id, spaceId, title, latestBody: `BODY_CANARY ${title}`, latestRevisionId: revisionId,
      ...(quarantined ? { sourceTrust: { preset: "low_trust_review" as const, disposition: "quarantined" as const } } : {}) });
    await db.insert(issueDocuments).values({ spaceId, issueId: taskId, documentId: id, key });
    return { id, revisionId };
  }

  it("rolls up primary and readable linked task metadata with distinct keys, never copies or bodies", async () => {
    const f = await fixture();
    const primary = await document(f.spaceId, f.taskId, "plan", "Primary plan");
    await document(f.spaceId, f.linkedId, "plan", "Linked plan");
    await document(f.spaceId, f.privateId, "plan", "PRIVATE_TITLE_CANARY");
    await document(f.spaceId, f.unrelatedId, "notes", "UNRELATED_TITLE_CANARY");
    const result = await listCaseTaskDocuments(db, { spaceId: f.spaceId, caseId: f.caseId, workIssueId: f.taskId, actor: f.actor });
    expect(result.taskDocuments).toHaveLength(2);
    expect(result.taskDocuments[0]).toMatchObject({ id: `issue:${f.taskId}:plan`, taskId: f.taskId, scope: "primary", key: "plan", document: { id: primary.id, latestRevisionId: primary.revisionId }, readPath: `/api/issues/${f.taskId}/documents/plan` });
    expect(new Set(result.taskDocuments.map(ref => ref.id)).size).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/BODY_CANARY|PRIVATE_TITLE_CANARY|UNRELATED_TITLE_CANARY|latestBody/);
    expect(await db.select().from(caseDocuments).where(eq(caseDocuments.caseId, f.caseId))).toHaveLength(0);
    expect(result.taskDocumentsOmitted).toBe(false);
  });

  it("filters quarantined references before the visible document limit and refreshes permissions", async () => {
    const f = await fixture();
    await document(f.spaceId, f.taskId, "a-quarantine", "QUARANTINE_TITLE_CANARY", true);
    await document(f.spaceId, f.taskId, "b-visible", "Visible finding");
    for (const key of SYSTEM_ISSUE_DOCUMENT_KEYS) await document(f.spaceId, f.taskId, key, "SYSTEM_TITLE_CANARY");
    const first = await listCaseTaskDocuments(db, { spaceId: f.spaceId, caseId: f.caseId, workIssueId: f.taskId, actor: f.actor, limit: 1 });
    expect(first.taskDocuments.map(ref => ref.key)).toEqual(["b-visible"]);
    expect(first.taskDocumentsOmitted).toBe(false);
    const operator = await listCaseTaskDocuments(db, { spaceId: f.spaceId, caseId: f.caseId, workIssueId: f.taskId,
      actor: { type: "operator", source: "local_implicit" }, limit: 2 });
    expect(operator.taskDocuments.map(ref => ref.key)).toEqual(["a-quarantine", "b-visible"]);
    expect(operator.taskDocumentsOmitted).toBe(false);
    await db.update(issues).set({ visibility: "private", assigneeAgentId: null }).where(eq(issues.id, f.taskId));
    expect((await listCaseTaskDocuments(db, { spaceId: f.spaceId, caseId: f.caseId, workIssueId: f.taskId, actor: f.actor })).taskDocuments).toEqual([]);
  });

  it("keeps the primary workflow reference visible before the context budget without injecting its body", async () => {
    const f = await fixture(), runId = randomUUID();
    for (let index = 0; index < 20; index++) await document(f.spaceId, f.taskId, `a-${index}`, `Finding ${index}`);
    const workflow = await document(f.spaceId, f.taskId, "workflow", "Workflow");
    await document(f.spaceId, f.linkedId, "workflow", "Linked workflow");
    const first = await listCaseTaskDocuments(db, { spaceId: f.spaceId, caseId: f.caseId, workIssueId: f.taskId, actor: f.actor, limit: 1 });
    expect(first.taskDocuments).toHaveLength(1);
    expect(first.taskDocuments[0]).toMatchObject({ taskId: f.taskId, key: "workflow", document: { id: workflow.id } });
    expect(first.taskDocumentsOmitted).toBe(true);
    await db.insert(heartbeatRuns).values({ id: runId, spaceId: f.spaceId, agentId: f.agentId, issueId: f.taskId,
      status: "running", invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId: f.taskId } });
    const context = await getCaseExecutionContext(db, { spaceId: f.spaceId, issueId: f.taskId, agentId: f.agentId, runId });
    expect(JSON.parse(context!.data).documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: "issue", taskId: f.taskId, key: "workflow", revisionId: workflow.revisionId }),
    ]));
    expect(context!.data).not.toContain("BODY_CANARY");
  });

  it("fresh wake context includes owner task and revision references alongside historical case documents", async () => {
    const f = await fixture(), runId = randomUUID();
    const primary = await document(f.spaceId, f.taskId, "receipt", "Receipt");
    const legacyId = randomUUID();
    await db.insert(documents).values({ id: legacyId, spaceId: f.spaceId, title: "Historical receipt", latestBody: "LEGACY_BODY_CANARY" });
    await db.insert(caseDocuments).values({ spaceId: f.spaceId, caseId: f.caseId, documentId: legacyId, key: "receipt" });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId: f.spaceId, agentId: f.agentId, issueId: f.taskId,
      status: "running", invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId: f.taskId } });
    const read = () => getCaseExecutionContext(db, { spaceId: f.spaceId, issueId: f.taskId, agentId: f.agentId, runId });
    const before = await read(), refs = JSON.parse(before!.data).documents;
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: "issue", taskId: f.taskId, key: "receipt", revisionId: primary.revisionId }),
      expect.objectContaining({ sourceKind: "case", caseId: f.caseId, key: "receipt" }),
    ]));
    expect(new Set(refs.map((ref: { id: string }) => ref.id)).size).toBe(2);
    expect(before!.data).not.toMatch(/BODY_CANARY|LEGACY_BODY_CANARY/);
    await db.update(documents).set({ latestRevisionId: randomUUID() }).where(eq(documents.id, primary.id));
    const after = await read();
    expect(after!.factsSha256).not.toBe(before!.factsSha256);
    expect(await db.select().from(caseDocuments).where(eq(caseDocuments.documentId, legacyId))).toHaveLength(1);
  });
});
