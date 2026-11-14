import { Command } from "commander";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface SpaceOptions extends BaseClientOptions {
  spaceId?: string;
}

interface JsonPayloadOptions extends SpaceOptions {
  payloadJson?: string;
}

interface QueryOptions extends SpaceOptions {
  query?: string;
  status?: string;
  requestType?: string;
  url?: string;
}

export function registerAccessCommands(program: Command): void {
  addWhoamiCommand(program);
  addCommonClientOptions(
    program
      .command("health")
      .description("Check API health")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get("/api/health"), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const access = program.command("access").description("Access and auth inspection operations");
  addWhoamiCommand(access);

  addCommonClientOptions(
    program
      .command("openapi")
      .description("Print the OpenAPI document")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get("/api/openapi.json"), { json: true });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const profile = program.command("profile").description("Current user profile operations");
  addSimpleGet(profile, "session", "Get auth session", "/api/auth/get-session");
  addSimpleGet(profile, "get", "Get current auth profile", "/api/auth/profile");
  addJsonPatch(profile, "update", "Update current auth profile", "/api/auth/profile");
  addCommonClientOptions(
    profile
      .command("space-user")
      .description("Get a user profile within a space")
      .argument("<userSlug>", "User slug")
      .option("-C, --space-id <id>", "Outpost ID")
      .action(async (userSlug: string, opts: SpaceOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          printOutput(await ctx.api.get(apiPath`/api/spaces/${ctx.spaceId}/users/${userSlug}/profile`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );

  const invite = program.command("invite").description("Invite operations");
  addSpaceList(invite, "list", "List space invites", "invites");
  addSpacePost(invite, "create", "Create an invite", "invites");
  addCommonClientOptions(
    invite
      .command("revoke")
      .description("Revoke an invite")
      .argument("<inviteId>", "Invite ID")
      .action(async (inviteId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/invites/${inviteId}/revoke`, {}), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  for (const [name, suffix] of [
    ["show", ""],
    ["logo", "logo"],
    ["onboarding", "onboarding"],
    ["onboarding:text", "onboarding.txt"],
    ["skills:index", "skills/index"],
  ] as const) {
    addCommonClientOptions(
      invite
        .command(name)
        .description(`Get invite ${name}`)
        .argument("<token>", "Invite token")
        .action(async (token: string, opts: BaseClientOptions) => {
          try {
            const ctx = resolveCommandContext(opts);
            const path = `${apiPath`/api/invites/${token}`}${suffix ? `/${suffix}` : ""}`;
            printOutput(await ctx.api.get(path), { json: ctx.json });
          } catch (err) {
            handleCommandError(err);
          }
      }),
    );
  }
  addCommonClientOptions(
    invite
      .command("test-resolution")
      .description("Test invite URL resolution")
      .argument("<token>", "Invite token")
      .requiredOption("--url <url>", "URL to test")
      .action(async (token: string, opts: QueryOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const query = new URLSearchParams({ url: opts.url ?? "" });
          printOutput(await ctx.api.get(`${apiPath`/api/invites/${token}/test-resolution`}?${query.toString()}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    invite
      .command("skill")
      .description("Get invite skill markdown")
      .argument("<token>", "Invite token")
      .argument("<skillName>", "Skill name")
      .action(async (token: string, skillName: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/invites/${token}/skills/${skillName}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    invite
      .command("accept")
      .description("Accept an invite")
      .argument("<token>", "Invite token")
      .option("--payload-json <json>", "Invite accept JSON payload", "{}")
      .action(async (token: string, opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/invites/${token}/accept`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const join = program.command("join").description("Join request operations");
  addCommonClientOptions(
    join
      .command("list")
      .description("List join requests")
      .option("-C, --space-id <id>", "Outpost ID")
      .option("--status <status>", "Filter by status (pending_approval, approved, rejected; pending alias accepted)")
      .option("--request-type <type>", "Filter by request type")
      .action(async (opts: QueryOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSpace: true });
          const params = new URLSearchParams();
          const status = normalizeJoinStatus(opts.status);
          if (status) params.set("status", status);
          if (opts.requestType) params.set("requestType", opts.requestType);
          const query = params.toString();
          printOutput(await ctx.api.get(`${apiPath`/api/spaces/${ctx.spaceId}/join-requests`}${query ? `?${query}` : ""}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSpace: false },
  );
  addJoinAction(join, "approve");
  addJoinAction(join, "reject");
  addCommonClientOptions(
    join
      .command("claim-key")
      .description("Claim an agent API key for an approved join request")
      .argument("<requestId>", "Join request ID")
      .requiredOption("--claim-secret <secret>", "Claim secret")
      .action(async (requestId: string, opts: BaseClientOptions & { claimSecret: string }) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/join-requests/${requestId}/claim-api-key`, { claimSecret: opts.claimSecret }), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const member = program.command("member").description("Outpost member operations");
  addSpaceList(member, "list", "List space members", "members");
  addSpaceList(member, "user-directory", "List space user directory", "user-directory");
  addMemberPatch(member, "update", "members");
  addMemberPatch(member, "role-and-grants", "members", "role-and-grants");
  addMemberPatch(member, "permissions", "members", "permissions");
  addMemberPost(member, "archive", "members", "archive");

  const admin = program.command("admin").description("Instance admin operations");
  const user = admin.command("user").description("Admin user operations");
  addCommonClientOptions(
    user
      .command("list")
      .description("List users")
      .option("--query <text>", "Search query")
      .action(async (opts: QueryOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const query = opts.query ? `?${new URLSearchParams({ query: opts.query }).toString()}` : "";
          printOutput(await ctx.api.get(`/api/admin/users${query}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addAdminUserPost(user, "promote", "promote-instance-admin");
  addAdminUserPost(user, "demote", "demote-instance-admin");
  addCommonClientOptions(
    user
      .command("space-access")
      .description("Get user space access")
      .argument("<userId>", "User ID")
      .action(async (userId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/admin/users/${userId}/space-access`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    user
      .command("space-access:update")
      .description("Update user space access")
      .argument("<userId>", "User ID")
      .requiredOption("--payload-json <json>", "UpdateUserSpaceAccess JSON payload")
      .action(async (userId: string, opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.put(apiPath`/api/admin/users/${userId}/space-access`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const instance = program.command("instance").description("Instance operations");
  addSimpleGet(instance, "scheduler-heartbeats", "List scheduler heartbeat agents", "/api/instance/scheduler-heartbeats");
  addSimpleGet(instance, "settings:general", "Get general instance settings", "/api/instance/settings/general");
  addJsonPatch(instance, "settings:general:update", "Update general instance settings", "/api/instance/settings/general");
  addSimpleGet(instance, "settings:experimental", "Get experimental instance settings", "/api/instance/settings/experimental");
  addJsonPatch(instance, "settings:experimental:update", "Update experimental instance settings", "/api/instance/settings/experimental");
  addCommonClientOptions(
    instance
      .command("database-backup")
      .description("Create a database backup")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post("/api/instance/database-backups", {}), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const sidebar = program.command("sidebar").description("Sidebar preference and badge operations");
  addSimpleGet(sidebar, "preferences", "Get current sidebar preferences", "/api/sidebar-preferences/me");
  addJsonPut(sidebar, "preferences:update", "Update current sidebar preferences", "/api/sidebar-preferences/me");
  addSpaceList(sidebar, "project-preferences", "Get current project sidebar preferences", "sidebar-preferences/me");
  addSpacePut(sidebar, "project-preferences:update", "Update current project sidebar preferences", "sidebar-preferences/me");
  addSpaceList(sidebar, "badges", "Get sidebar badges", "sidebar-badges");

  const inbox = program.command("inbox").description("Operator inbox operations");
  addSpaceList(inbox, "dismissals", "List dismissed inbox items", "inbox-dismissals");
  addSpacePost(inbox, "dismiss", "Dismiss an inbox item", "inbox-dismissals");

  const operatorClaim = program.command("operator-claim").description("Operator claim token operations");
  addCommonClientOptions(
    operatorClaim
      .command("show")
      .description("Inspect an operator claim token")
      .argument("<token>", "Claim token")
      .action(async (token: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/operator-claim/${token}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    operatorClaim
      .command("claim")
      .description("Claim an operator claim token")
      .argument("<token>", "Claim token")
      .option("--payload-json <json>", "Claim JSON payload", "{}")
      .action(async (token: string, opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/operator-claim/${token}/claim`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const openclaw = program.command("openclaw").description("OpenClaw integration helpers");
  addSpacePost(openclaw, "invite-prompt", "Create an OpenClaw invite prompt", "openclaw/invite-prompt");

  const publicSkills = program.command("available-skill").description("Public skill catalog operations");
  addSimpleGet(publicSkills, "list", "List available skills", "/api/skills/available");
  addSimpleGet(publicSkills, "index", "Get available skill index", "/api/skills/index");
  addCommonClientOptions(
    publicSkills
      .command("get")
      .description("Get available skill markdown")
      .argument("<skillName>", "Skill name")
      .action(async (skillName: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/skills/${skillName}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const llm = program.command("llm").description("LLM prompt documentation");
  addSimpleGet(llm, "agent-configuration", "Get agent configuration prompt docs", "/api/llms/agent-configuration.txt");
  addSimpleGet(llm, "agent-icons", "Get agent icon prompt docs", "/api/llms/agent-icons.txt");
  addCommonClientOptions(
    llm
      .command("agent-configuration:adapter")
      .description("Get adapter-specific agent configuration prompt docs")
      .argument("<adapterType>", "Adapter type")
      .action(async (adapterType: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(`${apiPath`/api/llms/agent-configuration/${adapterType}`}.txt`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

function addWhoamiCommand(parent: Command): void {
  addCommonClientOptions(
    parent
      .command("whoami")
      .description("Show current CLI auth identity")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get("/api/cli-auth/me"), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

function normalizeJoinStatus(status: string | undefined): string | undefined {
  if (status === "pending") return "pending_approval";
  return status;
}

function addSimpleGet(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(parent.command(name).description(description).action(async (opts: BaseClientOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.get(path), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function addJsonPatch(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(parent.command(name).description(description).requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.patch(path, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function addJsonPut(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(parent.command(name).description(description).requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.put(path, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function addSpaceList(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --space-id <id>", "Outpost ID").action(async (opts: SpaceOptions) => {
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

function addSpacePut(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --space-id <id>", "Outpost ID").requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSpace: true });
        printOutput(await ctx.api.put(`${apiPath`/api/spaces/${ctx.spaceId}`}/${path}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSpace: false },
  );
}

function addSpacePost(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --space-id <id>", "Outpost ID").requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
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

function addJoinAction(parent: Command, action: "approve" | "reject"): void {
  addCommonClientOptions(
    parent.command(action).description(`${action} a join request`).argument("<requestId>", "Join request ID").option("-C, --space-id <id>", "Outpost ID").action(async (requestId: string, opts: SpaceOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSpace: true });
        printOutput(await ctx.api.post(`${apiPath`/api/spaces/${ctx.spaceId}/join-requests/${requestId}`}/${action}`, {}), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSpace: false },
  );
}

function addMemberPatch(parent: Command, name: string, path: string, suffix?: string): void {
  addCommonClientOptions(
    parent.command(name).description(`${name} a member`).argument("<memberId>", "Member ID").option("-C, --space-id <id>", "Outpost ID").requiredOption("--payload-json <json>", "JSON payload").action(async (memberId: string, opts: JsonPayloadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSpace: true });
        const route = `${apiPath`/api/spaces/${ctx.spaceId}`}/${path}/${encodeURIComponent(memberId)}${suffix ? `/${suffix}` : ""}`;
        printOutput(await ctx.api.patch(route, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSpace: false },
  );
}

function addMemberPost(parent: Command, name: string, path: string, suffix: string): void {
  addCommonClientOptions(
    parent.command(name).description(`${name} a member`).argument("<memberId>", "Member ID").option("-C, --space-id <id>", "Outpost ID").option("--payload-json <json>", "JSON payload", "{}").action(async (memberId: string, opts: JsonPayloadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSpace: true });
        printOutput(await ctx.api.post(`${apiPath`/api/spaces/${ctx.spaceId}`}/${path}/${encodeURIComponent(memberId)}/${suffix}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSpace: false },
  );
}

function addAdminUserPost(parent: Command, name: string, suffix: string): void {
  addCommonClientOptions(parent.command(name).description(`${name} instance admin`).argument("<userId>", "User ID").action(async (userId: string, opts: BaseClientOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.post(`${apiPath`/api/admin/users/${userId}`}/${suffix}`, {}), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
