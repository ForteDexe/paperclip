import { afterEach, describe, expect, it } from "vitest";
import type { ServerAdapterModule } from "./types.js";
import { BUILTIN_ADAPTER_TYPES, OUTPOST_AGENT_ADAPTER_TYPES } from "./builtin-adapter-types.js";
import {
  findActiveServerAdapter,
  listServerAdapters,
  registerServerAdapter,
  requireServerAdapter,
  setOverridePaused,
  unregisterServerAdapter,
} from "./registry.js";

describe("retained server adapter registry", () => {
  afterEach(() => {
    setOverridePaused("codex_local", false);
    unregisterServerAdapter("codex_local");
  });

  it("ships only the retained built-ins and exposes only Codex and Claude for agents", () => {
    expect(new Set(listServerAdapters().map((adapter) => adapter.type))).toEqual(BUILTIN_ADAPTER_TYPES);
    expect(OUTPOST_AGENT_ADAPTER_TYPES).toEqual(new Set(["claude_local", "codex_local"]));
  });

  it.each(["claude_local", "codex_local"])("keeps %s as a native MCP harness", (type) => {
    const adapter = requireServerAdapter(type);
    expect(adapter.runtimeToolDelivery).toBe("native_mcp");
    expect(adapter.supportsInstructionsBundle).toBe(true);
    expect(adapter.supportsToolRefreshOnResume).toBe(true);
    expect(adapter.getRuntimeCommandSpec?.({})).toMatchObject({ command: type === "codex_local" ? "codex" : "claude" });
  });

  it("can pause and remove an external override without losing the Codex built-in", () => {
    const builtin = requireServerAdapter("codex_local");
    const external: ServerAdapterModule = { ...builtin, execute: async () => ({ exitCode: 0, signal: null, timedOut: false }) };

    registerServerAdapter(external);
    expect(findActiveServerAdapter("codex_local")).toBe(external);
    expect(setOverridePaused("codex_local", true)).toBe(true);
    expect(findActiveServerAdapter("codex_local")).toBe(builtin);
    expect(setOverridePaused("codex_local", false)).toBe(true);
    expect(findActiveServerAdapter("codex_local")).toBe(external);

    unregisterServerAdapter("codex_local");
    expect(findActiveServerAdapter("codex_local")).toBe(builtin);
  });
});
