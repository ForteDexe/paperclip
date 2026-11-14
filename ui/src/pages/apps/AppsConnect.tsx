import { describeError } from "@/api/errors";
import { useQuery } from "@tanstack/react-query";
import { aiConnectionsApi } from "@/api/ai-connections";
import { AiConnectionCredentialStep } from "@/components/ai-connections/AiConnectionCredentialStep";
import { AiProviderSetup } from "@/components/ai-connections/AiProviderSetup";
import { AiConnectionPoolConnector } from "@/components/ai-connections/AiConnectionPoolConnector";
import { useEffect } from "react";
import { isRetiredComposioConnection } from "@outpost/shared";
import { findComposioCatalogApp } from "@outpost/shared/aggregator-app-catalog";
import { toolsApi } from "@/api/tools";
import { queryKeys } from "@/lib/queryKeys";
import { QueryErrorState, useQueryView } from "@/components/QueryView";
import { Button } from "@/components/ui/button";
import { ConnectionSetupFlow } from "@/features/connections/ConnectionSetupFlow";
import { aiProviderSetupPreset, type ToolConnectionCredentialSource } from "@outpost/shared";
import { useSpace } from "@/context/SpaceContext";
import { useNavigate, useParams, useSearchParams } from "@/lib/router";
import { consumeSkillSourceReturn, skillSourceReturnPath } from "@/lib/skill-source-connect-return";

export { AccessStep, OAuthConnectStateScreen, type OAuthConnectPhase } from "@/features/connections/ConnectionSetupFlow";

