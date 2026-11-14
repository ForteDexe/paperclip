import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OutpostApiClient } from "./client.js";
import { readConfigFromEnv, type OutpostMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createOutpostMcpServer(config: OutpostMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "outpost",
    version: "0.1.0",
  });

  const client = new OutpostApiClient(config);
  const tools = createToolDefinitions(client);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: OutpostMcpConfig = readConfigFromEnv()) {
  const { server } = createOutpostMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
