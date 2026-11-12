// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { StatusCardSettingsForm, defaultSettingsValue, type StatusCardSettingsValue } from "./StatusCardSettingsForm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function render(value: StatusCardSettingsValue) {
  flushSync(() =>
    root.render(
      <TooltipProvider>
        <StatusCardSettingsForm value={value} onChange={() => {}} />
      </TooltipProvider>,
    ),
  );
}

describe("StatusCardSettingsForm usage controls", () => {
  it("does not render monetary estimates in manual mode", () => {
    render(defaultSettingsValue());
    expect(container.textContent).not.toContain("Estimated cost");
    expect(container.textContent).not.toContain("$");
  });

  it("keeps token controls without rendering monetary estimates", () => {
    render({
      ...defaultSettingsValue(),
      refreshPolicy: { mode: "interval", intervalMinutes: 30, triggers: defaultSettingsValue().refreshPolicy.triggers },
    });
    expect(container.textContent).toContain("Advanced");
    expect(container.textContent).not.toContain("Estimated cost");
    expect(container.textContent).not.toContain("$");
  });
});

describe("StatusCardSettingsForm advanced group", () => {
  it("hides the Advanced group in manual mode", () => {
    render(defaultSettingsValue());
    expect(container.textContent).not.toContain("Advanced");
    expect(container.textContent).not.toContain("Count as a change");
  });

  it("reveals the collapsed Advanced group when auto-updating", () => {
    render({
      ...defaultSettingsValue(),
      refreshPolicy: { mode: "interval", intervalMinutes: 30, triggers: defaultSettingsValue().refreshPolicy.triggers },
    });
    // The disclosure trigger is present; its contents stay collapsed until opened.
    expect(container.textContent).toContain("Advanced");
    expect(container.textContent).not.toContain("Count as a change");
  });
});
