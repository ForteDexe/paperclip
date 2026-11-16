// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationAlertBanner, partitionConversationFailureItems, useDismissedConversationAlerts } from "./ConversationAlertBanner";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConversationAlertBanner", () => {
  afterEach(() => window.localStorage.clear());

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

  it("remembers a dismissal when the conversation is remounted", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const Dismissible = () => {
      const { dismissedIds, dismiss } = useDismissedConversationAlerts("campfire:space:room");
      return dismissedIds.has("failure-1") ? null : (
        <ConversationAlertBanner title="Run failed" onDismiss={() => dismiss(["failure-1"])} />
      );
    };
    let root = createRoot(host);
    act(() => root.render(<Dismissible />));
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss alert"]')!.click());
    expect(host.textContent).toBe("");
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<Dismissible />));
    expect(host.textContent).toBe("");
    act(() => root.unmount());
    host.remove();
  });
});
