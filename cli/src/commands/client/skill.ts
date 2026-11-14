import { Command } from "commander";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface SkillOptions extends BaseClientOptions {
  spaceId?: string;
  payloadJson?: string;
  path?: string;
}

export function registerSkillCommands(program: Command): void {
  const skill = program.command("skill").description("Outpost skill operations");

  addSpaceGet(skill, "list", "List space skills", "skills");

  addCommonClientOptions(
    skill
      .command("get")
      .description("Get space skill details")
      .argument("<skillId>", "Skill ID")
      .option("-C, --space-id <id>", "Outpost ID")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          printOutput(await ctx.api.get(apiPath`/api/spaces/${ctx.spaceId}/skills/${skillId}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );

  addCommonClientOptions(
    skill
      .command("file")
      .description("Read a space skill file")
      .argument("<skillId>", "Skill ID")
      .option("-C, --space-id <id>", "Outpost ID")
      .option("--path <path>", "Skill-relative file path", "SKILL.md")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          const query = new URLSearchParams({ path: opts.path ?? "SKILL.md" });
          printOutput(await ctx.api.get(`${apiPath`/api/spaces/${ctx.spaceId}/skills/${skillId}/files`}?${query.toString()}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );

  addSpacePost(skill, "create", "Create a local space skill", "skills", true);
  addSpacePost(skill, "import", "Import space skills from a source", "skills/import", true);
  addSpacePost(skill, "scan-projects", "Scan project workspaces for space skills", "skills/scan-projects", true);

  addCommonClientOptions(
    skill
      .command("file:update")
      .description("Update a space skill file")
      .argument("<skillId>", "Skill ID")
      .option("-C, --space-id <id>", "Outpost ID")
      .requiredOption("--payload-json <json>", "SpaceSkillFileUpdate JSON payload")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          printOutput(
            await ctx.api.patch(apiPath`/api/spaces/${ctx.spaceId}/skills/${skillId}/files`, parseJson(opts.payloadJson ?? "{}")),
            { json: ctx.json },
          );
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );

  addSkillAction(skill, "update-status", "Get space skill update status", "update-status", "GET");
  addSkillAction(skill, "install-update", "Install available space skill update", "install-update", "POST");
  addSkillAction(skill, "delete", "Delete a space skill", "", "DELETE");
}

function addSpaceGet(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --space-id <id>", "Outpost ID").action(async (opts: SkillOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSpace: true });
        printOutput(await ctx.api.get(`${apiPath`/api/spaces/${ctx.spaceId}`}/${path}`), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSpace: false },
  );
}

function addSpacePost(parent: Command, name: string, description: string, path: string, requirePayload = false): void {
  const command = parent.command(name).description(description).option("-C, --space-id <id>", "Outpost ID");
  if (requirePayload) {
    command.requiredOption("--payload-json <json>", "JSON payload");
  } else {
    command.option("--payload-json <json>", "JSON payload", "{}");
  }
  addCommonClientOptions(
    command.action(async (opts: SkillOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSpace: true });
        printOutput(await ctx.api.post(`${apiPath`/api/spaces/${ctx.spaceId}`}/${path}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSpace: false },
  );
}

function addSkillAction(parent: Command, name: string, description: string, suffix: string, method: "GET" | "POST" | "DELETE"): void {
  addCommonClientOptions(
    parent
      .command(name)
      .description(description)
      .argument("<skillId>", "Skill ID")
      .option("-C, --space-id <id>", "Outpost ID")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          const path = `${apiPath`/api/spaces/${ctx.spaceId}/skills/${skillId}`}${suffix ? `/${suffix}` : ""}`;
          const result =
            method === "GET"
              ? await ctx.api.get(path)
              : method === "POST"
                ? await ctx.api.post(path, {})
                : await ctx.api.delete(path);
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
