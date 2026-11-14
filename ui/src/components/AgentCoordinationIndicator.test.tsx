// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentCoordinationIndicator } from "./AgentCoordinationIndicator";

describe("AgentCoordinationIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("hides the crown when an agent has no coordinated agents", () => {
    act(() => root.render(
      <TooltipProvider><AgentCoordinationIndicator directReportCount={0} /></TooltipProvider>,
    ));
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it("shows the crown with the number of coordinated agents", () => {
    act(() => root.render(
      <TooltipProvider><AgentCoordinationIndicator directReportCount={2} /></TooltipProvider>,
    ));
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Coordinates 2 agents");
  });
});
