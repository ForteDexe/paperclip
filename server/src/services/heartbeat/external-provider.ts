import type { NativeExecutionInput } from "../../vendor/outpost-runner/index.js";

/** Provider placement is distinct from access to a task's workspace. */
export function heartbeatExternalProvider(input: {
  run: { runtimeMode: string | null; runnerProfileJson: unknown };
  agent: { adapterType: string; adapterConfig: unknown };
}): "openai_dot" | "grok_bot" | "muse" | null {
  void input;
  return null;
}

export function nativeRuntimeHasInstructionFilesystem(backend: string): boolean {
  return !["claude_managed_agents_api", "aws_agentcore_harness_api"].includes(backend);
}

type TaskWorkspaceExecution = NativeExecutionInput;

export function nativeExecutionUsesTaskWorkspace(execution: NativeExecutionInput | null): execution is TaskWorkspaceExecution {
  return execution !== null && execution.provider.kind !== "cursor_cloud";
}
