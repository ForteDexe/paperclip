import { chromium, type BrowserContext } from "@playwright/test";
import { lstat, mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertOutsideRepository,
  ConnectionBlock,
  type ConnectionConfig,
} from "./connection-config.js";

/** Opens the isolated browser shared by attended GitHub and Antigravity journeys. */
export async function openConnectionBrowser(
  config: Pick<ConnectionConfig, "browser">,
  repositoryRoot: string,
  origin: string,
) {
  const temporary =
    config.browser.freshness === "signed-out" || !config.browser.profileDir;
  const profile = temporary
    ? await mkdtemp(path.join(os.tmpdir(), "outpost-qa-browser-"))
    : path.resolve(config.browser.profileDir!);
  await assertOutsideRepository(profile, repositoryRoot);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const stat = await lstat(profile);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new ConnectionBlock(
      "blocked_target",
      "browser_profile_requires_private_directory",
    );
  }
  const marker = path.join(profile, ".outpost-provider-qa");
  const entries = await readdir(profile);
  if (entries.length && !entries.includes(path.basename(marker))) {
    throw new ConnectionBlock(
      "blocked_target",
      "use_a_dedicated_empty_qa_browser_profile",
    );
  }
  if (!entries.length) {
    await writeFile(
      marker,
      "Dedicated Outpost QA browser. Contains private authentication state.\n",
      { mode: 0o600, flag: "wx" },
    );
  }
  const lock = path.join(profile, ".outpost-qa.lock");
  try {
    await (await open(lock, "wx", 0o600)).close();
  } catch {
    throw new ConnectionBlock("blocked_target", "qa_browser_profile_in_use");
  }
  let context: BrowserContext;
  try {
    const browserEnv = Object.fromEntries(
      [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XAUTHORITY",
        "LANG",
      ].flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])),
    );
    context = await chromium.launchPersistentContext(profile, {
      channel: config.browser.channel === "chrome" ? "chrome" : undefined,
      headless: !config.browser.headed,
      baseURL: origin,
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
      env: browserEnv,
      acceptDownloads: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    context.setDefaultTimeout(30_000);
    context.setDefaultNavigationTimeout(30_000);
  } catch {
    await rm(lock, { force: true });
    if (temporary) await rm(profile, { recursive: true, force: true });
    throw new ConnectionBlock("blocked_target", "qa_browser_launch_failed");
  }
  return {
    context,
    close: async () => {
      try {
        await context.close();
      } finally {
        await rm(lock, { force: true });
        if (temporary) await rm(profile, { recursive: true, force: true });
      }
    },
  };
}

/** One cancellation state covers an attended campaign and its teardown. */
export async function withConnectionCampaignCancellation<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  for (const signal of signals) process.on(signal, interrupt);
  try {
    return await run(controller.signal);
  } finally {
    for (const signal of signals) process.removeListener(signal, interrupt);
  }
}
