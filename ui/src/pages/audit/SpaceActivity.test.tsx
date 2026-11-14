// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SpaceActivity } from "./SpaceActivity.production";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@/context/SpaceContext", () => ({ useSpace: () => ({ selectedSpaceId: "space-1" }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("@/hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: false }) }));
vi.mock("@/lib/router", () => ({
  useSearchParams: () => [new URLSearchParams("entityType=case&entityId=CAS-C1&action=case."), vi.fn()],
}));
vi.mock("./AuditHub", () => ({ AuditHub: () => <div>Audit hub</div> }));
vi.mock("./AuditFeed", () => ({
  AuditFeed: (props: { spaceId: string; lockedEntity?: { type: string; id: string }; actionDomain: string }) => (
    <div data-space={props.spaceId} data-entity={JSON.stringify(props.lockedEntity)} data-action={props.actionDomain} />
  ),
}));

it("preserves case audit links when the streamlined shell is off", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SpaceActivity />));
    expect(container.firstElementChild?.getAttribute("data-space")).toBe("space-1");
    expect(container.firstElementChild?.getAttribute("data-entity")).toBe(JSON.stringify({ type: "case", id: "CAS-C1" }));
    expect(container.firstElementChild?.getAttribute("data-action")).toBe("case.");
  } finally {
    await act(async () => root.unmount());
  }
});
