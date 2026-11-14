import { isCrossSiteOAuthCallbackNavigation, oauthCallbackInterstitialHtml } from "../lib/oauth-browser-return.js";
import { aiConnectionRouterPluginKey } from "@outpost/shared";
import { aiConnectionRouterService } from "../services/ai-connection-router.js";
import { composioAppSetupSchema, composioAppsRefreshSchema, composioAppsSyncSchema, composioAppAccountSchema } from "@outpost/shared";
import { aggregatorAppsSyncSchema, aggregatorAppsRefreshSchema, arcadeDiscoverySetupSchema } from "@outpost/shared/aggregator-apps";
import { Router, type Request, type Response } from "express";
import type { Db } from "@outpost/db";
import { agents, spaces, connectionGrants, issueThreadInteractions, toolConnectionInstalls } from "@outpost/db";
import { and, eq, or } from "drizzle-orm";
import {
  APP_STORE_DEFINITIONS,
  isConnectorFeatureEnabled,
  isMemoryConnectorId,
  GITHUB_CONNECTOR_PROFILES,
  GOOGLE_WORKSPACE_CONNECTOR_PROFILES,
  isAgentStatusAssignableToWork,
  isGitHubConnectorProfileId,
  isGoogleWorkspaceConnectorProfileId,
  TOOL_ACTION_REQUEST_STATUSES,
  type DeploymentExposure,
  type DeploymentMode,
  type PermissionKey,
  type ToolConnection,
  type ToolConnectionCreateCapabilities,
  connectToolAppSchema,
  configureRailwaySshSchema,
  createConnectionGrantDelegationSchema,
  createToolStdioCommandTemplateSchema,
  createToolApplicationSchema,
  createToolConnectionSchema,
  createToolPolicySchema,
  createToolProfileBindingForProfileSchema,
  createToolProfileEntryForProfileSchema,
  createToolProfileWithEntriesSchema,
  deleteToolProfileSchema,
  duplicateToolPolicySchema,
  disableToolStdioCommandTemplateSchema,
  duplicateToolProfileSchema,
  finishToolAppSchema,
  finalizeOAuthAccessSchema,
  startToolOAuthSchema,
  reconnectToolAppSchema,
  replaceConnectionGrantMembersSchema,
  reviewToolProfileNewToolsSchema,
  createToolTrustRuleFromActionRequestSchema,
  importMcpJsonSchema,
  putToolConnectionInstallsSchema,
  connectionTokenRequestSchema,
  startConnectionAuthorizationSchema,
  revokeToolTrustRuleSchema,
  reorderToolPoliciesSchema,
  toolPolicyTestRequestSchema,
  toolConnectionTestCallSchema,
  unbindToolProfileBindingSchema,
  updateToolApplicationSchema,
  updateToolConnectionSchema,
  updateToolPolicySchema,
  updateToolProfileEntrySchema,
  updateToolProfileWithEntriesSchema,
} from "@outpost/shared";
import { filterConnectionManagementRows, filterConnectionManagementPolicies, connectionManagementGuard, requiredConnectionUserAction, connectionRequestActor, connectionRequestContext, connectionRequestUserId } from "./connection-management-authz.js";
import { assertAgentConnectionInstallAccess, connectionManagementService } from "../services/connection-management.js";
import { validate } from "../middleware/validate.js";
import { getActorInfo, assertOperator, assertOperatorOrAgent, assertSpaceAccess, assertInstanceAdmin, getAccessibleResource, hasSpaceAccess } from "./authz.js";
import { badRequest, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
import { accessService, logActivity, toolAccessPolicyService, toolAccessService, vercelConnectIntegrationStatus } from "../services/index.js";
import { ToolGatewayHttpError, type ToolGatewayService } from "../services/tool-gateway.js";
import { RailwayError } from "../services/railway.js";
import type { VercelConnectClient } from "../services/vercel-connect.js";
import {
  appWithOutpostCloudConnectorAvailability,
  isOutpostCloudConnectorStrategy,
  invalidateOutpostCloudConnectorCapabilities,
  type OutpostCloudConnector,
  outpostCloudConnectorCapabilitiesFromEnv,
} from "../services/outpost-cloud-connector.js";
import { runtimeCanonicalOrigin } from "../services/cloud-runtime-identity.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  completeOutpostCloudConnectorEnrollment,
  loadOutpostCloudConnectorIdentity,
  startOutpostCloudConnectorEnrollment,
} from "../services/outpost-cloud-connector-enrollment.js";
import { reconcileOutpostCloudConnectorEnrollmentStatus } from "../services/outpost-cloud-connector-status.js";
import {
  OAUTH_CLIENT_ID_METADATA_DOCUMENT_PATH,
  oauthClientIdMetadataDocument,
} from "../services/tool-access.js";
import { isLoopbackHost } from "../url-utils.js";
import { trustedOperatorMutationOrigin } from "../middleware/operator-mutation-guard.js";
import { connectionIntentService } from "../services/connection-intents.js";
import { redactRemoteUrlCredential } from "../services/remote-url-credentials.js";
import { connectionIntentDeliveryService } from "../services/connection-intent-delivery.js";
import type { heartbeatService } from "../services/heartbeat.js";

const SPACE_INSTALL_DENIAL_REASON =
  "Only someone who can configure this connection can choose this.";
const ORGANIZATION_GRANT_DENIAL_REASON =
  "Only a space owner, administrator, or connection manager can share this credential with the organization.";
type Heartbeat = ReturnType<typeof heartbeatService>;

