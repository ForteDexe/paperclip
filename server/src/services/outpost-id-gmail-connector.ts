/**
 * @deprecated Outpost ID is identity-only. Import the Outpost Cloud
 * connector names from `outpost-cloud-connector.ts` for new code.
 *
 * These aliases keep source compatibility while deployments and persisted app
 * definitions move from the former Outpost ID broker prototype.
 */
export {
  GMAIL_CONNECTOR_SCOPES,
  GMAIL_MCP_URL,
  GOOGLE_WORKSPACE_CONNECTOR_PROFILES,
  OutpostCloudConnectorError as OutpostIdConnectorError,
  createOutpostCloudConnector as createOutpostIdGmailConnector,
  outpostCloudConnectorCapabilitiesFromEnv as outpostIdGoogleConnectorCapabilitiesFromEnv,
  outpostCloudConnectorConfigFromEnv as outpostIdGmailConnectorConfigFromEnv,
} from "./outpost-cloud-connector.js";

export type {
  OutpostCloudConnector as OutpostIdGmailConnector,
  OutpostCloudConnector as OutpostIdGoogleWorkspaceConnector,
  OutpostCloudConnectorConfig as OutpostIdGmailConnectorConfig,
  OutpostCloudConnectorEnvironment as OutpostIdConnectorEnvironment,
  OutpostCloudConnectorOperation as OutpostIdConnectorOperation,
  SealedGmailCredentials,
  SealedGoogleWorkspaceCredentials,
} from "./outpost-cloud-connector.js";
