import { expect, it, vi } from "vitest";
import { searchRunnerApi } from "../services/native-runtime/runner-api-catalog.js";
import { executeRunnerApi } from "../services/native-runtime/runner-api-client.js";
import { startOpenCodeMcpBridge } from "../../../packages/outpost-runner/src/drivers/opencode/mcp-bridge.js";
import { searchApiAction } from "../../../packages/outpost-runner/src/protocol-actions/search-api.js";

it("delivers default-agent profile guidance through actual API discovery and bounded OpenCode MCP output", async () => {
  const descriptor = searchApiAction.live.descriptor;
  let calls = 0;
  const bridge = await startOpenCodeMcpBridge({
    tools: [{ name: descriptor.operationId, description: descriptor.description, inputSchema: descriptor.inputSchema }],
    handler: async call => {
      expect(call.tool).toBe("search_api"); calls++;
      return { type: "inputText", text: JSON.stringify(searchRunnerApi(call.arguments)) };
    },
  });
  try {
    const response = await fetch(bridge.url, { method: "POST", headers: {
      Authorization: `Bearer ${bridge.secret}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: "primary-guidance", method: "tools/call",
      params: { name: "outpost_search_api", arguments: { query: "set default agent", limit: 2 } } }) });
    expect(response.status).toBe(200);
    const wire = await response.json() as { result: { isError?: boolean; content: Array<{ type: string; text: string }> } };
    expect(wire.result.isError).not.toBe(true);
    const controller = JSON.parse(wire.result.content[0]!.text) as { type: string; text: string };
    expect(controller.type).toBe("inputText");
    expect(Buffer.byteLength(JSON.stringify(controller))).toBeLessThan(500_000);
    const discovered = JSON.parse(controller.text) as ReturnType<typeof searchRunnerApi>;
    const operation = discovered.results.find(row => row.operationId === "PUT /api/spaces/{spaceId}/default-agent/me");
    expect(operation).toBeDefined();
    expect(operation!.description).toMatch(/agent.{0,12}profile/i);
    expect(operation!.description).toContain("Set as default agent");
    expect(operation!.description).toMatch(/confirm.{0,30}replac/i);
    expect(operation!.description).toMatch(/initial Chat fallback/i);
    expect(operation!.authorization.actor).toBe("operator");
    expect(operation!.description).toContain("Agent credentials cannot access this operator route");
    expect(operation!.requestBody?.content["application/json"].schema.properties.defaultAgentId).toMatchObject({ type: "string", format: "uuid" });
    expect(calls).toBe(1);
  } finally { await bridge.close(); }
});

it("keeps the compatibility route operator-only when called with an agent identity", async () => {
  const spaceId = "00000000-0000-4000-8000-000000000111", runId = "00000000-0000-4000-8000-000000000112";
  const request = vi.fn<typeof fetch>(async () => Response.json({ error: "Operator access required" }, { status: 403 }));
  const result = await executeRunnerApi({ operationId: "PUT /api/spaces/{spaceId}/default-agent/me",
    body: { defaultAgentId: "00000000-0000-4000-8000-000000000113" } },
  { spaceId, runId, issueId: "00000000-0000-4000-8000-000000000114", workMode: "standard" },
  { apiUrl: "https://outpost.test", token: "synthetic-agent-only", fetch: request,
    readFile: async () => { throw new Error("No file read required"); },
    saveResponse: async () => { throw new Error("No capture required"); } });
  expect(result).toMatchObject({ ok: false, status: 403, data: { error: "Operator access required" } });
  expect(request).toHaveBeenCalledOnce();
  const headers = new Headers(request.mock.calls[0]![1]?.headers);
  expect(headers.get("Authorization")).toBe("Bearer synthetic-agent-only");
  expect(headers.get("X-Outpost-Run-Id")).toBe(runId);
});
