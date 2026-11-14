import { DEFAULT_CODEX_LOCAL_MODEL } from "@outpost/adapter-codex-local";
import { claudeLocalReasoningEffortsForModel, DEFAULT_CLAUDE_LOCAL_MODEL } from "@outpost/adapter-claude-local";
import { codexReasoningEffortOptions } from "./codex-reasoning-effort";
import { PROVIDER_ENV_KEYS } from "./provider-credential";

/** Only controls consumed by each adapter's config builder and runtime belong here. */
export const SETUP_CREDENTIAL_KEYS: Record<string, string> = {};

export function setupProviderKeys(adapter: string) {
  void adapter;
  return PROVIDER_ENV_KEYS;
}

export function setupEfforts(adapter: string, model = ""): string[] {
  switch (adapter) {
    case "claude_local":
      return [...claudeLocalReasoningEffortsForModel(model || DEFAULT_CLAUDE_LOCAL_MODEL)];
    case "codex_local":
      return codexReasoningEffortOptions(model || DEFAULT_CODEX_LOCAL_MODEL)
        .map((option) => option.value)
        .filter(Boolean);
    default:
      return [];
  }
}

export const SETUP_LOGIN_HINTS: Record<string, string> = {};
