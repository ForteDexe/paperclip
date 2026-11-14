import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { Agent, Space } from "@outpost/shared";
import { createAgentKeySchema, createBoardApiKeySchema } from "@outpost/shared";
import { loginBoardCli } from "../../client/operator-auth.js";
import { OutpostApiClient } from "../../client/http.js";
import { resolveProfile, readContext, setCurrentProfile, upsertProfile } from "../../client/context.js";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  normalizeApiBase,
  printOutput,
  resolveApiBase,
  type BaseClientOptions,
} from "./common.js";

interface ConnectOptions extends BaseClientOptions {
  profile?: string;
  persona?: "operator" | "agent";
  apiKeyEnvVarName?: string;
  tokenName?: string;
}

interface CreatedAgentKey {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

interface CreatedBoardKey extends CreatedAgentKey {
  expiresAt: string | null;
}

export function registerConnectCommand(program: Command): void {
  addCommonClientOptions(
    program
      .command("connect")
      .description("Interactively connect the CLI as a operator operator or agent")
      .option("--persona <persona>", "Persona to configure: operator or agent")
      .option("--api-key-env-var-name <name>", "Env var name to store in the profile", "OUTPOST_API_KEY")
      .option("--token-name <name>", "Token label to create")
      .action(async (opts: ConnectOptions) => {
        try {
          const result = await connectWizard(opts);
          printOutput(result, { json: opts.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

async function connectWizard(opts: ConnectOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`outpost connect` is interactive. For scripts, pass --api-base/--api-key or use context set/token commands.");
  }

  p.intro(pc.bgCyan(pc.black(" outpost connect ")));

  const context = readContext(opts.context);
  const resolvedProfile = resolveProfile(context, opts.profile);
  const initialApiBase = resolveApiBase(opts, resolvedProfile.profile);
  const apiBaseInput = await p.text({
    message: "Outpost API base",
    initialValue: initialApiBase,
    placeholder: "http://localhost:3100",
  });
  assertNotCancelled(apiBaseInput);
  const apiBase = normalizeApiBase(String(apiBaseInput || initialApiBase));
  console.log(pc.dim(`Checking ${apiBase}/api/health ...`));
  await verifyHealth(apiBase);

  const operatorLogin = await loginBoardCli({
    apiBase,
    requestedAccess: "operator",
    requestedSpaceId: opts.spaceId ?? resolvedProfile.profile.spaceId ?? null,
    command: "outpost connect",
  });
  const operatorApi = new OutpostApiClient({ apiBase, apiKey: operatorLogin.token });
  const spaces = (await operatorApi.get<Space[]>("/api/spaces")) ?? [];

  const persona = await choosePersona(opts.persona);
  const profileName = opts.profile?.trim() || await askProfileName(resolvedProfile.name);
  const apiKeyEnvVarName = opts.apiKeyEnvVarName?.trim() || "OUTPOST_API_KEY";

  if (persona === "operator") {
    const space = await chooseSpace(spaces, opts.spaceId ?? resolvedProfile.profile.spaceId, {
      optional: true,
    });
    const tokenName = opts.tokenName?.trim() || `cli-operator-${new Date().toISOString()}`;
    const key = await operatorApi.post<CreatedBoardKey>("/api/operator-api-keys", createBoardApiKeySchema.parse({
      name: tokenName,
      requestedSpaceId: space?.id ?? null,
    }));
    if (!key) throw new Error("Failed to create operator token");
    upsertProfile(profileName, {
      apiBase,
      spaceId: space?.id,
      persona: "operator",
      agentId: "",
      agentName: "",
      apiKeyEnvVarName,
      tokenName: key.name,
      tokenId: key.id,
      tokenCreatedAt: key.createdAt,
    }, opts.context);
    setCurrentProfile(profileName, opts.context);
    p.outro(pc.green(`Connected profile '${profileName}' as operator.`));
    return {
      ok: true,
      profile: profileName,
      persona: "operator",
      apiBase,
      spaceId: space?.id ?? null,
      key: publicKeyResult(key),
      exports: buildExports({ apiBase, spaceId: space?.id, agentId: undefined, envName: apiKeyEnvVarName, token: key.token }),
    };
  }

  const space = await chooseSpace(spaces, opts.spaceId ?? resolvedProfile.profile.spaceId, {
    optional: false,
  });
  if (!space) throw new Error("Outpost is required for agent profiles");
  const agents = (await operatorApi.get<Agent[]>(apiPath`/api/spaces/${space.id}/agents`)) ?? [];
  if (agents.length === 0) throw new Error(`Outpost '${space.name}' has no agents to connect.`);
  const agent = await chooseAgent(agents, resolvedProfile.profile.agentId);
  const tokenName = opts.tokenName?.trim() || `cli-agent-${new Date().toISOString()}`;
  const key = await operatorApi.post<CreatedAgentKey>(apiPath`/api/agents/${agent.id}/keys`, createAgentKeySchema.parse({ name: tokenName }));
  if (!key) throw new Error("Failed to create agent token");
  upsertProfile(profileName, {
    apiBase,
    spaceId: space.id,
    persona: "agent",
    agentId: agent.id,
    agentName: agent.name,
    apiKeyEnvVarName,
    tokenName: key.name,
    tokenId: key.id,
    tokenCreatedAt: key.createdAt,
  }, opts.context);
  setCurrentProfile(profileName, opts.context);
  p.outro(pc.green(`Connected profile '${profileName}' as ${agent.name}.`));
  return {
    ok: true,
    profile: profileName,
    persona: "agent",
    apiBase,
    spaceId: space.id,
    agentId: agent.id,
    agentName: agent.name,
    key: publicKeyResult(key),
    exports: buildExports({ apiBase, spaceId: space.id, agentId: agent.id, envName: apiKeyEnvVarName, token: key.token }),
  };
}

async function verifyHealth(apiBase: string): Promise<void> {
  const api = new OutpostApiClient({ apiBase });
  await api.get("/api/health");
}

async function choosePersona(input: string | undefined): Promise<"operator" | "agent"> {
  if (input === "operator" || input === "agent") return input;
  const selected = await p.select({
    message: "Connect as",
    options: [
      { value: "operator", label: "Operator operator" },
      { value: "agent", label: "Agent in a space" },
    ],
  });
  assertNotCancelled(selected);
  return selected as "operator" | "agent";
}

async function askProfileName(defaultName: string): Promise<string> {
  const profile = await p.text({
    message: "Profile name",
    initialValue: defaultName || "default",
  });
  assertNotCancelled(profile);
  const value = String(profile).trim();
  if (!value) throw new Error("Profile name is required");
  return value;
}

async function chooseSpace(
  spaces: Space[],
  preferredSpaceId: string | undefined,
  opts: { optional: boolean },
): Promise<Space | null> {
  if (spaces.length === 0) {
    if (opts.optional) return null;
    throw new Error("No spaces are accessible with this operator credential.");
  }
  const preferred = preferredSpaceId ? spaces.find((space) => space.id === preferredSpaceId) : null;
  if (spaces.length === 1 && !opts.optional) return spaces[0] ?? null;
  const selected = await p.select({
    message: opts.optional ? "Default space for this profile" : "Agent space",
    initialValue: preferred?.id ?? spaces[0]?.id,
    options: [
      ...(opts.optional ? [{ value: "", label: "(none)" }] : []),
      ...spaces.map((space) => ({
        value: space.id,
        label: space.name,
        hint: space.id,
      })),
    ],
  });
  assertNotCancelled(selected);
  if (!selected) return null;
  return spaces.find((space) => space.id === selected) ?? null;
}

async function chooseAgent(agents: Agent[], preferredAgentId: string | undefined): Promise<Agent> {
  const selected = await p.select({
    message: "Agent",
    initialValue: preferredAgentId && agents.some((agent) => agent.id === preferredAgentId)
      ? preferredAgentId
      : agents[0]?.id,
    options: agents.map((agent) => ({
      value: agent.id,
      label: agent.name,
      hint: agent.role,
    })),
  });
  assertNotCancelled(selected);
  const agent = agents.find((item) => item.id === selected);
  if (!agent) throw new Error("Agent selection failed");
  return agent;
}

function buildExports(input: {
  apiBase: string;
  spaceId?: string;
  agentId?: string;
  envName: string;
  token: string;
}): string {
  const escaped = (value: string) => value.replace(/'/g, "'\"'\"'");
  return [
    `export OUTPOST_API_URL='${escaped(input.apiBase)}'`,
    input.spaceId ? `export OUTPOST_SPACE_ID='${escaped(input.spaceId)}'` : null,
    input.agentId ? `export OUTPOST_AGENT_ID='${escaped(input.agentId)}'` : null,
    `export ${input.envName}='${escaped(input.token)}'`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function publicKeyResult(key: CreatedAgentKey | CreatedBoardKey) {
  return {
    id: key.id,
    name: key.name,
    createdAt: key.createdAt,
    token: key.token,
    expiresAt: "expiresAt" in key ? key.expiresAt : undefined,
  };
}

function assertNotCancelled<T>(value: T | symbol): asserts value is T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
}
