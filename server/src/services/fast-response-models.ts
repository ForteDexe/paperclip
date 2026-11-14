import { models as anthropic } from "@outpost/adapter-claude-local";
import { models as openai } from "@outpost/adapter-codex-local";
import { models as google } from "@outpost/adapter-gemini-local";
import { models as xai } from "@outpost/adapter-grok-local";
import type { AiConnectionMetadata } from "@outpost/shared";

/** Catalogs follow the saved API connection, never the host CLI's credentials or environment. */
export function fastResponseCatalogModels(connection: Pick<AiConnectionMetadata, "provider" | "routing">) {
  if (connection.routing) return connection.routing.models ?? [];
  return { anthropic, openai, google, xai, openrouter: [], github: [] }[connection.provider];
}
