import { useEffect, useMemo } from "react";
import { useParams } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useSpace } from "@/context/SpaceContext";
import { QueryErrorState } from "@/components/QueryView";
import { PluginSlotMount, usePluginSlots } from "@/plugins/slots";
import { NotFoundPage } from "./NotFound";

export function SpaceSettingsPluginPage() {
  const params = useParams<{
    spacePrefix?: string;
    settingsRoutePath?: string;
  }>();
  const { spacePrefix: routeSpacePrefix, settingsRoutePath } = params;
  const { spaces, selectedSpaceId } = useSpace();
  const { setBreadcrumbs } = useBreadcrumbs();

  const routeSpace = useMemo(() => {
    if (!routeSpacePrefix) return null;
    const requested = routeSpacePrefix.toUpperCase();
    return spaces.find((space) => space.issuePrefix.toUpperCase() === requested) ?? null;
  }, [spaces, routeSpacePrefix]);
  const hasInvalidSpacePrefix = Boolean(routeSpacePrefix) && !routeSpace;
  const resolvedSpaceId = routeSpace?.id ?? (routeSpacePrefix ? null : selectedSpaceId ?? null);
  const spacePrefix = resolvedSpaceId
    ? spaces.find((space) => space.id === resolvedSpaceId)?.issuePrefix ?? null
    : null;

  const { slots, isLoading, errorMessage, error, retry } = usePluginSlots({
    slotTypes: ["spaceSettingsPage"],
    spaceId: resolvedSpaceId,
    enabled: Boolean(resolvedSpaceId && settingsRoutePath),
  });

  const pageSlots = useMemo(() => {
    if (!settingsRoutePath) return [];
    return slots.filter((slot) => slot.routePath === settingsRoutePath);
  }, [settingsRoutePath, slots]);

  const pageSlot = pageSlots.length === 1 ? pageSlots[0] : null;

  useEffect(() => {
    if (!pageSlot) return;
    setBreadcrumbs([
      { label: "Settings", href: "/space/settings" },
      { label: pageSlot.displayName },
    ]);
  }, [pageSlot, setBreadcrumbs]);

  if (!resolvedSpaceId) {
    if (hasInvalidSpacePrefix) {
      return <NotFoundPage scope="invalid_space_prefix" requestedPrefix={routeSpacePrefix} />;
    }
    return <div className="text-sm text-muted-foreground">Select an outpost to view this page.</div>;
  }

  if (!settingsRoutePath || isLoading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  // Only a real failure reaches here; an outage keeps `isLoading` true above.
  if (errorMessage) {
    return <QueryErrorState error={error} action="load plugin extensions" onRetry={retry} className="max-w-xl" />;
  }

  if (pageSlots.length > 1) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Multiple plugins declare the outpost settings route <code>{settingsRoutePath}</code>. Disable one plugin or change its route.
      </div>
    );
  }

  if (!pageSlot) {
    return <NotFoundPage scope="operator" />;
  }

  return (
    <div className="max-w-6xl">
      <PluginSlotMount
        slot={pageSlot}
        context={{ spaceId: resolvedSpaceId, spacePrefix }}
        className="min-h-(--sz-200px)"
        missingBehavior="placeholder"
      />
    </div>
  );
}
