import { describe, expect, it } from "vitest";
import { usesExistingProviderLogin } from "./local-provider-login";

describe("usesExistingProviderLogin", () => {
  it.each(["codex_local", "claude_local"])("uses the host login for %s", (adapterType) => {
    expect(usesExistingProviderLogin(adapterType)).toBe(true);
  });

  it.each(["grok_local", "antigravity_runtime", "opencode_local", "pi_local"])(
    "keeps Outpost-managed connection setup for %s",
    (adapterType) => {
      expect(usesExistingProviderLogin(adapterType)).toBe(false);
    },
  );
});
