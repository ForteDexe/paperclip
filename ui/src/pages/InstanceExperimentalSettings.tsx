import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, Lock } from "lucide-react";
import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceFeatureKey,
  ManagedSettingMetadata,
  PatchInstanceExperimentalSettings,
} from "@outpost/shared";
import { experimentalSettingKey } from "@outpost/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { QueryErrorState, useQueryView } from "@/components/QueryView";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { describeError } from "@/api/errors";

function ManagedByCloudBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Lock aria-hidden="true" />
      Managed by Outpost Cloud
    </Badge>
  );
}

function ExperimentalToggleCard({
  title,
  description,
  footnote,
  checked,
  onCheckedChange,
  disabled,
  settingKey,
  managed,
  ariaLabel,
}: {
  title: string;
  description: string;
  footnote?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled: boolean;
  /** Flag key backing this card; operator-hidden keys render nothing. */
  settingKey: InstanceFeatureKey;
  managed?: ManagedSettingMetadata;
  ariaLabel: string;
}) {
  const { hidden: hiddenSettings } = useHiddenSettings();
  const isManaged = managed?.managed === true;
  if (hiddenSettings.has(experimentalSettingKey(settingKey))) return null;
  return (
    <Card id={`experimental-${settingKey}`} className="block scroll-mt-4 bg-transparent p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {isManaged ? <ManagedByCloudBadge /> : null}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          {footnote ? <p className="max-w-2xl text-xs text-muted-foreground">{footnote}</p> : null}
        </div>
        <ToggleSwitch
          checked={checked}
          onCheckedChange={(next) => {
            if (isManaged) return;
            onCheckedChange(next);
          }}
          disabled={disabled || isManaged}
          aria-label={ariaLabel}
        />
      </div>
    </Card>
  );
}

