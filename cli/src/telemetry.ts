import {
  TelemetryClient,
  trackInstallStarted,
  trackInstallCompleted,
  trackSpaceImported,
} from "../../packages/shared/src/telemetry/index.js";

export function initTelemetry(_fileConfig?: { enabled?: boolean }): TelemetryClient | null {
  return null;
}

export function initTelemetryFromConfigFile(_configPath?: string): TelemetryClient | null {
  return null;
}

export function getTelemetryClient(): TelemetryClient | null {
  return null;
}

export async function flushTelemetry(): Promise<void> {
  // Outpost never sends vendor telemetry.
}

export {
  trackInstallStarted,
  trackInstallCompleted,
  trackSpaceImported,
};
