import type { AiConnectionBinding, AiConnectionList } from "../../../packages/shared/src/ai-connections.js";
import type { ConnectionGrantsResponse, ToolConnectionInstall } from "../../../packages/shared/src/types/tool-access.js";

export const NEW_SPACE_NATIVE_MODEL = "openrouter/deepseek/deepseek-v4.1-flash-1017";
export const NEW_SPACE_PROVIDER_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export interface NativeSpace { id: string; name: string; issuePrefix: string; defaultResponsibleUserId?: string | null }
export interface NativeFirstAgent {
  id: string; spaceId: string; name: string; role: string; adapterType: string;
  adapterConfig: Record<string, unknown>; runtimeConfig: { aiConnection?: AiConnectionBinding; heartbeat?: { enabled?: boolean } };
  defaultEnvironmentId?: string | null; lifecycleState: string; status: string;
}
export interface NativeSetupRequest {
  spaceId: string; agentId: string; environmentId: string; adapterType: string; provider: string; model: string; sequence: number;
  binding?: AiConnectionBinding; containsCredential: boolean;
}
export interface NativeSetupProbe extends NativeSetupRequest {
  httpStatus: number; resultAdapterType: string; status: string; checks: Array<{ code: string; level: string }>;
}
export interface NewSpaceNativeReceipt {
  spaceId: string; spacePrefix: string; firstAgentId: string; spaceName: string; agentName: string;
  requestedHarness: "opencode_local"; actualHarness: "opencode_local"; model: string;
  environmentId: string; environmentDriver: "local"; actualProbeEnvironmentId: string;
  beforeSpaceIds: string[]; afterSpaceIds: string[]; beforeReadyAgents: number; afterAgentIds: string[];
  noAgentBeforeRouteDeparture: true; publicSetupRoute: string; savedSetupAgentId: string;
  hello: NativeSetupProbe; helloCount: number; hiredThroughPublicSetup: true; hireCount: number;
  firstAgentReady: true; chatComposerVisible: true; heartbeatRunIds: string[]; readyConversationPath: string;
  account: { id: string; grantId: string; provider: "openrouter"; method: "api_key"; status: "connected"; ownership: "personal"; ownerUserId: string; currentUserId: string; responsibleUserId: string; bindingMode: "delegated" };
  exactPublicGrantAndAgentInstall: true; draftContainsCredential: boolean; publicAgentContainsCredential: boolean;
  verificationKind: "public-native-hello-probe"; firstWorkExecuted: false; probeUsage: "unavailable-outside-heartbeat-accounting";
}
export function nativeSetupRequest(input: { spaceId: string; adapterType: string; body: unknown; sequence: number }, credential: string): NativeSetupRequest {
  const body = input.body as Record<string, unknown>; const config = body?.adapterConfig as Record<string, unknown> | undefined;
  return { spaceId: input.spaceId, adapterType: input.adapterType, sequence: input.sequence,
    agentId: typeof body?.agentId === "string" ? body.agentId : typeof body?.setupAgentId === "string" ? body.setupAgentId : "",
    environmentId: typeof body?.environmentId === "string" ? body.environmentId : typeof body?.defaultEnvironmentId === "string" ? body.defaultEnvironmentId : "",
    provider: typeof config?.provider === "string" ? config.provider : "", model: typeof config?.model === "string" ? config.model : "",
    binding: (body?.aiConnection ?? (body?.runtimeConfig as { aiConnection?: AiConnectionBinding } | undefined)?.aiConnection) as AiConnectionBinding | undefined,
    containsCredential: Boolean(credential && JSON.stringify(input.body).includes(credential)) };
}
export function requireNativeFirstAgentProof(input: {
  space: NativeSpace; agent: NativeFirstAgent; humanId: string; environment: { id: string; driver: string };
  savedSetupAgentId: string; probes: NativeSetupProbe[]; hires: Array<NativeSetupRequest & { httpStatus: number; resultAgentId: string }>;
  connection: { connectionId: string; grantId: string }; accounts: AiConnectionList;
  grants: ConnectionGrantsResponse; installs: ToolConnectionInstall[];
}): void {
  const { space, agent, humanId, environment, savedSetupAgentId, probes, hires, connection, accounts, grants, installs } = input;
  const binding = agent.runtimeConfig.aiConnection;
  const matches = (request: NativeSetupRequest) => request.spaceId === space.id && request.agentId === savedSetupAgentId
    && request.environmentId === environment.id && request.adapterType === "outpost_runner" && request.provider === "opencode"
    && request.model === NEW_SPACE_NATIVE_MODEL && request.containsCredential === false
    && request.binding?.provider === "openrouter" && request.binding.method === "api_key" && request.binding.mode === "delegated"
    && request.binding.connectionId === connection.connectionId && request.binding.grantId === connection.grantId;
  if (environment.driver !== "local" || !environment.id || probes.length !== 1 || hires.length !== 1
    || !matches(probes[0]!) || probes[0]!.httpStatus !== 200 || probes[0]!.resultAdapterType !== "outpost_runner" || probes[0]!.status !== "pass"
    || probes[0]!.checks.some(check => check.level === "error") || !probes[0]!.checks.some(check => check.code === "opencode_hello_probe_passed")
    || !Number.isInteger(probes[0]!.sequence) || probes[0]!.sequence < 1 || !Number.isInteger(hires[0]!.sequence) || probes[0]!.sequence >= hires[0]!.sequence
    || !matches(hires[0]!) || hires[0]!.httpStatus < 200 || hires[0]!.httpStatus >= 300 || hires[0]!.resultAgentId !== savedSetupAgentId)
    throw new Error("New space requires one current same-agent native OpenCode account/model/local-target test and hire");
  if (agent.id !== savedSetupAgentId || agent.spaceId !== space.id || agent.role !== "ceo" || agent.adapterType !== "outpost_runner"
    || agent.adapterConfig.provider !== "opencode" || agent.adapterConfig.model !== NEW_SPACE_NATIVE_MODEL
    || agent.defaultEnvironmentId !== environment.id || agent.lifecycleState !== "ready" || !["idle", "active"].includes(agent.status)
    || agent.runtimeConfig.heartbeat?.enabled !== false
    || binding?.provider !== "openrouter" || binding.method !== "api_key" || binding.mode !== "delegated"
    || binding.connectionId !== connection.connectionId || binding.grantId !== connection.grantId
    || space.defaultResponsibleUserId !== humanId || accounts.currentUserId !== humanId)
    throw new Error("New space public first-agent identity/configuration differs from the tested setup");
  const account = accounts.connections.find(row => row.id === connection.connectionId && row.grantId === connection.grantId);
  const grant = grants.grants.find(row => row.id === connection.grantId);
  if (!account || account.spaceId !== space.id || account.provider !== "openrouter" || account.method !== "api_key"
    || account.status !== "connected" || account.ownership !== "personal" || account.ownerUserId !== humanId
    || account.routing?.kind !== "openrouter" || account.routing.protocol !== "chat" || account.routing.auth !== "bearer"
    || account.routing.models.length !== 1 || account.routing.models[0]?.id !== NEW_SPACE_PROVIDER_MODEL
    || grants.connection.id !== connection.connectionId || grants.currentUserId !== humanId || grant?.connectionId !== connection.connectionId
    || grant.spaceId !== space.id || grant.kind !== "user" || grant.subjectUserId !== humanId || grant.status !== "active"
    || installs.length !== 1 || installs[0]?.spaceId !== space.id || installs[0]?.connectionId !== connection.connectionId
    || installs[0]?.targetType !== "agent" || installs[0]?.targetId !== agent.id)
    throw new Error("New space account requires its actual personal grant and exact first-agent public installation");
}
