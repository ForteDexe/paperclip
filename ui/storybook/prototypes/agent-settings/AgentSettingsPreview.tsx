import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Star } from "lucide-react";
import {
  AgentOverview,
  PromptsTab,
  ConfigurationTab,
  KeysTab,
  AgentRevisionsTab,
  confirmAgentConfigNavigation,
} from "@/pages/AgentDetail";
import { AgentAdvancedTab } from "@/pages/AgentAdvancedTab";
import { AgentToolsTab } from "@/pages/AgentToolsTab";
import { AgentContextualSidebar } from "@/components/AgentContextualSidebar";
import { AgentActionButtons } from "@/components/AgentActionButtons";
import { PillGuy } from "@/components/onboarding/PillGuy";
import {
  AgentConfigForm,
  AdapterLoginPanel,
} from "@/components/AgentConfigForm";
import { NewIssueDialog } from "@/components/NewIssueDialog";
import { Button } from "@/components/ui/button";
import { useSpace } from "@/context/SpaceContext";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";
import {
  AGENT_DETAIL_NAVIGATION,
  parseAgentDetailView,
  type AgentLocalDetailView,
} from "@/pages/agent-detail-navigation";
import { agentDisplayAdapterType, getAdapterDisplay } from "@/adapters/adapter-display-registry";
import { cn } from "@/lib/utils";
import { RuntimeTestCard } from "../RuntimeTestCard";
import { type TestOutcome } from "../new-agent-fixtures";
import { SPACE, ID, REF, createSettingsFixtures } from "./fixtures";
import { storybookIssues } from "../../fixtures/outpostData";
import "./settings.css";

const descriptions: Record<AgentLocalDetailView, string> = {
  advanced: "Edit the agent’s configuration as YAML.",
  overview: "A snapshot of Nova’s work, capabilities, and current setup.",
  instructions: "The files that guide how your agent thinks and works.",
  skills: "Choose the additional skills available to this agent.",
  runtime:
    "Configure the harness, model, environment, and how your agent runs.",
  tools: "Manage installed connections, available tools, and access policies.",
  channels: "Manage the external chat connections dedicated to this agent.",
  permissions: "Set the agent’s trust level, authority, and boundaries.",
  "api-keys": "Manage the keys this agent uses to authenticate with Outpost.",
  revisions:
    "Review past configuration changes and restore an earlier version.",
  activity: "Everything this agent did and everything done to it.",
  runs: "Every execution of this agent, newest first.",
};
type Feedback = Parameters<
  NonNullable<ComponentProps<typeof AgentConfigForm>["onTestFeedbackChange"]>
>[0];

export function AgentSettingsPreview({
  initialTab = "overview",
  adapterType = "claude_local",
  testOutcome = "pass",
  saveFails = false,
  runtimeContent,
}: {
  initialTab?: AgentLocalDetailView;
  adapterType?: string;
  testOutcome?: TestOutcome;
  saveFails?: boolean;
  /** Storybook-only extension point for reviewing proposed runtime controls in the existing page. */
  runtimeContent?: ReactNode;
}) {
  const [fixtures] = useState(() => {
    const fixtures = createSettingsFixtures(adapterType, testOutcome, saveFails);
    if (adapterType === "codex_local" || adapterType === "outpost_runner") {
      fixtures.agent.adapterConfig = { ...fixtures.agent.adapterConfig, model: "gpt-6.1-sol", modelReasoningEffort: "high", ...(adapterType === "outpost_runner" ? { provider: "codex" } : {}) };
    }
    return fixtures;
  });
  const [ready, setReady] = useState(false);
  const { selectedSpaceId, setSelectedSpaceId } = useSpace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => {
    const uninstall = fixtures.install();
    const previous = window.fetch;
    const codexFixture: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      if (url.pathname === "/api/adapters" || url.pathname === "/api/health") {
        const response = await previous(input, init);
        const data = await response.json();
        return Response.json(url.pathname === "/api/health" ? { ...data, status: "ok" }
          : data.map((adapter: { type: string }) => adapter.type === "codex_local" ? { ...adapter, supportedRunners: ["outpost", "legacy"], defaultRunner: "outpost" } : adapter));
      }
      return previous(input, init);
    };
    if (adapterType === "codex_local" || adapterType === "outpost_runner") window.fetch = codexFixture;
    const fixtureQueryKeys = [
      queryKeys.health,
      queryKeys.adapters.all,
      queryKeys.agents.detail(ID),
      queryKeys.agents.detail(REF),
      queryKeys.agents.skills(ID),
      queryKeys.spaceSkills.list(SPACE),
      queryKeys.agents.keys(ID),
      queryKeys.agents.configRevisions(ID),
      queryKeys.instance.experimentalSettings,
      queryKeys.instance.generalSettings,
      queryKeys.environments.list(SPACE),
      queryKeys.secrets.list(SPACE),
      ["tools", SPACE],
      ["tools", "connection", "settings-github"],
    ];
    const clearFixtureQueries = () =>
      fixtureQueryKeys.forEach((queryKey) =>
        queryClient.removeQueries({ queryKey }),
      );
    clearFixtureQueries();
    queryClient.setQueryData(queryKeys.agents.detail(ID), fixtures.agent);
    setSelectedSpaceId(SPACE);
    navigate(`/PAP/agents/${REF}/${initialTab}`, { replace: true });
    setReady(true);
    return () => {
      if (window.fetch === codexFixture) window.fetch = previous;
      uninstall();
      clearFixtureQueries();
    };
  }, [adapterType, fixtures, initialTab, queryClient, setSelectedSpaceId]);
  if (!ready || selectedSpaceId !== SPACE) return null;
  return (
    <Routes>
      <Route
        path="/:spacePrefix/agents/:agentId/:tab?"
        element={<SettingsPage runtimeContent={runtimeContent} />}
      />
      <Route
        path="*"
        element={
          <div className="p-8 space-y-4">
            <h2 className="text-xl font-semibold">Linked page</h2>
            <p className="text-sm text-muted-foreground">
              This preview focuses on agent configuration. The existing
              destination is unchanged.
            </p>
            <Button onClick={() => navigate(`/PAP/agents/${REF}/overview`)}>
              Back to agent
            </Button>
          </div>
        }
      />
    </Routes>
  );
}

