// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DecisionHistoryTable } from "./DecisionHistory";

describe("empty model history", () => {
  it.each([
    [false, "No decision requests in this period."],
    [true, "No fast responses in this period."],
  ] as const)("renders an inert empty state for fast response %s", (fastResponse, message) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      flushSync(() => root.render(
        <DecisionHistoryTable entries={[]} fastResponse={fastResponse} />,
      ));
      expect(container.textContent).toBe(message);
      expect(container.querySelector("a")).toBeNull();
    } finally {
      flushSync(() => root.unmount());
    }
  });
});
