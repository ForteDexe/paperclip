import { describe, expect, it } from "vitest";
import { sanitizeInheritedOutpostEnv } from "./server-utils.js";

describe("sanitizeInheritedOutpostEnv", () => {
  it("drops the host-only Outpost CLI command pointer", () => {
    expect(sanitizeInheritedOutpostEnv({
      OUTPOST_CMD: "node /missing/outpost/dist/index.js",
      OUTPOST_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      OUTPOST_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});
