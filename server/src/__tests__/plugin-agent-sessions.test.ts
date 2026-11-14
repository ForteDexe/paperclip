import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishLiveEvent } from "../services/live-events.js";
import { heartbeatRuns } from "@outpost/db";
import { createRunSecretRedactionRegistry } from "../services/run-secret-redaction.js";
import { REDACTED_EVENT_VALUE } from "../redaction.js";
import { homedir } from "node:os";
import { setImmediate } from "node:timers/promises";

const { readSettings, resolveSecretVersion } = vi.hoisted(() => ({
  readSettings: vi.fn(async () => ({ censorUsernameInLogs: true })),
  resolveSecretVersion: vi.fn(async ({ material }: { material: { synthetic: string } }) => material.synthetic),
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({ getGeneral: readSettings }),
}));
vi.mock("../secrets/provider-registry.js", () => ({ getSecretProvider: () => ({
  createSecret: async ({ value }: { value: string }) => ({ material: { synthetic: value } }),
  resolveVersion: resolveSecretVersion,
}) }));

const mockWakeup = vi.hoisted(() => vi.fn());
const mockHeartbeatService = vi.hoisted(() => vi.fn(() => ({ wakeup: mockWakeup })));

vi.mock("../services/heartbeat.js", () => ({
  heartbeatService: mockHeartbeatService,
}));

import { buildHostServices } from "../services/plugin-host-services.js";

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: async () => {},
        subscribe: () => {},
        clear: () => {},
      };
    },
  } as any;
}

function createSessionLookupDb(session: {
  id: string;
  spaceId: string;
  agentId: string;
  taskKey: string;
}) {
  const query = {
    from: () => query,
    where: () => query,
    then: (resolve: (rows: typeof session[]) => unknown) => Promise.resolve(resolve([session])),
  };
  return {
    select: () => query,
  } as never;
}

function createRunRedactionDb(session: Parameters<typeof createSessionLookupDb>[0]) {
  let contextSnapshot: unknown = {};
  const db = {
    select: () => ({ from: (table: unknown) => {
      const rows = () => table === heartbeatRuns ? [{ contextSnapshot }] : [session];
      const query = { where: () => query, for: () => query,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows()).then(resolve) };
      return query;
    } }),
    update: () => ({ set: (value: { contextSnapshot: unknown }) => ({ where: async () => { contextSnapshot = value.contextSnapshot; } }) }),
    transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  };
  return db;
}

