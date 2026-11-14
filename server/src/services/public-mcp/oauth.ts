/** Compatibility types for historical external-agent records during schema removal. */
export class McpOAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export type McpPrincipal = {
  [key: string]: unknown;
  actor?: unknown;
  grant: {
    id: string;
    spaceId: string;
    userId: string;
    agentId: string | null;
    purpose: string;
    scopes: string[];
  };
};
