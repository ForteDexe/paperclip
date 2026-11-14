import {
  outpostCloudConnectorEnrollmentStatus,
  type OutpostCloudConnectorEnrollmentStatus,
} from "./outpost-cloud-connector-enrollment.js";
import {
  createOutpostCloudConnector,
  outpostCloudConnectorConfigFromEnv,
} from "./outpost-cloud-connector.js";

export async function reconcileOutpostCloudConnectorEnrollmentStatus(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<OutpostCloudConnectorEnrollmentStatus> {
  const local = outpostCloudConnectorEnrollmentStatus(env);
  if (!local.configured) return local;
  const config = outpostCloudConnectorConfigFromEnv(env);
  if (!config) return { ...local, configured: false, status: "not_configured" };
  try {
    const status = await createOutpostCloudConnector({ config, request }).getInstanceStatus();
    if (status === "active") return { ...local, configured: true, status: "active" };
    if (status === "suspended") return { ...local, configured: false, status: "suspended" };
    return { ...local, configured: false, status: "not_configured" };
  } catch {
    return { ...local, configured: false, status: "unverified" };
  }
}
