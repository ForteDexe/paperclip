import type { Db } from "@outpost/db";
import type { Agent, EnvironmentProbeResult } from "@outpost/shared";
import { conflict, unprocessable } from "../errors.js";
import { resolveAgentRunnerEnvironmentForSpace } from "./agent-runner-selection.js";
import { probeEnvironment, readSandboxPlatformQualification } from "./environment-probe.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";

export async function qualifyAgentRunner(
  db: Db,
  agent: Pick<Agent, "spaceId" | "adapterType" | "defaultEnvironmentId">,
  expectedEnvironmentId: string,
  pluginWorkerManager?: PluginWorkerManager,
): Promise<EnvironmentProbeResult> {
  if (!["claude_local", "codex_local", "grok_local", "outpost_runner"].includes(agent.adapterType)) {
    throw unprocessable("This agent does not support computer qualification.");
  }
  const { environment } = await resolveAgentRunnerEnvironmentForSpace(db, agent.spaceId, agent.defaultEnvironmentId);
  if (!environment || environment.id !== expectedEnvironmentId) {
    throw conflict(agent.adapterType === "outpost_runner"
      ? "The agent's computer changed. Save the computer selection, reload, and run its test again."
      : "The agent's computer changed. Save any environment changes, reload, and retry the upgrade.");
  }
  if (environment.driver !== "sandbox") {
    throw unprocessable("This computer does not need sandbox qualification.");
  }
  // A normal native-agent Test still probes its runtime. Reuse a valid saved
  // platform proof so that test does not invalidate a healthy computer first.
  if (agent.adapterType === "outpost_runner" && await readSandboxPlatformQualification(db, environment, agent.spaceId)) {
    return { ok: true, driver: "sandbox", summary: "The agent's computer is qualified for runner selection.",
      details: { platformQualificationRecorded: true } };
  }
  const result = await probeEnvironment(db, environment, {
    spaceId: agent.spaceId,
    pluginWorkerManager,
    applyCustomImageTemplate: true,
    acquireSandboxRuntimeLease: true,
    assertSpaceBinding: true,
  });
  const qualified = result.ok === true && result.details?.platformQualificationRecorded === true;
  return {
    ok: result.ok,
    driver: "sandbox",
    summary: qualified ? "The agent's computer is qualified for runner selection."
      : agent.adapterType === "outpost_runner" ? "Could not verify the saved computer. Run test again."
        : "Could not qualify the agent's computer. Retry the upgrade or keep Legacy runner.",
    details: {
      platformQualificationRecorded: qualified,
      ...(typeof result.details?.leaseId === "string" ? { leaseId: result.details.leaseId } : {}),
    },
  };
}
