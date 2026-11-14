import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spaces, createDb, issues } from "@outpost/db";
import { buildExecutionPolicy } from "../../../ui/src/lib/issue-execution-policy.ts";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";
import { issueService } from "../services/issues.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("edited execution policy persistence", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("outpost-policy-persistence-");
    db = createDb(temporary.connectionString);
  }, 30_000);
  afterAll(async () => { await temporary?.cleanup(); });

  it.each(["reviewer", "monitor"] as const)("retains the independent review limit after removing the last %s", async (removed) => {
    const spaceId = randomUUID();
    const issueId = randomUUID();
    const original = normalizeIssueExecutionPolicy({
      maxReviewRounds: 4,
      ...(removed === "monitor"
        ? { monitor: { nextCheckAt: "2099-01-01T00:00:00.000Z" } }
        : { stages: [{ type: "review", participants: [{ type: "user", userId: "operator-reviewer" }] }] }),
    });
    await db.insert(spaces).values({ id: spaceId, name: "Policy fixture", issuePrefix: `P${spaceId.slice(0, 6)}` });
    await db.insert(issues).values({ id: issueId, spaceId, title: "Review limit fixture", executionPolicy: original as Record<string, unknown> | null });
    const edited = buildExecutionPolicy({ existingPolicy: original, reviewerValues: [], approverValues: [] })!;
    // The monitor editor removes this key after building the unchanged stages.
    const { monitor: _removedMonitor, ...withoutMonitor } = edited;
    const normalized = normalizeIssueExecutionPolicy(removed === "monitor" ? withoutMonitor : edited);
    const service = issueService(db);
    await service.update(issueId, { executionPolicy: normalized as Record<string, unknown> | null, spaceGuard: spaceId });
    const saved = await service.getById(issueId);
    expect(saved?.executionPolicy).toEqual({ mode: "normal", commentRequired: true, stages: [], maxReviewRounds: 4 });

    const restored = normalizeIssueExecutionPolicy(buildExecutionPolicy({
      existingPolicy: normalizeIssueExecutionPolicy(saved?.executionPolicy),
      reviewerValues: ["user:operator-reviewer"], approverValues: [],
    }));
    expect(restored).toMatchObject({ maxReviewRounds: 4, stages: [{ type: "review" }] });
  });
});
