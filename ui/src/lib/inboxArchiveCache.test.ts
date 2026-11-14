import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Issue } from "@outpost/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginLocalInboxArchive,
  boundLocalInboxArchive,
  clearLocalInboxArchive,
  confirmLocalInboxArchive,
  filterLocalInboxArchivedIssues,
  getIssuePresenceInActiveInboxCaches,
  getLocalInboxArchiveIssueIds,
  removeIssueFromInboxCaches,
  restoreIssueToInboxCaches,
  snapshotInboxIssueCaches,
} from "./inboxArchiveCache";
import { queryKeys } from "./queryKeys";

function issue(id: string): Issue {
  return { id } as Issue;
}

describe("inboxArchiveCache", () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const issueId of getLocalInboxArchiveIssueIds("space-1")) {
      clearLocalInboxArchive("space-1", issueId);
    }
  });

  it("restores only the failed archive during overlapping optimistic removals", () => {
    const spaceId = "space-1";
    const queryClient = new QueryClient();
    const queryKey = [...queryKeys.issues.listMineByMe(spaceId), "with-routine-executions"] as const;

    queryClient.setQueryData<Issue[]>(queryKey, [
      issue("issue-a"),
      issue("issue-b"),
      issue("issue-c"),
    ]);

    const archiveASnapshot = snapshotInboxIssueCaches(queryClient, spaceId);
    removeIssueFromInboxCaches(queryClient, spaceId, "issue-a");

    const archiveBSnapshot = snapshotInboxIssueCaches(queryClient, spaceId);
    removeIssueFromInboxCaches(queryClient, spaceId, "issue-b");

    restoreIssueToInboxCaches(queryClient, archiveASnapshot, "issue-a");

    expect(queryClient.getQueryData<Issue[]>(queryKey)?.map((cachedIssue) => cachedIssue.id)).toEqual([
      "issue-a",
      "issue-c",
    ]);

    restoreIssueToInboxCaches(queryClient, archiveBSnapshot, "issue-b");

    expect(queryClient.getQueryData<Issue[]>(queryKey)?.map((cachedIssue) => cachedIssue.id)).toEqual([
      "issue-a",
      "issue-b",
      "issue-c",
    ]);
  });

  it("filters locally archived issues until confirmed grace expires", () => {
    vi.useFakeTimers();
    const issues = [issue("issue-a"), issue("issue-b")];

    beginLocalInboxArchive("space-1", "issue-a");
    expect(filterLocalInboxArchivedIssues("space-1", issues)).toEqual([issue("issue-b")]);

    confirmLocalInboxArchive("space-1", "issue-a");
    vi.advanceTimersByTime(4_999);
    expect(filterLocalInboxArchivedIssues("space-1", issues)).toEqual([issue("issue-b")]);

    vi.advanceTimersByTime(1);
    expect(filterLocalInboxArchivedIssues("space-1", issues)).toEqual(issues);
  });

  it("does not let a completed archive release a newer operation's hide flag", () => {
    const releaseOld = beginLocalInboxArchive("space-1", "issue-a");
    const releaseNew = beginLocalInboxArchive("space-1", "issue-a");
    releaseOld();
    expect(getLocalInboxArchiveIssueIds("space-1").has("issue-a")).toBe(true);
    releaseNew();
    expect(getLocalInboxArchiveIssueIds("space-1").has("issue-a")).toBe(false);
    releaseOld();
    releaseNew();
    expect(getLocalInboxArchiveIssueIds("space-1").size).toBe(0);
  });

  it("does not expire an in-flight archive before post-settle bounding starts", () => {
    vi.useFakeTimers();
    beginLocalInboxArchive("space-1", "issue-a");

    vi.advanceTimersByTime(30_000);
    expect(getLocalInboxArchiveIssueIds("space-1").has("issue-a")).toBe(true);

    boundLocalInboxArchive("space-1", "issue-a");
    vi.advanceTimersByTime(29_999);
    expect(getLocalInboxArchiveIssueIds("space-1").has("issue-a")).toBe(true);

    vi.advanceTimersByTime(1);
    expect(getLocalInboxArchiveIssueIds("space-1").has("issue-a")).toBe(false);
  });

  it("distinguishes present, absent, and unavailable active inbox data", () => {
    const spaceId = "space-1";
    const queryClient = new QueryClient();
    const queryKey = [...queryKeys.issues.listMineByMe(spaceId), "with-routine-executions"] as const;

    expect(getIssuePresenceInActiveInboxCaches(queryClient, spaceId, "issue-a")).toBe("unknown");

    queryClient.setQueryData<Issue[]>(queryKey, [issue("issue-a")]);
    const observer = new QueryObserver<Issue[]>(queryClient, {
      queryKey,
      queryFn: async () => [],
    });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(getIssuePresenceInActiveInboxCaches(queryClient, spaceId, "issue-a")).toBe("present");
    queryClient.setQueryData<Issue[]>(queryKey, [issue("issue-b")]);
    expect(getIssuePresenceInActiveInboxCaches(queryClient, spaceId, "issue-a")).toBe("absent");

    unsubscribe();
  });
});
