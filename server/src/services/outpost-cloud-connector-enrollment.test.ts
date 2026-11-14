import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeOutpostCloudConnectorEnrollment,
  loadOutpostCloudConnectorIdentity,
  outpostCloudConnectorEnrollmentStatus,
  outpostCloudConnectorIdentityPath,
  startOutpostCloudConnectorEnrollment,
} from "./outpost-cloud-connector-enrollment.js";
import { outpostCloudConnectorConfigFromEnv } from "./outpost-cloud-connector.js";
import { reconcileOutpostCloudConnectorEnrollmentStatus } from "./outpost-cloud-connector-status.js";

describe("Outpost Cloud self-host enrollment", () => {
  let root = "";
  let previousHome: string | undefined;
  let previousInstance: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "outpost-cloud-connector-"));
    previousHome = process.env.OUTPOST_HOME;
    previousInstance = process.env.OUTPOST_INSTANCE_ID;
    process.env.OUTPOST_HOME = root;
    process.env.OUTPOST_INSTANCE_ID = "connector-test";
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OUTPOST_HOME;
    else process.env.OUTPOST_HOME = previousHome;
    if (previousInstance === undefined) delete process.env.OUTPOST_INSTANCE_ID;
    else process.env.OUTPOST_INSTANCE_ID = previousInstance;
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps private keys owner-only and activates only the matching one-time callback", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith("/v1/connector/enrollments")) {
        return Response.json({
          enrollmentId: "enroll-test",
          verificationUrl: "https://my.example.test/connections/enroll?id=enroll-test",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, { status: 201 });
      }
      const token = String(body.request);
      const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
      expect(claims).toMatchObject({
        iss: loadOutpostCloudConnectorIdentity()?.instanceId,
        aud: "https://my.example.test/v1/connector/enrollment-claims",
        env: "development",
        op: "enroll",
      });
      expect(typeof claims.ah).toBe("string");
      return Response.json({
        id: loadOutpostCloudConnectorIdentity()?.instanceId,
        environment: "development",
        origins: ["https://private.example.test"],
      });
    });

    const pending = await startOutpostCloudConnectorEnrollment({
      origin: "https://private.example.test",
      env: {
        OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test",
        OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "development",
      },
      request: request as typeof fetch,
    });
    expect(pending.status).toBe("pending");
    expect(pending.verificationUrl).toBe("https://my.example.test/connections/enroll?id=enroll-test");
    expect(statSync(path.dirname(outpostCloudConnectorIdentityPath())).mode & 0o777).toBe(0o700);
    expect(statSync(outpostCloudConnectorIdentityPath()).mode & 0o777).toBe(0o600);
    expect(readFileSync(outpostCloudConnectorIdentityPath(), "utf8")).not.toContain("approval-code");

    await expect(completeOutpostCloudConnectorEnrollment({
      enrollmentId: "enroll-test",
      approvalCode: "approval-code",
      state: "wrong-state",
      request: request as typeof fetch,
    })).rejects.toThrow(/Invalid or expired/);

    const state = loadOutpostCloudConnectorIdentity()?.pending?.returnState;
    const active = await completeOutpostCloudConnectorEnrollment({
      enrollmentId: "enroll-test",
      approvalCode: "approval-code",
      state: state!,
      request: request as typeof fetch,
    });
    expect(active).toMatchObject({ configured: true, status: "active", origins: ["https://private.example.test"] });
    const config = outpostCloudConnectorConfigFromEnv({});
    expect(config).toMatchObject({ baseUrl: "https://my.example.test", environment: "development" });
    expect(requests).toHaveLength(2);

    const statusRequest = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://my.example.test/v1/connector/instance-status");
      return Response.json({ active: false, status: "suspended" });
    });
    await expect(reconcileOutpostCloudConnectorEnrollmentStatus({}, statusRequest as typeof fetch)).resolves.toMatchObject({
      configured: false,
      status: "suspended",
      instanceId: active.instanceId,
    });
  });

  it("rejects non-loopback plain HTTP destinations before creating keys", async () => {
    await expect(startOutpostCloudConnectorEnrollment({
      origin: "http://private.example.test",
      request: vi.fn() as typeof fetch,
    })).rejects.toThrow(/requires HTTPS/);
    expect(outpostCloudConnectorEnrollmentStatus().status).toBe("not_configured");
  });

  it.each([
    "https://my.example.test/connections/enroll?id=another-enrollment",
    "https://my.example.test/connections/enroll",
    "https://my.example.test/connections/enroll?id=enroll-test&next=%2Faccount",
    "https://my.example.test/connections/enroll?id=enroll-test#fragment",
    "https://user@my.example.test/connections/enroll?id=enroll-test",
  ])("rejects an imprecise broker verification destination: %s", async (verificationUrl) => {
    await expect(startOutpostCloudConnectorEnrollment({
      origin: "https://private.example.test",
      env: {
        OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test",
        OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "development",
      },
      request: vi.fn(async () => Response.json({
        enrollmentId: "enroll-test",
        verificationUrl,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, { status: 201 })) as typeof fetch,
    })).rejects.toThrow(/invalid enrollment destination/);
  });

  it("serializes overlapping starts and reuses one unexpired enrollment", async () => {
    let releaseBroker!: () => void;
    const brokerMayRespond = new Promise<void>((resolve) => {
      releaseBroker = resolve;
    });
    const request = vi.fn(async () => {
      await brokerMayRespond;
      return Response.json({
        enrollmentId: "enroll-shared",
        verificationUrl: "https://my.example.test/connections/enroll?id=enroll-shared",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, { status: 201 });
    });
    const values = {
      origin: "https://private.example.test",
      spaceId: "space-test",
      initiatedBy: "user:admin-test",
      env: {
        OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my.example.test",
        OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "development",
      },
      request: request as typeof fetch,
    };

    const first = startOutpostCloudConnectorEnrollment(values);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const second = startOutpostCloudConnectorEnrollment(values);
    releaseBroker();

    const [firstStatus, secondStatus] = await Promise.all([first, second]);
    expect(request).toHaveBeenCalledOnce();
    expect(firstStatus).toMatchObject({ status: "pending", verificationUrl: expect.stringContaining("enroll-shared") });
    expect(secondStatus).toEqual(firstStatus);
    expect(loadOutpostCloudConnectorIdentity()?.pending).toMatchObject({
      enrollmentId: "enroll-shared",
      spaceId: "space-test",
      initiatedBy: "user:admin-test",
    });
    await expect(startOutpostCloudConnectorEnrollment({
      ...values,
      initiatedBy: "user:another-admin",
    })).rejects.toThrow(/another administrator/);
    await expect(startOutpostCloudConnectorEnrollment({
      ...values,
      spaceId: "another-space",
    })).rejects.toThrow(/another space/);
    expect(request).toHaveBeenCalledOnce();
  });

  it("defaults an enrollment to the environment of the standard Cloud broker", () => {
    expect(outpostCloudConnectorEnrollmentStatus({})).toMatchObject({
      brokerBaseUrl: "https://my.outpost.app",
      environment: "production",
    });
    expect(outpostCloudConnectorEnrollmentStatus({
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app",
    })).toMatchObject({ environment: "staging" });
    expect(outpostCloudConnectorEnrollmentStatus({
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://test.outpost.app",
    })).toMatchObject({ environment: "test" });
  });

  it.each(["development", "staging", "production"])("rejects %s identity at the test broker", (environment) => {
    expect(() => outpostCloudConnectorEnrollmentStatus({
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://test.outpost.app",
      OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: environment,
    })).toThrow(/broker and environment do not match/);
  });

  it("persists test enrollment identity and signs requests for the test broker", async () => {
    const origin = "https://tenant.test.outpost.app";
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith("/enrollments")) {
        expect(body).toMatchObject({ environment: "test", origin });
        return Response.json({ enrollmentId: "enroll-test", verificationUrl: "https://test.outpost.app/connections/enroll?id=enroll-test", expiresAt: new Date(Date.now() + 60_000).toISOString() }, { status: 201 });
      }
      const claims = JSON.parse(Buffer.from(body.request.split(".")[1], "base64url").toString("utf8"));
      expect(claims).toMatchObject({ env: "test", aud: "https://test.outpost.app/v1/connector/enrollment-claims" });
      return Response.json({ id: loadOutpostCloudConnectorIdentity()!.instanceId, environment: "test", origins: [origin] });
    });
    const env = { OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://test.outpost.app" };
    await startOutpostCloudConnectorEnrollment({ origin, env, request: request as typeof fetch });
    const pending = loadOutpostCloudConnectorIdentity()!;
    await completeOutpostCloudConnectorEnrollment({ enrollmentId: "enroll-test", approvalCode: "approval-code", state: pending.pending!.returnState, env, request: request as typeof fetch });
    expect(outpostCloudConnectorConfigFromEnv(env)).toMatchObject({ environment: "test", baseUrl: "https://test.outpost.app", instanceId: pending.instanceId });
  });

  it("rotates a non-active identity instead of mixing enrollment targets", async () => {
    const origin = "https://private.example.test";
    const productionRequest = vi.fn(async () => Response.json({
      enrollmentId: "enroll-production",
      verificationUrl: "https://my.outpost.app/connections/enroll?id=enroll-production",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, { status: 201 }));
    await startOutpostCloudConnectorEnrollment({
      origin,
      env: { OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my.outpost.app" },
      request: productionRequest as typeof fetch,
    });
    const productionIdentity = loadOutpostCloudConnectorIdentity()!;

    expect(outpostCloudConnectorEnrollmentStatus({
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app",
    })).toEqual({
      configured: false,
      status: "unverified",
      brokerBaseUrl: "https://my-staging.outpost.app",
      instanceId: null,
      environment: "staging",
      origins: [],
    });

    const stagingRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://my-staging.outpost.app/v1/connector/enrollments");
      expect(JSON.parse(String(init?.body))).toMatchObject({ environment: "staging", origin });
      return Response.json({
        enrollmentId: "enroll-staging",
        verificationUrl: "https://my-staging.outpost.app/connections/enroll?id=enroll-staging",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, { status: 201 });
    });
    const stagingStatus = await startOutpostCloudConnectorEnrollment({
      origin,
      env: { OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app" },
      request: stagingRequest as typeof fetch,
    });
    const stagingIdentity = loadOutpostCloudConnectorIdentity()!;

    expect(stagingStatus).toMatchObject({
      status: "pending",
      brokerBaseUrl: "https://my-staging.outpost.app",
      environment: "staging",
      verificationUrl: "https://my-staging.outpost.app/connections/enroll?id=enroll-staging",
    });
    expect(stagingIdentity.instanceId).not.toBe(productionIdentity.instanceId);
    expect(stagingIdentity.signPublicKey).not.toBe(productionIdentity.signPublicKey);
    expect(stagingIdentity.sealPublicKey).not.toBe(productionIdentity.sealPublicKey);
    expect(stagingRequest).toHaveBeenCalledOnce();
  });

  it("fails closed when the configured target changes during callback or after activation", async () => {
    const origin = "https://private.example.test";
    const productionEnv = {
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my.outpost.app",
      OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "production",
    };
    const request = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/connector/enrollments")) {
        return Response.json({
          enrollmentId: "enroll-production",
          verificationUrl: "https://my.outpost.app/connections/enroll?id=enroll-production",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, { status: 201 });
      }
      return Response.json({
        id: loadOutpostCloudConnectorIdentity()?.instanceId,
        environment: "production",
        origins: [origin],
      });
    });
    await startOutpostCloudConnectorEnrollment({ origin, env: productionEnv, request: request as typeof fetch });
    const pending = loadOutpostCloudConnectorIdentity()!;
    const changedTargetRequest = vi.fn();

    await expect(completeOutpostCloudConnectorEnrollment({
      enrollmentId: "enroll-production",
      approvalCode: "approval-code",
      state: pending.pending!.returnState,
      env: {
        OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app",
        OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
      },
      request: changedTargetRequest as typeof fetch,
    })).rejects.toThrow(/Invalid or expired/);
    expect(changedTargetRequest).not.toHaveBeenCalled();

    await completeOutpostCloudConnectorEnrollment({
      enrollmentId: "enroll-production",
      approvalCode: "approval-code",
      state: pending.pending!.returnState,
      env: productionEnv,
      request: request as typeof fetch,
    });
    const activeIdentity = loadOutpostCloudConnectorIdentity()!;
    const activeSwitchRequest = vi.fn();
    const stagingEnv = {
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app",
      OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
    };

    await expect(startOutpostCloudConnectorEnrollment({
      origin,
      env: stagingEnv,
      request: activeSwitchRequest as typeof fetch,
    })).rejects.toThrow(/another target/);
    expect(activeSwitchRequest).not.toHaveBeenCalled();
    expect(loadOutpostCloudConnectorIdentity()).toEqual(activeIdentity);
    expect(outpostCloudConnectorConfigFromEnv(stagingEnv)).toBeNull();
  });

  it("treats managed environment identity as an atomic override of local identity", async () => {
    const origin = "https://private.example.test";
    const productionEnv = {
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my.outpost.app",
      OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "production",
    };
    const request = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/connector/enrollments")) {
        return Response.json({
          enrollmentId: "enroll-production",
          verificationUrl: "https://my.outpost.app/connections/enroll?id=enroll-production",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, { status: 201 });
      }
      return Response.json({
        id: loadOutpostCloudConnectorIdentity()?.instanceId,
        environment: "production",
        origins: [origin],
      });
    });
    await startOutpostCloudConnectorEnrollment({ origin, env: productionEnv, request: request as typeof fetch });
    const pending = loadOutpostCloudConnectorIdentity()!;
    await completeOutpostCloudConnectorEnrollment({
      enrollmentId: "enroll-production",
      approvalCode: "approval-code",
      state: pending.pending!.returnState,
      env: productionEnv,
      request: request as typeof fetch,
    });
    const localIdentity = loadOutpostCloudConnectorIdentity()!;

    const managedEnv = {
      OUTPOST_CLOUD_CONNECTOR_INSTANCE_ID: "managed-staging-instance",
      OUTPOST_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY: "managed-signing-key",
      OUTPOST_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY: "managed-sealing-key",
      OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app",
      OUTPOST_PUBLIC_URL: "https://managed-stack.example.test",
    };
    expect(outpostCloudConnectorEnrollmentStatus(managedEnv)).toEqual({
      configured: true,
      status: "active",
      brokerBaseUrl: "https://my-staging.outpost.app",
      instanceId: "managed-staging-instance",
      environment: "staging",
      origins: ["https://managed-stack.example.test"],
    });
    expect(outpostCloudConnectorConfigFromEnv(managedEnv)).toMatchObject({
      baseUrl: "https://my-staging.outpost.app",
      instanceId: "managed-staging-instance",
      environment: "staging",
      signPrivateKey: "managed-signing-key",
      sealPrivateKey: "managed-sealing-key",
    });
    expect(loadOutpostCloudConnectorIdentity()).toEqual(localIdentity);

    for (const omitted of [
      "OUTPOST_CLOUD_CONNECTOR_INSTANCE_ID",
      "OUTPOST_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY",
      "OUTPOST_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY",
      "OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT",
    ] as const) {
      const partialManagedEnv: NodeJS.ProcessEnv = { ...managedEnv };
      delete partialManagedEnv[omitted];
      expect(outpostCloudConnectorEnrollmentStatus(partialManagedEnv)).toMatchObject({
        configured: false,
        status: "unverified",
        instanceId: null,
        environment: "staging",
      });
      expect(() => outpostCloudConnectorConfigFromEnv(partialManagedEnv)).toThrow(/incomplete/);
      expect(loadOutpostCloudConnectorIdentity()).toEqual(localIdentity);
    }

    expect(outpostCloudConnectorConfigFromEnv(productionEnv)).toMatchObject({
      baseUrl: localIdentity.brokerBaseUrl,
      instanceId: localIdentity.instanceId,
      environment: localIdentity.environment,
      signPrivateKey: localIdentity.signPrivateKey,
      sealPrivateKey: localIdentity.sealPrivateKey,
    });
  });

  it("rejects known Cloud broker and environment mismatches", () => {
    const managedIdentity = {
      OUTPOST_CLOUD_CONNECTOR_INSTANCE_ID: "managed-instance",
      OUTPOST_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY: "managed-signing-key",
      OUTPOST_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY: "managed-sealing-key",
    };
    const mismatches = [
      {
        ...managedIdentity,
        OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my.outpost.app",
        OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
      },
      {
        ...managedIdentity,
        OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app",
        OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "production",
      },
    ];
    for (const env of mismatches) {
      expect(() => outpostCloudConnectorEnrollmentStatus(env)).toThrow(/do not match/);
      expect(() => outpostCloudConnectorConfigFromEnv(env)).toThrow(/do not match/);
    }
    expect(() => outpostCloudConnectorEnrollmentStatus({
      OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
    })).toThrow(/do not match/);
  });

  it("does not create or complete self-host enrollment with managed identity configuration", async () => {
    const origin = "https://private.example.test";
    const localEnv = {
      OUTPOST_CLOUD_CONNECTOR_BASE_URL: "https://my-staging.outpost.app",
      OUTPOST_CLOUD_CONNECTOR_ENVIRONMENT: "staging",
    };
    const enrollmentRequest = vi.fn(async () => Response.json({
      enrollmentId: "enroll-local",
      verificationUrl: "https://my-staging.outpost.app/connections/enroll?id=enroll-local",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, { status: 201 }));
    await startOutpostCloudConnectorEnrollment({
      origin,
      env: localEnv,
      request: enrollmentRequest as typeof fetch,
    });
    const pendingIdentity = loadOutpostCloudConnectorIdentity()!;
    const managedEnv = {
      ...localEnv,
      OUTPOST_CLOUD_CONNECTOR_INSTANCE_ID: "managed-staging-instance",
      OUTPOST_CLOUD_CONNECTOR_SIGN_PRIVATE_KEY: "managed-signing-key",
      OUTPOST_CLOUD_CONNECTOR_SEAL_PRIVATE_KEY: "managed-sealing-key",
    };
    const managedRequest = vi.fn();

    await expect(startOutpostCloudConnectorEnrollment({
      origin,
      env: managedEnv,
      request: managedRequest as typeof fetch,
    })).rejects.toThrow(/unavailable with managed identity/);
    await expect(completeOutpostCloudConnectorEnrollment({
      enrollmentId: "enroll-local",
      approvalCode: "approval-code",
      state: pendingIdentity.pending!.returnState,
      env: managedEnv,
      request: managedRequest as typeof fetch,
    })).rejects.toThrow(/Invalid or expired/);
    expect(managedRequest).not.toHaveBeenCalled();
    expect(loadOutpostCloudConnectorIdentity()).toEqual(pendingIdentity);
  });

  it("does not treat legacy Outpost ID keys as a Cloud enrollment", () => {
    expect(outpostCloudConnectorEnrollmentStatus({
      OUTPOST_ID_CONNECTOR_INSTANCE_ID: "legacy-instance",
      OUTPOST_ID_CONNECTOR_SIGN_PRIVATE_KEY: "legacy-signing-key",
      OUTPOST_ID_CONNECTOR_SEAL_PRIVATE_KEY: "legacy-sealing-key",
      OUTPOST_ID_CONNECTOR_ENVIRONMENT: "production",
      OUTPOST_ID_CONNECTOR_BASE_URL: "https://id.outpost.app",
    })).toMatchObject({
      configured: false,
      status: "not_configured",
      brokerBaseUrl: "https://my.outpost.app",
      instanceId: null,
    });
  });
});
