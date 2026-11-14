import { OUTPOST_RUNNER_ACPX_PROFILES } from "@outpost/adapter-utils";
const CLOUD_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "opencode_local",
  "grok_local",
]);

/** Creation policy shared by the picker and direct setup links. */
export function isNewAgentAdapterAllowed(
  type: string,
  {
    cloud,
    nativeRunnerEnabled,
    openAiDotEnabled = false,
    museEnabled = false,
    runnerProvider,
    candidateHarnesses,
  }: { cloud: boolean; nativeRunnerEnabled: boolean; openAiDotEnabled?: boolean; museEnabled?: boolean; runnerProvider?: string;
    candidateHarnesses?: readonly { agent: "antigravity"; model: string }[] },
) {
  if (type === "openai_dot" || (type === "outpost_runner" && runnerProvider === "openai_dot")) {
    return openAiDotEnabled;
  }
  if (type === "muse" || (type === "outpost_runner" && runnerProvider === "muse")) return museEnabled && nativeRunnerEnabled;
  if (type === "outpost_runner" && runnerProvider === "antigravity") return OUTPOST_RUNNER_ACPX_PROFILES.some(profile => profile.value === "antigravity" && profile.qualified)
    || Boolean(candidateHarnesses?.some(candidate => candidate.agent === "antigravity" && candidate.model));
  if (type === "outpost_runner") return runnerProvider === "copilot" || nativeRunnerEnabled;
  if (cloud && type === "cursor_cloud") return nativeRunnerEnabled;
  if (cloud) return CLOUD_ADAPTERS.has(type);
  return true;
}
