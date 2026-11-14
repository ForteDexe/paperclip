import type { RunnerApi } from "../api.js";
import type {
  ToolConnection,
  ToolApplication,
  ToolProfileEffectiveSummary,
} from "../../../packages/shared/src/types/tool-access.js";
import { scoreConnectionSearch } from "../../../packages/shared/src/connection-search.js";

export const SYNTHETIC_NOTION_NAME = "Notion (synthetic notes app)";
const SYNTHETIC_NOTION_DESCRIPTION =
  "Notion is the display alias for this controlled synthetic notes app and its synthetic launch page. This is an owned loopback test implementation, not the official Notion provider.";

export function ownedSyntheticConnection(
  connection: ToolConnection,
  spaceId: string,
  providerURL: string,
) {
  try {
    const provider = new URL(providerURL),
      saved = new URL(String(connection.config?.url));
    return (
      connection.spaceId === spaceId &&
      connection.transport === "mcp_remote" &&
      connection.status === "active" &&
      connection.enabled === true &&
      provider.protocol === "http:" &&
      provider.hostname === "127.0.0.1" &&
      saved.href === provider.href &&
      !connection.config?.sourceTemplateKey &&
      !connection.transportConfig?.sourceTemplateKey
    );
  } catch {
    return false;
  }
}

/** The arbitrary-server wizard deliberately defaults to no new-action quarantine.
 * Establish the frozen scenario's different prerequisite through its supported
 * public connection configuration, before changing the real provider catalog. */
export async function enableOwnedCatalogQuarantine(
  api: RunnerApi,
  connectionId: string,
  spaceId: string,
  providerURL: string,
) {
  const before = await api.get<ToolConnection>(
    `/api/tool-connections/${connectionId}`,
  );
  if (!ownedSyntheticConnection(before, spaceId, providerURL))
    throw new Error(
      "Quarantine prerequisite requires the actual active owned synthetic connection",
    );
  await api.patch(`/api/tool-connections/${connectionId}`, {
    config: { ...before.config, quarantineNewEntries: true },
  });
  const after = await api.get<ToolConnection>(
    `/api/tool-connections/${connectionId}`,
  );
  if (
    !ownedSyntheticConnection(after, spaceId, providerURL) ||
    after.config?.quarantineNewEntries !== true ||
    after.transportConfig?.quarantineNewEntries !== true
  )
    throw new Error(
      "Public configuration did not persist new-action quarantine before catalog discovery",
    );
  return after;
}

/** Independent public installed/effective-access inventory plus the exact
 * product discovery scorer. Runtime search requires an already-running native
 * capability, so this setup probe does not forge one or admit a setup run. */
export function syntheticNotionBinding(
  connection: ToolConnection,
  application: ToolApplication,
  effective: ToolProfileEffectiveSummary,
  target: {
    spaceId: string;
    agentId: string;
    providerURL: string;
    readId: string;
    writeId: string;
  },
) {
  return (
    ownedSyntheticConnection(
      connection,
      target.spaceId,
      target.providerURL,
    ) &&
    connection.name === SYNTHETIC_NOTION_NAME &&
    application.id === connection.applicationId &&
    application.spaceId === target.spaceId &&
    !application.metadata?.sourceTemplateKey &&
    application.description === SYNTHETIC_NOTION_DESCRIPTION &&
    effective.agentId === target.agentId &&
    effective.installedConnections.some(
      (c) =>
        c.id === connection.id &&
        c.name === SYNTHETIC_NOTION_NAME &&
        c.spaceId === target.spaceId,
    ) &&
    effective.allowedTools.some(
      (t) =>
        t.id === target.readId &&
        t.connectionId === connection.id &&
        t.toolName === "launch_read",
    ) &&
    !effective.allowedTools.some(
      (t) =>
        t.id === target.writeId ||
        (t.connectionId === connection.id && t.toolName === "launch_update"),
    ) &&
    scoreConnectionSearch("Notion", [connection.name], application.description)
      .nameScore > 0 &&
    scoreConnectionSearch(
      "Notion workspace access to find and update the launch page",
      [connection.name],
      application.description,
    ).score > 0
  );
}

export async function prepareSyntheticNotionAlias(
  api: RunnerApi,
  connectionId: string,
) {
  const connection = await api.get<ToolConnection>(
    `/api/tool-connections/${connectionId}`,
  );
  await api.patch(`/api/tool-connections/${connectionId}`, {
    name: SYNTHETIC_NOTION_NAME,
  });
  await api.patch(`/api/tool-applications/${connection.applicationId}`, {
    description: SYNTHETIC_NOTION_DESCRIPTION,
  });
}

export async function observeSyntheticNotionBinding(
  api: RunnerApi,
  connectionId: string,
  target: {
    spaceId: string;
    agentId: string;
    providerURL: string;
    readId: string;
    writeId: string;
  },
) {
  const connection = await api.get<ToolConnection>(
    `/api/tool-connections/${connectionId}`,
  );
  const [applications, effective] = await Promise.all([
    api.get<{ applications: ToolApplication[] }>(
      `/api/spaces/${target.spaceId}/tools/applications`,
    ),
    api.get<ToolProfileEffectiveSummary>(
      `/api/spaces/${target.spaceId}/tools/profiles/effective/agents/${target.agentId}`,
    ),
  ]);
  const application = applications.applications.find(
    (a) => a.id === connection.applicationId,
  );
  if (!application)
    throw new Error(
      "Actual synthetic application was not returned by the space-scoped public application inventory",
    );
  return {
    matched: syntheticNotionBinding(connection, application, effective, target),
    connectionName: connection.name,
    configuredService: `connection:${connection.id}`,
    providerKind: "owned-synthetic-notes",
    readId: target.readId,
    writeId: target.writeId,
    discoveryProbe:
      "public-effective-inventory-and-product-search-scorer; no pre-query runtime capability",
  };
}
