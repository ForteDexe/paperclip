import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  spaces,
  completionContracts,
  createDb,
  heartbeatRuns,
  issues,
  nativeRunFinalizations,
  nativeRunResults,
  workAssessments,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import {
  CONTROL_PLANE_CONFORMANCE_RESULT,
  CONTROL_PLANE_CONFORMANCE_TERMINAL,
} from "../../vendor/outpost-runner/testing.js";
import { OutpostControlPlanePort } from "./outpost-control-plane-port.js";
import { finalizeNativeRun } from "./native-run-finalizer.js";
import { commitNativeStatusDecision } from "./status-decision-committer.js";
import { NATIVE_STATUS_ARBITER_POLICY_VERSION } from "./status-arbiter.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres native finalization recovery state tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("native finalization recovery state", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const spaceId = randomUUID();
  const agentId = randomUUID();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-native-recovery-state-");
    db = createDb(tempDb.connectionString);
    await db.insert(spaces).values({ id: spaceId, name: "Recovery state", issuePrefix: "RST" });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Native worker", adapterType: "codex_local", status: "running" });
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedNativeRun() {
    const issueId = randomUUID(), contractId = randomUUID(), runId = randomUUID(), runnerInstanceId = randomUUID();
    const contractSha256 = `contract-${contractId}`;
    await db.insert(issues).values({ id: issueId, spaceId, title: "Native recovery state fixture",
      status: "in_progress", assigneeAgentId: agentId, workMode: "standard" });
    await db.insert(completionContracts).values({ id: contractId, spaceId, issueId, revision: 1,
      schemaVersion: "outpost.completion-contract.v1", policyVersion: "recovery-state-v1", risk: "standard",
      completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: { revision: "recovery-state-v1", objective: "Finish", criteria: [{ id: "objective", requirement: "Complete the task" }] },
      canonicalSha256: contractSha256, createdByActorType: "system", createdByActorId: "test" });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, status: "running", runtimeMode: "native",
      nativeIssueId: issueId, nativeSessionId: runId, runnerInstanceId, completionContractId: contractId,
      completionContractSha256: contractSha256, contextSnapshot: { issueId } });
    return { issueId, contractId, contractSha256, runId, runnerInstanceId };
  }

  async function completeResult(fixture: Awaited<ReturnType<typeof seedNativeRun>>) {
    const port = new OutpostControlPlanePort(db, { spaceId, issueId: fixture.issueId, runId: fixture.runId, agentId,
      sessionId: fixture.runId, completionContractId: fixture.contractId, completionContractSha256: fixture.contractSha256,
      sourceInstanceId: fixture.runnerInstanceId, controlPlaneSourceInstanceId: "recovery-state-test" });
    await port.openRun({ identity: { runId: fixture.runId, sessionId: fixture.runId, spaceId, issueId: fixture.issueId, agentId },
      backendKind: "mock", sourceInstanceId: fixture.runnerInstanceId });
    await port.completeRun({ result: CONTROL_PLANE_CONFORMANCE_RESULT, terminal: CONTROL_PLANE_CONFORMANCE_TERMINAL,
      callerResultId: `${fixture.runId}:result` });
  }

  async function readFinalization(runId: string) {
    return (await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, runId)))[0];
  }

  it("clears stale recovery state when the finalizer claims a persisted result", async () => {
    const fixture = await seedNativeRun();
    await completeResult(fixture);
    await db.update(nativeRunFinalizations).set({ recoveryState: "resuming_session", recoveryRequestId: "restart-request" })
      .where(eq(nativeRunFinalizations.runId, fixture.runId));
    await finalizeNativeRun({ db, runId: fixture.runId, workspaceFinalizeStatus: "succeeded", failpoint: "status_projection" })
      .catch(() => undefined);
    expect(await readFinalization(fixture.runId)).toMatchObject({
      phase: "retryable_failure", recoveryState: null, recoveryRequestId: null,
    });
  });

  it("clears stale recovery state when a status decision commits", async () => {
    const fixture = await seedNativeRun();
    const resultId = randomUUID(), assessmentId = randomUUID();
    await db.insert(nativeRunResults).values({ id: resultId, spaceId, issueId: fixture.issueId, runId: fixture.runId,
      completionContractId: fixture.contractId, serverFingerprint: `fp-${resultId}`, schemaStatus: "accepted",
      resultJson: {}, canonicalSha256: `sha-${resultId}` });
    await db.insert(workAssessments).values({ id: assessmentId, spaceId, issueId: fixture.issueId, runId: fixture.runId,
      contractId: fixture.contractId, resultId, triggerKind: "native_result", triggerActorSpaceId: spaceId,
      priorIssueStatus: "in_progress", priorStatusVersion: 0, policyVersion: "recovery-state-v1", assessmentJson: {},
      inputDigest: `digest-${assessmentId}` });
    await db.insert(nativeRunFinalizations).values({ runId: fixture.runId, spaceId, issueId: fixture.issueId,
      phase: "arbitrating", resultId, recoveryState: "resuming_session", recoveryRequestId: "restart-request" });
    await commitNativeStatusDecision({
      db, spaceId, issueId: fixture.issueId, runId: fixture.runId, assessmentId,
      priorStatus: "in_progress", priorStatusVersion: 0, priorDecisionId: null,
      decision: {
        policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION,
        statusAction: "cancelled",
        toStatus: "cancelled",
        reasonCode: "cancellation_issue_authorized",
        unblockDescriptor: null,
        effects: [{ kind: "release_checkout" }, { kind: "cancel_continuations" }],
      },
    });
    expect(await readFinalization(fixture.runId)).toMatchObject({
      phase: "committed", recoveryState: null, recoveryRequestId: null,
    });
  });
});
