import { describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys";

describe("project query keys", () => {
  it("separates default and includeArchived project list caches", () => {
    expect(queryKeys.projects.list("space-1")).toEqual([
      "projects",
      "space-1",
      { includeArchived: false },
    ]);
    expect(queryKeys.projects.list("space-1", { includeArchived: true })).toEqual([
      "projects",
      "space-1",
      { includeArchived: true },
    ]);
    expect(queryKeys.projects.list("space-1")).not.toEqual(
      queryKeys.projects.list("space-1", { includeArchived: true }),
    );
    expect(queryKeys.projects.all("space-1")).toEqual(["projects", "space-1"]);
  });
});

describe("audit query keys", () => {
  it("separates entity-scoped activity from the unscoped feed", () => {
    const unscoped = queryKeys.audit.agentActions("space-1", { actorScope: "all" });
    const routine = queryKeys.audit.agentActions("space-1", {
      actorScope: "all",
      entityType: "routine",
      entityId: "routine-1",
    });

    expect(routine).not.toEqual(unscoped);
    expect(routine).toContain("routine-1");
  });
});
