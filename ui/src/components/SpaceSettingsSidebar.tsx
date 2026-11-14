import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Cpu,
  FlaskConical,
  Puzzle,
  SlidersHorizontal,
} from "lucide-react";
import type { PluginRecord } from "@outpost/shared";
import { pluginsApi } from "@/api/plugins";
import { NavLink } from "@/lib/router";
import { INSTANCE_SETTINGS_PATH_PREFIX } from "@/lib/instance-settings";
import { SIDEBAR_SCROLL_RESET_STATE } from "@/lib/navigation-scroll";
import { queryKeys } from "@/lib/queryKeys";
import { useSpace } from "@/context/SpaceContext";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { usePluginSlots } from "@/plugins/slots";
import { SidebarNavItem } from "./SidebarNavItem";
import { ContextualSidebarFrame } from "./ContextualSidebarFrame";
import { primarySidebarStyles } from "./primary-sidebar-styles";

/**
 * Sandbox-provider-only plugins (e.g. E2B, exe.dev, Modal) have no per-plugin
 * settings page, so a sidebar entry would lead nowhere useful. Filter them out
 * here. Plugins that mix a sandbox provider with other contributions still
 * appear.
 */
function isSandboxProviderOnly(plugin: PluginRecord): boolean {
  const drivers = plugin.manifestJson.environmentDrivers ?? [];
  if (drivers.length === 0) return false;
  return drivers.every((d) => d.kind === "sandbox_provider");
}

export function SpaceSettingsSidebar() {
  const { selectedSpaceId } = useSpace();
  const { hidden: hiddenSettings } = useHiddenSettings();
  const showPage = (pageKey: string) => !hiddenSettings.has(pageKey);
  const showPlugins = showPage("instance.plugins");
  const { slots: spaceSettingsPluginSlots } = usePluginSlots({
    slotTypes: ["spaceSettingsPage"],
    spaceId: selectedSpaceId,
    enabled: !!selectedSpaceId,
  });
  const { data: plugins } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
    // The listing only feeds the per-plugin subtree below; skip it when the
    // operator hides the Plugins surface.
    enabled: showPlugins,
  });
  const sidebarPlugins = (plugins ?? []).filter((plugin) => !isSandboxProviderOnly(plugin));

  return (
    <ContextualSidebarFrame
      surface="settings"
      title="Settings"
      showHeader={false}
      className={primarySidebarStyles.surface}
    >
      <div
        data-slot="settings-sidebar-header"
        className="flex h-(--sz-60px) shrink-0 items-center px-3"
      >
        <div data-slot="settings-back-group" className={`${primarySidebarStyles.group} w-full`}>
          <SidebarNavItem to="/dashboard" label="Back to app" icon={ArrowLeft} />
        </div>
      </div>
      <nav
        aria-label="Settings"
        data-slot="contextual-sidebar-nav"
        className={primarySidebarStyles.nav}
      >
        <div data-slot="contextual-sidebar-group" className={primarySidebarStyles.group}>
          <SidebarNavItem to="/space/settings" label="General" icon={SlidersHorizontal} end />
          {spaceSettingsPluginSlots
            .filter((slot) => slot.routePath)
            .map((slot) => (
              <SidebarNavItem
                key={`${slot.pluginKey}:${slot.id}`}
                to={`/space/settings/${slot.routePath}`}
                label={slot.displayName}
                icon={Puzzle}
                end
              />
            ))}
          {showPage("instance.experimental") && (
            <SidebarNavItem
              to={`${INSTANCE_SETTINGS_PATH_PREFIX}/experimental`}
              label="Experimental"
              icon={FlaskConical}
            />
          )}
          {showPlugins && (
            <SidebarNavItem
              to={`${INSTANCE_SETTINGS_PATH_PREFIX}/plugins`}
              label="Plugins"
              icon={Puzzle}
            />
          )}
          {showPlugins && sidebarPlugins.length > 0 ? (
            <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-border/70 pl-3">
              {sidebarPlugins.map((plugin) => (
                <NavLink
                  key={plugin.id}
                  to={`${INSTANCE_SETTINGS_PATH_PREFIX}/plugins/${plugin.id}`}
                  state={SIDEBAR_SCROLL_RESET_STATE}
                  className={({ isActive }) =>
                    [
                      "rounded-md px-2 py-1.5 text-xs transition-colors",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    ].join(" ")
                  }
                >
                  {plugin.manifestJson.displayName ?? plugin.packageName}
                </NavLink>
              ))}
            </div>
          ) : null}
          {showPage("instance.adapters") && (
            <SidebarNavItem
              to={`${INSTANCE_SETTINGS_PATH_PREFIX}/adapters`}
              label="Adapters"
              icon={Cpu}
            />
          )}
        </div>
      </nav>
    </ContextualSidebarFrame>
  );
}
