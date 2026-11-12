import type { InstanceExperimentalSettings } from "@paperclipai/shared";

export function resolveStreamlinedUiEnabled(
  settings:
    | Pick<InstanceExperimentalSettings, "enableStreamlinedUi">
    | null
    | undefined,
): boolean {
  // Outpost has one application shell. Keep the legacy value readable in
  // stored settings, but never let it select a second navigation system.
  void settings;
  return true;
}

/** The streamlined shell is Outpost's only application shell. */
export function useStreamlinedUiEnabled(): { enabled: boolean; loaded: boolean } {
  return { enabled: true, loaded: true };
}
