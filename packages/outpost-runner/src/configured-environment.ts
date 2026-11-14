import { AGENT_OBSERVABILITY_ENV_KEYS } from "./drivers/agent-observability.js";
/** Names minted by the controller from the resolved task configuration.
 * Values remain in the process environment, never in argv or this manifest.
 * Do not mint this projection from ambient process.env.
 */
export const CONFIGURED_ENVIRONMENT_KEYS = "OUTPOST_CONFIGURED_ENV_KEYS";

export const GENERATED_RUNTIME_ENVIRONMENT_KEYS: ReadonlySet<string> = new Set([
  CONFIGURED_ENVIRONMENT_KEYS,
  ...AGENT_OBSERVABILITY_ENV_KEYS,
  "OUTPOST_AGENT_ID", "OUTPOST_AGENT_KEY_ID", "OUTPOST_AGENT_PUBLIC_KEY", "OUTPOST_AGENT_PRIVATE_KEY",
  "OUTPOST_API_KEY", "OUTPOST_API_URL", "OUTPOST_API_BRIDGE_MODE", "OUTPOST_COMPANY_ID", "OUTPOST_INSTANCE_ID",
  "OUTPOST_RUNTIME_NOTIFICATION_HELPER", "OUTPOST_RUNTIME_NOTIFICATION_CONTEXT", "OUTPOST_RUN_ID", "OUTPOST_NORMALIZED_SESSION_ID", "OUTPOST_RUNNER_INSTANCE_ID", "OUTPOST_RUNNER_BOOTSTRAP_TICKET", "OUTPOST_TASK_ID", "OUTPOST_APPROVAL_ID", "OUTPOST_APPROVAL_STATUS", "OUTPOST_LINKED_ISSUE_IDS",
  "OUTPOST_WAKE_REASON", "OUTPOST_WAKE_COMMENT_ID", "OUTPOST_WAKE_PAYLOAD_JSON", "OUTPOST_EXECUTION_MODE",
  "OUTPOST_WORKSPACES_JSON", "OUTPOST_WORKSPACE_ID", "OUTPOST_WORKSPACE_CWD", "OUTPOST_WORKSPACE_SOURCE",
  "OUTPOST_WORKSPACE_REPO_URL", "OUTPOST_WORKSPACE_REPO_REF", "OUTPOST_WORKSPACE_BRANCH",
  "OUTPOST_WORKSPACE_WORKTREE_PATH", "OUTPOST_WORKSPACE_REALIZATION_MODE", "OUTPOST_WORKSPACE_AUTHORITATIVE_ROOT",
  "OUTPOST_RUNTIME_PRIMARY_URL", "OUTPOST_RUNTIME_SERVICES_JSON", "OUTPOST_RUNTIME_SERVICE_INTENTS_JSON",
  "OUTPOST_AGENT_MESSAGE_KEY", "OUTPOST_HARNESS_CHECKOUT_KEY", "OUTPOST_EXTERNAL_CHAT_EXECUTION_BOUND_KEY",
  "OUTPOST_NATIVE_MCP_STDIO", "OUTPOST_NATIVE_MCP_PROXY",
  "OUTPOST_NATIVE_MCP_NAME", "OUTPOST_NATIVE_MCP_URL", "OUTPOST_NATIVE_MCP_TOKEN", "OUTPOST_AI_PROVIDER_KEY",
  "OUTPOST_PROVIDER_TRACE_PATH", "OUTPOST_PROVIDER_TRACE_MAX_BYTES", "OUTPOST_ACPX_CREDENTIAL_BINDING",
  "OUTPOST_RUNNER_NETWORK_ACCESS", "OUTPOST_RUNNER_NETWORK_ROOTS", "OUTPOST_RUNNER_EXTERNAL_SANDBOX",
  "OUTPOST_GITHUB_AUTH_MODE", "OUTPOST_GITHUB_HOST_HOME", "OUTPOST_GIT_METADATA_ROOTS",
  "OUTPOST_GITHUB_BROKER_TOKEN", "OUTPOST_GITHUB_BROKER_URL", "OUTPOST_GITHUB_BRIDGE_TOKEN", "OUTPOST_GITHUB_LAUNCHER_DIR",
]);

export const PROVIDER_CREDENTIAL_ENVIRONMENT_KEYS: readonly string[] = [
  "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK", "OPENROUTER_API_KEY", "XAI_API_KEY", "CURSOR_API_KEY", "CURSOR_AUTH_TOKEN",
  "COPILOT_GITHUB_TOKEN", "KIMI_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "OUTPOST_GIT_TOKEN",
];

const RESERVED_KEYS = new Set([
  "PATH", "HOME", "USERPROFILE", "CODEX_HOME", "AGENT_HOME", "SHELL", "NODE_OPTIONS", "NODE_PATH",
  "PYTHONPATH", "PYTHONHOME", "RUBYOPT", "RUBYLIB", "PERL5OPT", "PERL5LIB", "BASH_ENV", "ENV", "ZDOTDIR", "GH_CONFIG_DIR",
  ...PROVIDER_CREDENTIAL_ENVIRONMENT_KEYS,
]);

function eligibleKey(key: string): boolean {
  const upper = key.toUpperCase();
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
    && !GENERATED_RUNTIME_ENVIRONMENT_KEYS.has(upper)
    && !RESERVED_KEYS.has(upper)
    && !/^(?:LD_|DYLD_|GIT_CONFIG_|OUTPOST_(?:RUNNER_|NATIVE_|GITHUB_|ACPX_|CURSOR_CLOUD_|VERIFIED_))/.test(upper);
}

function checkedNames(names: unknown): string[] {
  if (!Array.isArray(names) || names.length > 128 || names.some(name => typeof name !== "string" || !eligibleKey(name))
    || new Set(names).size !== names.length) throw new Error("Invalid configured environment projection");
  return (names as string[]).sort();
}

/** Mint at the server's resolved configuration boundary, before host inheritance. */
export function configuredEnvironmentProjection(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = checkedNames(Object.keys(source).filter(key => source[key] !== undefined && eligibleKey(key)));
  return configuredEnvironment({ ...source, [CONFIGURED_ENVIRONMENT_KEYS]: JSON.stringify(names) });
}

/** Accept only an explicitly supplied, controller-minted projection. */
export function configuredEnvironment(source: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const raw = source?.[CONFIGURED_ENVIRONMENT_KEYS];
  if (raw === undefined) return {};
  if (Buffer.byteLength(raw) > 20_000) throw new Error("Invalid configured environment projection");
  let names: string[];
  try { names = checkedNames(JSON.parse(raw)); } catch { throw new Error("Invalid configured environment projection"); }
  const result: NodeJS.ProcessEnv = {};
  let bytes = 0;
  for (const name of names) {
    const value = source?.[name];
    if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid configured environment value");
    const size = Buffer.byteLength(name) + Buffer.byteLength(value);
    bytes += size;
    if (size > 65_536 || bytes > 262_144) throw new Error("Configured environment exceeds its bounded launch size");
    result[name] = value;
  }
  result[CONFIGURED_ENVIRONMENT_KEYS] = JSON.stringify(names);
  return result;
}

export function configuredEnvironmentKeys(source: NodeJS.ProcessEnv | undefined): string[] {
  return Object.keys(configuredEnvironment(source)).filter(key => key !== CONFIGURED_ENVIRONMENT_KEYS).sort();
}
