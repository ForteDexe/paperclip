export interface OutpostMcpConfig {
  apiUrl: string;
  apiKey: string;
  spaceId: string | null;
  agentId: string | null;
  runId: string | null;
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeApiUrl(apiUrl: string): string {
  const trimmed = stripTrailingSlash(apiUrl.trim());
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OutpostMcpConfig {
  const apiUrl = nonEmpty(env.OUTPOST_API_URL);
  if (!apiUrl) {
    throw new Error("Missing OUTPOST_API_URL");
  }
  const apiKey = nonEmpty(env.OUTPOST_API_KEY);
  if (!apiKey) {
    throw new Error("Missing OUTPOST_API_KEY");
  }

  return {
    apiUrl: normalizeApiUrl(apiUrl),
    apiKey,
    spaceId: nonEmpty(env.OUTPOST_SPACE_ID),
    agentId: nonEmpty(env.OUTPOST_AGENT_ID),
    runId: nonEmpty(env.OUTPOST_RUN_ID),
  };
}
