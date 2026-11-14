import { expect, test } from "@playwright/test";
import { collectionFixture, type CollectionFixture } from "./fixture";

let fixture: CollectionFixture;
test.beforeAll(async ({ request }) => {
  fixture = await collectionFixture(request);
});

// A 12-task history used to cost three serial five-ID summary requests on
// every page load. It must be one request.
test("Mine refreshes a recent-task history with one summaries request", async ({ page, request }) => {
  const session = await (await request.get("/api/auth/get-session")).json().catch(() => null);
  const userId: string | null = session?.user?.id ?? session?.session?.userId ?? null;
  const spaceId = fixture.space.id;
  const taskIds = fixture.taskIds.slice(0, 12);
  await page.addInitScript(({ spaceId, userId, taskIds }) => {
    const entries = taskIds.map((id, index) => ({
      id, spaceId, title: `Recent ${index}`, identifier: null, status: "backlog", recordedAt: Date.now() - index * 1000,
    }));
    for (const owner of new Set([userId ?? "__local_operator__", "__local_operator__"])) {
      localStorage.setItem(`outpost.recentTasks.v2:${spaceId}:${owner}`, JSON.stringify(entries));
    }
  }, { spaceId, userId, taskIds });
  const summaries: URL[] = [];
  page.on("request", item => {
    const url = new URL(item.url());
    if (url.pathname === `/api/spaces/${spaceId}/issues/summaries`) summaries.push(url);
  });
  const response = page.waitForResponse(item => new URL(item.url()).pathname === `/api/spaces/${spaceId}/issues/summaries`);
  await page.goto(`/${fixture.space.issuePrefix}/issues?view=mine`);
  // The server must accept the whole batch, not just receive it.
  const first = await response;
  expect(first.status()).toBe(200);
  const rows = await first.json() as Array<{ id: string }>;
  expect(rows.map(row => row.id).sort()).toEqual([...taskIds].sort());
  // Allow any follow-up chunk to start before counting.
  await page.waitForTimeout(1_500);
  // The live-updates socket may refresh the batch once after it opens; that
  // repeats the same request. Chunked requests would each carry fewer IDs.
  for (const url of summaries) expect(url.searchParams.get("ids")!.split(",")).toHaveLength(12);
  expect(summaries.length).toBeLessThanOrEqual(2);
});
