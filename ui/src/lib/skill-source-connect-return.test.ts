// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { consumeSkillSourceReturn, rememberSkillSourceReturn, skillSourceReturnPath } from "./skill-source-connect-return";

afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); });

it("retains a space-scoped, one-time return through an OAuth reload", () => {
  const sourceId = "94df7764-6811-43e4-ac85-a6d6b636d73d";
  rememberSkillSourceReturn("space-a", sourceId);
  expect(skillSourceReturnPath("space-b")).toBeNull();
  expect(consumeSkillSourceReturn("space-a")).toBe(`/skills/sources/${sourceId}`);
  expect(skillSourceReturnPath("space-a")).toBeNull();
});

it("expires abandoned setup and rejects arbitrary redirect destinations", () => {
  vi.useFakeTimers();
  rememberSkillSourceReturn("space-a", "new");
  vi.advanceTimersByTime(31 * 60 * 1000);
  expect(consumeSkillSourceReturn("space-a")).toBeNull();
  rememberSkillSourceReturn("space-a", "https://example.com");
  expect(skillSourceReturnPath("space-a")).toBeNull();
  sessionStorage.setItem("outpost.skill-source-connect-return:space-a", JSON.stringify({ sourceId: "//example.com", expiresAt: Date.now() + 1000 }));
  expect(consumeSkillSourceReturn("space-a")).toBeNull();
});
