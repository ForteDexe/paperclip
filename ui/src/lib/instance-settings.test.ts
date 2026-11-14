import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTANCE_SETTINGS_PATH,
  filterHiddenInstanceSettingsPath,
  normalizeRememberedInstanceSettingsPath,
} from "./instance-settings";

describe("normalizeRememberedInstanceSettingsPath", () => {
  it("canonicalizes known instance settings pages under space settings", () => {
    expect(normalizeRememberedInstanceSettingsPath("/instance/settings/general")).toBe(
      "/space/settings/instance/general",
    );
    expect(normalizeRememberedInstanceSettingsPath("/instance/settings/experimental")).toBe(
      "/space/settings/instance/experimental",
    );
    expect(normalizeRememberedInstanceSettingsPath("/instance/settings/environments")).toBe(
      DEFAULT_INSTANCE_SETTINGS_PATH,
    );
    expect(normalizeRememberedInstanceSettingsPath("/settings/access?tab=users#admins")).toBe(
      "/space/settings/instance/access?tab=users#admins",
    );
    expect(normalizeRememberedInstanceSettingsPath("/instance/settings/plugins/example?tab=config#logs")).toBe(
      "/space/settings/instance/plugins/example?tab=config#logs",
    );
    expect(normalizeRememberedInstanceSettingsPath("/PAP/space/settings/instance/adapters")).toBe(
      "/space/settings/instance/adapters",
    );
    expect(normalizeRememberedInstanceSettingsPath("/space/settings/instance/general")).toBe(
      "/space/settings/instance/general",
    );
    expect(normalizeRememberedInstanceSettingsPath("/space/settings/instance/plugins/example?tab=config#logs")).toBe(
      "/space/settings/instance/plugins/example?tab=config#logs",
    );
    expect(normalizeRememberedInstanceSettingsPath("/space/settings/environments")).toBe(
      DEFAULT_INSTANCE_SETTINGS_PATH,
    );
    expect(normalizeRememberedInstanceSettingsPath("/PAP/settings/plugins/example")).toBe(
      "/space/settings/instance/plugins/example",
    );
  });

  it("falls back to the default page for unknown paths", () => {
    expect(normalizeRememberedInstanceSettingsPath("/instance/settings/nope")).toBe(
      DEFAULT_INSTANCE_SETTINGS_PATH,
    );
    // The Heartbeats page was removed; remembered paths remap to the default.
    expect(normalizeRememberedInstanceSettingsPath("/instance/settings/heartbeats")).toBe(
      DEFAULT_INSTANCE_SETTINGS_PATH,
    );
    expect(normalizeRememberedInstanceSettingsPath(null)).toBe(DEFAULT_INSTANCE_SETTINGS_PATH);
  });
});

describe("filterHiddenInstanceSettingsPath", () => {
  const hidden = new Set(["instance.plugins", "instance.environments"]);

  it("remaps hidden pages (including sub-paths) to the default settings path", () => {
    expect(
      filterHiddenInstanceSettingsPath("/space/settings/instance/plugins", hidden),
    ).toBe(DEFAULT_INSTANCE_SETTINGS_PATH);
    expect(
      filterHiddenInstanceSettingsPath("/space/settings/instance/plugins/plugin-1", hidden),
    ).toBe(DEFAULT_INSTANCE_SETTINGS_PATH);
    expect(
      filterHiddenInstanceSettingsPath("/space/settings/instance/environments", hidden),
    ).toBe(DEFAULT_INSTANCE_SETTINGS_PATH);
  });

  it("keeps visible pages and non-settings paths untouched", () => {
    expect(
      filterHiddenInstanceSettingsPath("/space/settings/instance/experimental", hidden),
    ).toBe("/space/settings/instance/experimental");
    expect(filterHiddenInstanceSettingsPath("/dashboard", hidden)).toBe("/dashboard");
    expect(
      filterHiddenInstanceSettingsPath("/space/settings/instance/plugins", new Set()),
    ).toBe("/space/settings/instance/plugins");
  });
});
