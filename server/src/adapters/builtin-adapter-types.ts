/**
 * Adapter types shipped with Outpost. External plugins must not replace these.
 */
export const BUILTIN_ADAPTER_TYPES = new Set([
  "acpx_local",
  "claude_local",
  "codex_local",
  "process",
  "http",
]);

/** Adapter types Outpost offers when creating or reconfiguring an agent. */
export const OUTPOST_AGENT_ADAPTER_TYPES = new Set([
  "claude_local",
  "codex_local",
]);
