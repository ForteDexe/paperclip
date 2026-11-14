import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, spaces, createDb, environmentLeases, environments, type Db } from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { assertLoginEnvironmentTarget, resolveLoginEnvironmentTarget } from "./login-environment.js";
const fixtures = vi.hoisted(() => ({ environment: { id: "environment", driver: "plugin" }, instanceDefault: "environment", spaces: ["space"], agent: { id: "agent", spaceId: "space", adapterType: "outpost_runner", lifecycleState: "verifying", defaultEnvironmentId: "environment" } as Record<string, unknown> | undefined }));
vi.mock("./environments.js", () => ({ environmentService: () => ({ getById: async () => fixtures.environment, listBoundSpaceIds: async () => fixtures.spaces }) }));
vi.mock("./instance-settings.js", () => ({ instanceSettingsService: () => ({ get: async () => ({ defaultEnvironmentId: fixtures.instanceDefault }) }) }));
vi.mock("./environment-selection.js", () => ({ assertEnvironmentSelectionForSpace: vi.fn(async () => {}) }));
const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => fixtures.agent ? [fixtures.agent] : [] }) }) }) } as unknown as Db;
beforeEach(() => { fixtures.instanceDefault = "environment"; fixtures.environment = { id: "environment", driver: "plugin" }; fixtures.spaces = ["space"]; fixtures.agent = { id: "agent", spaceId: "space", adapterType: "outpost_runner", lifecycleState: "verifying", defaultEnvironmentId: "environment" }; });
describe("login environment transport target", () => {
  it("permits a verifying saved agent on its own computer", async () => { await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment", agentId: "agent" })).resolves.toEqual(fixtures.environment); });
  it("rejects a provider without an existing-computer credential path", async () => { await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment", agentId: "agent", adapterType: "grok_local" })).rejects.toMatchObject({ status: 400 }); });
  it("requires a saved target for existing-computer login", async () => { await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment" })).rejects.toMatchObject({ status: 400 }); });
  it("rejects a foreign space environment", async () => { fixtures.spaces = ["another-space"]; await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment", agentId: "agent" })).rejects.toMatchObject({ status: 403 }); });
  it("does not expose a foreign or missing agent", async () => { fixtures.agent!.spaceId = "another-space"; await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment", agentId: "agent" })).rejects.toMatchObject({ status: 404 }); });
  it.each([{ defaultEnvironmentId: "another-environment" }, { lifecycleState: "pending" }, { adapterType: "codex_local" }])("rejects unavailable target binding %j", async change => { Object.assign(fixtures.agent!, change); await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment", agentId: "agent" })).rejects.toMatchObject({ status: 400 }); });
  it("supports the inherited environment", async () => { fixtures.agent!.defaultEnvironmentId = null; await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment", agentId: "agent" })).resolves.toEqual(fixtures.environment); });
  it("retains agentless temporary sandbox login", async () => { fixtures.environment.driver = "sandbox"; await expect(assertLoginEnvironmentTarget(db, { spaceId: "space", environmentId: "environment" })).resolves.toEqual(fixtures.environment); });
});

const postgres = await getEmbeddedPostgresTestSupport();
(postgres.supported ? describe : describe.skip)("automatic login computer selection", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("outpost-login-target-"); }, 90_000);
  afterAll(async () => { await database?.cleanup(); });

  it("prefers a ready computer in the chosen space and effective environment", async () => {
    const db = createDb(database.connectionString);
    const spaceId = randomUUID();
    const otherSpaceId = randomUUID();
    const environmentId = randomUUID();
    const otherEnvironmentId = randomUUID();
    const readyId = randomUUID();
    const verifyingId = randomUUID();
    fixtures.environment = { id: environmentId, driver: "plugin" };
    fixtures.instanceDefault = environmentId;
    fixtures.spaces = [spaceId];
    await db.insert(spaces).values([
      { id: spaceId, name: "Login space", issuePrefix: "LOGIN" },
      { id: otherSpaceId, name: "Other space", issuePrefix: "OTHER" },
    ]);
    await db.insert(environments).values([
      { id: environmentId, name: "Computers", driver: "plugin" },
      { id: otherEnvironmentId, name: "Other computers", driver: "plugin" },
    ]);
    const agent = { spaceId, name: "Computer", adapterType: "outpost_runner", defaultEnvironmentId: environmentId } as const;
    await db.insert(agents).values([
      { ...agent, id: readyId, defaultEnvironmentId: null, lifecycleState: "ready" },
      { ...agent, id: verifyingId, lifecycleState: "verifying", status: "paused" },
      { ...agent, spaceId: otherSpaceId },
      { ...agent, defaultEnvironmentId: otherEnvironmentId },
      { ...agent, status: "paused" },
      { ...agent, status: "pending_approval", lifecycleState: "verifying" },
      { ...agent, adapterType: "codex_local" },
    ]);
    const request = { spaceId, environmentId, adapterType: "codex_local", selectComputer: true };
    await expect(resolveLoginEnvironmentTarget(db, request)).resolves.toMatchObject({ agentId: readyId });
    await expect(resolveLoginEnvironmentTarget(db, { ...request, agentId: verifyingId })).resolves.toMatchObject({ agentId: verifyingId });
    const [loginLease] = await db.insert(environmentLeases).values({
      spaceId, environmentId, metadata: { purpose: "login", agentId: readyId },
    }).returning({ id: environmentLeases.id });
    await expect(resolveLoginEnvironmentTarget(db, request)).resolves.toMatchObject({ agentId: verifyingId });
    await db.update(environmentLeases).set({ status: "released" }).where(eq(environmentLeases.id, loginLease.id));
    await expect(resolveLoginEnvironmentTarget(db, request)).resolves.toMatchObject({ agentId: readyId });
    fixtures.instanceDefault = otherEnvironmentId;
    await expect(resolveLoginEnvironmentTarget(db, request)).resolves.toMatchObject({ agentId: verifyingId });
    await db.delete(agents).where(eq(agents.id, verifyingId));
    await expect(resolveLoginEnvironmentTarget(db, request)).rejects.toMatchObject({
      status: 400, message: "No agent computer is available for sign-in.",
    });
  });
});
