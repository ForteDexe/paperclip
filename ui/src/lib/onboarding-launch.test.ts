import { describe, expect, it } from "vitest";
import {
  buildOnboardingIssuePayload,
  buildOnboardingProjectPayload,
  selectDefaultSpaceGoalId,
  selectReusableOnboardingProject,
} from "./onboarding-launch";

describe("selectDefaultSpaceGoalId", () => {
  it("prefers the earliest active root space goal", () => {
    expect(
      selectDefaultSpaceGoalId([
        {
          id: "team-goal",
          spaceId: "space-1",
          title: "Nested",
          description: null,
          level: "team",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-04T00:00:00Z"),
          updatedAt: new Date("2026-03-04T00:00:00Z"),
        },
        {
          id: "goal-2",
          spaceId: "space-1",
          title: "Later active root",
          description: null,
          level: "space",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-03T00:00:00Z"),
          updatedAt: new Date("2026-03-03T00:00:00Z"),
        },
        {
          id: "goal-1",
          spaceId: "space-1",
          title: "Earliest active root",
          description: null,
          level: "space",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-02T00:00:00Z"),
          updatedAt: new Date("2026-03-02T00:00:00Z"),
        },
      ]),
    ).toBe("goal-1");
  });

  it("falls back to the earliest root space goal when none are active", () => {
    expect(
      selectDefaultSpaceGoalId([
        {
          id: "goal-2",
          spaceId: "space-1",
          title: "Cancelled root",
          description: null,
          level: "space",
          status: "cancelled",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-03T00:00:00Z"),
          updatedAt: new Date("2026-03-03T00:00:00Z"),
        },
        {
          id: "goal-1",
          spaceId: "space-1",
          title: "Earliest root",
          description: null,
          level: "space",
          status: "planned",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-02T00:00:00Z"),
          updatedAt: new Date("2026-03-02T00:00:00Z"),
        },
      ]),
    ).toBe("goal-1");
  });
});

describe("onboarding launch payloads", () => {
  it("reuses a non-cancelled Onboarding project by name", () => {
    expect(
      selectReusableOnboardingProject([
        { id: "cancelled", name: "Onboarding", status: "cancelled" },
        { id: "active", name: " onboarding ", status: "in_progress" },
      ]),
    ).toEqual({ id: "active", name: " onboarding ", status: "in_progress" });

    expect(
      selectReusableOnboardingProject([
        { id: "cancelled", name: "Onboarding", status: "cancelled" },
        { id: "other", name: "Roadmap", status: "in_progress" },
      ]),
    ).toBeNull();
  });

  it("links the onboarding project and first issue to the selected goal", () => {
    expect(buildOnboardingProjectPayload("goal-1")).toEqual({
      name: "Onboarding",
      status: "in_progress",
      goalIds: ["goal-1"],
    });

    expect(
      buildOnboardingIssuePayload({
        title: "  Create your first engineer  ",
        assigneeAgentId: "agent-1",
        projectId: "project-1",
        goalId: "goal-1",
      }),
    ).toEqual({
      title: "Create your first engineer",
      assigneeAgentId: "agent-1",
      projectId: "project-1",
      goalId: "goal-1",
      status: "todo",
      onboardingFirstTask: true,
    });
  });

  it("sends no client description — the server owns the first task's brief", () => {
    const payload = buildOnboardingIssuePayload({
      title: "Task",
      assigneeAgentId: "agent-1",
      projectId: "project-1",
      goalId: null,
    });
    expect(payload).not.toHaveProperty("description");
    expect(payload.onboardingFirstTask).toBe(true);
  });

  it("omits goal links when no default space goal exists", () => {
    expect(buildOnboardingProjectPayload(null)).toEqual({
      name: "Onboarding",
      status: "in_progress",
    });

    expect(
      buildOnboardingIssuePayload({
        title: "Task",
        assigneeAgentId: "agent-1",
        projectId: "project-1",
        goalId: null,
      }),
    ).toEqual({
      title: "Task",
      assigneeAgentId: "agent-1",
      projectId: "project-1",
      status: "todo",
      onboardingFirstTask: true,
    });
  });
});
