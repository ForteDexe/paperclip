// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewAgentDialog } from "./NewAgentDialog";

const agents = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), get: vi.fn() }));
const state = vi.hoisted(() => ({ navigate: vi.fn(), close: vi.fn() }));

vi.mock("@/api/agents", () => ({ agentsApi: agents }));
vi.mock("@/api/adapters", () => ({
  adaptersApi: {
    list: async () => [
      { type: "codex_local", loaded: true },
      { type: "claude_local", loaded: true },
      { type: "opencode_local", loaded: true },
      { type: "outpost_runner", loaded: true },
    ],
  },
}));
vi.mock("@/context/SpaceContext", () => ({
  useSpace: () => ({ selectedSpaceId: "space-1" }),
}));
vi.mock("@/context/DialogContext", () => ({
  useDialog: () => ({ newAgentOpen: true, closeNewAgent: state.close }),
}));
vi.mock("@/lib/router", () => ({ useNavigate: () => state.navigate }));
vi.mock("@/hooks/useAgentAppearanceDraft", () => ({
  useAgentAppearanceDraft: () => ({ appearance: {}, setAppearance: vi.fn() }),
}));
vi.mock("./AgentCharacter", () => ({ AgentCharacter: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

beforeEach(async () => {
  vi.clearAllMocks();
  agents.create.mockImplementation(async (_spaceId, input) => ({
    ...input,
    id: input.setupId,
    metadata: input.metadata ?? {},
  }));
  agents.update.mockImplementation(async (id, input) => ({ id, name: "Rocky", ...input }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={cache}>
        <NewAgentDialog />
      </QueryClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
  container.remove();
});

it("offers only the supported local Codex and Claude agents", async () => {
  const input = document.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Rocky");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Choose adapter");

  expect(document.querySelector('input[value="codex_local"]')).toBeTruthy();
  expect(document.querySelector('input[value="claude_local"]')).toBeTruthy();
  expect(document.querySelector('input[value="opencode_local"]')).toBeNull();
  expect(document.querySelector('input[value="outpost_runner"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Invite an external agent");
});
