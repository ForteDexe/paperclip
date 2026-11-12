// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveStreamlinedUiEnabled,
  useStreamlinedUiEnabled,
} from "./useStreamlinedUiEnabled";

function Probe() {
  const state = useStreamlinedUiEnabled();
  return <output>{`${state.enabled}:${state.loaded}`}</output>;
}

describe("useStreamlinedUiEnabled", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  it("always selects the single Outpost shell", () => {
    expect(resolveStreamlinedUiEnabled(undefined)).toBe(true);
    expect(resolveStreamlinedUiEnabled(null)).toBe(true);
    expect(resolveStreamlinedUiEnabled({ enableStreamlinedUi: true })).toBe(true);
    expect(resolveStreamlinedUiEnabled({ enableStreamlinedUi: false })).toBe(true);

    flushSync(() => {
      root.render(<Probe />);
    });

    expect(host.textContent).toBe("true:true");
  });
});
