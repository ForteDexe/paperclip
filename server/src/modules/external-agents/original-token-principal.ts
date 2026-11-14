import { McpOAuthError, type PublicMcpOAuth } from "../../services/public-mcp/oauth.js";

type DotOAuthPrincipalOwner = Pick<PublicMcpOAuth, "mode" | "config" | "authenticate">;
export interface DotOriginalTokenPrincipal {
  userId: string;
  spaceId: string;
  grantId: string;
  clientId: string;
  resource: string;
  purpose: "agent";
}
export async function readDotOriginalTokenPrincipal(oauth: DotOAuthPrincipalOwner, input: {
  accessToken: string;
  upstreamClientId: string;
  selectingUserId: string;
  canonicalVerifiedResource: string;
  requestedSpaceId?: string;
}): Promise<DotOriginalTokenPrincipal> {
  const deny = () => new McpOAuthError("invalid_grant", "Dot connection authority does not match the selected request.");
  let origin: string;
  try { origin = new URL(input.canonicalVerifiedResource).origin; } catch { throw deny(); }
  if (oauth.mode !== "openai_dot_agent" || input.canonicalVerifiedResource !== origin + "/mcp/runner"
    || oauth.config.origin !== origin || oauth.config.resource !== input.canonicalVerifiedResource) throw deny();
  const { grant, space } = await oauth.authenticate(input.accessToken);
  if (grant.purpose !== "agent" || !grant.scopes.includes("outpost:agent")
    || !grant.id || !grant.spaceId || space.id !== grant.spaceId
    || !input.upstreamClientId || grant.clientId !== input.upstreamClientId
    || !input.selectingUserId || grant.userId !== input.selectingUserId
    || grant.resource !== input.canonicalVerifiedResource
    || input.requestedSpaceId !== undefined && grant.spaceId !== input.requestedSpaceId) throw deny();
  return { userId: grant.userId, spaceId: grant.spaceId, grantId: grant.id, clientId: grant.clientId, resource: grant.resource, purpose: "agent" };
}
