import type { AdapterExecutionResult } from "../../adapters/types.js";

export const controlledSpaceBootstrapMessage = "Controlled review bootstrap unavailable";
export const controlledSpaceBootstrapScript = `console.error(${JSON.stringify(controlledSpaceBootstrapMessage)});process.exit(75)`;

export function controlledSpaceBootstrapResult(config: Record<string, unknown>, result: AdapterExecutionResult): AdapterExecutionResult {
  const args = config.args;
  if (config.command !== process.execPath || !Array.isArray(args) || args.length !== 2 || args[0] !== "-e" ||
      args[1] !== controlledSpaceBootstrapScript || result.exitCode !== 75 || result.signal !== null || result.timedOut ||
      result.resultJson?.stdout !== "" || result.resultJson?.stderr !== controlledSpaceBootstrapMessage + "\n") return result;
  return { ...result, executionRecovery: { kind: "bootstrap", providerWorkStarted: false } };
}