export function InstanceExperimentalSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { hidden: hiddenSettings } = useHiddenSettings();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/space/settings" },
      { label: "Experimental" },
    ]);
  }, [setBreadcrumbs]);

  const experimentalQuery = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const experimentalView = useQueryView(experimentalQuery);

  const toggleMutation = useMutation<
    InstanceExperimentalSettingsWithManaged,
    Error,
    PatchInstanceExperimentalSettings,
    { previousSettings?: InstanceExperimentalSettingsWithManaged }
  >({
    mutationFn: async (patch: PatchInstanceExperimentalSettings) =>
      instanceSettingsApi.updateExperimental(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.instance.experimentalSettings });
      const previousSettings = queryClient.getQueryData<InstanceExperimentalSettingsWithManaged>(
        queryKeys.instance.experimentalSettings,
      );
      if (previousSettings) {
        queryClient.setQueryData<InstanceExperimentalSettingsWithManaged>(
          queryKeys.instance.experimentalSettings,
          { ...previousSettings, ...patch },
        );
      }
      return { previousSettings };
    },
    onSuccess: async (updatedSettings) => {
      setActionError(null);
      queryClient.setQueryData(queryKeys.instance.experimentalSettings, updatedSettings);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adapters.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
        queryClient.invalidateQueries({ queryKey: ["apps"] }),
      ]);
    },
    onError: (error, _patch, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(queryKeys.instance.experimentalSettings, context.previousSettings);
      }
      setActionError(describeError(error).body);
    },
  });

  if (experimentalQuery.isLoading || experimentalView.kind === "reconnecting") {
    return (
      <div className="max-w-6xl space-y-6">
        <div className="text-sm text-muted-foreground">Loading experimental settings...</div>
      </div>
    );
  }

  if (experimentalView.kind === "error") {
    return (
      <div className="max-w-6xl space-y-6">
        <QueryErrorState
          size="page"
          error={experimentalQuery.error}
          action="load experimental settings"
          onRetry={experimentalView.retry}
          retrying={experimentalView.isFetching}
        />
      </div>
    );
  }

  // Present only on cloud-managed instances: keys the managed overlay controls
  // render locked with the "Managed by Outpost Cloud" badge. Self-hosted
  // responses carry no `managedKeys`, so every card stays editable.
  const managedKeys = experimentalQuery.data?.managedKeys ?? {};
  const enableDecisions = experimentalQuery.data?.enableDecisions === true;
  const enableGoalsSidebarLink = experimentalQuery.data?.enableGoalsSidebarLink === true;
  const enableCases = experimentalQuery.data?.enableCases === true;
  const enableCampfire = experimentalQuery.data?.enableCampfire === true;
  const enableTaskRecordPrototype = experimentalQuery.data?.enableTaskRecordPrototype === true;
  const enableServerInfoDebugView = experimentalQuery.data?.enableServerInfoDebugView === true;
  const enableOutpostDeveloperMode =
    experimentalQuery.data?.enableOutpostDeveloperMode === true;
  const autoRestartDevServerWhenIdle = experimentalQuery.data?.autoRestartDevServerWhenIdle === true;
  const isVisible = (key: InstanceFeatureKey) => !hiddenSettings.has(experimentalSettingKey(key));
  const showDeveloperSection = ([
    "autoRestartDevServerWhenIdle",
    "enableOutpostDeveloperMode",
    "enableServerInfoDebugView",
  ] satisfies InstanceFeatureKey[]).some(isVisible);
  return (
    <div className="max-w-6xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Experimental</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Opt into features that are still being evaluated before they become default behavior.
        </p>
      </div>

      <div
        role="alert"
        className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Experimental features may break at any time.</p>
            <p className="text-muted-foreground">
              These features are opt-in and come with no compatibility guarantees. They may change, break, or be
              removed without notice. Avoid relying on them for critical or production workflows.
            </p>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section className="space-y-3" aria-labelledby="experimental-features-heading">
        <div className="space-y-1">
          <h2 id="experimental-features-heading" className="text-sm font-semibold">
            Experimental features
          </h2>
          <p className="text-sm text-muted-foreground">
            Optional product features that are still being evaluated.
          </p>
        </div>

        <ExperimentalToggleCard
          title="Cases"
          description="Durable work products (blog posts, tweet storms…) that tasks create and iterate on. Adds the Cases tab and the agent case API."
          footnote="Turning Cases off hides the tab and blocks the case API; existing case data is kept."
          checked={enableCases}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableCases: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableCases"
          managed={managedKeys.enableCases}
          ariaLabel="Toggle cases experimental setting"
        />

        <ExperimentalToggleCard
          title="Campfire"
          description="Persistent group rooms where you and multiple agents can discuss work through the native Chat interface."
          footnote="Turning Campfire off hides the rooms and blocks its API; existing room history is kept."
          checked={enableCampfire}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableCampfire: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableCampfire"
          managed={managedKeys.enableCampfire}
          ariaLabel="Toggle Campfire experimental setting"
        />

        <ExperimentalToggleCard
          title="Decisions"
          description="Show the Decisions item in the main sidebar — the attention home that surfaces the tasks awaiting your input — while the surface is still being evaluated."
          checked={enableDecisions}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableDecisions: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableDecisions"
          managed={managedKeys.enableDecisions}
          ariaLabel="Toggle decisions experimental setting"
        />

        <ExperimentalToggleCard
          title="Task Record"
          description="Add a living source of truth beside each task conversation for the refined brief, open questions, decisions, validation, and result."
          footnote="Records use structured, revisioned task data and remain separate from conversation history."
          checked={enableTaskRecordPrototype}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableTaskRecordPrototype: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableTaskRecordPrototype"
          managed={managedKeys.enableTaskRecordPrototype}
          ariaLabel="Toggle task record experimental setting"
        />

        <ExperimentalToggleCard
          title="North Stars"
          description="Show North Stars in the main sidebar for long-term direction that tasks can support."
          checked={enableGoalsSidebarLink}
          onCheckedChange={(checked) =>
            toggleMutation.mutate({ enableGoalsSidebarLink: checked })
          }
          disabled={toggleMutation.isPending}
          settingKey="enableGoalsSidebarLink"
          managed={managedKeys.enableGoalsSidebarLink}
          ariaLabel="Toggle north stars sidebar link experimental setting"
        />
      </section>

      {showDeveloperSection ? (
        <section className="space-y-3" aria-labelledby="developer-mode-heading">
          <div className="space-y-1">
            <h2 id="developer-mode-heading" className="text-sm font-semibold">
              Outpost Developer Mode
            </h2>
            <p className="text-sm text-muted-foreground">
              Internal tools for developing, testing, and debugging Outpost.
            </p>
          </div>

          <ExperimentalToggleCard
            title="Auto-Restart Dev Server When Idle"
            description="In `pnpm dev:once`, wait for all queued and running local agent runs to finish, then restart the server automatically when backend changes or migrations make the current boot stale."
            checked={autoRestartDevServerWhenIdle}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ autoRestartDevServerWhenIdle: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="autoRestartDevServerWhenIdle"
            managed={managedKeys.autoRestartDevServerWhenIdle}
            ariaLabel="Toggle guarded dev-server auto-restart"
          />

          <ExperimentalToggleCard
            title="Outpost Developer Mode"
            description="Show internal Outpost maintainer tools and observability links, including Honeycomb trace queries on run pages."
            checked={enableOutpostDeveloperMode}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableOutpostDeveloperMode: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableOutpostDeveloperMode"
            managed={managedKeys.enableOutpostDeveloperMode}
            ariaLabel="Toggle Outpost developer mode experimental setting"
          />

          <ExperimentalToggleCard
            title="Server Info Debug View"
            description='Show a "Server" section in the account drawer with the current server restart time and running commit.'
            checked={enableServerInfoDebugView}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableServerInfoDebugView: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableServerInfoDebugView"
            managed={managedKeys.enableServerInfoDebugView}
            ariaLabel="Toggle server info debug view experimental setting"
          />

        </section>
      ) : null}

    </div>
  );
}