function SettingsPage({ runtimeContent }: { runtimeContent?: ReactNode }) {
  const location = useLocation();
  const view = parseAgentDetailView(
    location.pathname.split("/").pop() ?? "overview",
  );
  const queryClient = useQueryClient();
  const { data: agent } = useQuery({
    queryKey: queryKeys.agents.detail(ID),
    queryFn: () => agentsApi.get(ID, SPACE),
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [starred, setStarred] = useState(false);
  const save = useRef<(() => void) | null>(null),
    cancel = useRef<(() => void) | null>(null),
    test = useRef<(() => void) | null>(null);
  const onSaveAction = useCallback((fn: (() => void) | null) => {
    save.current = fn;
  }, []);
  const onCancelAction = useCallback((fn: (() => void) | null) => {
    cancel.current = fn;
  }, []);
  const onTestAction = useCallback((fn: (() => void) | null) => {
    test.current = fn;
  }, []);
  const [testAction, setTestAction] = useState({
    disabled: false,
    pending: false,
  });
  const [feedback, setFeedback] = useState<Feedback>({
    errorMessage: null,
    result: null,
    login: null,
  });
  const onDirty = useCallback((value: boolean) => {
    setDirty(value);
    if (value) setSaved(false);
  }, []);
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      agentsApi.update(ID, patch, SPACE),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.agents.detail(ID), updated);
      queryClient.invalidateQueries({
        queryKey: queryKeys.agents.configRevisions(ID),
      });
    },
  });
  const permissions = useMutation({
    mutationFn: (patch: Parameters<typeof agentsApi.updatePermissions>[1]) =>
      agentsApi.updatePermissions(ID, patch, SPACE),
    onSuccess: (updated) =>
      queryClient.setQueryData(queryKeys.agents.detail(ID), updated),
  });
  useEffect(() => {
    setDirty(false);
    setSaved(false);
    setSaveError(null);
  }, [view]);
  if (!agent)
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading agent…</div>
    );
  const title = AGENT_DETAIL_NAVIGATION.flatMap((s) => s.items).find(
    (t) => t.value === view,
  )?.label;
  const displayType = agentDisplayAdapterType(agent);
  const display = getAdapterDisplay(displayType);
  const Icon = display.icon;
  const callbacks = {
    onDirtyChange: onDirty,
    onSaveActionChange: onSaveAction,
    onCancelActionChange: onCancelAction,
    onSavingChange: setSaving,
  };
  async function saveAgent(patch: Record<string, unknown>) {
    setSaving(true);
    setSaveError(null);
    try {
      await update.mutateAsync(patch);
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save changes.",
      );
      throw error;
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-6 py-3 text-xs text-muted-foreground">
        <span>Agents</span>
        <ChevronRight className="size-3" />
        <span>{agent.name}</span>
        <ChevronRight className="size-3" />
        <span className="text-foreground">{title}</span>
      </div>
      <div className="flex min-h-screen">
        <div
          className="hidden w-52 shrink-0 md:block"
          onClickCapture={(event) => {
            if (
              dirty &&
              (event.target as HTMLElement).closest("a") &&
              (saving || !confirmAgentConfigNavigation(true))
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <AgentContextualSidebar
            agentRef={REF}
            agentId={ID}
            agentName={agent.name}
          />
        </div>
        <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
          <div className="mx-auto max-w-5xl space-y-8">
            <details className="md:hidden">
              <summary className="cursor-pointer text-sm">
                {agent.name} · Agent navigation
              </summary>
              <AgentContextualSidebar
                agentRef={REF}
                agentId={ID}
                agentName={agent.name}
              />
            </details>
            <header className="flex flex-wrap items-center justify-between gap-5 border-b border-border pb-6">
              <div className="flex min-w-0 items-center gap-4">
                <div
                  role="img"
                  aria-label={`${agent.name} avatar`}
                  className="shrink-0"
                >
                  <PillGuy state="alive" className="size-12" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {agent.name}
                  </h1>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {displayType === "claude_local" ||
                    displayType === "codex_local" ? (
                      <img
                        src={`/brands/${displayType === "claude_local" ? "claude" : "codex"}-color.svg`}
                        className="size-4"
                        alt=""
                      />
                    ) : (
                      <Icon className="size-4" />
                    )}
                    <span>{display.label}</span>
                    <span>·</span>
                    <span>{agent.title || agent.role}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={starred ? "Unstar agent" : "Star agent"}
                  onClick={() => setStarred(!starred)}
                >
                  <Star className={cn("size-4", starred && "fill-current")} />
                </Button>
                <AgentActionButtons
                  agent={agent}
                  spaceId={SPACE}
                  assignLabel="Assign Task"
                  showRun={false}
                  showStatus={false}
                  onActionError={setSaveError}
                />
              </div>
            </header>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">
                {descriptions[view]}
              </p>
            </div>
            <div
              className={cn("agent-settings-content", `agent-settings-${view}`)}
              key={view}
            >
              {view === "overview" && (
                <AgentOverview
                  agent={agent}
                  runs={[]}
                  assignedIssues={storybookIssues.slice(0, 3)}
                  coordinatedAgents={[]}
                  agentRouteId={REF}
                />
              )}
              {view === "instructions" && (
                <PromptsTab
                  agent={agent}
                  spaceId={SPACE}
                  showSaveNotice={false}
                  {...callbacks}
                />
              )}
              {view === "runtime" && runtimeContent
                ? runtimeContent
                : view === "runtime" && (
                    <div className="space-y-6">
                      <div className="agent-settings-form">
                        <AgentConfigForm
                          mode="edit"
                          agent={agent}
                          onSave={saveAgent}
                          isSaving={saving}
                          hideInlineSave
                          hidePromptTemplate
                          hideInstructionsFile
                          content="configuration"
                          environmentVariablesPlacement="configuration"
                          sectionLayout="cards"
                          canConfigureProviderTrace
                          sectionOrder={[
                            "adapter",
                            "permissions",
                            "environment",
                            "run-policy",
                            "identity",
                          ]}
                          sectionTitles={{
                            adapter: "Harness",
                            permissions: "Model & execution",
                            identity: "Agent identity",
                          }}
                          onDirtyChange={onDirty}
                          onSaveActionChange={onSaveAction}
                          onCancelActionChange={onCancelAction}
                          onTestActionChange={onTestAction}
                          onTestActionStateChange={setTestAction}
                          onTestFeedbackChange={setFeedback}
                        />
                      </div>
                      {view === "runtime" && (
                        <>
                          <RuntimeTestCard
                            state={
                              testAction.pending
                                ? "running"
                                : feedback.errorMessage ||
                                    feedback.result?.status === "fail"
                                  ? "fail"
                                  : feedback.result?.status === "warn"
                                    ? "warn"
                                    : feedback.result
                                      ? "pass"
                                      : "idle"
                            }
                            result={feedback.result}
                            error={feedback.errorMessage}
                            disabled={testAction.disabled}
                            onTest={() => test.current?.()}
                          />
                          {feedback.login && (
                            <AdapterLoginPanel
                              {...feedback.login}
                              onStored={() => test.current?.()}
                              onApplyStored={() => test.current?.()}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
              {view === "permissions" && (
                <ConfigurationTab
                  agent={agent}
                  spaceId={SPACE}
                  {...callbacks}
                  updatePermissions={permissions}
                  content="permissions"
                />
              )}
              {view === "tools" && (
                <AgentToolsTab agent={agent} spaceId={SPACE} />
              )}
              {view === "api-keys" && (
                <KeysTab agentId={ID} spaceId={SPACE} />
              )}
              {view === "revisions" && (
                <AgentRevisionsTab agent={agent} spaceId={SPACE} />
              )}
              {view === "advanced" && (
                <AgentAdvancedTab key={agent.id} agent={agent} onDirtyChange={onDirty} onSavingChange={setSaving} onSaved={() => {}} />
              )}
            </div>
            {(saveError || permissions.error) && (
              <p role="alert" className="text-sm text-destructive">
                {saveError ?? String(permissions.error)}
              </p>
            )}
            {(["runtime", "instructions"] as string[]).includes(
              view,
            ) &&
              !(view === "runtime" && runtimeContent) && (
                <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-4">
                  <p role="status" className="text-xs text-muted-foreground">
                    {saving
                      ? "Saving changes…"
                      : dirty
                        ? "You have unsaved changes."
                        : saved
                          ? "Changes saved."
                          : ""}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      disabled={!dirty || saving}
                      onClick={() => cancel.current?.()}
                    >
                      Discard
                    </Button>
                    <Button
                      disabled={!dirty || saving}
                      onClick={() => {
                        Promise.resolve(save.current?.()).catch(() => {});
                      }}
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </footer>
              )}
          </div>
        </main>
      </div>
      <NewIssueDialog />
    </div>
  );
}
