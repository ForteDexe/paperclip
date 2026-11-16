// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ConversationAlertBanner, partitionConversationFailureItems } from "./ConversationAlertBanner";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConversationAlertBanner", () => {
  it("shows the failure and lets the user dismiss it", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const dismiss = vi.fn();
    act(() => root.render(<ConversationAlertBanner title="Run failed" detail="Model unavailable" onDismiss={dismiss} />));
    expect(host.textContent).toContain("Run failed · Model unavailable");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss alert"]')!.click());
    expect(dismiss).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("lifts ordinary run failures out of Agent Chat but keeps actionable credential errors inline", () => {
    const failure = { id: "failed", kind: "marker", variant: "interrupted", tone: "error", label: "Run failed" } as const;
    const credential = {
      id: "credential",
      kind: "marker",
      variant: "interrupted",
      tone: "error",
      label: "Credential access needed",
      credentialAccess: { agentName: "Rocky", deniedUser: "User", settingsHref: "/settings" },
    } as const;
    const result = partitionConversationFailureItems([failure, credential]);
    expect(result.failures).toEqual([failure]);
    expect(result.rest).toEqual([credential]);
  });
});
