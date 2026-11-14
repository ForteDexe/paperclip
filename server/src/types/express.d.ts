export {};

import type { AgentApiKeyScope } from "@outpost/shared";

declare global {
  namespace Express {
    interface Request {
      actor: {
        type: "operator" | "agent" | "none";
        userId?: string;
        userName?: string | null;
        userEmail?: string | null;
        agentId?: string;
        spaceId?: string;
        spaceIds?: string[];
        sessionId?: string | null;
        memberships?: Array<{
          spaceId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        onBehalfOfMemberships?: Array<{
          spaceId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        isInstanceAdmin?: boolean;
        canManageExperimentalSettings?: boolean;
        keyId?: string;
        keyScope?: AgentApiKeyScope;
        runId?: string;
        onBehalfOfUserId?: string | null;
        authorizingUserId?: string;
        identityContextId?: string | null;
        source?: "local_implicit" | "session" | "operator_key" | "agent_key" | "agent_jwt" | "mcp_oauth" | "cloud_tenant" | "cloud_control" | "none";
      };
    }
  }
}
