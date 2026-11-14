// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Agent } from "@outpost/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DefaultAgentCrownButton, DefaultAgentPresentationProvider } from "./DefaultAgentPresentation";

const agent = (id: string, name: string) => ({ id, name, spaceId: "space-a", status: "idle" }) as Agent;
const lead = agent("lead", "Default agent");
const engineering_lead = agent("engineering_lead", "Engineering Lead");

let root: Root;
let container: HTMLDivElement;

function Harness({ initial, onChange, error, onRetry }: {
  initial: Agent | null;
  onChange: (agentId: string) => void;
  error?: string;
  onRetry?: () => void;
}) {
  const [primary, setPrimary] = useState<Agent | null>(initial);
  return (
    <TooltipProvider>
      <DefaultAgentPresentationProvider value={{
        spaceId: "space-a",
        defaultAgentId: primary?.id ?? null,
        defaultAgent: primary,
        error,
        onRetry,
        onChange: (agentId) => {
          onChange(agentId);
          setPrimary([lead, engineering_lead].find((candidate) => candidate.id === agentId) ?? null);
        },
      }}>
        <DefaultAgentCrownButton agent={lead} />
      </DefaultAgentPresentationProvider>
    </TooltipProvider>
  );
}

async function render(props: Parameters<typeof Harness>[0]) {
  await act(async () => root.render(<Harness {...props} />));
}

const crown = () => container.querySelector<HTMLElement>(".primary-crown");
const nextTick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const dialog = () => document.body.querySelector<HTMLElement>("[role=alertdialog]");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("DefaultAgentCrownButton", () => {
  it("sets the default at once when there is no default agent yet", async () => {
    const onChange = vi.fn();
    await render({ initial: null, onChange });
    expect(crown()?.getAttribute("aria-label")).toBe("Set as default agent");

    await act(async () => crown()?.click());

    expect(onChange).toHaveBeenCalledWith("lead");
    expect(dialog()).toBeNull();
    expect(crown()?.getAttribute("role")).toBe("img");
    expect(crown()?.getAttribute("aria-label")).toBe("Default agent");
    expect(crown()?.dataset.pop).toBe("now");
    const bubbles = Array.from(crown()?.querySelectorAll<HTMLElement>(".primary-crown-bubble") ?? []);
    expect(bubbles).toHaveLength(3);
    for (const bubble of bubbles) {
      expect(Number(bubble.style.getPropertyValue("--bubble-size"))).toBeGreaterThan(0);
      expect(Number(bubble.style.getPropertyValue("--bubble-travel"))).toBeGreaterThan(0);
    }
  });

  it("asks before replacing the current default agent, then fills after the dialog", async () => {
    const onChange = vi.fn();
    await render({ initial: engineering_lead, onChange });

    await act(async () => crown()?.click());
    expect(dialog()?.textContent).toContain("Change the default agent?");
    expect(onChange).not.toHaveBeenCalled();

    const confirm = Array.from(dialog()?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Set as default agent");
    await act(async () => confirm?.click());

    expect(onChange).toHaveBeenCalledWith("lead");
    expect(crown()?.getAttribute("aria-label")).toBe("Default agent");
    expect(crown()?.dataset.pop).toBe("after-dialog");
    await nextTick();
    expect(document.activeElement).toBe(crown());
    expect(document.body.querySelector("[data-slot=tooltip-content]")).toBeNull();
  });

  it("keeps the current default agent when the dialog is cancelled", async () => {
    const onChange = vi.fn();
    await render({ initial: engineering_lead, onChange });

    await act(async () => crown()?.click());
    const cancel = Array.from(dialog()?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());

    expect(onChange).not.toHaveBeenCalled();
    expect(crown()?.getAttribute("aria-label")).toBe("Set as default agent");
    await nextTick();
    expect(document.activeElement).toBe(crown());
    expect(document.body.querySelector("[data-slot=tooltip-content]")).toBeNull();
  });

  it("shows a still, filled pin on the default agent", async () => {
    await render({ initial: lead, onChange: vi.fn() });
    expect(crown()?.getAttribute("role")).toBe("img");
    expect(crown()?.dataset.pop).toBeUndefined();
    expect(crown()?.querySelector(".primary-crown-bubble")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("retries loading when the default agent could not be loaded", async () => {
    const onRetry = vi.fn();
    await render({ initial: null, onChange: vi.fn(), error: "offline", onRetry });

    await act(async () => crown()?.click());

    expect(crown()?.getAttribute("aria-label")).toBe("Retry loading default agent");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
