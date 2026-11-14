import { cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The endpoint is a packaging input, never a model-callable destination.
const endpoint = new URL(process.argv[2] || "http://localhost:3100/mcp/outpost");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/mcp/outpost"
  || (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:"))) {
  throw new Error("Supply a deployed HTTPS /mcp/outpost URL, or HTTP loopback for development.");
}
const root = path.dirname(fileURLToPath(import.meta.url));
const identity = { name: "outpost", version: "0.1.0", description: "Review your team, delegate work and retrieve durable results in Outpost.", author: { name: "Outpost", url: "https://outpost.ing" }, homepage: "https://outpost.ing", repository: "https://github.com/paperclipai/paperclip", license: "MIT" };
const presentation = { displayName: "Outpost", shortDescription: "Your persistent team behind your assistant.", longDescription: "Use your Outpost crew as yourself. Review tasks, delegate work to agents, add feedback and retrieve documents. Delegation can start autonomous work using your configured execution capacity.", developerName: "Outpost", category: "Productivity", capabilities: ["Read", "Write"], defaultPrompt: "Review my Outpost crew and show what needs my attention." };
const json = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + "\n");
for (const vendor of ["openai", "claude"]) {
  const out = path.join(root, vendor, "outpost");
  const manifestDir = vendor === "openai" ? ".codex-plugin" : ".claude-plugin";
  await mkdir(path.join(out, manifestDir), { recursive: true });
  await cp(path.join(root, "shared", "skills"), path.join(out, "skills"), { recursive: true });
  await json(path.join(out, ".mcp.json"), { mcpServers: { outpost: { type: "http", url: endpoint.href } } });
  if (vendor === "openai") {
    await json(path.join(out, "plugin.json"), { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", ...identity, extensions: { "com.openai": { interface: presentation } } });
    await json(path.join(out, "mcp.json"), { $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { outpost: { type: "streamable-http", url: endpoint.href } } });
    await json(path.join(out, manifestDir, "plugin.json"), { ...identity, skills: "./skills/", mcpServers: "./.mcp.json", interface: presentation });
  } else {
    await json(path.join(out, manifestDir, "plugin.json"), { ...identity, skills: "./skills/", mcpServers: "./.mcp.json" });
  }
}
console.log(`Built both plugin packages for ${endpoint.href}${local ? " (development only; not a public listing)" : ""}`);
