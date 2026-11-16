// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMPFIRE_RUNNING_FRAMES,
  CampfireAgentStatus,
  campfireAgentStatusLabel,
} from "./CampfireAgentStatus";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CampfireAgentStatus", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("uses resting semantics for invokable agents that are not running", () => {
    expect(campfireAgentStatusLabel("active")).toBe("resting");
    expect(campfireAgentStatusLabel("idle")).toBe("resting");
    expect(campfireAgentStatusLabel("paused")).toBe("paused");
    expect(campfireAgentStatusLabel("error")).toBe("error");
  });

  it("cycles through the original Campfire running frames", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<CampfireAgentStatus status="running" name="Rocky" />));
    expect(host.textContent).toBe(CAMPFIRE_RUNNING_FRAMES[0]);
    act(() => vi.advanceTimersByTime(90));
    expect(host.textContent).toBe(CAMPFIRE_RUNNING_FRAMES[1]);
    expect(host.querySelector('[aria-label="Rocky is running"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
