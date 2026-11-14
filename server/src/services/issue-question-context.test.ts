import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, spaces, createDb, heartbeatRuns, issues, issueThreadInteractions } from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { activeIssueInteractionCondition } from "./issue-question-context.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("AI connection wait audience", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("connection-wait-audience-");
    db = createDb(database.connectionString);
  }, 90_000);
  afterAll(async () => { await database?.cleanup(); });

  it.each(["other_user", "same_user", "unknown_user", "unaddressed", "tool_access", "foreign_run", "missing_run"])(
    "uses the current run's user when selecting native connection waits (%s)", async audience => {
      const spaceId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
      await db.insert(spaces).values({ id: spaceId, name: "Wait audience", issuePrefix: `W${spaceId.slice(0, 8)}` });
      await db.insert(agents).values({ id: agentId, spaceId, name: "Worker", adapterType: "outpost_runner" });
      await db.insert(issues).values({ id: issueId, spaceId, title: "Fresh user turn", assigneeAgentId: agentId });
      let runSpaceId = spaceId;
      if (audience === "foreign_run") {
        runSpaceId = randomUUID();
        await db.insert(spaces).values({ id: runSpaceId, name: "Other space", issuePrefix: `F${runSpaceId.slice(0, 8)}` });
      }
      if (audience !== "missing_run") await db.insert(heartbeatRuns).values({
        id: runId, spaceId: runSpaceId, agentId, status: "running",
        responsibleUserId: audience === "unknown_user" ? null : "operator",
      });
      const [interaction] = await db.insert(issueThreadInteractions).values({
        spaceId, issueId, kind: "connection_intent", status: "pending", createdByAgentId: agentId,
        addresseeUserId: audience === "unaddressed" ? null : audience === "same_user" ? "operator" : "other-user",
        effectiveResolverPolicy: "human_only",
        payload: { version: 1, ...(audience === "tool_access" ? {} : { purpose: "ai" as const }),
          serviceSlug: "openai", serviceName: "OpenAI", requestingAgentId: agentId,
          requestingAgentName: "Worker", phase: "requested" },
      }).returning();
      const waits = await db.select().from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.spaceId, spaceId), eq(issueThreadInteractions.issueId, issueId),
        eq(issueThreadInteractions.status, "pending"), activeIssueInteractionCondition({ runId }),
      ));
      expect(waits).toHaveLength(audience === "other_user" ? 0 : 1);
      // Context-free readers retain the pending card and its authorization gate.
      expect(await db.select().from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.id, interaction.id), activeIssueInteractionCondition(),
      ))).toEqual([interaction]);
    },
  );
});
