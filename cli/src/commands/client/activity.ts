import { Command } from "commander";
import type { ActivityEvent } from "@outpost/shared";
import {
  addCommonClientOptions,
  apiPath,
  formatInlineRecord,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface ActivityListOptions extends BaseClientOptions {
  spaceId?: string;
  agentId?: string;
  entityType?: string;
  entityId?: string;
  payloadJson?: string;
}

export function registerActivityCommands(program: Command): void {
  const activity = program.command("activity").description("Activity log operations");

  addCommonClientOptions(
    activity
      .command("list")
      .description("List space activity log entries")
      .requiredOption("-C, --space-id <id>", "Outpost ID")
      .option("--agent-id <id>", "Filter by agent ID")
      .option("--entity-type <type>", "Filter by entity type")
      .option("--entity-id <id>", "Filter by entity ID")
      .action(async (opts: ActivityListOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          const params = new URLSearchParams();
          if (opts.agentId) params.set("agentId", opts.agentId);
          if (opts.entityType) params.set("entityType", opts.entityType);
          if (opts.entityId) params.set("entityId", opts.entityId);

          const query = params.toString();
          const path = `${apiPath`/api/spaces/${ctx.spaceId}/activity`}${query ? `?${query}` : ""}`;
          const rows = (await ctx.api.get<ActivityEvent[]>(path)) ?? [];

          if (ctx.json) {
            printOutput(rows, { json: true });
            return;
          }

          if (rows.length === 0) {
            printOutput([], { json: false });
            return;
          }

          for (const row of rows) {
            console.log(
              formatInlineRecord({
                id: row.id,
                action: row.action,
                actorType: row.actorType,
                actorId: row.actorId,
                entityType: row.entityType,
                entityId: row.entityId,
                createdAt: String(row.createdAt),
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );

  addCommonClientOptions(
    activity
      .command("create")
      .description("Create a space activity log entry")
      .requiredOption("-C, --space-id <id>", "Outpost ID")
      .requiredOption("--payload-json <json>", "CreateActivity JSON payload")
      .action(async (opts: ActivityListOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          const result = await ctx.api.post(apiPath`/api/spaces/${ctx.spaceId}/activity`, parseJson(opts.payloadJson ?? "{}"));
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );

  addCommonClientOptions(
    activity
      .command("issue")
      .description("List activity for an issue")
      .argument("<issueId>", "Issue ID")
      .action(async (issueId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/issues/${issueId}/activity`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
