import { expect, test, type Page } from "@playwright/test";

/**
 * Archived-space URL handling.
 *
 * Regression (React #185): landing on an archived space's URL crashed the
 * app — the Layout route-sync selected the archived space while the
 * SpaceProvider bootstrap resolver rejected it, and the two effects
 * ping-ponged the selection until React blew the nested-update limit.
 *
 * Policy: stale state (remembered paths, browser history, bookmarks,
 * restored tabs) keeps depositing users into archived spaces long after
 * archiving, so a cold arrival bounces to an active space with a toast.
 * A deliberate visit — selecting the archived space from the spaces
 * list — sticks, so its pages stay reachable.
 */

async function createSpace(page: Page, name: string): Promise<{ id: string; prefix: string }> {
  const res = await page.request.post("/api/spaces", { data: { name } });
  expect(res.ok(), `create space failed ${res.status()}: ${await res.text()}`).toBe(true);
  const space = await res.json();
  return { id: space.id, prefix: space.issuePrefix ?? space.prefix ?? "E2E" };
}

function collectFatalErrors(page: Page): string[] {
  const fatal: string[] = [];
  page.on("pageerror", (err) => {
    fatal.push(`PAGEERROR: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!/App shell crashed|Page render failed|Minified React error #185|Maximum update depth/.test(text)) {
      return;
    }
    fatal.push(`CONSOLE: ${text.slice(0, 300)}`);
  });
  return fatal;
}

test("archived space URLs bounce cold arrivals and honor deliberate visits", async ({ page }) => {
  const fatal = collectFatalErrors(page);

  const active = await createSpace(page, "Archived Loop Active");
  const archived = await createSpace(page, "Archived Loop Archived");
  const archiveRes = await page.request.patch(`/api/spaces/${archived.id}`, {
    data: { status: "archived" },
  });
  expect(archiveRes.ok(), `archive failed ${archiveRes.status()}: ${await archiveRes.text()}`).toBe(true);

  // The e2e server is shared across specs, so other spaces exist and the
  // bounce may pick any active one; the contract is only "not the archived
  // space's routes anymore".
  const awayFromArchived = (url: URL) =>
    url.pathname.endsWith("/dashboard") && !url.pathname.startsWith(`/${archived.prefix}/`);

  // Cold arrival #1: a fresh load straight onto the archived space's
  // remembered URL (previously the first-open blank-screen crash) bounces
  // to an active space.
  await page.goto(`/${archived.prefix}/dashboard`);
  await page.waitForURL(awayFromArchived, { timeout: 15_000 });
  await expect(page.getByText("Archived Loop Archived is archived")).toBeVisible();
  expect(fatal, `crash on direct load of archived space URL:\n${fatal.join("\n")}`).toEqual([]);

  // Cold arrival #2: re-arrival at the archived URL (previously the
  // "switched back" crash) bounces the same way.
  await page.goto(`/${archived.prefix}/issues`);
  await page.waitForURL(awayFromArchived, { timeout: 15_000 });
  expect(fatal, `crash on re-arrival at archived space URL:\n${fatal.join("\n")}`).toEqual([]);

  // Deliberate visit: selecting the archived space from the spaces list
  // sticks — no bounce — so its pages (and the way back to unarchiving) stay
  // reachable.
  await page.goto(`/${active.prefix}/spaces`);
  await page.waitForLoadState("networkidle");
  await page.getByText("Archived Loop Archived").first().click();
  await page.waitForURL(new RegExp(`/${archived.prefix}/`), { timeout: 15_000 });
  await page.waitForTimeout(1_500);
  expect(page.url()).toMatch(new RegExp(`/${archived.prefix}/`));
  expect(fatal, `crash during deliberate archived visit:\n${fatal.join("\n")}`).toEqual([]);

  const rootContent = await page.locator("#root").innerText().catch(() => "");
  expect(rootContent.length).toBeGreaterThan(0);
});
