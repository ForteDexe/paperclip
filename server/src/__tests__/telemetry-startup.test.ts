import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stateFactory = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/shared/telemetry", async (importOriginal) => ({
  ...await importOriginal<typeof import("@paperclipai/shared/telemetry")>(),
  loadOrCreateState: stateFactory,
}));

describe("server telemetry startup", () => {
  beforeEach(() => {
    vi.resetModules();
    stateFactory.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([undefined, { enabled: false }, { enabled: true }])(
    "never creates a client or sends vendor telemetry for %j",
    async (config) => {
      const { initTelemetry, getTelemetryClient } = await import("../telemetry.js");

      expect(initTelemetry(config)).toBeNull();
      expect(getTelemetryClient()).toBeNull();
      expect(stateFactory).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
