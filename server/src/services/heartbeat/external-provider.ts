import type { NativeExecutionInput } from "../../vendor/outpost-runner/index.js";

export function nativeRuntimeHasInstructionFilesystem(backend: string): boolean {
  return !["claude_managed_agents_api", "aws_agentcore_harness_api"].includes(backend);
}

type TaskWorkspaceExecution = NativeExecutionInput;

export function nativeExecutionUsesTaskWorkspace(execution: NativeExecutionInput | null): execution is TaskWorkspaceExecution {
  return execution !== null && execution.provider.kind !== "cursor_cloud";
}