/** Full-page host for the same setup used by inline connection requests. */
export function AppsConnect({ byoOnly = false, credentialSource = "outpost_vault" }: {
  byoOnly?: boolean;
  credentialSource?: ToolConnectionCredentialSource;
} = {}) {
  const { selectedSpaceId } = useSpace();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { appKey } = useParams<{ appKey?: string }>();
  const source = searchParams.get("source") ?? appKey ?? searchParams.get("appKey");
  const reconnectId = searchParams.get("reconnect");
  const aiLoginId = searchParams.get("aiLogin");
  const login = useQuery({ queryKey: ["ai-login-setup", selectedSpaceId, aiLoginId],
    queryFn: () => aiConnectionsApi.loginSetup(selectedSpaceId!, aiLoginId!), enabled: Boolean(selectedSpaceId && aiLoginId) });
  const loginView = useQueryView(login);
  const preset = aiProviderSetupPreset(source);
  const aiReconnectRequested = Boolean(reconnectId && (preset || ["openai", "anthropic", "xai"].includes(source ?? "")));
  const aiAccounts = useQuery({ queryKey: ["ai-connections", selectedSpaceId], queryFn: () => aiConnectionsApi.list(selectedSpaceId!), enabled: Boolean(selectedSpaceId && aiReconnectRequested) });
  const aiAccountsView = useQueryView(aiAccounts);
  const aiReconnect = aiAccounts.data?.connections.find(c => c.id === reconnectId);
  const gallery = useQuery({ queryKey: queryKeys.apps.gallery(selectedSpaceId ?? "__none__"), queryFn: () => toolsApi.listGallery(selectedSpaceId!), enabled: !!selectedSpaceId && !!source?.startsWith("ai-router-") });
  const galleryView = useQueryView(gallery);
  const router = gallery.data?.apps.find(app => app.slug === source)?.aiConnectionRouter;
  const toolkit = searchParams.get("targetToolkit");
  const reuseComposio = source === "composio" && Boolean(toolkit && findComposioCatalogApp(toolkit))
    && searchParams.get("new") !== "1" && !searchParams.get("resume") && !searchParams.get("reconnect")
    && !byoOnly && credentialSource === "outpost_vault";
  const saved = useQuery({ queryKey: queryKeys.tools.connections(selectedSpaceId ?? "__none__"),
    queryFn: () => toolsApi.listConnections(selectedSpaceId!), enabled: reuseComposio && Boolean(selectedSpaceId) });
  const savedView = useQueryView(saved);
  const hasSavedComposio = reuseComposio && saved.data?.connections.some(connection =>
    connection.config?.sourceTemplateKey === "composio" && connection.transport === "mcp_remote"
    && connection.status === "active" && connection.enabled && !isRetiredComposioConnection(connection));
  useEffect(() => {
    if (hasSavedComposio) navigate(`/apps?source=composio&targetToolkit=${encodeURIComponent(toolkit!)}`, { replace: true });
  }, [hasSavedComposio, toolkit, navigate]);
  if (reuseComposio && selectedSpaceId && (saved.isPending || savedView.kind === "reconnecting" || hasSavedComposio)) return <p role="status" className="text-sm text-muted-foreground">Checking saved Composio accounts…</p>;
  if (reuseComposio && savedView.kind === "error") return <div className="space-y-3">
    <QueryErrorState error={saved.error} action="load your Composio accounts" onRetry={savedView.retry} retrying={savedView.isFetching} />
    <Button variant="ghost" onClick={() => navigate("/apps")}>Cancel</Button>
  </div>;
  const returningToSkills = source === "github" && selectedSpaceId && skillSourceReturnPath(selectedSpaceId);
  function returnToSkills() {
    const path = selectedSpaceId && consumeSkillSourceReturn(selectedSpaceId);
    if (path) navigate(path);
  }
  if (aiLoginId && selectedSpaceId) {
    if (loginView.kind === "loading" || loginView.kind === "reconnecting") return <p role="status">Loading saved sign-in…</p>;
    if (!login.data) return <p role="alert">{login.error ? describeError(login.error).body : "This sign-in is unavailable."}</p>;
    const { intent, environmentId, connectionId, grantId } = login.data;
    if (connectionId && grantId) return <div className="space-y-4"><p role="status">This account is connected.</p><Button onClick={() => navigate(`/apps/${connectionId}/permissions`)}>View connection</Button></div>;
    return <AiConnectionCredentialStep key={aiLoginId} spaceId={selectedSpaceId} {...intent}
      agentIds={intent.agentIds ?? []} allAgents={intent.allAgents ?? false} initialMethod={intent.method} fixedMethod
      environmentId={environmentId} hideName onCancel={() => navigate("/apps")}
      onComplete={binding => navigate(`/apps/${binding.connectionId}/permissions`)} />;
  }
  if (aiReconnectRequested && (aiAccountsView.kind === "loading" || aiAccountsView.kind === "reconnecting")) return <p role="status">Loading connection…</p>;
  if (aiReconnectRequested && aiAccountsView.kind === "error") return <p role="alert">Could not load this connection. Refresh to try again.</p>;
  if (aiReconnectRequested && !aiReconnect) return <p role="alert">This connection is unavailable. Return to Connectors to choose an account.</p>;
  if (selectedSpaceId && (preset || aiReconnect?.routing)) return (
    <AiProviderSetup
      key={reconnectId ?? source}
      spaceId={selectedSpaceId}
      reconnect={aiReconnect}
      initialProvider={preset?.provider}
      initialProtocol={preset?.protocol}
      providerLabel={preset?.label}
      onCancel={() => navigate("/apps")}
      onComplete={binding => navigate(`/apps/${binding.connectionId}/permissions`)}
    />
  );
  if (source?.startsWith("ai-router-")) {
    if (gallery.isPending || galleryView.kind === "reconnecting") return <p role="status">Loading connector…</p>;
    if (galleryView.kind === "error") return <QueryErrorState error={gallery.error} action="load the connector" onRetry={galleryView.retry} retrying={galleryView.isFetching} />;
    if (!router) return <p role="alert">This connection pool plugin is unavailable. Enable it in Plugins.</p>;
    return <AiConnectionPoolConnector pluginKey={router.pluginKey} />;
  }
  return <ConnectionSetupFlow byoOnly={byoOnly} credentialSource={credentialSource} host="page"
    onComplete={returningToSkills ? returnToSkills : undefined}
    onCancel={returningToSkills ? returnToSkills : undefined} />;
}
