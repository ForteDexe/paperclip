import { describe, expect, it } from "vitest";
import {
  isEnabledAdapterType,
  isValidAdapterType,
  isVisualAdapterChoice,
  listAdapterOptions,
} from "./metadata";
import type { UIAdapterModule } from "./types";

const externalAdapter: UIAdapterModule = {
  type: "external_test",
  label: "External Test",
  parseStdoutLine: () => [],
  ConfigFields: () => null,
  buildAdapterConfig: () => ({}),
};

describe("adapter metadata", () => {
  it("limits agent adapter choices to Claude and Codex", () => {
    expect(isEnabledAdapterType("external_test")).toBe(false);
    expect(isValidAdapterType("external_test")).toBe(false);

    expect(
      listAdapterOptions((type) => type, [externalAdapter]),
    ).toEqual([]);

    expect(listAdapterOptions((type) => type, [
      { ...externalAdapter, type: "claude_local" },
      { ...externalAdapter, type: "codex_local" },
      { ...externalAdapter, type: "gemini_local" },
    ]).map((option) => option.value)).toEqual(["claude_local", "codex_local"]);
  });

  it("keeps intentionally withheld built-in adapters marked as coming soon", () => {
    expect(isEnabledAdapterType("process")).toBe(false);
    expect(isEnabledAdapterType("http")).toBe(false);
  });

  it("marks the retired ACPX adapter as unavailable for new selections", () => {
    expect(isEnabledAdapterType("acpx_local")).toBe(false);
    expect(isValidAdapterType("acpx_local")).toBe(false);
    expect(isVisualAdapterChoice("acpx_local")).toBe(false);

    expect(listAdapterOptions((type) => type, [{ ...externalAdapter, type: "acpx_local" }])).toEqual([]);
  });
});
