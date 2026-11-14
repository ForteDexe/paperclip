import { ChangeEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type InteractionResolverPolicy,
  type IssueThreadInteractionKind,
} from "@outpost/shared";
import { useSpace } from "../context/SpaceContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useOptionalToastActions } from "../context/ToastContext";
import { useCloudInstance } from "../hooks/useCloudInstance";
import { resolveSpaceArchiveDeparture } from "../lib/space-selection";
import { cloudPortfolioManageUrl } from "../lib/cloudLinks";
import { navigateTopLevel } from "@/lib/browserNavigation";
import { spacesApi } from "../api/spaces";
import { assetsApi } from "../api/assets";
import { describeError } from "@/api/errors";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import {
  InteractionPolicyPanel,
  applyPolicyChange,
  type PolicyField,
  type PolicySelectValue,
} from "../components/InteractionPolicyPanel";
import { SpacePatternIcon } from "../components/SpacePatternIcon";
import {
  Field,
  ToggleField,
} from "../components/agent-config-primitives";
import { InstanceGeneralSettings } from "./InstanceGeneralSettings";

export function SpaceSettings() {
  const {
    spaces,
    selectedSpace,
    selectedSpaceId,
    setSelectedSpaceId
  } = useSpace();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toastActions = useOptionalToastActions();
  const cloud = useCloudInstance();
  // Managed instances derive the task ID prefix from the space name, so a
  // rename here also renumbers the existing task IDs.
  const isCloudManaged = Boolean(cloud);
  // General settings local state
  const [spaceName, setSpaceName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<InteractionResolverPolicy>({});

  // Sync local state from selected space
  useEffect(() => {
    if (!selectedSpace) return;
    setSpaceName(selectedSpace.name);
    setDescription(selectedSpace.description ?? "");
    setLogoUrl(selectedSpace.logoUrl ?? "");
    setPolicy(selectedSpace.interactionResolverPolicy ?? {});
  }, [selectedSpace]);

  const generalDirty =
    !!selectedSpace &&
    (spaceName !== selectedSpace.name ||
      description !== (selectedSpace.description ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
    }) => spacesApi.update(selectedSpaceId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      spacesApi.update(selectedSpaceId!, {
        requireOperatorApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all });
    }
  });

  const policyMutation = useMutation({
    mutationFn: (next: InteractionResolverPolicy) =>
      spacesApi.update(selectedSpaceId!, { interactionResolverPolicy: next }),
    onSuccess: (space) => {
      setPolicy(space.interactionResolverPolicy ?? {});
      queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all });
    }
  });

  function handlePolicyChange(
    kind: IssueThreadInteractionKind,
    field: PolicyField,
    value: PolicySelectValue,
  ) {
    const next = applyPolicyChange(policy, kind, field, value);
    setPolicy(next);
    policyMutation.mutate(next);
  }

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadSpaceLogo(selectedSpaceId!, file)
        .then((asset) => spacesApi.update(selectedSpaceId!, { logoAssetId: asset.assetId })),
    onSuccess: (space) => {
      syncLogoState(space.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => spacesApi.update(selectedSpaceId!, { logoAssetId: null }),
    onSuccess: (space) => {
      setLogoUploadError(null);
      syncLogoState(space.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  const archiveMutation = useMutation({
    mutationFn: ({ spaceId }: { spaceId: string }) =>
      spacesApi.archive(spaceId),
    onSuccess: async (_result, { spaceId }) => {
      // Never stay on the archived space's settings: the only visible
      // change would be the archive button going inert. Leave for wherever
      // still makes sense (another active space, the Cloud portfolio, or
      // the spaces list), with a toast naming what happened.
      const archived = spaces.find((space) => space.id === spaceId);
      const archivedName = archived?.name ?? "Outpost";
      const departure = resolveSpaceArchiveDeparture({
        archivedSpaceId: spaceId,
        spaces,
        cloudPortfolioUrl: cloudPortfolioManageUrl(cloud?.cloudBaseUrl),
      });
      if (departure.kind === "cloud_portfolio") {
        // The whole organization is on its way to being archived by the
        // control plane; a full navigation to the Cloud portfolio replaces
        // this document, so cache invalidation below would never run.
        navigateTopLevel(departure.url);
        return;
      }
      if (departure.kind === "space") {
        toastActions?.pushToast({
          title: `${archivedName} is archived`,
          body: `Switched to ${departure.space.name}.`,
          tone: "info",
          dedupeKey: `space-archive-departure:${spaceId}`,
        });
        setSelectedSpaceId(departure.space.id);
        navigate(`/${departure.space.issuePrefix}/dashboard`, { replace: true });
      } else {
        toastActions?.pushToast({
          title: `${archivedName} is archived`,
          body: "You can unarchive it from this list.",
          tone: "info",
          dedupeKey: `space-archive-departure:${spaceId}`,
        });
        navigate(`/${archived?.issuePrefix ?? ""}/spaces`, { replace: true });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.spaces.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.spaces.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedSpace?.name ?? "Outpost", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedSpace?.name]);

  if (!selectedSpace) {
    return (
      <div className="text-sm text-muted-foreground">
        No outpost selected. Select an outpost from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: spaceName.trim(),
      description: description.trim() || null
    });
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">General</h1>
      </div>

      {/* General */}
      <div className="max-w-2xl space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3">
          <Field label="Outpost name" hint="The display name for your outpost.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
            />
            {isCloudManaged && (
              <p className="mt-1 text-xs text-muted-foreground">
                Renaming can change this outpost's task ID prefix. Existing task IDs are
                renumbered and old task links stop resolving.
              </p>
            )}
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the outpost profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional outpost description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="max-w-2xl space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <SpacePatternIcon
                spaceName={spaceName || selectedSpace.name}
                logoUrl={logoUrl || null}
                className="rounded-(--rad-14)"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.error || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ?? describeError(logoUploadMutation.error).body}
                    </span>
                  )}
                  {clearLogoMutation.error && (
                    <span className="text-xs text-destructive">
                      {describeError(clearLogoMutation.error).body}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">Uploading logo...</span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !spaceName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.error && (
            <span className="text-xs text-destructive">
              {describeError(generalMutation.error).body}
            </span>
          )}
        </div>
      )}

      {/* Creation */}
      <div className="max-w-2xl space-y-4" data-testid="outpost-settings-team-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Creation
        </div>
        <div>
          <ToggleField
            label="Require operator approval for new creations"
            hint="New agent creations stay pending until approved by operator."
            checked={!!selectedSpace.requireOperatorApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
            toggleTestId="outpost-settings-team-approval-toggle"
          />
        </div>
      </div>

      {/* Interaction policy */}
      <InteractionPolicyPanel
        policy={policy}
        onChange={handlePolicyChange}
        isPending={policyMutation.isPending}
        errorMessage={policyMutation.error ? describeError(policyMutation.error).body : null}
      />

      <InstanceGeneralSettings embedded />

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this outpost to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedSpace.status === "archived"
              }
              onClick={() => {
                if (!selectedSpaceId) return;
                const confirmed = window.confirm(
                  `Archive outpost "${selectedSpace.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                archiveMutation.mutate({ spaceId: selectedSpaceId });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedSpace.status === "archived"
                ? "Already archived"
                : "Archive outpost"}
            </Button>
            {archiveMutation.error && (
              <span className="text-xs text-destructive">
                {describeError(archiveMutation.error).body}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
