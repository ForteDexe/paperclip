import { useAccountIdentity } from "@/api/spaces-query";
import { useSpace } from "@/context/SpaceContext";
import { useDialogState } from "@/context/DialogContext";
import { useLocation } from "@/lib/router";
import { isOnboardingPath } from "@/lib/onboarding-route";
import type { PluginHostContext } from "@/plugins/bridge";
import { PluginSlotMount, usePluginSlots, type PluginSlotContext } from "@/plugins/slots";

function AppShellEntries({ context }: { context: PluginSlotContext }) {
  const { slots, errorMessage } = usePluginSlots({
    slotTypes: ["appShellOverlay"],
    spaceId: context.spaceId,
  });
  // Optional extensions must not replace the application's normal error UI.
  if (errorMessage || slots.length === 0) return null;
  return (
    <aside className="plugin-app-shell-overlays" aria-label="Application extensions">
      {slots.map((slot) => (
        <PluginSlotMount
          key={`${slot.pluginId}:${slot.pluginVersion}:${slot.id}`}
          slot={slot}
          context={context}
          className="plugin-app-shell-overlay"
        />
      ))}
    </aside>
  );
}

/**
 * One persistent mount in each application shell. Navigation preserves the
 * plugin tree; changing account/space, signing out, or entering onboarding
 * disposes it. Plugins must cancel their requests/subscriptions on disposal.
 * Host context is display context, never proof of server authorization.
 */
export function PluginAppShellOverlays({ localTrusted = false }: { localTrusted?: boolean }) {
  const { userId, settled } = useAccountIdentity();
  const { selectedSpaceId, selectedSpace, loading } = useSpace();
  const { onboardingOpen, onboardingRouteDismissed } = useDialogState();
  const { pathname } = useLocation();
  // Local-trusted instances intentionally have no login requirement. Still
  // prefer any real account and wait for identity resolution so account changes
  // cannot reuse the prior account's in-memory plugin state.
  const identity = settled ? userId ?? (localTrusted ? "local-operator" : null) : null;
  const onboardingVisible = onboardingOpen || (!onboardingRouteDismissed && isOnboardingPath(pathname));
  if (!identity || loading || onboardingVisible) return null;
  const context: PluginSlotContext & PluginHostContext = {
    spaceId: selectedSpaceId,
    spacePrefix: selectedSpace?.issuePrefix ?? null,
    projectId: null, entityId: null, entityType: null, parentEntityId: null,
    userId,
  };
  return (
    <AppShellEntries
      key={JSON.stringify([identity, selectedSpaceId])}
      context={context}
    />
  );
}
