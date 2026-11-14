import type { PluginEvent } from "@outpost/plugin-sdk";

export interface ActivityPublication {
  spaceId: string;
  payload: Record<string, unknown>;
  pluginEvent: PluginEvent | null;
}
