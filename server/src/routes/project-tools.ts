import { Router } from "express";
import { eq } from "drizzle-orm";
import { spaces, type Db } from "@outpost/db";
import { projectToolContext } from "../services/project-tool-context.js";
import { callProjectTool, projectToolDefinitions } from "../services/project-tools.js";
import { assertSpaceAccess } from "./authz.js";
import { forbidden } from "../errors.js";

/** Mounted after actor middleware; connection-scoped tokens cannot authenticate here. */
export function projectToolRoutes(db: Db) {
  const router = Router();
  router.post("/mcp/project-tools", async (req, res) => {
    const context = await projectToolContext(db, req.actor);
    assertSpaceAccess(req, context.run.spaceId);
    const { id = null, method, params } = req.body;
    const send = (result: unknown) => res.json({ jsonrpc: "2.0", id, result });
    if (method === "initialize") return send({ protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "outpost-project-tools", version: "1" } });
    if (method === "notifications/initialized") return res.status(202).end();
    const definitions = projectToolDefinitions(context.issue.workMode, true);
    if (method === "tools/list") return send({ tools: definitions });
    if (method !== "tools/call") return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    try {
      if (!definitions.some(tool => tool.name === params?.name)) throw forbidden("Tool is unavailable in this mode");
      const apiUrl = process.env.OUTPOST_API_URL;
      if (!apiUrl) throw new Error("Outpost API origin is unavailable");
      const result = await callProjectTool({
        name: params.name, arguments: params.arguments ?? {}, apiUrl,
        token: req.header("authorization")!.replace(/^Bearer\s+/i, ""),
        spaceId: context.run.spaceId, issueId: context.issue.id, agentId: context.run.agentId,
        conversation: Boolean(context.issue.conversationAgentId),
        spacePrefix: params.name === "list_projects" ? (await db.select({ issuePrefix: spaces.issuePrefix }).from(spaces)
          .where(eq(spaces.id, context.run.spaceId)))[0]?.issuePrefix : null,
      });
      return send({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    } catch (error) {
      return send({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Project tool failed" }] });
    }
  });
  return router;
}
