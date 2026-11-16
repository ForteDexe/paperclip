import { describe, expect, it } from "vitest";
import {
  campfireMemberStatus,
  campfireMentionHandles,
  normalizeCampfireHandle,
  normalizeCampfireRoomName,
} from "./campfire.js";

describe("Campfire input helpers", () => {
  it("normalizes room names and rejects empty or oversized names", () => {
    expect(normalizeCampfireRoomName("  Model   Training  ")).toBe("Model Training");
    expect(() => normalizeCampfireRoomName("  ")).toThrow("Room name is required");
    expect(() => normalizeCampfireRoomName("x".repeat(81))).toThrow("80 characters");
  });

  it("normalizes portable mention handles", () => {
    expect(normalizeCampfireHandle(" @Rocky_2 ")).toBe("Rocky_2");
    expect(() => normalizeCampfireHandle("Rocky Model")).toThrow("letters, numbers");
  });

  it("extracts unique, case-insensitive mentions without treating email text as a mention", () => {
    expect(campfireMentionHandles("Ask @Rocky, then @claude and @ROCKY again.")).toEqual([
      "rocky",
      "claude",
    ]);
    expect(campfireMentionHandles("mail dev@example.com or quote foo@rocky")).toEqual([]);
  });

  it("shows an active Campfire turn as running without changing the saved agent status", () => {
    expect(campfireMemberStatus("idle", true)).toBe("running");
    expect(campfireMemberStatus("paused", false)).toBe("paused");
  });
});
