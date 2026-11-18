// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Issue, TaskRecordDocument } from "@outpost/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskRecordPanel } from "./TaskRecordPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recordDocument: TaskRecordDocument = {
  id: "record-document",
  spaceId: "space-1",
  issueId: "task-1",
  key: "working-spec",
  title: "Task Record",
  format: "task_record",
  latestRevisionId: "11111111-1111-4111-8111-111111111111",
  latestRevisionNumber: 2,
  createdByAgentId: null,
  createdByUserId: "operator",
  updatedByAgentId: null,
  updatedByUserId: "operator",
  lockedAt: null,
  lockedByAgentId: null,
  lockedByUserId: null,
  sourceTrust: null,
  createdAt: new Date("2026-11-18T12:00:00.000Z"),
  updatedAt: new Date("2026-11-18T12:05:00.000Z"),
  record: {
    version: 2,
    intent: "Prove the parser workflow.",
    features: [{
      id: "parse_input",
      behavior: "Parse input",
      outcome: "Return normalized records.",
      state: "testing",
      validation: "Fixture run is in progress.",
    }],
    constraintsAndNonGoals: ["Do not mutate input files."],
    decisions: [],
    openQuestions: ["Should malformed rows be skipped?"],
    nextStep: { featureId: "parse_input", comment: "Finish the fixture run." },
    resultsAndVerification: [],
  },
};

vi.mock("@/hooks/useTaskRecord", () => ({
  useTaskRecord: () => ({ data: recordDocument, isLoading: false }),
}));

describe("TaskRecordPanel structured workflow fields", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("presents feature validation and unresolved questions as first-class fields", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const issue = { id: "task-1", title: "Parser", description: "Prove the parser workflow." } as Issue;

    await act(async () => root!.render(
      <QueryClientProvider client={client}>
        <TaskRecordPanel issue={issue} />
      </QueryClientProvider>,
    ));

    expect(container.textContent).toContain("Fixture run is in progress.");
    expect(container.textContent).toContain("Should malformed rows be skipped?");
    const wrapUp = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Final — Wrap up"));
    expect(wrapUp?.disabled).toBe(true);
    expect(wrapUp?.title).toBe("Resolve or remove every Open Question before wrapping up");

    const edit = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Edit record"));
    await act(async () => edit?.click());

    expect(container.querySelector('textarea[aria-label="Feature 1 validation"]')).not.toBeNull();
    expect(container.querySelector('textarea[aria-label="Open Questions item 1"]')).not.toBeNull();
  });
});
