import { describe, expect, it } from "vitest";
import { sanitizeInheritedOutpostEnv } from "./server-utils.js";

describe("sanitizeInheritedOutpostEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedOutpostEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      OUTPOST_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      OUTPOST_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});
