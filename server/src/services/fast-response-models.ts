import { models as anthropic } from "@outpost/adapter-claude-local";
import { models as openai } from "@outpost/adapter-codex-local";
import type { AiConnectionMetadata } from "@outpost/shared";

/** Catalogs follow the saved API connection, never the host CLI's credentials or environment. */
export function fastResponseCatalogModels(connection: Pick<AiConnectionMetadata, "provider" | "routing">) {
  if (connection.routing) return connection.routing.models ?? [];
  return connection.provider === "anthropic" ? anthropic
    : connection.provider === "openai" ? openai : [];
}
