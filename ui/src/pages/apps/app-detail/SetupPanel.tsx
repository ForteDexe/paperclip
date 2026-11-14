import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolCatalogEntry, ToolConnection } from "@outpost/shared";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { appDefinitionSlug } from "../app-definition-display";
import type { AppDetailSectionProps } from "./types";

export function SetupPanel({
  connection,
  galleryEntry,
  onUpdateConfig,
  configUpdateDisabled,
  identities,
  agentsSummary,
  permissionsSummary,
  permissionsLoading,
  onOpenPermissions,
}: Pick<
  AppDetailSectionProps,
  "connection" | "galleryEntry"
> & {
  onUpdateConfig: (config: Record<string, unknown>) => void;
  configUpdateDisabled: boolean;
  /**
   * The fixed Identity section. It replaces the old generic OAuth "workspace
   * authorization" block and shows the identity type chosen during setup.
   */
  identities?: ReactNode;
  agentsSummary: string;
  permissionsSummary: string | null;
  permissionsLoading: boolean;
  onOpenPermissions: () => void;
}) {
  return (
    <div className="space-y-10">
      {identities}
      <SetupLinkSection title="Agents" summary={agentsSummary} onClick={onOpenPermissions} />
      <SetupLinkSection
        title="Actions"
        summary={permissionsLoading ? "Loading permissions…" : permissionsSummary ?? "Manage permissions"}
        onClick={onOpenPermissions}
      />
      {appDefinitionSlug(galleryEntry) === "posthog" && (
        <PostHogConfigurationSection connection={connection} />
      )}
    </div>
  );
}

function SetupLinkSection({
  title,
  summary,
  onClick,
}: {
  title: string;
  summary: string;
  onClick: () => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 text-sm text-muted-foreground">{summary}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </section>
  );
}

/**
 * Provider label used in identity and revoke copy. Falls back to the app's own
 * display name so a pasted server never reads as a generic "OAuth".
 */
export function connectionProviderName(
  galleryEntry: Parameters<typeof appDefinitionSlug>[0],
  fallback: string,
): string {
  switch (appDefinitionSlug(galleryEntry)) {
    case "notion":
      return "Notion";
    case "posthog":
      return "PostHog";
    case "gmail":
      return "Gmail";
    case "google-sheets":
      return "Google Sheets";
    default:
      return fallback;
  }
}

function PostHogConfigurationSection({ connection }: { connection: ToolConnection }) {
  const raw = connection.config?.methodConfig;
  const config = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const method = connection.config?.connectionMethodKey === "mcp-oauth" ? "PostHog sign-in" : "Personal API key";
  const features = typeof config.features === "string" ? config.features : "None";
  const tools = typeof config.tools === "string" && config.tools ? config.tools : "None";
  const rows = [
    ["Connection method", method],
    ["Project pin", typeof config.projectId === "string" ? config.projectId : "Use active project"],
    ["Read-only mode", config.readOnly === true ? "On" : "Off"],
    ["Feature groups", features],
    ["Individual tools", tools],
    ["Response mode", typeof config.mode === "string" ? config.mode : "tools"],
  ];
  return (
    <section>
      <h2 className="text-sm font-bold text-foreground">PostHog access scope</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        PostHog uses its normal account defaults unless you narrow the optional controls below.
      </p>
      <dl className="mt-4 divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-2 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="break-words text-sm text-foreground sm:col-span-2">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function QuarantinedActionsReview({
  entries,
  disabled,
  onSubmit,
}: {
  entries: ToolCatalogEntry[];
  disabled: boolean;
  onSubmit: (enabledIds: string[]) => void;
}) {
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const count = entries.length;
  const selectedIds = entries.filter((entry) => enabledIds.has(entry.id)).map((entry) => entry.id);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            Review {count} new {count === 1 ? "action" : "actions"}
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Turn on the actions agents may use. Anything left off stays blocked when you save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs font-medium text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
            disabled={disabled}
            onClick={() => setEnabledIds(new Set(entries.map((entry) => entry.id)))}
          >
            Turn all on
          </button>
          <button
            type="button"
            className="text-xs font-medium text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
            disabled={disabled}
            onClick={() => setEnabledIds(new Set())}
          >
            Turn all off
          </button>
        </div>
      </div>
      <div className="divide-y divide-border">
        {entries.map((entry) => {
          const enabled = enabledIds.has(entry.id);
          const label = entry.title ?? entry.toolName;
          return (
            <div key={entry.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{label}</div>
                {entry.description && (
                  <div className="truncate text-xs text-muted-foreground">{entry.description}</div>
                )}
              </div>
              <ToggleSwitch
                aria-label={`${label} allowed`}
                checked={enabled}
                disabled={disabled}
                onCheckedChange={(next) => {
                  setEnabledIds((current) => {
                    const updated = new Set(current);
                    if (next) updated.add(entry.id);
                    else updated.delete(entry.id);
                    return updated;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-amber-700 dark:text-amber-300">
          {selectedIds.length} of {count} will be on
        </span>
        <Button size="sm" disabled={disabled} onClick={() => onSubmit(selectedIds)}>
          {disabled ? "Saving…" : "Save choices"}
        </Button>
      </div>
    </section>
  );
}