describe("plugin agent sessions", () => {
  beforeEach(() => {
    readSettings.mockReset().mockResolvedValue({ censorUsernameInLogs: true });
    resolveSecretVersion.mockReset().mockImplementation(async ({ material }) => material.synthetic);
  });
  it("redacts registered native run secrets before notifying the plugin worker", async () => {
    const session = { id: "session-1", spaceId: "space-1", agentId: "agent-1", taskKey: "plugin:outpost.gateway:session:session-1" };
    const db = createRunRedactionDb(session);
    const secret = "synthetic-registered-run-secret";
    await createRunSecretRedactionRegistry(db as never).register(session.spaceId, "run-1", secret);
    const notifyWorker = vi.fn();
    mockWakeup.mockResolvedValue({ id: "run-1" });
    const services = buildHostServices(db as never, "plugin-record-id", "outpost.gateway", createEventBusStub(), notifyWorker);
    try {
      await services.agentSessions.sendMessage({ sessionId: session.id, spaceId: session.spaceId, prompt: "synthetic" });
      const native = { runId: "run-1", seq: 1, message: `output ${secret}`, payload: {
        orpEvent: { payload: { text: `output ${secret}`, apiKey: "unregistered-credential", cwd: `${homedir()}/synthetic` } },
      } };
      publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.event", payload: native });
      await vi.waitFor(() => expect(notifyWorker).toHaveBeenCalledOnce());
      const delivered = notifyWorker.mock.calls[0][1];
      expect(JSON.stringify(delivered)).not.toContain(secret);
      expect(JSON.stringify(delivered)).not.toContain("unregistered-credential");
      expect(JSON.stringify(delivered)).not.toContain(`${homedir()}/synthetic`);
      expect(delivered.message).toBe(`output ${REDACTED_EVENT_VALUE}`);
      expect(native.message).toContain(secret);
      publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.log",
        payload: { runId: "run-1", seq: 2, chunk: `legacy ${secret}` } });
      await vi.waitFor(() => expect(notifyWorker).toHaveBeenCalledTimes(2));
      publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.status",
        payload: { runId: "run-1", status: "succeeded", finalText: `done ${secret}` } });
      await vi.waitFor(() => expect(notifyWorker.mock.calls.at(-1)![1].eventType).toBe("done"));
      expect(notifyWorker).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(notifyWorker.mock.calls)).not.toContain(secret);
      expect(notifyWorker.mock.calls.at(-1)![1].message).toBe(`done ${REDACTED_EVENT_VALUE}`);
    } finally { services.dispose(); }
  });

  it.each(["settings", "registered secret"])("ends plugin delivery with a safe error when final-status %s redaction fails", async source => {
    const session = { id: "session-1", spaceId: "space-1", agentId: "agent-1", taskKey: "plugin:outpost.gateway:session:session-1" };
    const db = createRunRedactionDb(session);
    const secret = "synthetic-final-run-secret";
    await createRunSecretRedactionRegistry(db as never).register(session.spaceId, "run-1", secret);
    mockWakeup.mockResolvedValue({ id: "run-1" });
    const notifyWorker = vi.fn();
    const services = buildHostServices(db as never, "plugin-record-id", "outpost.gateway", createEventBusStub(), notifyWorker);
    try {
      await services.agentSessions.sendMessage({ sessionId: session.id, spaceId: session.spaceId, prompt: "synthetic" });
      if (source === "settings") readSettings.mockRejectedValueOnce(new Error(`unavailable ${secret}`));
      else resolveSecretVersion.mockRejectedValueOnce(new Error(`unavailable ${secret}`));
      publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.status",
        payload: { runId: "run-1", status: "succeeded", finalText: `done ${secret}` } });
      await vi.waitFor(() => expect(notifyWorker).toHaveBeenCalledOnce());
      expect(notifyWorker).toHaveBeenCalledWith("agents.sessions.event", {
        sessionId: session.id, runId: "run-1", seq: 0, eventType: "error", stream: "system",
        message: "Run event delivery unavailable", payload: { reason: "delivery_unavailable" },
      });
      expect(JSON.stringify(notifyWorker.mock.calls)).not.toContain(secret);
      readSettings.mockClear();
      resolveSecretVersion.mockClear();
      publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.event",
        payload: { runId: "run-1", seq: 2, message: `later ${secret}` } });
      publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.status",
        payload: { runId: "run-1", status: "succeeded", finalText: `later ${secret}` } });
      await setImmediate();
      expect(notifyWorker).toHaveBeenCalledOnce();
      expect(readSettings).not.toHaveBeenCalled();
      expect(resolveSecretVersion).not.toHaveBeenCalled();
    } finally { services.dispose(); }
  });

  it("finishes an expired plugin subscription with a delivery error", async () => {
    vi.useFakeTimers();
    const session = { id: "session-1", spaceId: "space-1", agentId: "agent-1", taskKey: "plugin:outpost.gateway:session:session-1" };
    mockWakeup.mockResolvedValue({ id: "run-1" });
    const notifyWorker = vi.fn();
    const services = buildHostServices(createSessionLookupDb(session), "plugin-record-id", "outpost.gateway", createEventBusStub(), notifyWorker);
    try {
      await services.agentSessions.sendMessage({ sessionId: session.id, spaceId: session.spaceId, prompt: "synthetic" });
      await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);
      expect(notifyWorker).toHaveBeenCalledOnce();
      expect(notifyWorker.mock.calls[0][1]).toMatchObject({ eventType: "error", payload: { reason: "delivery_unavailable" } });
      publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.status",
        payload: { runId: "run-1", status: "succeeded", finalText: "late result" } });
      await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);
      expect(notifyWorker).toHaveBeenCalledOnce();
      expect(readSettings).not.toHaveBeenCalled();
    } finally {
      services.dispose();
      vi.useRealTimers();
    }
  });

  it("cannot notify a disposed plugin when an earlier redaction read settles", async () => {
    let release!: (value: { censorUsernameInLogs: boolean }) => void;
    readSettings.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const session = { id: "session-1", spaceId: "space-1", agentId: "agent-1", taskKey: "plugin:outpost.gateway:session:session-1" };
    mockWakeup.mockResolvedValue({ id: "run-1" });
    const notifyWorker = vi.fn();
    const services = buildHostServices(createSessionLookupDb(session), "plugin-record-id", "outpost.gateway", createEventBusStub(), notifyWorker);
    await services.agentSessions.sendMessage({ sessionId: session.id, spaceId: session.spaceId, prompt: "synthetic" });
    publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.event", payload: { runId: "run-1", seq: 1 } });
    await vi.waitFor(() => expect(readSettings).toHaveBeenCalledOnce());
    services.dispose();
    readSettings.mockClear();
    release({ censorUsernameInLogs: true });
    await setImmediate();
    publishLiveEvent({ spaceId: session.spaceId, type: "heartbeat.run.status", payload: { runId: "run-1", status: "succeeded" } });
    await setImmediate();
    expect(notifyWorker).not.toHaveBeenCalled();
    expect(readSettings).not.toHaveBeenCalled();
  });
  it("delivers the message body in wake context and returns final assistant text on done", async () => {
    const spaceId = "space-1";
    const agentId = "agent-1";
    const sessionId = "session-1";
    const notifyWorker = vi.fn();
    mockWakeup.mockReset();
    mockWakeup.mockResolvedValue({ id: "run-1" });

    const services = buildHostServices(
      createSessionLookupDb({
        id: sessionId,
        spaceId,
        agentId,
        taskKey: "plugin:outpost.gateway:session:session-1",
      }),
      "plugin-record-id",
      "outpost.gateway",
      createEventBusStub(),
      notifyWorker,
    );

    await expect(
      services.agentSessions.sendMessage({
        sessionId,
        spaceId,
        prompt: "hello",
        reason: "gateway_chat_message",
      }),
    ).resolves.toEqual({ runId: "run-1" });

    expect(mockWakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        payload: { prompt: "hello" },
        contextSnapshot: {
          taskKey: "plugin:outpost.gateway:session:session-1",
          wakeReason: "gateway_chat_message",
          wakeSource: "automation",
          wakeTriggerDetail: "system",
          outpostAgentMessage: {
            text: "hello",
            source: "plugin_session",
            pluginKey: "outpost.gateway",
            sessionId,
          },
        },
      }),
    );

    publishLiveEvent({
      spaceId,
      type: "heartbeat.run.status",
      payload: {
        runId: "run-1",
        status: "succeeded",
        finalText: "Hello! How can I help?",
      },
    });

    await vi.waitFor(() => expect(notifyWorker).toHaveBeenCalledWith(
      "agents.sessions.event",
      expect.objectContaining({
        sessionId,
        runId: "run-1",
        eventType: "done",
        message: "Hello! How can I help?",
      }),
    ));

    services.dispose();
  });
});
