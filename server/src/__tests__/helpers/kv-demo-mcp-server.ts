import { createServer, type IncomingMessage, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

type KvEntry = { key: string; value: string; updatedAt: string };

class TestKvStore {
  private readonly entries = new Map<string, KvEntry>();

  set(key: string, value: string): KvEntry {
    const entry = { key, value, updatedAt: new Date().toISOString() };
    this.entries.set(key, entry);
    return entry;
  }

  get(key: string): KvEntry | undefined {
    return this.entries.get(key);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  list(prefix = ""): KvEntry[] {
    return [...this.entries.values()]
      .filter((entry) => entry.key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  snapshot(): { entries: KvEntry[] } {
    return { entries: this.list() };
  }
}

export type KvDemoHttpServer = {
  server: Server;
  store: TestKvStore;
  listen: (port: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body ? JSON.parse(body) : undefined;
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function createMcpServer(store: TestKvStore): McpServer {
  const server = new McpServer({ name: "outpost-test-kv", version: "1.0.0" });
  const key = z.string().trim().min(1);

  server.registerTool("kv_set", {
    description: "Set a key to a string value.",
    inputSchema: { key, value: z.string() },
  }, async ({ key: entryKey, value }) => text(store.set(entryKey, value)));
  server.registerTool("kv_get", {
    description: "Get a value by key.",
    inputSchema: { key },
  }, async ({ key: entryKey }) => text(store.get(entryKey) ?? { found: false, key: entryKey }));
  server.registerTool("kv_list", {
    description: "List values, optionally filtered by prefix.",
    inputSchema: { prefix: z.string().optional() },
  }, async ({ prefix }) => text(store.list(prefix)));
  server.registerTool("kv_delete", {
    description: "Delete a value by key.",
    inputSchema: { key },
  }, async ({ key: entryKey }) => text({ deleted: store.delete(entryKey), key: entryKey }));
  return server;
}

export function createKvDemoHttpServer(): KvDemoHttpServer {
  const store = new TestKvStore();
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST" || new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      const mcp = createMcpServer(store);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, await readJsonBody(req));
    })().catch((error) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });

  return {
    server,
    store,
    listen: (port, host = "127.0.0.1") => new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
    }),
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
