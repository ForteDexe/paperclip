import { describe, expect, it } from "vitest";
import type { Environment } from "@outpost/shared";
import { buildLoginLeaseAcquireArgs } from "./adapter-login-lease.js";

// A minimal environment stand-in. The helper copies the reference without a
// read, so the test does not need a full environment row.
const ENVIRONMENT = { id: "env-1", name: "Sandbox", driver: "sandbox" } as unknown as Environment;

describe("buildLoginLeaseAcquireArgs", () => {
  it("keeps plugin probes as ordinary Runner allocations", () => {
    const args = buildLoginLeaseAcquireArgs({ metadata: { spaceId: "co", environment: { ...ENVIRONMENT, driver: "plugin" }, adapterType: "outpost_runner" } });
    expect(args.purpose).toBeUndefined();
    expect(args.loginCommandKey).toBeUndefined();
    expect(args.adapterType).toBe("outpost_runner");
  });
  it("binds an explicit browser login to its command and Runner target", () => {
    const args = buildLoginLeaseAcquireArgs({ browserLogin: true, metadata: { spaceId: "co", environment: { ...ENVIRONMENT, driver: "plugin" }, adapterType: "codex_local" }, targetAgentId: "computer" });
    expect(args).toMatchObject({ purpose: "login", loginCommandKey: "codex", adapterType: "outpost_runner", agentId: "computer" });
  });
  it("sets the fixed lease arguments that both login services share", () => {
    const args = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT, adapterType: "codex" },
    });

    // A null issue, a null heartbeat run, and a null execution workspace disable
    // lease reuse, so the login session always runs in a fresh sandbox.
    expect(args.issueId).toBeNull();
    expect(args.heartbeatRunId).toBeNull();
    expect(args.persistedExecutionWorkspace).toBeNull();
    // The helper applies the active custom-image template for both services.
    expect(args.applyCustomImageTemplate).toBe(true);
  });

  it("passes the lease metadata through to the acquire arguments", () => {
    const args = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT, adapterType: "claude" },
    });

    expect(args.spaceId).toBe("co-1");
    expect(args.environment).toBe(ENVIRONMENT);
    expect(args.adapterType).toBe("claude");
  });

  it("defaults the adapter type to null when the caller omits it", () => {
    const args = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT },
    });

    expect(args.adapterType).toBeNull();
  });

  it("passes the target agent through to the lease agent and defaults to null", () => {
    const withAgent = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT },
      targetAgentId: "agent-7",
    });
    expect(withAgent.agentId).toBe("agent-7");

    const withoutAgent = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT },
    });
    expect(withoutAgent.agentId).toBeNull();
  });

  it("passes the space-binding assertion through and leaves it unset by default", () => {
    const asserted = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT },
      assertSpaceBinding: true,
    });
    expect(asserted.assertSpaceBinding).toBe(true);

    const unset = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT },
    });
    expect(unset.assertSpaceBinding).toBeUndefined();
  });

  it("passes the requested expiry through and defaults to null", () => {
    const deadline = new Date("2026-01-01T00:00:00.000Z");
    const bounded = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT },
      requestedExpiresAt: deadline,
    });
    expect(bounded.requestedExpiresAt).toBe(deadline);

    const unbounded = buildLoginLeaseAcquireArgs({
      metadata: { spaceId: "co-1", environment: ENVIRONMENT },
    });
    expect(unbounded.requestedExpiresAt).toBeNull();
  });
});
