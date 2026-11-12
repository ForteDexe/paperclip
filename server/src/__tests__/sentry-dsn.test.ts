import { describe, expect, it } from "vitest";
import { resolveSentryDsns } from "../sentry-dsn.js";

describe("resolveSentryDsns", () => {
  it.each([
    {},
    { SENTRY_DSN: "https://legacy.example/1" },
    { SENTRY_DSN_FRONTEND: "https://frontend.example/1" },
    { SENTRY_DSN_BACKEND: "https://backend.example/1" },
    {
      SENTRY_DSN: "https://legacy.example/1",
      SENTRY_DSN_FRONTEND: "https://frontend.example/1",
      SENTRY_DSN_BACKEND: "https://backend.example/1",
    },
  ])("keeps vendor crash reporting disabled for %j", (env) => {
    expect(resolveSentryDsns(env)).toEqual({
      frontend: null,
      backend: null,
      legacyFallbackUsed: false,
    });
  });
});
