import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTokenCommands } from "../commands/client/token.js";

const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerTokenCommands(program);
  return program;
}

function agentResponse() {
  return {
    id: AGENT_ID,
    spaceId: SPACE_ID,
    name: "Worker",
    urlKey: "worker",
    role: "Engineer",
    status: "active",
  };
}

describe("token commands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OUTPOST_API_KEY;
    delete process.env.OUTPOST_API_URL;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates an agent token through the generic token command", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(agentResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "key-1",
        name: "external-worker",
        token: "pcp_plaintext",
        createdAt: "2026-05-23T00:00:00.000Z",
      }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "token",
      "agent",
      "create",
      "--api-base",
      "http://localhost:3100",
      "--api-key",
      "operator-token",
      "--space-id",
      SPACE_ID,
      "--agent",
      "worker",
      "--name",
      "external-worker",
      "--json",
    ], { from: "user" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://localhost:3100/api/agents/worker?spaceId=${SPACE_ID}`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`http://localhost:3100/api/agents/${AGENT_ID}/keys`);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: "external-worker",
      scope: { kind: "standard" },
    });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      agentId: AGENT_ID,
      spaceId: SPACE_ID,
      key: { id: "key-1", token: "pcp_plaintext" },
    });
  });

  it("lists and revokes agent tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(agentResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "key-1", name: "external-worker", createdAt: "2026-05-23T00:00:00.000Z", revokedAt: null }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(agentResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, keyId: "key-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "token", "agent", "list",
      "--api-base", "http://localhost:3100",
      "--api-key", "operator-token",
      "--space-id", SPACE_ID,
      "--agent", "worker",
    ], { from: "user" });

    await createProgram().parseAsync([
      "token", "agent", "revoke", "key-1",
      "--api-base", "http://localhost:3100",
      "--api-key", "operator-token",
      "--space-id", SPACE_ID,
      "--agent", "worker",
    ], { from: "user" });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(`http://localhost:3100/api/agents/${AGENT_ID}/keys`);
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`http://localhost:3100/api/agents/${AGENT_ID}/keys/key-1`);
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("DELETE");
  });

  it("resolves agent token commands by agent id without the reference lookup query", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(agentResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "key-1", name: "external-worker", createdAt: "2026-05-23T00:00:00.000Z", revokedAt: null }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "token", "agent", "list",
      "--api-base", "http://localhost:3100",
      "--api-key", "operator-token",
      "--space-id", SPACE_ID,
      "--agent", AGENT_ID,
      "--json",
    ], { from: "user" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://localhost:3100/api/agents/${AGENT_ID}`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`http://localhost:3100/api/agents/${AGENT_ID}/keys`);
  });

  it("creates a operator token with a ttl-derived expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "operator-key-1",
        name: "external-admin",
        token: "pcp_board_plaintext",
        createdAt: "2026-05-23T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: "2026-06-06T00:00:00.000Z",
      }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "token", "operator", "create",
      "--api-base", "http://localhost:3100",
      "--api-key", "operator-token",
      "--space-id", SPACE_ID,
      "--name", "external-admin",
      "--ttl-days", "14",
      "--json",
    ], { from: "user" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3100/api/operator-api-keys");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "external-admin",
      requestedSpaceId: SPACE_ID,
      expiresAt: "2026-06-06T00:00:00.000Z",
    });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      key: {
        id: "operator-key-1",
        name: "external-admin",
        token: "pcp_board_plaintext",
        expiresAt: "2026-06-06T00:00:00.000Z",
      },
    });
  });

  it("creates a non-expiring operator token when requested", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "operator-key-1",
        name: "external-admin",
        token: "pcp_board_plaintext",
        createdAt: "2026-05-23T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: null,
      }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "token", "operator", "create",
      "--api-base", "http://localhost:3100",
      "--api-key", "operator-token",
      "--space-id", SPACE_ID,
      "--name", "external-admin",
      "--never-expires",
      "--json",
    ], { from: "user" });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "external-admin",
      requestedSpaceId: SPACE_ID,
      expiresAt: null,
    });
  });

  it("lists and revokes operator tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: "operator-key-1",
        name: "external-admin",
        createdAt: "2026-05-23T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, keyId: "operator-key-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "token", "operator", "list",
      "--api-base", "http://localhost:3100",
      "--api-key", "operator-token",
    ], { from: "user" });

    await createProgram().parseAsync([
      "token", "operator", "revoke", "operator-key-1",
      "--api-base", "http://localhost:3100",
      "--api-key", "operator-token",
      "--json",
    ], { from: "user" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3100/api/operator-api-keys");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:3100/api/operator-api-keys/operator-key-1");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });
});