/** Allowlist (e.g. Google Sheets allowed spreadsheet ids) lives in connection config. */
function allowlistIds(config: Record<string, unknown> | null | undefined): string[] {
  const raw = config?.allowedSpreadsheetIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function agentHierarchyDepths(rows: Array<{ id: string; leadAgentId: string | null }>): Map<string, number> {
  const parentById = new Map(rows.map((row) => [row.id, row.leadAgentId]));
  const depthById = new Map<string, number>();

  const depthFor = (agentId: string, path: Set<string>): number => {
    const known = depthById.get(agentId);
    if (known !== undefined) return known;
    const parentId = parentById.get(agentId);
    if (!parentId || !parentById.has(parentId) || path.has(agentId)) {
      depthById.set(agentId, 0);
      return 0;
    }
    const nextPath = new Set(path).add(agentId);
    const depth = depthFor(parentId, nextPath) + 1;
    depthById.set(agentId, depth);
    return depth;
  };

  for (const row of rows) depthFor(row.id, new Set());
  return depthById;
}

/**
 * Classify a connection PATCH into operator-visible lifecycle events so the
 * per-app Activity tab can humanize them (PAP-11284). A single update may
 * touch more than one thing (e.g. pause + allowlist), so this returns a list.
 */
function classifyConnectionUpdate(
  before: { enabled: boolean; config?: Record<string, unknown> | null },
  after: { enabled: boolean; config?: Record<string, unknown> | null },
): Array<{ lifecycle: "paused" | "resumed" | "allowlist_changed"; details: Record<string, unknown> }> {
  const events: Array<{ lifecycle: "paused" | "resumed" | "allowlist_changed"; details: Record<string, unknown> }> = [];
  if (before.enabled !== after.enabled) {
    events.push({ lifecycle: after.enabled ? "resumed" : "paused", details: { enabled: after.enabled } });
  }
  const beforeIds = allowlistIds(before.config);
  const afterIds = allowlistIds(after.config);
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const added = afterIds.filter((id) => !beforeSet.has(id)).length;
  const removed = beforeIds.filter((id) => !afterSet.has(id)).length;
  if (added > 0 || removed > 0) {
    events.push({ lifecycle: "allowlist_changed", details: { added, removed, total: afterIds.length } });
  }
  return events;
}

export function filterVisibleToolConnections<T extends {
  status?: string;
  createdByUserId?: string | null;
}>(
  connections: T[],
  actor: { userId?: string | null; canManageConnections: boolean },
): T[] {
  return connections.filter((connection) =>
    connection.status !== "draft"
    || actor.canManageConnections
    || Boolean(actor.userId && connection.createdByUserId === actor.userId));
}

export function connectionIntentOAuthOutcomeHtml(input: {
  interactionId: string;
  issueId: string | null;
  outcome: "connected" | "declined" | "failed";
  openerOrigin?: string | null;
}) {
  // The callback window is only a signal. Connection identity and every
  // authorization URL stay server-side; the opener refreshes the task from the
  // interaction id instead of trusting provider-window data.
  const message = JSON.stringify({
    type: "outpost.connection-intent.oauth",
    interactionId: input.interactionId,
    outcome: input.outcome,
  }).replace(/</g, "\\u003c");
  const issuePath = input.issueId
    ? `/issues/${encodeURIComponent(input.issueId)}`
    : "/issues";
  const fallback = JSON.stringify(issuePath);
  const openerOrigin = (() => {
    if (!input.openerOrigin) return null;
    try {
      const parsed = new URL(input.openerOrigin);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password
        ? parsed.origin
        : null;
    } catch {
      return null;
    }
  })();
  const targetOrigin = JSON.stringify(openerOrigin ?? "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connection authorization</title></head><body><p>Returning to Outpost…</p><script>const message=${message};const targetOrigin=${targetOrigin}||window.location.origin;if(window.opener&&window.opener!==window){window.opener.postMessage(message,targetOrigin);window.close();}else{window.location.replace(${fallback});}</script></body></html>`;
}

function normalizeCloudConnectorEnrollmentReturnTo(returnTo?: string | null): string | null {
  if (!returnTo || returnTo.length > 2_048) return null;
  try {
    const parsed = new URL(returnTo, "http://outpost.local");
    if (
      parsed.origin !== "http://outpost.local"
      || !["/apps/connect", "/apps/chat/connect"].includes(parsed.pathname)
      || parsed.username
      || parsed.password
    ) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function cloudConnectorEnrollmentOutcomeHtml(issuePrefix: string, returnTo: string, issueId?: string): string {
  const fallbackPath = issueId
    ? `/${encodeURIComponent(issuePrefix)}/issues/${encodeURIComponent(issueId)}`
    : cloudConnectorEnrollmentReturnPath(issuePrefix, returnTo);
  const fallback = JSON.stringify(fallbackPath).replaceAll("<", "\\u003c");
  // This document is served only after server-verified enrollment. The parent
  // independently re-reads enrollment status; browser messages grant no access.
  return `<!doctype html><html><head><meta charset="utf-8"><title>Outpost connected</title></head><body><p>Outpost is connected. Return to your task to finish connecting the app.</p><script>if(window.opener&&window.opener!==window){window.close();}else{const link=document.createElement("a");link.href=${fallback};link.textContent=${JSON.stringify(issueId ? "Return to task" : "Continue setup")};document.body.append(link);}</script></body></html>`;
}

export function cloudConnectorEnrollmentReturnPath(issuePrefix: string, returnTo?: string | null): string {
  const spaceRoot = `/${encodeURIComponent(issuePrefix)}`;
  const normalizedReturnTo = normalizeCloudConnectorEnrollmentReturnTo(returnTo);
  if (normalizedReturnTo) {
    const parsed = new URL(normalizedReturnTo, "http://outpost.local");
    parsed.searchParams.set("cloud_connector", "enrolled");
    return `${spaceRoot}${parsed.pathname}${parsed.search}`;
  }
  return `${spaceRoot}/apps/connections?cloud_connector=enrolled`;
}

export function toolAccessRoutes(
  db: Db,
  options: {
    deploymentMode?: DeploymentMode;
    deploymentExposure?: DeploymentExposure;
    authPublicBaseUrl?: string | null;
    trustedLocalStdioRuntimeHost?: string | null;
    toolGateway?: ToolGatewayService;
    /** Test-only seams forwarded to the tool access service. */
    remoteHttpEndpointLookup?: NonNullable<Parameters<typeof toolAccessService>[1]>["remoteHttpEndpointLookup"];
    remoteHttpRequest?: NonNullable<Parameters<typeof toolAccessService>[1]>["remoteHttpRequest"];
    vercelConnectClient?: VercelConnectClient | null;
    outpostCloudConnector?: OutpostCloudConnector | null;
    connectionIntentHeartbeat?: Pick<Heartbeat, "wakeup">;
  } = {},
) {
  const router = Router();
  const svc = toolAccessService(db, options);
  const policySvc = toolAccessPolicyService(db);
  const connectionIntents = connectionIntentService(db);

  async function isConnectionIntent(interactionId: string | null | undefined) {
    if (!interactionId) return false;
    const row = await db
      .select({ kind: issueThreadInteractions.kind })
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, interactionId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return row?.kind === "connection_intent";
  }

  function bypassCurrentMembershipCheck(req: Request) {
    return req.actor.source === "local_implicit" || req.actor.isInstanceAdmin === true;
  }

  async function finishConnectionIntentOAuth(input: {
    interactionId: string;
    connectionId?: string;
    userId: string;
    outcome: "connected" | "declined" | "failed";
    canManageOrganizationGrant: boolean;
    bypassCurrentMembershipCheck: boolean;
  }) {
    const loaded = await connectionIntents.loadIntent(input.interactionId);
    if (loaded.interaction.addresseeUserId !== input.userId) {
      throw forbidden("OAuth callback user does not match the connection request");
    }
    if (loaded.interaction.status !== "pending") return loaded.interaction;
    const interaction = input.outcome === "connected" && input.connectionId
      ? await connectionIntents.complete(input.interactionId, input.connectionId, input.userId, {
          oauthCompletion: true,
          canManageOrganizationGrant: input.canManageOrganizationGrant,
          bypassCurrentMembershipCheck: input.bypassCurrentMembershipCheck,
        })
      : await connectionIntents.updatePhase(input.interactionId, "needs_retry", input.userId, {
            bypassCurrentMembershipCheck: input.bypassCurrentMembershipCheck,
          });
    if (interaction.status === "accepted" && options.connectionIntentHeartbeat) {
      await connectionIntentDeliveryService(db, options.connectionIntentHeartbeat).tryDeliver(input.interactionId);
    }
    return interaction;
  }

  function sendConnectionIntentOAuthOutcome(
    res: import("express").Response,
    input: {
      interactionId: string;
      issueId: string | null;
      outcome: "connected" | "declined" | "failed";
      openerOrigin?: string | null;
    },
  ) {
    res.type("html").send(connectionIntentOAuthOutcomeHtml(input));
  }

  function configuredPublicBaseUrl() {
    const runtimeOrigin = runtimeCanonicalOrigin();
    if (runtimeOrigin) return runtimeOrigin;
    const raw = (
      process.env.OUTPOST_AUTH_PUBLIC_BASE_URL?.trim()
      || process.env.BETTER_AUTH_URL?.trim()
      || process.env.BETTER_AUTH_BASE_URL?.trim()
      || options.authPublicBaseUrl?.trim()
      || process.env.OUTPOST_PUBLIC_URL?.trim()
      || process.env.OUTPOST_MANAGED_RUNTIME_PUBLIC_URL?.trim()
    );
    if (!raw) return null;
    try {
      return new URL(raw).origin;
    } catch {
      return null;
    }
  }

  function requestLoopbackBaseUrl(req: Request, forInitiation = false) {
    const host = req.get("host")?.trim();
    if (!host) return null;
    try {
      const parsed = new URL(`${req.protocol}://${host}`);
      if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        || parsed.username
        || parsed.password
        || !isLoopbackHost(parsed.hostname)
      ) {
        return null;
      }
      // A few otherwise standards-compliant DCR servers reject numeric
      // loopback redirect hosts while accepting localhost. In local-trusted
      // mode both names reach the same loopback-only process, so advertise the
      // interoperable spelling and retain the browser's exact origin as OAuth
      // state for popup postMessage below.
      if (
        (forInitiation || (req.method !== "GET" && req.method !== "HEAD"))
        && (options.deploymentMode ?? "local_trusted") === "local_trusted"
        && parsed.protocol === "http:"
        && parsed.hostname !== "localhost"
      ) {
        parsed.hostname = "localhost";
      }
      // A provider callback has no initiating browser Origin. Preserve its
      // actual host: rewriting 127.0.0.1 here changes the redirect_uri used at
      // authorization and causes the token endpoint to reject the code.
      return parsed.origin;
    } catch {
      return null;
    }
  }

  function trustedBrowserBaseUrl(req: Request) {
    const origin = trustedOperatorMutationOrigin(req);
    if (!origin) return null;
    try {
      const parsed = new URL(origin);
      const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
      const routedHost = forwardedHost || req.header("host")?.trim();
      const normalizedRoutedHost = routedHost
        ? new URL(`${parsed.protocol}//${routedHost}`).host.toLowerCase()
        : null;
      if (
        parsed.host.toLowerCase() === normalizedRoutedHost
        && parsed.protocol === "https:"
      ) {
        return parsed.origin;
      }
    } catch {
      // The shared origin parser already validates this. Fail closed if its
      // contract ever changes.
    }
    return null;
  }

  function enrolledConnectorBaseUrl(req: Request) {
    // Browser-initiated mutations must prove their own same-origin HTTPS
    // request. The durable binding is only a callback/metadata fallback for
    // provider GETs, which do not carry the initiating browser's Origin.
    if (req.method !== "GET" && req.method !== "HEAD") return null;
    const identity = loadOutpostCloudConnectorIdentity();
    if (identity?.status !== "active") return null;
    const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = (forwardedHost || req.header("host")?.trim())?.toLowerCase();
    if (!requestHost) return null;
    for (const origin of identity.origins) {
      try {
        const parsed = new URL(origin);
        if (
          parsed.protocol === "https:"
          && !parsed.username
          && !parsed.password
          && parsed.host.toLowerCase() === requestHost
        ) {
          return parsed.origin;
        }
      } catch {
        // Ignore malformed legacy identity origins.
      }
    }
    return null;
  }

  function oauthRedirectUri(req: Request, forInitiation = false) {
    const baseUrl = configuredPublicBaseUrl()
      ?? trustedBrowserBaseUrl(req)
      ?? enrolledConnectorBaseUrl(req)
      ?? requestLoopbackBaseUrl(req, forInitiation);
    if (!baseUrl) {
      throw unprocessable(
        "This Outpost needs a browser-reachable HTTPS address (or loopback HTTP) before browser sign-in can start.",
        { code: "oauth_redirect_origin_unsupported" },
      );
    }
    return new URL("/api/tools/oauth/callback", baseUrl).toString();
  }

  function oauthBrowserOrigin(req: Request) {
    const trustedBrowserOrigin = trustedBrowserBaseUrl(req);
    if (trustedBrowserOrigin) return trustedBrowserOrigin;
    const host = req.get("host")?.trim();
    if (!host) return null;
    try {
      const parsed = new URL(`${req.protocol}://${host}`);
      return isLoopbackHost(parsed.hostname) ? parsed.origin : null;
    } catch {
      return null;
    }
  }

  async function oauthAppPath(
    spaceId: string,
    connectionId: string,
  ) {
    const [space] = await db
      .select({ issuePrefix: spaces.issuePrefix })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);
    if (!space) throw new Error("OAuth callback connection belongs to a missing space");
    return `/${space.issuePrefix}/apps/${connectionId}/permissions`;
  }

function connectorEnrollmentPrincipal(req: Request): string {
  return req.actor.userId ? `user:${req.actor.userId}` : `source:${req.actor.source ?? "operator"}`;
}

/**
   * A failed first authorization is still an incomplete setup, not an app
   * configuration task. Send it back to the same exact draft so the operator
   * can retry the missing checkpoint. Reauthorization of an already-active
   * connection keeps the established detail-page recovery route.
   */
  async function oauthRecoveryPath(
    connection: ToolConnection,
    outcome: "failed" | "denied",
    code?: string | null,
    providerRecovery?: { installationUrl?: unknown; managementUrl?: unknown },
  ) {
    const detailPermissionsPath = await oauthAppPath(connection.spaceId, connection.id);
    const params = new URLSearchParams({ oauth: outcome });
    if (code) params.set("code", code);
    const addGitHubRecoveryUrls = (target: URLSearchParams) => {
      if (code !== "github_installation_required") return;
      for (const [key, value] of [
        ["installation_url", providerRecovery?.installationUrl],
        ["management_url", providerRecovery?.managementUrl],
      ] as const) {
        if (typeof value !== "string") continue;
        try {
          const url = new URL(value);
          if (url.protocol === "https:" && url.hostname.toLowerCase() === "github.com") {
            target.set(key, url.toString());
          }
        } catch {
          // Provider recovery links are optional. The retry path remains usable
          // when an upstream response omits or malforms one.
        }
      }
    };
    addGitHubRecoveryUrls(params);
    const source = connection.config?.sourceTemplateKey
      ?? connection.transportConfig?.sourceTemplateKey;
    if (connection.status !== "draft" || typeof source !== "string" || !source.trim()) {
      return `${detailPermissionsPath}?${params.toString()}`;
    }

    const appsSegment = detailPermissionsPath.indexOf("/apps/");
    const spacePrefix = appsSegment >= 0 ? detailPermissionsPath.slice(0, appsSegment) : "";
    const setupParams = new URLSearchParams({
      source,
      resume: connection.id,
      oauth: outcome,
    });
    if (code) setupParams.set("code", code);
    addGitHubRecoveryUrls(setupParams);
    const setupRoute = connection.credentialSource === "vercel_connect"
      ? "/apps/vercel-connect"
      : "/apps/connect";
    return `${spacePrefix}${setupRoute}?${setupParams.toString()}`;
  }

  const access = accessService(db);
  const managementGuard = connectionManagementGuard(db, "tool");

  async function assertOperatorToolPermission(req: Request, spaceId: string, permissionKey: PermissionKey) {
    if (req.actor.type === "agent") {
      const context = connectionRequestContext(req);
      if (!context || context.resource.spaceId !== spaceId) throw forbidden("This operation requires an authorized management context");
      await context.reauthorize();
      return;
    }
    assertOperatorOrAgent(req);
    assertSpaceAccess(req, spaceId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const userId = connectionRequestUserId(req);
    if (userId && await access.hasPermission(spaceId, "user", userId, permissionKey)) return;
    throw forbidden(`Missing permission: ${permissionKey}`);
  }

  function activeToolMembership(req: Request, spaceId: string) {
    assertOperatorOrAgent(req);
    assertSpaceAccess(req, spaceId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return null;
    const membership = Array.isArray((req.actor.type === "agent" ? req.actor.onBehalfOfMemberships : req.actor.memberships))
      ? (req.actor.type === "agent" ? req.actor.onBehalfOfMemberships : req.actor.memberships)?.find((item) => item.spaceId === spaceId)
      : null;
    if (!membership || membership.status !== "active") {
      throw forbidden("User does not have active space access");
    }
    if (!membership.membershipRole || membership.membershipRole === "viewer") {
      throw forbidden("Viewer access is read-only");
    }
    return membership;
  }

  async function isToolConnectionManager(req: Request, spaceId: string) {
    assertOperatorOrAgent(req);
    assertSpaceAccess(req, spaceId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return true;
    return Boolean(connectionRequestUserId(req) && await access.hasPermission(
      spaceId,
      "user",
      connectionRequestUserId(req)!,
      "tools:manage_connections",
    ));
  }

  async function assertToolConnectionConfigureAccess(
    req: Request,
    connection: { spaceId: string; createdByUserId?: string | null },
  ) {
    activeToolMembership(req, connection.spaceId);
    if (await isToolConnectionManager(req, connection.spaceId)) return;
    if (connectionRequestUserId(req) && connection.createdByUserId === connectionRequestUserId(req)) return;
    throw forbidden(
      "Only the connection creator or a connection manager can configure, reconnect, or delete this connection",
    );
  }

  async function assertToolConnectionAccess(
    req: Request,
    connection: { id: string; spaceId: string; createdByUserId?: string | null },
  ) {
    activeToolMembership(req, connection.spaceId);
    if (await isToolConnectionManager(req, connection.spaceId)) return;
    if (connectionRequestUserId(req) && connection.createdByUserId === connectionRequestUserId(req)) return;
    const [grant] = await db
      .select({ id: connectionGrants.id })
      .from(connectionGrants)
      .where(and(
        eq(connectionGrants.spaceId, connection.spaceId),
        eq(connectionGrants.connectionId, connection.id),
        eq(connectionGrants.status, "active"),
        or(
          eq(connectionGrants.kind, "organization"),
          connectionRequestUserId(req)
            ? and(eq(connectionGrants.kind, "user"), eq(connectionGrants.subjectUserId, connectionRequestUserId(req)!))
            : eq(connectionGrants.kind, "organization"),
        ),
      ))
      .limit(1);
    if (grant) return;
    throw forbidden("You need access to this connection before you can install it on an agent");
  }

  /**
   * Non-throwing membership probe for capability reporting (PAP-17835).
   *
   * `activeToolMembership` throws for viewers because it guards mutations. The
   * personal-connections UI still has to *render* for a viewer, so capability
   * computation needs the role without the 403. Returns `null` for a principal
   * with no scoped membership (local implicit / instance admin), matching
   * `activeToolMembership`'s "unrestricted" sentinel.
   */
  function toolMembershipRole(req: Request, spaceId: string): {
    unrestricted: boolean;
    role: string | null;
    isViewer: boolean;
    isActive: boolean;
  } {
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      return { unrestricted: true, role: null, isViewer: false, isActive: true };
    }
    const membership = Array.isArray((req.actor.type === "agent" ? req.actor.onBehalfOfMemberships : req.actor.memberships))
      ? (req.actor.type === "agent" ? req.actor.onBehalfOfMemberships : req.actor.memberships)?.find((item) => item.spaceId === spaceId)
      : null;
    const isActive = Boolean(membership && membership.status === "active");
    const role = membership?.membershipRole ?? null;
    return { unrestricted: false, role, isViewer: role === "viewer", isActive };
  }

  async function isToolConnectionManagerQuiet(req: Request, spaceId: string) {
    if (req.actor.type === "agent") return (await connectionManagementService(db).capability(req.actor, "connections:configure", {
      ...connectionRequestContext(req)?.resource, type: "connection_management", spaceId,
      connectionId: undefined, selfServiceUserId: undefined, readOnly: false,
      operation: connectionRequestContext(req)?.resource.operation ?? "configure",
    }, { readContext: connectionRequestContext(req) })).allowed;
    const membership = toolMembershipRole(req, spaceId);
    if (membership.unrestricted) return true;
    if (!membership.isActive || membership.isViewer) return false;
    if (membership.role === "owner" || membership.role === "admin") return true;
    return Boolean(connectionRequestUserId(req) && await access.hasPermission(
      spaceId,
      "user",
      connectionRequestUserId(req)!,
      "tools:manage_connections",
    ));
  }

  async function describeConnectionCreateCapabilities(
    req: Request,
    spaceId: string,
  ): Promise<ToolConnectionCreateCapabilities> {
    const canManageConnections = await isToolConnectionManagerQuiet(req, spaceId);
    return {
      canCreateOrganizationGrant: canManageConnections,
      organizationGrantReason: canManageConnections ? null : ORGANIZATION_GRANT_DENIAL_REASON,
      canSetSpaceInstall: canManageConnections,
      spaceInstallReason: canManageConnections ? null : SPACE_INSTALL_DENIAL_REASON,
    };
  }

  /**
   * Server-computed capabilities for the connection identity/install surfaces.
   * The UI renders the §3 matrix from these booleans instead of reconstructing
   * policy from role strings, because creator identity and per-agent edit rights
   * are not derivable client-side.
   */
  async function describeConnectionCapabilities(
    req: Request,
    connection: { id: string; spaceId: string; createdByUserId?: string | null },
  ) {
    const membership = toolMembershipRole(req, connection.spaceId);
    const isManager = await isToolConnectionManagerQuiet(req, connection.spaceId);
    const mutationCapable = membership.unrestricted || (membership.isActive && !membership.isViewer);
    const isCreator = Boolean(connectionRequestUserId(req) && connection.createdByUserId === connectionRequestUserId(req));
    const management = connectionManagementService(db);
    const resource = { ...connectionRequestContext(req)?.resource, type: "connection_management" as const,
      spaceId: connection.spaceId, connectionId: connection.id, operation: "configure",
      readOnly: false, selfServiceUserId: connection.createdByUserId };
    const manage = await management.capability(req.actor, "connections:configure", resource, { readContext: connectionRequestContext(req) });
    const use = await management.capability(req.actor, "connections:test", { ...resource, operation: "use" }, { mutation: false, readContext: connectionRequestContext(req) });
    const toolAccess = req.actor.type === "agent" && req.actor.agentId && options.toolGateway
      ? await options.toolGateway.summarizeConnectionAccessForAgent({ spaceId: connection.spaceId, connectionId: connection.id,
        agentId: req.actor.agentId, heartbeatRunId: req.actor.runId, issueId: resource.issueId, projectId: resource.projectId }) : null;
    const usage = toolAccess ? { ...use, allowed: use.allowed && toolAccess.allowedCount > 0,
      reason: !use.allowed ? use.reason : toolAccess.allowedCount > 0 ? "Configured actions are allowed; each call reauthorizes."
        : toolAccess.askFirstCount > 0 ? "Configured actions require approval." : "No configured actions are available.",
      requiresApproval: toolAccess.askFirstCount > 0, allowedCount: toolAccess.allowedCount, askFirstCount: toolAccess.askFirstCount } : use;
    const canConfigure = manage.allowed;
    const editableAgentIds: string[] = [];
    if (mutationCapable) {
      const spaceAgents = await db.select({ id: agents.id }).from(agents).where(eq(agents.spaceId, connection.spaceId));
      const capabilities = await management.describeAgentInstallCapabilities(req.actor, resource, spaceAgents.map(agent => agent.id), { readContext: connectionRequestContext(req) });
      for (let i = 0; i < spaceAgents.length; i++) {
        if (capabilities[i].allowed) editableAgentIds.push(spaceAgents[i].id);
      }
    }
    return {
      canConfigure,
      management: manage,
      usage,
      canCreateOrganizationGrant: canConfigure,
      canSetSpaceInstall: canConfigure,
      // Personal consent belongs to the person: it needs a named operator user, and
      // it is never available to a viewer or to an unauthenticated principal.
      canConnectAsCurrentUser: Boolean(connectionRequestUserId(req)) && mutationCapable,
      canManageAgentInstalls: mutationCapable && editableAgentIds.length > 0,
      canViewOtherPersonalIdentities: req.actor.type === "operator" && isManager,
      editableAgentIds,
    };
  }

  /**
   * Per-grant authorization. Revoking your own identity is always allowed (the
   * consent is yours to withdraw); revoking anyone else's is manager-only — that
   * is the kill switch. Audience editing is creator-or-manager, and only for an
   * organization grant.
   */
  function describeGrantCapabilities(
    grant: { kind: string; subjectUserId: string | null; createdByUserId: string | null },
    context: { userId: string | null; isManager: boolean; mutationCapable: boolean },
  ) {
    if (!context.mutationCapable) return { canRevoke: false, canEditAudience: false };
    const isOwnGrant = Boolean(context.userId && grant.subjectUserId === context.userId);
    const isGrantCreator = Boolean(context.userId && grant.createdByUserId === context.userId);
    return {
      canRevoke: isOwnGrant || isGrantCreator || context.isManager,
      canEditAudience: grant.kind === "organization" && (isGrantCreator || context.isManager),
    };
  }

  async function assertOperatorAnyToolPermission(req: Request, spaceId: string, permissionKeys: PermissionKey[]) {
    assertOperatorOrAgent(req);
    assertSpaceAccess(req, spaceId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const userId = connectionRequestUserId(req);
    if (userId) {
      for (const permissionKey of permissionKeys) {
        if (await access.hasPermission(spaceId, "user", userId, permissionKey)) return;
      }
    }
    throw forbidden(`Missing one of permissions: ${permissionKeys.join(", ")}`);
  }

  async function assertCanTestAsAgent(req: Request, spaceId: string, agentId: string, knownAgent?: { id: string; status: string }) {
    const agent = knownAgent ?? (await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.spaceId, spaceId)))
      .limit(1))[0];
    // Admin permission bypasses must not make unassignable agents testable.
    if (!agent || agent.id !== agentId || !isAgentStatusAssignableToWork(agent.status)) {
      throw forbidden("This agent is not available for testing");
    }
    const decision = await access.decide({
      actor: req.actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        spaceId,
        issueId: null,
        projectId: null,
        parentIssueId: null,
        assigneeAgentId: agentId,
        assigneeUserId: null,
      },
      scope: {
        assigneeAgentId: agentId,
        assigneeUserId: null,
      },
    });
    if (decision.allowed) return;
    throw forbidden(decision.explanation);
  }

  function sendToolGatewayError(res: import("express").Response, error: unknown) {
    if (error instanceof ToolGatewayHttpError) {
      res.status(error.status).json({ error: error.message, reasonCode: error.reasonCode, ...error.details });
      return true;
    }
    return false;
  }

  async function assertToolsAdmin(req: Request, spaceId: string) {
    assertOperator(req);
    await assertOperatorToolPermission(req, spaceId, "tools:admin");
  }

  async function assertToolsRuntimeManage(req: Request, spaceId: string) {
    await assertOperatorToolPermission(req, spaceId, "tools:manage_runtime");
  }

  router.post("/agents/me/connections/:connectionId/start-authorization", managementGuard("connections:configure", "POST /agents/me/connections/:connectionId/start-authorization", { personal: true }), validate(startConnectionAuthorizationSchema), async (req, res) => {
    if (req.actor.type !== "agent" || !req.actor.agentId || !req.actor.spaceId || !req.actor.runId) {
      res.status(401).json({ error: "Active agent run authentication required" });
      return;
    }
    const result = await svc.startAuthorizationForAgent({
      spaceId: req.actor.spaceId,
      connectionId: req.params.connectionId as string,
      agentId: req.actor.agentId,
      runId: req.actor.runId,
      subjectUserId: req.body.subjectUserId,
      scopes: req.body.scopes,
      returnTo: req.body.returnTo,
      redirectUri: oauthRedirectUri(req),
      managementContext: connectionRequestContext(req),
    });
    res.json({ ...requiredConnectionUserAction(req, { type: "connection", id: req.params.connectionId as string, spaceId: req.actor.spaceId }, result.authorizationUrl, "Authenticate the selected account and consent to the requested provider access."), url: result.authorizationUrl, ...(result.handoff ? { handoff: result.handoff } : {}) });
  });

  router.post("/agents/me/connections/:connectionId/token", validate(connectionTokenRequestSchema), async (req, res) => {
    if (req.actor.type !== "agent" || !req.actor.agentId || !req.actor.spaceId) {
      res.status(401).json({ error: "Agent authentication required" });
      return;
    }
    if (!req.actor.runId) {
      res.status(401).json({ error: "Agent run id required", code: "run_id_required" });
      return;
    }
    const headerRunId = req.get("X-Outpost-Run-Id")?.trim();
    if (headerRunId && headerRunId !== req.actor.runId) {
      res.status(403).json({ error: "Run id header does not match agent token", code: "run_id_mismatch" });
      return;
    }
    const result = await svc.mintConnectionTokenForAgent({
      connectionId: req.params.connectionId as string,
      spaceId: req.actor.spaceId,
      agentId: req.actor.agentId,
      runId: req.actor.runId,
      body: req.body,
    });
    res.status(result.status === "use_env_lease" ? 409 : 200).json(result);
  });

  function assertToolAppMutationAccess(req: Request, spaceId: string) {
    if (req.actor.type === "agent" && !connectionRequestContext(req)) throw forbidden("An authorized connection management operation is required");
    activeToolMembership(req, spaceId);
  }

  router.get("/spaces/:spaceId/tools/gallery", managementGuard("connections:read", "GET /spaces/:spaceId/tools/gallery", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const advertisedProfiles = options.outpostCloudConnector === undefined
      ? await outpostCloudConnectorCapabilitiesFromEnv()
      : options.outpostCloudConnector
        ? await options.outpostCloudConnector.getCapabilities()
        : [];
    const vercelConnect = vercelConnectIntegrationStatus();
    const settings = await instanceSettingsService(db).getExperimental();
    let oauthCallbackUrl: string | undefined;
    try {
      // Setup must display the callback used by its initiating POST. Provider
      // callbacks themselves retain their exact request-derived redirect URI.
      oauthCallbackUrl = oauthRedirectUri(req, true);
    } catch (error) {
      const details = error instanceof HttpError
        && error.details
        && typeof error.details === "object"
        && !Array.isArray(error.details)
        ? error.details as Record<string, unknown>
        : null;
      if (details?.code !== "oauth_redirect_origin_unsupported") throw error;
    }
    res.json({
      ...(oauthCallbackUrl ? { oauthCallbackUrl } : {}),
      capabilities: await describeConnectionCreateCapabilities(req, spaceId),
      credentialSources: {
        vercelConnect: {
          available: vercelConnect.enabled && vercelConnect.configured,
          enabled: vercelConnect.enabled,
          authentication: vercelConnect.authentication,
          manageUrl: vercelConnect.manageUrl,
          reason: vercelConnect.enabled
            ? vercelConnect.configured
              ? null
              : "Vercel Connect needs workload OIDC or OUTPOST_VERCEL_CONNECT_ACCESS_TOKEN."
            : "Vercel Connect setup is disabled on this Outpost instance.",
        },
      },
      apps: [...APP_STORE_DEFINITIONS.filter((app) => (settings.enableMemoryConnectors || !isMemoryConnectorId(app.slug))
        && isConnectorFeatureEnabled(app, settings)).map((app) =>
        appWithOutpostCloudConnectorAvailability(app, advertisedProfiles)
      ), ...await aiConnectionRouterService(db).catalog()],
    });
  });

  router.get("/spaces/:spaceId/tools/apps/:galleryKey/preflight", managementGuard("connections:read", "GET /spaces/:spaceId/tools/apps/:galleryKey/preflight", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const methodKey = typeof req.query.methodKey === "string" ? req.query.methodKey.trim() || null : null;
    res.json(await svc.preflightGalleryAppMetadata(req.params.galleryKey as string, methodKey));
  });

  /**
   * Outpost's Client ID Metadata Document (PAP-17087).
   *
   * The document's own URL is the `client_id` Outpost presents to an
   * authorization server that supports CIMD, so this endpoint has to be publicly
   * readable — an authorization server fetches it server-to-server with no
   * Outpost session. It contains only this deployment's callback and the
   * grant/response/auth methods Outpost uses: no space, connection or secret
   * data of any kind.
   */
  router.get(OAUTH_CLIENT_ID_METADATA_DOCUMENT_PATH.replace(/^\/api/, ""), (_req, res) => {
    const redirectUri = oauthRedirectUri(_req);
    const clientId = new URL(OAUTH_CLIENT_ID_METADATA_DOCUMENT_PATH, new URL(redirectUri).origin).toString();
    res.type("application/json").json(oauthClientIdMetadataDocument({ clientId, redirectUri }));
  });

  router.post("/spaces/:spaceId/tools/apps/connect", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/apps/connect", { personal: true }), validate(connectToolAppSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    // An omitted grant kind is the backward-compatible organization default.
    // On resume, the persisted connection identity is authoritative: accepting
    // a contradictory `grantKind: "user"` here could otherwise let a creator
    // replace the credential behind an existing organization grant.
    const retainedConnectionId = req.body.resumeConnectionId ?? req.body.reconnectConnectionId;
    const resumedConnection = retainedConnectionId
      ? await svc.getConnection(retainedConnectionId, spaceId)
      : null;
    if (resumedConnection) await assertToolConnectionConfigureAccess(req, resumedConnection);
    const effectiveGrantKind = resumedConnection
      ? resumedConnection.credentialPolicy === "per_user"
        ? "user"
        : resumedConnection.credentialPolicy === "per_agent"
          ? "agent"
          : "organization"
      : req.body.grantKind ?? "organization";
    // Personal connection creation remains available to ordinary active
    // members, but sharing a credential with every human is a manager
    // operation and must be enforced here, not inferred by the client.
    const createsManagedGrant = effectiveGrantKind === "organization" || effectiveGrantKind === "agent";
    if (createsManagedGrant && !await isToolConnectionManagerQuiet(req, spaceId)) {
      throw forbidden(
        effectiveGrantKind === "agent"
          ? "Only connection managers can authorize a dedicated agent identity"
          : ORGANIZATION_GRANT_DENIAL_REASON,
      );
    }
    try {
      const result = await svc.connectGalleryApp(spaceId, req.body, connectionRequestActor(req));
      if (result.auth?.kind === "oauth") {
        try {
          // "Just me" must consent as the caller, not as the workspace: passing
          // `subjectUserId` is what makes the callback land the tokens on the
          // caller's personal grant instead of an organization grant
          // (PAP-17835). The service refuses any subject other than the actor,
          // so this cannot start consent on someone else's behalf.
          const personalSubjectUserId = (req.actor.type === "agent" || req.body.grantKind === "user") ? connectionRequestUserId(req) ?? null : null;
          const dedicatedSubjectAgentId = req.body.grantKind === "agent" ? req.body.subjectAgentId ?? null : null;
          const start = await svc.startOAuth(spaceId, result.connectionId, {
            workspaceServices: req.body.workspaceServices,
            redirectUri: oauthRedirectUri(req),
            actor: connectionRequestActor(req),
            ...(personalSubjectUserId ? { subjectUserId: personalSubjectUserId } : {}),
            ...(dedicatedSubjectAgentId ? { subjectAgentId: dedicatedSubjectAgentId } : {}),
            ...(req.body.interactionId ? { interactionId: req.body.interactionId } : {}),
          });
          result.auth.startUrl = start.authorizationUrl;
          result.auth.handoff = start.handoff;
          result.auth.issuer = start.issuer ?? result.auth.issuer ?? null;
          result.auth.resource = start.resource ?? result.auth.resource ?? null;
          result.auth.registrationSource = start.registrationSource ?? null;
        } catch (error) {
          // An unknown server whose authorization server supports neither CIMD
          // nor dynamic registration is not a failed connect: the draft
          // connection is real and usable as soon as the operator supplies a
          // client they registered themselves. Report that instead of a 4xx so
          // the wizard can ask for it rather than losing the draft.
          const code = error instanceof HttpError ? String((error.details as { code?: unknown })?.code ?? "") : "";
          if (code !== "oauth_manual_client_required" && code !== "oauth_manual_client_rebinding_required") throw error;
          result.auth.startUrl = null;
          result.auth.manualClientRequired = true;
        }
      }
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_app.connected",
        entityType: "tool_connection",
        entityId: result.connectionId,
        details: {
          galleryKey: req.body.galleryKey ?? null,
          credentialSource: result.connection.credentialSource,
          link: typeof req.body.link === "string" ? redactRemoteUrlCredential(req.body.link) : null,
          applicationId: result.application.id,
          catalogEntryCount: result.catalog.length,
          readOnlyActionCount: result.actions.readOnly.length,
          canMakeChangesActionCount: result.actions.canMakeChanges.length,
        },
      });
      res.status(201).json({ ...result, ...(result.auth?.kind === "oauth" && result.auth.startUrl
        ? requiredConnectionUserAction(req, { type: "connection", id: result.connectionId, spaceId }, result.auth.startUrl,
          "Open this saved setup and authenticate the account in your browser.") : {}) });
    } catch (error) {
      svc.ensureNoDuplicateNameError(error);
    }
  });

  router.post(
    "/spaces/:spaceId/tools/connections/:connectionId/start-authorization", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/connections/:connectionId/start-authorization", { personal: true }),
    validate(startConnectionAuthorizationSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      activeToolMembership(req, spaceId);
      if (!connectionRequestUserId(req) || connectionRequestUserId(req) !== req.body.subjectUserId) {
        throw forbidden("Operator users may only authorize their own connection subject");
      }
      const existing = await svc.getConnection(req.params.connectionId as string, spaceId);
      await assertToolConnectionAccess(req, existing);
      const result = await svc.startOAuth(spaceId, existing.id, {
        redirectUri: oauthRedirectUri(req),
        actor: connectionRequestActor(req),
        subjectUserId: req.body.subjectUserId,
        scopes: req.body.scopes,
        returnTo: req.body.returnTo,
      });
      res.json({ ...requiredConnectionUserAction(req, { type: "connection", id: existing.id, spaceId: existing.spaceId }, result.authorizationUrl, "Authenticate the selected account and consent to the requested provider access."), url: result.authorizationUrl, ...(result.handoff ? { handoff: result.handoff } : {}) });
    },
  );

  router.post("/tools/oauth/:connectionId/start", managementGuard("connections:configure", "POST /tools/oauth/:connectionId/start", { personal: true }), validate(startToolOAuthSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    const subjectUserId = (req.actor.type === "agent" || req.body?.asCurrentUser === true) ? connectionRequestUserId(req) ?? null : null;
    const subjectAgentId = req.body?.asAgentId ?? null;
    if (req.body?.asCurrentUser === true && !subjectUserId) {
      throw forbidden("Connecting an app as yourself requires a signed-in user");
    }
    if (subjectUserId && existing.credentialPolicy === "per_user") {
      // Personal reconnect is consent owned by the fixed subject, not a manager
      // configuration action. Membership blocks viewers; the service then
      // proves this caller is the connection's retained subject before it can
      // create OAuth state. Shared reconnects keep the stricter configure gate.
      activeToolMembership(req, existing.spaceId);
    } else {
      await assertToolConnectionConfigureAccess(req, existing);
    }
    const result = await svc.startOAuth(existing.spaceId, existing.id, {
      workspaceServices: req.body.workspaceServices,
      redirectUri: oauthRedirectUri(req),
      actor: connectionRequestActor(req),
      returnTo: oauthBrowserOrigin(req) ?? undefined,
      ...(subjectUserId ? { subjectUserId } : {}),
      ...(subjectAgentId ? { subjectAgentId } : {}),
      ...(req.body?.interactionId ? { interactionId: req.body.interactionId } : {}),
    });
    res.json({ ...result, ...requiredConnectionUserAction(req, { type: "connection", id: existing.id, spaceId: existing.spaceId }, result.authorizationUrl, "Authenticate the selected account and consent to the requested provider access.") });
  });

  router.get("/tools/oauth/cloud-connector/enrollment", async (req, res) => {
    assertOperator(req);
    res.json(await reconcileOutpostCloudConnectorEnrollmentStatus());
  });

  router.post("/tools/oauth/cloud-connector/enrollment", async (req, res) => {
    assertInstanceAdmin(req);
    const spaceId = typeof req.body?.spaceId === "string" ? req.body.spaceId : "";
    if (!spaceId) throw badRequest("Outpost Cloud enrollment requires a space");
    assertSpaceAccess(req, spaceId);
    const origin = new URL(oauthRedirectUri(req)).origin;
    const returnTo = normalizeCloudConnectorEnrollmentReturnTo(
      typeof req.body?.returnTo === "string" ? req.body.returnTo : undefined,
    ) ?? undefined;
    let status;
    try {
      status = await startOutpostCloudConnectorEnrollment({
        origin,
        spaceId,
        initiatedBy: connectorEnrollmentPrincipal(req),
        label: typeof req.body?.label === "string" ? req.body.label : undefined,
        returnTo,
      });
    } catch {
      throw unprocessable("Outpost Cloud enrollment could not be started", {
        code: "outpost_cloud_connector_enrollment_failed",
      });
    }
    await logActivity(db, {
      spaceId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "outpost_cloud_connector.enrollment_started",
      entityType: "connector_instance",
      entityId: status.instanceId ?? "pending",
      details: { environment: status.environment, status: status.status },
    });
    res.status(201).json(status);
  });

  router.get("/tools/oauth/cloud-connector/enrollment-callback", async (req, res) => {
    assertInstanceAdmin(req);
    const enrollmentId = typeof req.query.enrollment_id === "string" ? req.query.enrollment_id : "";
    const approvalCode = typeof req.query.approval_code === "string" ? req.query.approval_code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!enrollmentId || !approvalCode || !state) throw badRequest("Invalid Outpost Cloud enrollment callback");
    const pending = loadOutpostCloudConnectorIdentity()?.pending;
    if (pending?.spaceId && !hasSpaceAccess(req, pending.spaceId)) {
      throw notFound("Outpost Cloud enrollment not found");
    }
    if (pending?.initiatedBy && pending.initiatedBy !== connectorEnrollmentPrincipal(req)) {
      throw notFound("Outpost Cloud enrollment not found");
    }
    const [space] = pending?.spaceId
      ? await db
        .select({ id: spaces.id, issuePrefix: spaces.issuePrefix })
        .from(spaces)
        .where(eq(spaces.id, pending.spaceId))
        .limit(1)
      : [];
    if (!space) throw notFound("Outpost Cloud enrollment not found");
    let status;
    try {
      status = await completeOutpostCloudConnectorEnrollment({ enrollmentId, approvalCode, state });
      invalidateOutpostCloudConnectorCapabilities();
    } catch {
      throw badRequest("Invalid or expired Outpost Cloud enrollment callback");
    }
    if (pending?.spaceId) {
      await logActivity(db, {
        spaceId: pending.spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "outpost_cloud_connector.enrollment_completed",
        entityType: "connector_instance",
        entityId: status.instanceId ?? enrollmentId,
        details: { environment: status.environment, status: status.status },
      });
    }
    const returnTo = normalizeCloudConnectorEnrollmentReturnTo(pending?.returnTo);
    if (returnTo && new URL(returnTo, "http://outpost.local").searchParams.get("enrollment_host") === "dialog") {
      res.set("Cache-Control", "no-store");
      const intent = new URL(returnTo, "http://outpost.local").searchParams.get("intent");
      const parsedIntent = startToolOAuthSchema.safeParse({ interactionId: intent });
      const interactionId = parsedIntent.success ? parsedIntent.data.interactionId : undefined;
      const [interaction] = interactionId ? await db.select({ issueId: issueThreadInteractions.issueId })
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.id, interactionId),
          eq(issueThreadInteractions.spaceId, space.id),
          eq(issueThreadInteractions.addresseeUserId, req.actor.userId ?? ""),
          eq(issueThreadInteractions.kind, "connection_intent"),
        )).limit(1) : [];
      res.type("html").send(cloudConnectorEnrollmentOutcomeHtml(space.issuePrefix, returnTo, interaction?.issueId));
      return;
    }
    res.redirect(303, cloudConnectorEnrollmentReturnPath(space.issuePrefix, returnTo));
  });

  const handleOutpostCloudConnectorCallback = async (req: Request, res: Response) => {
    assertOperator(req);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const claimId = typeof req.query.claim_id === "string" ? req.query.claim_id : null;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const pendingState = state ? await svc.peekOAuthState(state) : null;
    if (!pendingState || !hasSpaceAccess(req, pendingState.spaceId)) {
      throw badRequest("Invalid or expired OAuth state");
    }
    const pendingConnection = await svc.getConnection(pendingState.connectionId, pendingState.spaceId);
    const pendingConnectionIntent = await isConnectionIntent(pendingState.interactionId);
    if (pendingState.subjectUserId && pendingState.subjectUserId === req.actor.userId) {
      await assertToolConnectionAccess(req, pendingConnection);
    } else {
      await assertToolConnectionConfigureAccess(req, pendingConnection);
    }
    const acceptsHtml = req.get("accept")?.includes("text/html") === true;
    try {
      const result = await svc.completeOutpostCloudConnectorCallback({
        state,
        claimId,
        error,
        actor: getActorInfo(req),
      });
      const pendingConfig = pendingConnection.config ?? {};
      const oauthConfig = pendingConfig.oauth && typeof pendingConfig.oauth === "object"
        ? pendingConfig.oauth as Record<string, unknown>
        : null;
      const connectorProfileValue = typeof oauthConfig?.connectorProfile === "string"
        ? oauthConfig.connectorProfile
        : null;
      const connectorProfile = connectorProfileValue && (
        isGoogleWorkspaceConnectorProfileId(connectorProfileValue) || isGitHubConnectorProfileId(connectorProfileValue)
      )
        ? connectorProfileValue
        : null;
      const connectorDefinition = connectorProfile
        ? isGitHubConnectorProfileId(connectorProfile)
          ? GITHUB_CONNECTOR_PROFILES[connectorProfile]
          : GOOGLE_WORKSPACE_CONNECTOR_PROFILES[connectorProfile]
        : null;
      await logActivity(db, {
        spaceId: result.connection.spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "tool_app.oauth_connected",
        entityType: "tool_connection",
        entityId: result.connection.id,
        details: {
          applicationId: result.application.id,
          catalogEntryCount: result.catalog.length,
          provider: connectorDefinition?.appSlug ?? "managed",
          ...(connectorDefinition ? { profile: connectorProfile } : {}),
        },
      });
      if (acceptsHtml && pendingConnectionIntent && pendingState.interactionId && req.actor.userId) {
        await finishConnectionIntentOAuth({
          interactionId: pendingState.interactionId,
          connectionId: result.connection.id,
          userId: req.actor.userId,
          outcome: "connected",
          canManageOrganizationGrant: await isToolConnectionManager(req, pendingConnection.spaceId),
          bypassCurrentMembershipCheck: bypassCurrentMembershipCheck(req),
        });
        sendConnectionIntentOAuthOutcome(res, {
          interactionId: pendingState.interactionId,
          issueId: pendingState.issueId,
          outcome: "connected",
          openerOrigin: pendingState.returnTo,
        });
        return;
      }
      if (acceptsHtml) {
        const permissionsPath = await oauthAppPath(result.connection.spaceId, result.connection.id);
        res.redirect(303, `${permissionsPath}?success=1`);
        return;
      }
      res.json(result);
    } catch (callbackError) {
      if (!acceptsHtml) throw callbackError;
      const details = callbackError instanceof HttpError && callbackError.details && typeof callbackError.details === "object"
        ? callbackError.details as Record<string, unknown>
        : null;
      if (pendingConnectionIntent && pendingState.interactionId && req.actor.userId) {
        const outcome = details?.code === "oauth_authorization_denied" ? "declined" : "failed";
        await finishConnectionIntentOAuth({
          interactionId: pendingState.interactionId,
          userId: req.actor.userId,
          outcome,
          canManageOrganizationGrant: await isToolConnectionManager(req, pendingConnection.spaceId),
          bypassCurrentMembershipCheck: bypassCurrentMembershipCheck(req),
        });
        sendConnectionIntentOAuthOutcome(res, {
          interactionId: pendingState.interactionId,
          issueId: pendingState.issueId,
          outcome,
          openerOrigin: pendingState.returnTo,
        });
        return;
      }
      const outcome = details?.code === "oauth_authorization_denied" ? "denied" : "failed";
      res.redirect(303, await oauthRecoveryPath(
        pendingConnection,
        outcome,
        typeof details?.code === "string" ? details.code : null,
        {
          installationUrl: details?.installationUrl,
          managementUrl: details?.managementUrl,
        },
      ));
    }
  };
  router.get("/tools/oauth/cloud-connector/callback", handleOutpostCloudConnectorCallback);
  router.get("/tools/oauth/outpost-id/callback", handleOutpostCloudConnectorCallback);

  router.get("/tools/vercel-connect/callback", async (req, res) => {
    assertOperator(req);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const pendingState = state ? await svc.peekOAuthState(state) : null;
    if (!pendingState || !hasSpaceAccess(req, pendingState.spaceId)) {
      throw badRequest("Invalid or expired Vercel Connect state");
    }
    const pendingConnection = await svc.getConnection(pendingState.connectionId, pendingState.spaceId);
    const pendingConnectionIntent = await isConnectionIntent(pendingState.interactionId);
    if (pendingState.subjectUserId && pendingState.subjectUserId === req.actor.userId) {
      await assertToolConnectionAccess(req, pendingConnection);
    } else {
      await assertToolConnectionConfigureAccess(req, pendingConnection);
    }
    const acceptsHtml = req.get("accept")?.includes("text/html") === true;
    try {
      const result = await svc.completeVercelConnectCallback({
        state,
        error,
        actor: getActorInfo(req),
      });
      await logActivity(db, {
        spaceId: result.connection.spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "tool_app.oauth_connected",
        entityType: "tool_connection",
        entityId: result.connection.id,
        details: {
          applicationId: result.application.id,
          catalogEntryCount: result.catalog.length,
          provider: "vercel_connect",
        },
      });
      if (acceptsHtml && pendingConnectionIntent && pendingState.interactionId && req.actor.userId) {
        await finishConnectionIntentOAuth({
          interactionId: pendingState.interactionId,
          connectionId: result.connection.id,
          userId: req.actor.userId,
          outcome: "connected",
          canManageOrganizationGrant: await isToolConnectionManager(req, pendingConnection.spaceId),
          bypassCurrentMembershipCheck: bypassCurrentMembershipCheck(req),
        });
        sendConnectionIntentOAuthOutcome(res, {
          interactionId: pendingState.interactionId,
          issueId: pendingState.issueId,
          outcome: "connected",
          openerOrigin: pendingState.returnTo,
        });
        return;
      }
      if (acceptsHtml) {
        const permissionsPath = await oauthAppPath(result.connection.spaceId, result.connection.id);
        res.redirect(303, `${permissionsPath}?success=1`);
        return;
      }
      res.json(result);
    } catch (callbackError) {
      if (!acceptsHtml) throw callbackError;
      const details = callbackError instanceof HttpError && callbackError.details && typeof callbackError.details === "object"
        ? callbackError.details as Record<string, unknown>
        : null;
      const callbackCode = typeof details?.code === "string" ? details.code : "vercel_connect_callback_failed";
      await logActivity(db, {
        spaceId: pendingState.spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "tool_app.oauth_failed",
        entityType: "tool_connection",
        entityId: pendingState.connectionId,
        details: { code: callbackCode, provider: "vercel_connect" },
      });
      if (pendingConnectionIntent && pendingState.interactionId && req.actor.userId) {
        const outcome = callbackCode === "oauth_authorization_denied" ? "declined" : "failed";
        await finishConnectionIntentOAuth({
          interactionId: pendingState.interactionId,
          userId: req.actor.userId,
          outcome,
          canManageOrganizationGrant: await isToolConnectionManager(req, pendingConnection.spaceId),
          bypassCurrentMembershipCheck: bypassCurrentMembershipCheck(req),
        });
        sendConnectionIntentOAuthOutcome(res, {
          interactionId: pendingState.interactionId,
          issueId: pendingState.issueId,
          outcome,
          openerOrigin: pendingState.returnTo,
        });
        return;
      }
      res.redirect(303, await oauthRecoveryPath(pendingConnection, "failed", callbackCode));
    }
  });

  router.get("/tools/oauth/callback", async (req, res) => {
    assertOperator(req);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    // `error_description` / `error_uri` are read from neither the query nor the
    // provider's body: they are provider-authored prose, and Outpost maps the
    // `error` code to its own copy instead of reflecting them (PAP-17108).
    const iss = typeof req.query.iss === "string" ? req.query.iss : null;
    const pendingState = state ? await svc.peekOAuthState(state) : null;
    if (!pendingState || !hasSpaceAccess(req, pendingState.spaceId)) {
      throw badRequest("Invalid or expired OAuth state");
    }
    const pendingConnection = await svc.getConnection(pendingState.connectionId, pendingState.spaceId);
    const pendingConnectionIntent = await isConnectionIntent(pendingState.interactionId);
    if (!pendingState.subjectUserId) {
      if (!await isToolConnectionManagerQuiet(req, pendingConnection.spaceId)) {
        throw forbidden(ORGANIZATION_GRANT_DENIAL_REASON);
      }
    } else if (pendingState.subjectUserId === req.actor.userId) {
      await assertToolConnectionAccess(req, pendingConnection);
    } else {
      await assertToolConnectionConfigureAccess(req, pendingConnection);
    }
    const acceptsHtml = req.get("accept")?.includes("text/html") === true;
    if (acceptsHtml && isCrossSiteOAuthCallbackNavigation(req)) {
      // State is only peeked above, so the same-origin repeat still owns it.
      res.set("Cache-Control", "no-store");
      res.set("Referrer-Policy", "no-referrer");
      res.type("html").send(oauthCallbackInterstitialHtml(req.originalUrl));
      return;
    }
    let result: Awaited<ReturnType<typeof svc.completeOAuthCallback>>;
    try {
      result = await svc.completeOAuthCallback({
        state,
        code,
        error,
        iss,
        // A provider denial is bound and consumed by state alone. Avoid
        // requiring this deployment's callback origin just to record that the
        // user declined; successful code exchange still validates the origin.
        redirectUri: error ? "" : oauthRedirectUri(req),
        actor: getActorInfo(req),
      });
    } catch (callbackError) {
      if (!acceptsHtml) throw callbackError;
      const details = callbackError instanceof HttpError
        && callbackError.details
        && typeof callbackError.details === "object"
        && !Array.isArray(callbackError.details)
        ? callbackError.details as Record<string, unknown>
        : null;
      const callbackErrorCode = typeof details?.code === "string" ? details.code : null;
      const callbackFailureCode = callbackErrorCode
        ?? (callbackError instanceof HttpError ? `oauth_callback_http_${callbackError.status}` : "oauth_callback_failed");
      await logActivity(db, {
        spaceId: pendingState.spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "tool_app.oauth_failed",
        entityType: "tool_connection",
        entityId: pendingState.connectionId,
        details: {
          code: callbackFailureCode,
          status: callbackError instanceof HttpError ? callbackError.status : 500,
          // HttpError messages are Outpost-authored. Provider-authored
          // error_description/error_uri values are never read above and cannot
          // be reflected into the activity stream.
          message: callbackError instanceof HttpError
            ? callbackError.message
            : "OAuth callback failed unexpectedly.",
        },
      });
      if (pendingConnectionIntent && pendingState.interactionId && req.actor.userId) {
        const outcome = callbackErrorCode === "oauth_authorization_denied" ? "declined" : "failed";
        await finishConnectionIntentOAuth({
          interactionId: pendingState.interactionId,
          userId: req.actor.userId,
          outcome,
          canManageOrganizationGrant: await isToolConnectionManager(req, pendingConnection.spaceId),
          bypassCurrentMembershipCheck: bypassCurrentMembershipCheck(req),
        });
        sendConnectionIntentOAuthOutcome(res, {
          interactionId: pendingState.interactionId,
          issueId: pendingState.issueId,
          outcome,
          openerOrigin: pendingState.returnTo,
        });
        return;
      }
      res.redirect(303, await oauthRecoveryPath(
        pendingConnection,
        callbackErrorCode === "oauth_authorization_denied" ? "denied" : "failed",
        callbackFailureCode,
      ));
      return;
    }
    await logActivity(db, {
      spaceId: result.connection.spaceId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "tool_app.oauth_connected",
      entityType: "tool_connection",
      entityId: result.connection.id,
      details: {
        applicationId: result.application.id,
        catalogEntryCount: result.catalog.length,
      },
    });
    if (acceptsHtml && pendingConnectionIntent && pendingState.interactionId && req.actor.userId) {
      await finishConnectionIntentOAuth({
        interactionId: pendingState.interactionId,
        connectionId: result.connection.id,
        userId: req.actor.userId,
        outcome: "connected",
        canManageOrganizationGrant: await isToolConnectionManager(req, pendingConnection.spaceId),
        bypassCurrentMembershipCheck: bypassCurrentMembershipCheck(req),
      });
      sendConnectionIntentOAuthOutcome(res, {
        interactionId: pendingState.interactionId,
        issueId: pendingState.issueId,
        outcome: "connected",
        openerOrigin: pendingState.returnTo,
      });
      return;
    }
    if (acceptsHtml) {
      const permissionsPath = await oauthAppPath(result.connection.spaceId, result.connection.id);
      res.redirect(303, `${permissionsPath}?success=1`);
      return;
    }
    res.json(result);
  });

  router.post(
    "/spaces/:spaceId/tools/apps/:connectionId/finalize-oauth-access", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/apps/:connectionId/finalize-oauth-access", { personal: true }),
    validate(finalizeOAuthAccessSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const existing = await svc.getConnection(req.params.connectionId as string, spaceId);
      await assertToolConnectionConfigureAccess(req, existing);
      const result = await svc.finalizeOAuthAccess(spaceId, existing.id, req.body, connectionRequestActor(req));
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_app.oauth_access_finalized",
        entityType: "tool_connection",
        entityId: result.connection.id,
        details: {
          grantKind: req.body.grantKind,
          profileId: result.profile.id,
          profileEntryCount: result.profileEntries.length,
        },
      });
      res.json(result);
    },
  );

  router.post("/spaces/:spaceId/tools/apps/:connectionId/finish", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/apps/:connectionId/finish", { personal: true }), validate(finishToolAppSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    const existing = await svc.getConnection(req.params.connectionId as string, spaceId);
    await assertToolConnectionConfigureAccess(req, existing);
    const result = await svc.finishGalleryAppConnection(spaceId, existing.id, req.body, connectionRequestActor(req));
    await logActivity(db, {
      spaceId,
      ...connectionRequestActor(req),
      action: "tool_app.finished",
      entityType: "tool_connection",
      entityId: result.connection.id,
      details: {
        profileId: result.profile.id,
        profileEntryCount: result.profileEntries.length,
        profileBindingCount: result.profileBindings.length,
        askFirstPolicyCount: result.policies.length,
        reviewedCatalogEntryCount: req.body.reviewedCatalogEntryIds?.length ?? 0,
        access: req.body.access,
      },
    });
    res.json(result);
  });

  router.get("/spaces/:spaceId/tools/examples", managementGuard("connections:read", "GET /spaces/:spaceId/tools/examples", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json({ examples: await svc.listExamples(spaceId) });
  });

  router.get("/spaces/:spaceId/tools/apps/attention", managementGuard("connections:read", "GET /spaces/:spaceId/tools/apps/attention", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.listAppsNeedingAttention(spaceId);
    const apps = await filterConnectionManagementRows(db, req, "connections:read", result.apps, row => ({ connectionId: row.connection.id }));
    res.json({ ...result, apps, totals: {
      connections: apps.length, health: apps.filter(app => app.healthNeedsAttention).length,
      quarantinedCatalogEntries: apps.reduce((sum, app) => sum + app.quarantinedCatalogEntryCount, 0),
      pendingActionRequests: apps.reduce((sum, app) => sum + app.pendingActionRequestCount, 0),
      newToolsPendingReview: apps.reduce((sum, app) => sum + app.newToolsPendingReviewCount, 0),
      newToolsPendingProfiles: new Set(apps.flatMap(app => app.newToolsPendingProfiles.map(profile => profile.profileId))).size,
    } });
  });

  router.get("/spaces/:spaceId/tools/action-requests", managementGuard("connections:read", "GET /spaces/:spaceId/tools/action-requests", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const statusRaw = typeof req.query.status === "string" ? req.query.status : "pending";
    const status = (TOOL_ACTION_REQUEST_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as (typeof TOOL_ACTION_REQUEST_STATUSES)[number])
      : "pending";
    res.json({ actionRequests: await filterConnectionManagementRows(db, req, "connections:read", await svc.listActionRequests(spaceId, status), row => ({ connectionId: row.connectionId, issueId: row.request.issueId })) });
  });

  router.post("/spaces/:spaceId/tools/examples/:id/install", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/examples/:id/install", { personal: true }), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    const result = await svc.installExample(spaceId, req.params.id as string, connectionRequestActor(req));
    await logActivity(db, {
      spaceId,
      ...connectionRequestActor(req),
      action: "tool_example.installed",
      entityType: "tool_example",
      entityId: result.example.id,
      details: {
        created: result.created,
        applicationId: result.application.id,
        connectionId: result.connection.id,
        profileId: result.profile.id,
        profileEntryCount: result.profileEntries.length,
      },
    });
    res.status(result.created ? 201 : 200).json(result);
  });

  router.post("/spaces/:spaceId/tools/examples/:id/smoke", async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.smokeExample(spaceId, req.params.id as string, getActorInfo(req));
    await logActivity(db, {
      spaceId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "tool_example.smoke_run",
      entityType: "tool_example",
      entityId: result.exampleId,
      details: {
        ok: result.ok,
        actor: result.actor,
        connectionId: result.connection.id,
        profileId: result.profile.id,
        checks: result.checks.map((check) => ({
          name: check.name,
          ok: check.ok,
          toolName: check.toolName ?? null,
          decision: check.decision ?? null,
          reasonCode: check.reasonCode ?? null,
        })),
      },
    });
    res.json(result);
  });

  router.get("/spaces/:spaceId/tools/applications", managementGuard("connections:read", "GET /spaces/:spaceId/tools/applications", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json({ applications: await svc.listApplications(spaceId) });
  });

  router.post("/spaces/:spaceId/tools/applications", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/applications", { personal: true }), validate(createToolApplicationSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    try {
      const application = await svc.createApplication(spaceId, req.body, connectionRequestContext(req));
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_application.created",
        entityType: "tool_application",
        entityId: application.id,
        details: { type: application.type, name: application.name },
      });
      res.status(201).json(application);
    } catch (error) {
      svc.ensureNoDuplicateNameError(error);
    }
  });

  router.patch("/tool-applications/:applicationId", managementGuard("connections:configure", "PATCH /tool-applications/:applicationId", { personal: true }), validate(updateToolApplicationSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getApplication(req.params.applicationId as string), "Tool application not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    try {
      const application = await svc.updateApplication(existing.id, req.body, connectionRequestContext(req));
      await logActivity(db, {
        spaceId: application.spaceId,
        ...connectionRequestActor(req),
        action: "tool_application.updated",
        entityType: "tool_application",
        entityId: application.id,
        details: { status: application.status, name: application.name },
      });
      res.json(application);
    } catch (error) {
      svc.ensureNoDuplicateNameError(error);
    }
  });

  router.delete("/tool-applications/:applicationId", managementGuard("connections:configure", "DELETE /tool-applications/:applicationId", { personal: true }), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getApplication(req.params.applicationId as string), "Tool application not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    const application = await svc.deleteApplication(existing.id, connectionRequestContext(req));
    await logActivity(db, {
      spaceId: application.spaceId,
      ...connectionRequestActor(req),
      action: "tool_application.deleted",
      entityType: "tool_application",
      entityId: application.id,
      details: { type: application.type, name: application.name },
    });
    res.json(application);
  });

  router.get("/spaces/:spaceId/tools/connections", managementGuard("connections:read", "GET /spaces/:spaceId/tools/connections", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const connections = await svc.listConnections(spaceId, connectionRequestUserId(req) ?? undefined);
    const canManageConnections = await isToolConnectionManagerQuiet(req, spaceId);
    let visible = filterVisibleToolConnections(connections, { userId: connectionRequestUserId(req), canManageConnections });
    if (req.actor.type === "agent") {
      const management = connectionManagementService(db);
      const allowed = await Promise.all(visible.map(connection => management.capability(req.actor, "connections:read", {
        type: "connection_management", spaceId, connectionId: connection.id,
        operation: "GET /spaces/:spaceId/tools/connections", readOnly: true,
      }, { mutation: false, readContext: connectionRequestContext(req) })));
      visible = visible.filter((_, index) => allowed[index].allowed);
    }
    res.json({ connections: visible });
  });

  router.post("/spaces/:spaceId/tools/connections", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/connections", { personal: true }), validate(createToolConnectionSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    try {
      const connection = await svc.createConnection(spaceId, req.body, connectionRequestActor(req));
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_connection.created",
        entityType: "tool_connection",
        entityId: connection.id,
        details: {
          transport: connection.transport,
          status: connection.status,
          enabled: connection.enabled,
          credentialRefCount: (connection.credentialRefs ?? []).length + connection.credentialSecretRefs.length,
          ...(req.body.agentInstructions !== undefined ? { agentInstructionsChanged: true, agentInstructionsEnabled: connection.agentInstructions?.enabled ?? false } : {}),
        },
      });
      res.status(201).json(connection);
    } catch (error) {
      svc.ensureNoDuplicateNameError(error);
    }
  });

  router.get("/tool-connections/:connectionId", managementGuard("connections:read", "GET /tool-connections/:connectionId", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(
      req,
      res,
      svc.getConnection(req.params.connectionId as string, undefined, connectionRequestUserId(req) ?? undefined),
      "Tool connection not found",
    );
    if (!connection) return;
    res.json(connection);
  });

  router.post("/tool-connections/:connectionId/railway/ssh", managementGuard("connections:configure", "POST /tool-connections/:connectionId/railway/ssh", { personal: true }), validate(configureRailwaySshSchema), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    await assertToolConnectionConfigureAccess(req, connection);
    const setup = await svc.configureRailwaySsh(connection.id, connection.spaceId, req.body, connectionRequestActor(req)).catch((error) => {
      if (error instanceof RailwayError) throw new HttpError(error.status, error.message);
      throw error;
    });
    await logActivity(db, { spaceId: connection.spaceId, ...connectionRequestActor(req), action: "tool_connection.railway_ssh_updated", entityType: "tool_connection", entityId: connection.id, details: { action: req.body.action, grantId: req.body.grantId, enabled: setup?.enabled ?? false } });
    res.json(setup);
  });

  router.get("/tool-connections/:connectionId/grants", managementGuard("connections:read", "GET /tool-connections/:connectionId/grants", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    const listed = await svc.listConnectionGrants(connection.id, connection.spaceId);
    const capabilities = await describeConnectionCapabilities(req, connection);
    const membership = toolMembershipRole(req, connection.spaceId);
    const grantContext = {
      userId: connectionRequestUserId(req) ?? null,
      isManager: await isToolConnectionManagerQuiet(req, connection.spaceId),
      mutationCapable: membership.unrestricted || (membership.isActive && !membership.isViewer),
    };
    // A regular member has no reason to browse coworkers' personal identities;
    // the manager kill switch does. Filtering here rather than in the UI keeps
    // the list itself — not just its controls — under server policy.
    const visibleGrants = listed.grants.filter((grant) =>
      grant.kind === "organization"
      || capabilities.canViewOtherPersonalIdentities
      || (grantContext.userId !== null && grant.subjectUserId === grantContext.userId));
    res.json({
      ...listed,
      grants: visibleGrants.map((grant) => ({
        ...grant,
        capabilities: describeGrantCapabilities(grant, grantContext),
      })),
      capabilities,
      currentUserId: grantContext.userId,
      members: capabilities.canConfigure
        ? await svc.listConnectionAudienceMembers(connection.spaceId)
        : [],
    });
  });

  router.put(
    "/tool-connections/:connectionId/grants/:grantId/members", managementGuard("connections:profiles", "PUT /tool-connections/:connectionId/grants/:grantId/members", { personal: true }),
    validate(replaceConnectionGrantMembersSchema),
    async (req, res) => {
      assertOperatorOrAgent(req);
      const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
      if (!connection) return;
      // Viewer/inactive principals are rejected before anything else, so a
      // read-only member can never reach the audience writer.
      activeToolMembership(req, connection.spaceId);
      const { grants } = await svc.listConnectionGrants(connection.id, connection.spaceId);
      const target = grants.find((grant) => grant.id === req.params.grantId);
      if (!target) throw notFound("Connection grant not found");
      const isGrantCreator = Boolean(connectionRequestUserId(req) && target.createdByUserId === connectionRequestUserId(req));
      if (!isGrantCreator) await assertToolConnectionConfigureAccess(req, connection);
      const memberUserIds = req.body.memberUserIds as string[];
      const grant = await svc.replaceConnectionGrantMembers(
        connection.id,
        target.id,
        memberUserIds,
        connectionRequestActor(req),
      );
      await logActivity(db, {
        spaceId: connection.spaceId,
        ...connectionRequestActor(req),
        action: "tool_connection.grant_audience_replaced",
        entityType: "connection_grant",
        entityId: grant.id,
        details: { connectionId: connection.id, memberCount: memberUserIds.length },
      });
      res.json(grant);
    },
  );

  router.post("/tool-connections/:connectionId/grants/installations", managementGuard("connections:profiles", "POST /tool-connections/:connectionId/grants/installations", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    await assertToolConnectionConfigureAccess(req, connection);
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const credentialSecretRefs = Array.isArray(body.credentialSecretRefs) ? body.credentialSecretRefs : [];
    const providerTenant = body.providerTenant && typeof body.providerTenant === "object"
      ? body.providerTenant as { name?: string; externalId?: string }
      : undefined;
    const grant = await svc.addConnectionInstallation(connection.id, {
      providerTenant,
      credentialSecretRefs,
      isDefault: body.isDefault === true,
    }, connectionRequestActor(req));
    await logActivity(db, {
      spaceId: connection.spaceId,
      ...connectionRequestActor(req),
      action: "tool_connection.grant_added",
      entityType: "connection_grant",
      entityId: grant.id,
      details: { connectionId: connection.id, kind: grant.kind },
    });
    res.status(201).json(grant);
  });

  router.delete("/tool-connections/:connectionId/grants/:grantId", managementGuard("connections:configure", "DELETE /tool-connections/:connectionId/grants/:grantId", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    const { grants } = await svc.listConnectionGrants(connection.id, connection.spaceId);
    const grantToRevoke = grants.find((grant) => grant.id === req.params.grantId);
    const canRevokeOwnGrant = Boolean(
      connectionRequestUserId(req)
      && grantToRevoke
      && (grantToRevoke.subjectUserId === connectionRequestUserId(req) || grantToRevoke.createdByUserId === connectionRequestUserId(req)),
    );
    if (!canRevokeOwnGrant) await assertToolConnectionConfigureAccess(req, connection);
    const grant = await svc.revokeConnectionGrant(connection.id, req.params.grantId as string, connectionRequestActor(req));
    await logActivity(db, {
      spaceId: connection.spaceId,
      ...connectionRequestActor(req),
      action: "tool_connection.grant_revoked",
      entityType: "connection_grant",
      entityId: grant.id,
      details: { connectionId: connection.id, kind: grant.kind },
    });
    res.json(grant);
  });

  router.post("/tool-connections/:connectionId/grants/:grantId/delegations", managementGuard("connections:profiles", "POST /tool-connections/:connectionId/grants/:grantId/delegations", { personal: true }), validate(createConnectionGrantDelegationSchema), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    const ownerUserId = connectionRequestUserId(req);
    if (!ownerUserId) throw forbidden("A named user is required to delegate a personal grant");
    const agentId = req.body.agentId;
    const delegation = await svc.createConnectionGrantDelegation(
      connection.id,
      req.params.grantId as string,
      agentId,
      ownerUserId,
      connectionRequestContext(req),
    );
    await logActivity(db, {
      spaceId: connection.spaceId,
      ...connectionRequestActor(req),
      action: "tool_connection.grant_delegated",
      entityType: "connection_grant",
      entityId: req.params.grantId as string,
      details: { connectionId: connection.id, delegationId: delegation.id, agentId },
    });
    res.status(201).json(delegation);
  });

  router.delete("/tool-connections/:connectionId/grants/:grantId/delegations/:delegationId", managementGuard("connections:profiles", "DELETE /tool-connections/:connectionId/grants/:grantId/delegations/:delegationId", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    const { grants } = await svc.listConnectionGrants(connection.id, connection.spaceId);
    const grant = grants.find((candidate) => candidate.id === req.params.grantId);
    if (!grant) throw notFound("Connection grant not found");
    const canRevokeOwnDelegation = Boolean(connectionRequestUserId(req) && grant.subjectUserId === connectionRequestUserId(req));
    if (!canRevokeOwnDelegation && !await isToolConnectionManager(req, connection.spaceId)) {
      throw forbidden("Only the personal grant owner or a connection manager can revoke a delegation");
    }
    const delegation = await svc.revokeConnectionGrantDelegation(
      connection.id,
      grant.id,
      req.params.delegationId as string,
      connectionRequestActor(req),
    );
    await logActivity(db, {
      spaceId: connection.spaceId,
      ...connectionRequestActor(req),
      action: "tool_connection.grant_delegation_revoked",
      entityType: "connection_grant",
      entityId: grant.id,
      details: { connectionId: connection.id, delegationId: delegation.id, agentId: delegation.agentId },
    });
    res.json(delegation);
  });

  router.get("/tool-connections/:connectionId/review-counts", managementGuard("connections:read", "GET /tool-connections/:connectionId/review-counts", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const { resource } = connectionRequestContext(req)!;
    if (!hasSpaceAccess(req, resource.spaceId)) throw notFound("Tool connection not found");
    assertSpaceAccess(req, resource.spaceId);
    res.json(await svc.getConnectionReviewCounts(resource.spaceId, resource.connectionId!));
  });

  router.get("/tool-connections/:connectionId/usage", managementGuard("connections:read", "GET /tool-connections/:connectionId/usage", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    const range = req.query.range === "30d" ? "30d" : req.query.range === undefined || req.query.range === "7d" ? "7d" : null;
    if (!range) throw badRequest("Usage range must be 7d or 30d");
    res.json(await svc.getConnectionUsage(connection.id, range, connection.spaceId));
  });

  router.get("/tool-connections/:connectionId/installs", managementGuard("connections:profiles", "GET /tool-connections/:connectionId/installs", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    res.json({ connectionId: connection.id, installs: connection.installs ?? [] });
  });

  router.put(
    "/tool-connections/:connectionId/installs", managementGuard("connections:profiles", "PUT /tool-connections/:connectionId/installs", { personal: true }),
    validate(putToolConnectionInstallsSchema),
    async (req, res) => {
      assertOperatorOrAgent(req);
      const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
      if (!connection) return;
      const existingInstalls = await db
        .select()
        .from(toolConnectionInstalls)
        .where(and(
          eq(toolConnectionInstalls.spaceId, connection.spaceId),
          eq(toolConnectionInstalls.connectionId, connection.id),
        ));
      const requestedInstalls = req.body.installs as Array<{ targetType: "space" | "agent"; targetId: string }>;
      const requestedKeys = new Set(requestedInstalls.map((install) => `${install.targetType}:${install.targetId}`));
      const existingKeys = new Set(existingInstalls.map((install) => `${install.targetType}:${install.targetId}`));
      const changedInstalls = [
        ...requestedInstalls.filter((install) => !existingKeys.has(`${install.targetType}:${install.targetId}`)),
        ...existingInstalls.filter((install) => !requestedKeys.has(`${install.targetType}:${install.targetId}`)),
      ];
      if (changedInstalls.some((install) => install.targetType === "space")) {
        await assertToolConnectionConfigureAccess(req, connection);
      }
      if (changedInstalls.some((install) => install.targetType === "agent")) {
        await assertToolConnectionAccess(req, connection);
        const changedAgentIds = [...new Set(
          changedInstalls
            .filter((install) => install.targetType === "agent")
            .map((install) => install.targetId),
        )];
        await assertAgentConnectionInstallAccess(db, req.actor, connection.spaceId, changedAgentIds);
      }
      const snapshot = await svc.putConnectionInstalls(connection.id, req.body, connectionRequestActor(req));
      await logActivity(db, {
        spaceId: connection.spaceId,
        ...connectionRequestActor(req),
        action: "tool_connection.installs_synced",
        entityType: "tool_connection",
        entityId: connection.id,
        details: {
          installs: snapshot.installs.map((install) => ({ targetType: install.targetType, targetId: install.targetId })),
        },
      });
      res.json(snapshot);
    },
  );

  router.get("/tool-connections/:connectionId/test-agents", managementGuard("connections:read", "GET /tool-connections/:connectionId/test-agents", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    if (!options.toolGateway) {
      res.status(501).json({ error: "Tool gateway service is not configured" });
      return;
    }
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    await assertOperatorAnyToolPermission(req, connection.spaceId, ["tools:use", "tools:manage_connections"]);
    const rows = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        title: agents.title,
        status: agents.status,
        leadAgentId: agents.leadAgentId,
      })
      .from(agents)
      .where(eq(agents.spaceId, connection.spaceId));
    const hierarchyDepthByAgentId = agentHierarchyDepths(rows);
    const candidates = [];
    for (const agent of rows) {
      try {
        await assertCanTestAsAgent(req, connection.spaceId, agent.id, agent);
      } catch {
        continue;
      }
      candidates.push({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        title: agent.title,
        status: agent.status,
        hierarchyDepth: hierarchyDepthByAgentId.get(agent.id) ?? 0,
      });
    }
    candidates.sort((a, b) => a.hierarchyDepth - b.hierarchyDepth || a.name.localeCompare(b.name));
    res.json({ agents: candidates });
  });

  router.get("/tool-connections/:connectionId/test-agents/:agentId/access", managementGuard("connections:read", "GET /tool-connections/:connectionId/test-agents/:agentId/access", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    if (!options.toolGateway) {
      res.status(501).json({ error: "Tool gateway service is not configured" });
      return;
    }
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    await assertOperatorAnyToolPermission(req, connection.spaceId, ["tools:use", "tools:manage_connections"]);
    const agentId = req.params.agentId as string;
    await assertCanTestAsAgent(req, connection.spaceId, agentId);
    const accessSummary = await options.toolGateway.summarizeConnectionAccessForAgent({
      spaceId: connection.spaceId,
      connectionId: connection.id,
      agentId,
    });
    res.json({ access: accessSummary });
  });

  async function composioAppManager(req: Request, res: Response) {
    assertOperatorOrAgent(req);
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return null;
    if (!await isToolConnectionManager(req, connection.spaceId)) throw forbidden("Only a connection manager can configure apps and grant agent access");
    return connection;
  }

  router.get("/tool-connections/:connectionId/aggregator/apps", managementGuard("connections:read", "GET /tool-connections/:connectionId/aggregator/apps", { personal: true }), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.set("Cache-Control", "private, no-store");
    res.json(await svc.listAggregatorApps(connection.id, { ...connectionRequestActor(req), }));
  });
  router.post("/tool-connections/:connectionId/aggregator/apps/sync", managementGuard("connections:configure", "POST /tool-connections/:connectionId/aggregator/apps/sync", { personal: true }), validate(aggregatorAppsSyncSchema), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.json(await svc.syncAggregatorApps(connection.id, req.body.force, { ...connectionRequestActor(req), }));
  });
  router.post("/tool-connections/:connectionId/aggregator/apps/refresh", managementGuard("connections:configure", "POST /tool-connections/:connectionId/aggregator/apps/refresh", { personal: true }), validate(aggregatorAppsRefreshSchema), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.json(await svc.refreshAggregatorApps(connection.id, req.body.toolkits, { ...connectionRequestActor(req), }));
  });
  router.put("/tool-connections/:connectionId/aggregator/discovery", managementGuard("connections:configure", "PUT /tool-connections/:connectionId/aggregator/discovery", { personal: true }), validate(arcadeDiscoverySetupSchema), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.json(await svc.configureArcadeDiscovery(connection.id, req.body, { ...connectionRequestActor(req), }));
  });

  router.get("/tool-connections/:connectionId/composio/apps", managementGuard("connections:read", "GET /tool-connections/:connectionId/composio/apps", { personal: true }), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.json(await svc.listComposioApps(connection.id, { ...connectionRequestActor(req), }));
  });

  router.post("/tool-connections/:connectionId/composio/apps/sync", managementGuard("connections:configure", "POST /tool-connections/:connectionId/composio/apps/sync", { personal: true }), validate(composioAppsSyncSchema), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.json(await svc.syncComposioApps(connection.id, req.body.force, { ...connectionRequestActor(req), }));
  });

  router.post("/tool-connections/:connectionId/composio/apps/refresh", managementGuard("connections:configure", "POST /tool-connections/:connectionId/composio/apps/refresh", { personal: true }), validate(composioAppsRefreshSchema), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.json(await svc.refreshComposioApps(connection.id, req.body.toolkits, { ...connectionRequestActor(req), }));
  });

  router.post("/tool-connections/:connectionId/composio/apps/:toolkit/accounts", managementGuard("connections:configure", "POST /tool-connections/:connectionId/composio/apps/:toolkit/accounts", { personal: true }), validate(composioAppAccountSchema), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    res.json(await svc.manageComposioAppAccount(connection.id, req.params.toolkit as string, req.body, { ...connectionRequestActor(req), }));
  });

  router.post("/tool-connections/:connectionId/composio/apps/:toolkit/setup", managementGuard("connections:configure", "POST /tool-connections/:connectionId/composio/apps/:toolkit/setup", { personal: true }), validate(composioAppSetupSchema), async (req, res) => {
    const connection = await composioAppManager(req, res);
    if (!connection) return;
    const result = await svc.setupComposioApp(connection.id, req.params.toolkit as string, req.body,
      { ...connectionRequestActor(req), });
    res.json(result);
  });

  router.post("/tool-connections/:connectionId/test-calls", managementGuard("connections:test", "POST /tool-connections/:connectionId/test-calls", { personal: true }), validate(toolConnectionTestCallSchema), async (req, res) => {
    assertOperatorOrAgent(req);
    if (!options.toolGateway) {
      res.status(501).json({ error: "Tool gateway service is not configured" });
      return;
    }
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    await assertOperatorAnyToolPermission(req, connection.spaceId, ["tools:use", "tools:manage_connections"]);
    await assertCanTestAsAgent(req, connection.spaceId, req.body.agentId);
    try {
      const result = await options.toolGateway.executeTestCall({
        managementContext: connectionRequestContext(req),
        spaceId: connection.spaceId,
        connectionId: connection.id,
        agentId: req.body.agentId,
        userId: connectionRequestUserId(req) ?? "operator",
        toolName: req.body.toolName,
        parameters: req.body.parameters ?? {},
      });
      res.json(result);
    } catch (error) {
      if (!sendToolGatewayError(res, error)) throw error;
    }
  });

  router.get("/tool-connections/:connectionId/test-calls/:actionRequestId", managementGuard("connections:test", "GET /tool-connections/:connectionId/test-calls/:actionRequestId", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    if (!options.toolGateway) {
      res.status(501).json({ error: "Tool gateway service is not configured" });
      return;
    }
    const connection = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!connection) return;
    await assertOperatorAnyToolPermission(req, connection.spaceId, ["tools:use", "tools:manage_connections"]);
    try {
      const status = await options.toolGateway.getTestCallStatus({
        actor: req.actor,
        spaceId: connection.spaceId,
        connectionId: connection.id,
        actionRequestId: req.params.actionRequestId as string,
      });
      res.json(status);
    } catch (error) {
      if (!sendToolGatewayError(res, error)) throw error;
    }
  });

  router.patch("/tool-connections/:connectionId", managementGuard("connections:configure", "PATCH /tool-connections/:connectionId", { personal: true }), validate(updateToolConnectionSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    await assertToolConnectionConfigureAccess(req, existing);
    if (aiConnectionRouterPluginKey(existing)) throw badRequest("Update this connection pool through its pool settings.");
    const connection = await svc.updateConnection(existing.id, req.body, connectionRequestContext(req));
    const lifecycleChanges = classifyConnectionUpdate(
      { enabled: existing.enabled, config: existing.config },
      { enabled: connection.enabled, config: connection.config },
    );
    const baseLog = {
      spaceId: connection.spaceId,
      ...connectionRequestActor(req),
      action: "tool_connection.updated",
      entityType: "tool_connection",
      entityId: connection.id,
    };
    if (lifecycleChanges.length === 0) {
      await logActivity(db, {
        ...baseLog,
        details: {
          status: connection.status,
          enabled: connection.enabled,
          ...(req.body.agentInstructions !== undefined ? { agentInstructionsChanged: true, agentInstructionsEnabled: connection.agentInstructions?.enabled ?? false } : {}),
          credentialRefCount: (connection.credentialRefs ?? []).length + connection.credentialSecretRefs.length,
        },
      });
    } else {
      // One activity row per lifecycle change so the Activity tab renders one
      // humanized row each (PAP-11284), e.g. a combined pause + allowlist edit.
      for (const change of lifecycleChanges) {
        await logActivity(db, {
          ...baseLog,
          details: {
            status: connection.status,
            enabled: connection.enabled,
          ...(req.body.agentInstructions !== undefined ? { agentInstructionsChanged: true, agentInstructionsEnabled: connection.agentInstructions?.enabled ?? false } : {}),
            lifecycle: change.lifecycle,
            ...change.details,
          },
        });
      }
    }
    res.json(connection);
  });

  router.delete("/tool-connections/:connectionId", managementGuard("connections:configure", "DELETE /tool-connections/:connectionId", { personal: true }), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    await assertToolConnectionConfigureAccess(req, existing);
    if (aiConnectionRouterPluginKey(existing)) throw badRequest("Remove this connection pool through its revision-checked pool settings.");
    const applicationBefore = await svc.getApplication(existing.applicationId);
    const { connection, removal } = await svc.archiveConnection(
      existing.id,
      existing.spaceId,
      connectionRequestActor(req),
    );
    const applicationAfter = await svc.getApplication(existing.applicationId);
    // The receipt is counts and outcomes only. Removal is a revocation boundary
    // (PAP-17119) and operators need to see what it tore down, but this row is
    // space-readable activity, so it never carries a secret name or value.
    await logActivity(db, {
      spaceId: connection.spaceId,
      ...connectionRequestActor(req),
      action: "tool_connection.archived",
      entityType: "tool_connection",
      entityId: connection.id,
      details: { transport: connection.transport, ...removal },
    });
    if (applicationBefore.status !== "archived" && applicationAfter.status === "archived") {
      await logActivity(db, {
        spaceId: applicationAfter.spaceId,
        ...connectionRequestActor(req),
        action: "tool_application.archived",
        entityType: "tool_application",
        entityId: applicationAfter.id,
        details: { type: applicationAfter.type, name: applicationAfter.name, reason: "last_connection_removed" },
      });
    }
    res.json({ ...connection, removal });
  });

  router.post("/tool-connections/:connectionId/health-check", managementGuard("connections:configure", "POST /tool-connections/:connectionId/health-check", { personal: true }), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    if (existing.credentialPolicy === "per_user") await assertToolConnectionAccess(req, existing);
    else await assertToolConnectionConfigureAccess(req, existing);
    res.json(await svc.checkHealth(existing.id, connectionRequestActor(req)));
  });

  router.post(
    "/tool-connections/:connectionId/reconnect", managementGuard("connections:configure", "POST /tool-connections/:connectionId/reconnect", { personal: true }),
    validate(reconnectToolAppSchema),
    async (req, res) => {
      const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
      if (!existing) return;
      await assertToolConnectionConfigureAccess(req, existing);
      const result = await svc.reconnectGalleryApp(
        existing.id,
        existing.spaceId,
        req.body,
        connectionRequestActor(req),
      );
      await logActivity(db, {
        spaceId: existing.spaceId,
        ...connectionRequestActor(req),
        action: "tool_app.reconnected",
        entityType: "tool_connection",
        entityId: existing.id,
        details: { healthStatus: result.connection.healthStatus },
      });
      res.json(result);
    },
  );

  router.post("/tool-connections/:connectionId/catalog/refresh", managementGuard("connections:configure", "POST /tool-connections/:connectionId/catalog/refresh", { personal: true }), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    await assertToolConnectionConfigureAccess(req, existing);
    const result = await svc.refreshCatalog(existing.id, connectionRequestActor(req));
    await logActivity(db, {
      spaceId: existing.spaceId,
      ...connectionRequestActor(req),
      action: "tool_connection.catalog_refresh",
      entityType: "tool_connection",
      entityId: existing.id,
      details: {
        discoveredCount: result.discoveredCount,
        quarantinedCount: result.quarantinedCount,
      },
    });
    res.json(result);
  });

  router.get("/tool-connections/:connectionId/catalog", managementGuard("connections:read", "GET /tool-connections/:connectionId/catalog", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    res.json({ catalog: await svc.listCatalog(existing.id, existing.spaceId, getActorInfo(req)) });
  });

  router.get("/tool-connections/:connectionId/activity", managementGuard("connections:audit", "GET /tool-connections/:connectionId/activity", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    res.json(await svc.listConnectionActivity(existing.id, existing.spaceId, limit, connectionRequestContext(req)));
  });

  router.get("/spaces/:spaceId/tools/profiles", managementGuard("connections:profiles", "GET /spaces/:spaceId/tools/profiles", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json({ profiles: await filterConnectionManagementRows(db, req, "connections:profiles", await svc.listProfiles(spaceId), row => ({ profileId: row.id })) });
  });

  router.get("/tool-connections/:connectionId/profile-configuration", managementGuard("connections:profiles", "GET /tool-connections/:connectionId/profile-configuration", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const existing = await getAccessibleResource(req, res, svc.getConnection(req.params.connectionId as string), "Tool connection not found");
    if (!existing) return;
    const profiles = await svc.listConnectionProfileConfiguration(existing.spaceId, existing.id,
      rows => filterConnectionManagementRows(db, req, "connections:profiles", rows, row => ({ profileId: row.id })));
    res.json({ profiles });
  });

  router.get("/tool-profiles/:profileId/new-tools", managementGuard("connections:profiles", "GET /tool-profiles/:profileId/new-tools", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const existing = await getAccessibleResource(req, res, svc.getProfile(req.params.profileId as string), "Tool profile not found");
    if (!existing) return;
    res.json(await svc.listProfileNewTools(existing.id, existing.spaceId));
  });

  router.post("/spaces/:spaceId/tools/profiles", managementGuard("connections:profiles", "POST /spaces/:spaceId/tools/profiles", { personal: true }), validate(createToolProfileWithEntriesSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    try {
      const profile = await svc.createProfile(spaceId, req.body, connectionRequestContext(req));
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_profile.created",
        entityType: "tool_profile",
        entityId: profile.id,
        details: { name: profile.name, entryCount: profile.entries.length },
      });
      res.status(201).json(profile);
    } catch (error) {
      svc.ensureNoDuplicateNameError(error);
    }
  });

  router.get("/spaces/:spaceId/tools/profiles/effective/agents/:agentId", managementGuard("connections:profiles", "GET /spaces/:spaceId/tools/profiles/effective/agents/:agentId", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const effective = await svc.getEffectiveProfilesForAgent(spaceId, req.params.agentId as string);
    const profiles = await filterConnectionManagementRows(db, req, "connections:profiles", effective.profiles, profile => ({ profileId: profile.id }));
    const connectionIds = [...new Set([...effective.allowedTools.map(tool => tool.connectionId), ...effective.installedConnections.map(connection => connection.id)])];
    const connections = await filterConnectionManagementRows(db, req, "connections:profiles", connectionIds, connectionId => ({ connectionId }));
    if (profiles.length !== effective.profiles.length || connections.length !== connectionIds.length) throw forbidden("Effective profile resources are unavailable to this delegated principal");
    res.json(effective);
  });

  router.patch("/tool-profiles/:profileId", managementGuard("connections:profiles", "PATCH /tool-profiles/:profileId", { personal: true }), validate(updateToolProfileWithEntriesSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getProfile(req.params.profileId as string), "Tool profile not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    try {
      const profile = await svc.updateProfile(existing.id, req.body, connectionRequestContext(req));
      await logActivity(db, {
        spaceId: profile.spaceId,
        ...connectionRequestActor(req),
        action: "tool_profile.updated",
        entityType: "tool_profile",
        entityId: profile.id,
        details: { status: profile.status, entryCount: profile.entries.length },
      });
      res.json(profile);
    } catch (error) {
      svc.ensureNoDuplicateNameError(error);
    }
  });

  router.post("/tool-profiles/:profileId/duplicate", managementGuard("connections:profiles", "POST /tool-profiles/:profileId/duplicate", { personal: true }), validate(duplicateToolProfileSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getProfile(req.params.profileId as string), "Tool profile not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    try {
      const profile = await svc.duplicateProfile(existing.id, req.body, connectionRequestContext(req));
      await logActivity(db, {
        spaceId: profile.spaceId,
        ...connectionRequestActor(req),
        action: "tool_profile.duplicated",
        entityType: "tool_profile",
        entityId: profile.id,
        details: {
          sourceProfileId: existing.id,
          name: profile.name,
          entryCount: profile.entries.length,
          assignmentCount: profile.summary.assignmentCount,
        },
      });
      res.status(201).json(profile);
    } catch (error) {
      svc.ensureNoDuplicateNameError(error);
    }
  });

  router.delete("/tool-profiles/:profileId", managementGuard("connections:profiles", "DELETE /tool-profiles/:profileId", { personal: true }), validate(deleteToolProfileSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getProfile(req.params.profileId as string), "Tool profile not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    const result = await svc.deleteProfile(existing.id, req.body, connectionRequestContext(req));
    await logActivity(db, {
      spaceId: existing.spaceId,
      ...connectionRequestActor(req),
      action: "tool_profile.deleted",
      entityType: "tool_profile",
      entityId: existing.id,
      details: {
        name: existing.name,
        summary: result.summary,
        reassignedToProfileId: result.reassignedToProfileId,
        reassignedBindingCount: result.reassignedBindingCount,
      },
    });
    res.json(result);
  });

  router.post("/tool-profiles/:profileId/new-tools/review", managementGuard("connections:profiles", "POST /tool-profiles/:profileId/new-tools/review", { personal: true }), validate(reviewToolProfileNewToolsSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getProfile(req.params.profileId as string), "Tool profile not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    const result = await svc.reviewProfileNewTools(existing.id, req.body, connectionRequestActor(req));
    await logActivity(db, {
      spaceId: existing.spaceId,
      ...connectionRequestActor(req),
      action: "tool_profile.new_tools_reviewed",
      entityType: "tool_profile",
      entityId: existing.id,
      details: {
        allowedCount: result.allowedCount,
        keptBlockedCount: result.keptBlockedCount,
        reviewedCatalogEntryIds: result.reviewedCatalogEntryIds,
      },
    });
    res.json(result);
  });

  router.post("/tool-profiles/:profileId/entries", managementGuard("connections:profiles", "POST /tool-profiles/:profileId/entries", { personal: true }), validate(createToolProfileEntryForProfileSchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getProfile(req.params.profileId as string), "Tool profile not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    const entry = await svc.addProfileEntry(existing.id, req.body, connectionRequestContext(req));
    await logActivity(db, {
      spaceId: entry.spaceId,
      ...connectionRequestActor(req),
      action: "tool_profile_entry.created",
      entityType: "tool_profile_entry",
      entityId: entry.id,
      details: { profileId: entry.profileId, selectorType: entry.selectorType, effect: entry.effect },
    });
    res.status(201).json(entry);
  });

  router.patch("/tool-profile-entries/:entryId", managementGuard("connections:profiles", "PATCH /tool-profile-entries/:entryId", { personal: true }), validate(updateToolProfileEntrySchema), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getProfileEntry(req.params.entryId as string), "Tool profile entry not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    const entry = await svc.updateProfileEntry(existing.id, req.body, connectionRequestContext(req));
    await logActivity(db, {
      spaceId: entry.spaceId,
      ...connectionRequestActor(req),
      action: "tool_profile_entry.updated",
      entityType: "tool_profile_entry",
      entityId: entry.id,
      details: { profileId: entry.profileId, selectorType: entry.selectorType, effect: entry.effect },
    });
    res.json(entry);
  });

  router.delete("/tool-profile-entries/:entryId", managementGuard("connections:profiles", "DELETE /tool-profile-entries/:entryId", { personal: true }), async (req, res) => {
    const existing = await getAccessibleResource(req, res, svc.getProfileEntry(req.params.entryId as string), "Tool profile entry not found");
    if (!existing) return;
    assertToolAppMutationAccess(req, existing.spaceId);
    const entry = await svc.deleteProfileEntry(existing.id, connectionRequestContext(req));
    await logActivity(db, {
      spaceId: entry.spaceId,
      ...connectionRequestActor(req),
      action: "tool_profile_entry.deleted",
      entityType: "tool_profile_entry",
      entityId: entry.id,
      details: { profileId: entry.profileId },
    });
    res.json(entry);
  });

  router.post(
    "/spaces/:spaceId/tools/profiles/:profileId/bind", managementGuard("connections:profiles", "POST /spaces/:spaceId/tools/profiles/:profileId/bind", { personal: true }),
    validate(createToolProfileBindingForProfileSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertToolAppMutationAccess(req, spaceId);
      const existing = await svc.getProfile(req.params.profileId as string, spaceId);
      try {
        const binding = await svc.bindProfile(existing.id, req.body, connectionRequestActor(req));
        await logActivity(db, {
          spaceId,
          ...connectionRequestActor(req),
          action: "tool_profile_binding.created",
          entityType: "tool_profile_binding",
          entityId: binding.id,
          details: { profileId: binding.profileId, targetType: binding.targetType, targetId: binding.targetId },
        });
        res.status(201).json(binding);
      } catch (error) {
        svc.ensureNoDuplicateNameError(error);
      }
    },
  );

  router.post(
    "/spaces/:spaceId/tools/profiles/:profileId/unbind", managementGuard("connections:profiles", "POST /spaces/:spaceId/tools/profiles/:profileId/unbind", { personal: true }),
    validate(unbindToolProfileBindingSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertToolAppMutationAccess(req, spaceId);
      const existing = await svc.getProfile(req.params.profileId as string, spaceId);
      const result = await svc.unbindProfile(existing.id, req.body, connectionRequestContext(req));
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_profile_binding.deleted",
        entityType: "tool_profile",
        entityId: existing.id,
        details: { targetType: req.body.targetType, targetId: req.body.targetId, unbound: result.unbound },
      });
      res.json(result);
    },
  );

  router.get("/spaces/:spaceId/tools/runtime-slots", managementGuard("connections:runtime", "GET /spaces/:spaceId/tools/runtime-slots", { personal: true }), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertToolsRuntimeManage(req, spaceId);
    res.json({ runtimeSlots: await filterConnectionManagementRows(db, req, "connections:runtime", await svc.listRuntimeSlots(spaceId), row => ({ connectionId: row.connectionId, issueId: row.issueId })) });
  });

  router.post("/spaces/:spaceId/tools/runtime-slots/:id/stop", managementGuard("connections:runtime", "POST /spaces/:spaceId/tools/runtime-slots/:id/stop", { personal: true }), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertToolsRuntimeManage(req, spaceId);
    res.json(await svc.stopRuntimeSlot(spaceId, req.params.id as string, connectionRequestActor(req)));
  });

  router.post("/spaces/:spaceId/tools/runtime-slots/:id/restart", managementGuard("connections:runtime", "POST /spaces/:spaceId/tools/runtime-slots/:id/restart", { personal: true }), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertToolsRuntimeManage(req, spaceId);
    res.json(await svc.restartRuntimeSlot(spaceId, req.params.id as string, connectionRequestActor(req)));
  });

  router.get("/spaces/:spaceId/tools/runtime-health", managementGuard("connections:runtime", "GET /spaces/:spaceId/tools/runtime-health", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json(await svc.getRuntimeHealth(spaceId));
  });

  router.get("/spaces/:spaceId/tools/runs/:runId/decisions", managementGuard("connections:audit", "GET /spaces/:spaceId/tools/runs/:runId/decisions", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const result = await svc.getRunDecisionLookup(spaceId, req.params.runId as string);
    res.json({ ...result, decisions: await filterConnectionManagementRows(db, req, "connections:audit", result.decisions, row => ({ connectionId: row.invocation.connectionId, issueId: row.invocation.issueId })) });
  });

  router.get("/spaces/:spaceId/tools/trust-rules", managementGuard("connections:profiles", "GET /spaces/:spaceId/tools/trust-rules", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json({ trustRules: await filterConnectionManagementPolicies(db, req, await policySvc.listTrustRules(spaceId)) });
  });

  router.get("/spaces/:spaceId/tools/policies", managementGuard("connections:profiles", "GET /spaces/:spaceId/tools/policies", { personal: true }), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    res.json({ policies: await filterConnectionManagementPolicies(db, req, await policySvc.listPolicies(spaceId)) });
  });

  // Rules UI sentence slots map exactly onto policy selectors:
  // capability -> riskLevel, app -> applicationId, actions -> toolNames.
  router.post("/spaces/:spaceId/tools/policies/reorder", managementGuard("connections:profiles", "POST /spaces/:spaceId/tools/policies/reorder", { personal: true }), validate(reorderToolPoliciesSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    const policies = await policySvc.reorderPolicies(spaceId, req.body, connectionRequestContext(req));
    await logActivity(db, {
      spaceId,
      ...connectionRequestActor(req),
      action: "tool_policy.reordered",
      entityType: "tool_policy",
      entityId: spaceId,
      details: {
        policyIds: req.body.policyIds,
        priorityStep: 100,
      },
    });
    res.json({ policies });
  });

  router.post("/spaces/:spaceId/tools/policies", managementGuard("connections:profiles", "POST /spaces/:spaceId/tools/policies", { personal: true }), validate(createToolPolicySchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    try {
      const policy = await policySvc.createPolicy(spaceId, req.body, { userId: connectionRequestUserId(req) ?? null, agentId: req.actor.agentId ?? null }, connectionRequestContext(req));
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_policy.created",
        entityType: "tool_policy",
        entityId: policy.id,
        details: { name: policy.name, policyType: policy.policyType, priority: policy.priority },
      });
      res.status(201).json(policy);
    } catch (error) {
      policySvc.ensureNoDuplicatePolicyNameError(error);
    }
  });

  router.post("/spaces/:spaceId/tools/policies/:policyId/duplicate", managementGuard("connections:profiles", "POST /spaces/:spaceId/tools/policies/:policyId/duplicate", { personal: true }), validate(duplicateToolPolicySchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    try {
      const policy = await policySvc.duplicatePolicy({
        spaceId,
        managementContext: connectionRequestContext(req),
        policyId: req.params.policyId as string,
        body: req.body,
        actor: { userId: connectionRequestUserId(req) ?? null, agentId: req.actor.agentId ?? null },
      });
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_policy.duplicated",
        entityType: "tool_policy",
        entityId: policy.id,
        details: {
          sourcePolicyId: req.params.policyId,
          name: policy.name,
          enabled: policy.enabled,
          priority: policy.priority,
        },
      });
      res.status(201).json(policy);
    } catch (error) {
      policySvc.ensureNoDuplicatePolicyNameError(error);
    }
  });

  router.patch("/spaces/:spaceId/tools/policies/:policyId", managementGuard("connections:profiles", "PATCH /spaces/:spaceId/tools/policies/:policyId", { personal: true }), validate(updateToolPolicySchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    try {
      const policy = await policySvc.updatePolicy({
        spaceId,
        managementContext: connectionRequestContext(req),
        policyId: req.params.policyId as string,
        body: req.body,
      });
      await logActivity(db, {
        spaceId,
        ...connectionRequestActor(req),
        action: "tool_policy.updated",
        entityType: "tool_policy",
        entityId: policy.id,
        details: { name: policy.name, policyType: policy.policyType, enabled: policy.enabled, priority: policy.priority },
      });
      res.json(policy);
    } catch (error) {
      policySvc.ensureNoDuplicatePolicyNameError(error);
    }
  });

  router.delete("/spaces/:spaceId/tools/policies/:policyId", managementGuard("connections:profiles", "DELETE /spaces/:spaceId/tools/policies/:policyId", { personal: true }), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    const policy = await policySvc.deletePolicy({
      spaceId,
        managementContext: connectionRequestContext(req),
      policyId: req.params.policyId as string,
    });
    await logActivity(db, {
      spaceId,
      ...connectionRequestActor(req),
      action: "tool_policy.deleted",
      entityType: "tool_policy",
      entityId: policy.id,
      details: { name: policy.name, policyType: policy.policyType },
    });
    res.json(policy);
  });

  router.post(
    "/spaces/:spaceId/tools/action-requests/:actionRequestId/trust-rule",
    validate(createToolTrustRuleFromActionRequestSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertToolAppMutationAccess(req, spaceId);
      const policy = await policySvc.createTrustRuleFromActionRequest({
        spaceId,
        actionRequestId: req.params.actionRequestId as string,
        body: req.body,
        actor: { userId: req.actor.userId ?? null },
      });
      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "tool_trust_rule.created",
        entityType: "tool_policy",
        entityId: policy.id,
        details: {
          name: policy.name,
          selectors: policy.selectors,
          sourceActionRequestId: req.params.actionRequestId,
        },
      });
      res.status(201).json(policy);
    },
  );

  router.post("/spaces/:spaceId/tools/trust-rules/:policyId/revoke", managementGuard("connections:profiles", "POST /spaces/:spaceId/tools/trust-rules/:policyId/revoke", { personal: true }), validate(revokeToolTrustRuleSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertToolAppMutationAccess(req, spaceId);
    const policy = await policySvc.revokeTrustRule({
      spaceId,
      policyId: req.params.policyId as string,
      body: req.body,
      actor: { userId: connectionRequestUserId(req) ?? null, agentId: req.actor.agentId ?? null },
    });
    await logActivity(db, {
      spaceId,
      ...connectionRequestActor(req),
      action: "tool_trust_rule.revoked",
      entityType: "tool_policy",
      entityId: policy.id,
      details: { reason: req.body.reason ?? null },
    });
    res.json(policy);
  });

  router.get("/spaces/:spaceId/tools/stdio-templates", managementGuard("connections:read", "GET /spaces/:spaceId/tools/stdio-templates"), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertToolsAdmin(req, spaceId);
    res.json({ templates: await svc.approvedStdioTemplates(spaceId) });
  });

  router.post("/spaces/:spaceId/tools/stdio-templates", validate(createToolStdioCommandTemplateSchema), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertToolsAdmin(req, spaceId);
    const template = await svc.createStdioCommandTemplate(spaceId, req.body, getActorInfo(req));
    await logActivity(db, {
      spaceId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "tool_stdio_command_template.created",
      entityType: "tool_stdio_command_template",
      entityId: template.id ?? template.templateId,
      details: {
        templateId: template.templateId,
        command: template.command,
        argCount: template.args.length,
        envKeyCount: template.envKeys.length,
        toolCount: template.tools.length,
      },
    });
    res.status(201).json(template);
  });

  router.post(
    "/spaces/:spaceId/tools/stdio-templates/:templateId/disable",
    validate(disableToolStdioCommandTemplateSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertToolsAdmin(req, spaceId);
      const template = await svc.disableStdioCommandTemplate(spaceId, req.params.templateId as string);
      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "tool_stdio_command_template.disabled",
        entityType: "tool_stdio_command_template",
        entityId: template.id ?? template.templateId,
        details: { templateId: template.templateId, reason: req.body.reason ?? null },
      });
      res.json(template);
    },
  );

  router.post("/spaces/:spaceId/tools/mcp/import-json", validate(importMcpJsonSchema), async (req, res) => {
    assertOperator(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const preview = await svc.previewMcpJsonImport(req.body);
    await logActivity(db, {
      spaceId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "tool_connection.import_mcp_json_previewed",
      entityType: "tool_connection_import",
      entityId: spaceId,
      details: { draftCount: preview.drafts.length },
    });
    res.json(preview);
  });

  router.post("/spaces/:spaceId/tools/policy/test", managementGuard("connections:configure", "POST /spaces/:spaceId/tools/policy/test", { personal: true }), validate(toolPolicyTestRequestSchema), async (req, res) => {
    assertOperatorOrAgent(req);
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const input = { ...req.body, spaceId,
      ...(req.actor.type === "agent" ? { actorType: "agent", actorId: req.actor.agentId } : {}) };
    const decision = await policySvc.decide(input);
    let auditEvent = null;
    if (input.writeAuditEvent === true) {
      auditEvent = await policySvc.writeAudit(input, decision);
    }
    res.json({ decision, auditEvent });
  });

  return router;
}
