/** Server-owned rollout policy. Never read from agent tool arguments. */
export function runnerApiToolsEnabled(
  spaceId: string,
  bindingOverride?: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const enabled = environment.OUTPOST_RUNNER_API_TOOLS_ENABLED;
  // Enabled by default. Explicit settings fail closed; bindings can only narrow access.
  if ((enabled !== undefined && enabled !== "true") || bindingOverride === false) return false;
  const spaces = environment.OUTPOST_RUNNER_API_TOOLS_SPACE_IDS;
  if (spaces === undefined) return true;
  return spaces.split(",").map(value => value.trim()).filter(Boolean).includes(spaceId);
}
