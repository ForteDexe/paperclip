const HOST_LOGIN_ADAPTERS = new Set(["codex_local", "claude_local"]);

/** Codex and Claude own their credentials outside Outpost. */
export function usesExistingProviderLogin(adapterType: string): boolean {
  return HOST_LOGIN_ADAPTERS.has(adapterType);
}
