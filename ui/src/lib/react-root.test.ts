import { describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import {
  getOrCreateOutpostReactRoot,
  type OutpostReactRootHost,
} from "./react-root";

describe("getOrCreateOutpostReactRoot", () => {
  it("reuses the existing root when the entry module runs again", () => {
    const host: OutpostReactRootHost = {};
    const container = {} as Parameters<typeof getOrCreateOutpostReactRoot>[1];
    const root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
    const createRoot = vi.fn(() => root);

    expect(getOrCreateOutpostReactRoot(host, container, createRoot)).toBe(root);
    expect(getOrCreateOutpostReactRoot(host, container, createRoot)).toBe(root);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
  });
});
