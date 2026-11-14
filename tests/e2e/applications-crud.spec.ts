import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Current Apps lifecycle coverage. The legacy Tools -> Applications CRUD table
// was retired; old links now redirect to /apps. Keep this harness focused on
// the user-visible Connections list plus app Permissions flows.

type SeedResult = {
  spaceId: string;
  prefix: string;
};

const SCREENSHOT_DIR = "test-results";
const APP_PREFIX = `QA 10820 ${Date.now().toString(36)}`;

async function discoverSpace(request: APIRequestContext): Promise<SeedResult> {
  const res = await request.post("/api/spaces", {
    data: { name: `applications lifecycle ${Date.now()}` },
  });
  expect(res.ok(), `create space failed ${res.status()}: ${await res.text()}`).toBe(true);
  const space = await res.json();
  return {
    spaceId: space.id,
    prefix: space.issuePrefix ?? space.prefix ?? space.urlKey ?? "E2E",
  };
}

async function createApplication(
  request: APIRequestContext,
  spaceId: string,
  body: { name: string; description?: string; type?: string },
): Promise<{ id: string; name: string }> {
  const res = await request.post(`/api/spaces/${spaceId}/tools/applications`, {
    data: { type: "mcp_http", ...body },
  });
  if (!res.ok()) throw new Error(`create app failed ${res.status()}: ${await res.text()}`);
  return res.json();
}

async function createConnection(
  request: APIRequestContext,
  spaceId: string,
  data: { applicationName?: string; applicationId?: string; name: string; transport?: string; config?: object },
): Promise<{ id: string; applicationId: string; name: string }> {
  const res = await request.post(`/api/spaces/${spaceId}/tools/connections`, {
    data: {
      transport: "mcp_remote",
      config: { url: "http://127.0.0.1:65535/mcp" },
      enabled: true,
      status: "active",
      ...data,
    },
  });
  if (!res.ok()) throw new Error(`create connection failed ${res.status()}: ${await res.text()}`);
  return res.json();
}

async function gotoApps(page: Page, prefix: string) {
  await page.goto(`/${prefix}/apps/connections`);
  await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible({ timeout: 30_000 });
}

test.describe.serial("applications lifecycle", () => {
  let seed: SeedResult;

  test.beforeAll(async ({ request }) => {
    seed = await discoverSpace(request);
  });

  test.afterAll(async ({ request }) => {
    if (!seed?.spaceId) return;
    await request.delete(`/api/spaces/${seed.spaceId}`).catch(() => undefined);
  });

  test("Connections list surfaces connected and not-connected apps", async ({ page, request }) => {
    const connectedName = `${APP_PREFIX}-connected`;
    const notConnectedName = `${APP_PREFIX}-offline`;
    const connected = await createConnection(request, seed.spaceId, {
      applicationName: connectedName,
      name: connectedName,
    });
    const notConnected = await createApplication(request, seed.spaceId, { name: notConnectedName });

    await gotoApps(page, seed.prefix);

    // The connected app starts with a "Connected" status. A
    // background health sweep then probes the connection endpoint. The test
    // endpoint is an unreachable loopback URL, so the probe fails and the pill
    // becomes "Needs attention" and adds a "Reconnect" action. Both are
    // connected states that navigate to the same Permissions page. This test
    // proves the connected-vs-not-connected split, not the transient health
    // label, so accept either connected state instead of the racy exact label.
    // The pill is derived from two react-query fetches (applications +
    // connections), so keep the same generous window the rest of this spec uses.
    const connectorList = page.getByRole("list", { name: "Connector list" });
    const connectedRow = connectorList
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: connectedName, exact: true }) });
    await expect(connectedRow).toBeVisible();
    await expect(connectedRow.getByText(/^(Connected|Needs attention)$/)).toBeVisible({ timeout: 30_000 });
    const openConnection = connectedRow.getByRole("button", { name: /^Open .* permissions$/ });
    await expect(openConnection).toBeVisible();

    // The not-connected app has no connection, so the health sweep never touches
    // it and its Connect action stay deterministic.
    const notConnectedRow = connectorList
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: notConnectedName, exact: true }) });
    await expect(notConnectedRow).toBeVisible();
    await expect(notConnectedRow).toHaveAttribute("data-connected", "false");
    await expect(notConnectedRow.getByRole("button", { name: `Connect ${notConnectedName}` })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/applications-crud-current-list.png`, fullPage: true });

    await openConnection.click();
    await expect(page).toHaveURL(
      new RegExp(`/${seed.prefix}/apps/${connected.id}/permissions$`),
      { timeout: 20_000 },
    );

    await gotoApps(page, seed.prefix);
    await notConnectedRow.getByRole("button", { name: `Connect ${notConnectedName}` }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${seed.prefix}/apps/app/${notConnected.id}/permissions$`),
      { timeout: 20_000 },
    );
  });

  test("connected app detail supports rename on Permissions", async ({ page, request }) => {
    const appName = `${APP_PREFIX}-detail-app`;
    const renamed = `${APP_PREFIX}-renamed-app`;
    const connection = await createConnection(request, seed.spaceId, {
      applicationName: appName,
      name: appName,
    });

    await page.goto(`/${seed.prefix}/apps/${connection.id}/permissions`);
    await expect(page.getByRole("heading", { name: appName })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Rename app" }).click();
    await page.getByLabel("App name").fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/applications-crud-current-detail.png`, fullPage: true });
  });
});
