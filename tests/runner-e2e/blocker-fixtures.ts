import { FixtureRegistry } from "./fixture-registry.js";
import { prepareLegacyContinuationSkill } from "./continuation-fixtures.js";
import type { RunnerApi } from "./api.js";
import type { LiveFixtureValues } from "./live-fixtures.js";
import type { MatrixExecution } from "./types.js";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function setupBlockerFixtures(input: {
  api: RunnerApi; fixtures: LiveFixtureValues; execution: MatrixExecution; workspacePath: string; nonce: string;
}) {
  const { api, fixtures, execution } = input;
  if (execution.profile.id === "legacy-claude") {
    await mkdir(path.join(input.workspacePath, ".blocker-provider-home", ".claude"), { recursive: true });
  }
  const registry = new FixtureRegistry();
  registry.register<{ id: string }>({ id: "coordinator", async setup() {
    const payload = execution.profile.buildAgent({ environmentId: fixtures.environment.id, environmentFixtureId: "local",
      workspacePath: input.workspacePath, secretRefs: fixtures.secretRefs, executionId: input.nonce });
    return api.post(`/api/spaces/${fixtures.space.id}/agents`, { ...payload,
      name: "Morgan Coordinator", role: "general", title: "Operations Coordinator",
      capabilities: "Coordinates operational work. Has no external administrator access or agent-creation permission." });
  } });
  registry.register({ id: "worker-policy", dependencies: ["coordinator"], async setup(resolved) {
    const coordinator = resolved.get("coordinator") as { id: string };
    for (const agentId of [coordinator.id, fixtures.agent.id]) {
      await api.patch(`/api/agents/${agentId}/permissions`, { canCreateAgents: false, canAssignTasks: true });
      await prepareLegacyContinuationSkill(api, fixtures.space.id, agentId);
    }
    await api.patch(`/api/agents/${fixtures.agent.id}`, { leadAgentId: coordinator.id });
    return true;
  } });
  // All agents/runs live in the parent registry's isolated space. The harness
  // cancels every space run and removes the instance after evidence capture.
  const setup = await registry.setupAll();
  return { coordinator: setup.values.get("coordinator") as { id: string } };
}
