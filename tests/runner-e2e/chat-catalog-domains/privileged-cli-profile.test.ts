import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { contextGuidanceArgv, runOwnedCli } from "./privileged-cli-support.js";
import { gradeChooseCliContext, privilegedCliCases } from "./privileged-cli.js";
import { settlePrivilegedChat } from "./privileged-support.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { readContext, upsertProfile, setCurrentProfile } from "../../../cli/src/client/context.js";
vi.mock("./internal-definition.js", () => ({ fixtureWorker: vi.fn() }));
vi.mock("./privileged-cli-support.js", async original => ({ ...await original<typeof import("./privileged-cli-support.js")>(), runOwnedCli: vi.fn() }));
vi.mock("./privileged-support.js", async original => ({ ...await original<typeof import("./privileged-support.js")>(), settlePrivilegedChat: vi.fn() }));
const fixture = { space: "owned-space", apiBase: "http://fixture.test" };
const fence = (text: string) => `\`\`\`bash\n${text}\n\`\`\``;
const exact = "outpost context set --profile acorn --space-id owned-space --persona operator --use\noutpost space current\noutpost auth whoami";
const directories: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it("accepts actual supported operator persona and space/identity readback with inherited configured API, without rewriting argv", () => {
  expect(contextGuidanceArgv(fence(exact), fixture)).toEqual({ commands: [
    ["context", "set", "--profile", "acorn", "--space-id", "owned-space", "--persona", "operator", "--use"],
    ["space", "current"], ["auth", "whoami"]], bindings: [], signIn: [] });
});
it("accepts selecting the existing configured profile then reading its scoped space", () => {
  expect(contextGuidanceArgv(fence("outpost context use acorn\noutpost space current --json"), fixture)?.commands).toEqual([["context", "use", "acorn"], ["space", "current", "--json"]]);
});
it.each([exact.replace("owned-space", "foreign"), exact.replace("operator", "agent"), exact.replace("--use", "--api-base https://foreign.invalid --use"),
  exact.replace("owned-space", "<acorn-space-id>"), exact.replace("owned-space", "<SPACE_ID>"), exact.replace("owned-space", "$SPACE_ID"),
  exact.replace("--persona operator", "--agent-id attacker"), exact.replace("--persona operator", "--api-key secret"), exact.replace("--persona operator", "--invented yes"),
  exact.replace("--use", "--use --use"), exact.replace("space current", "space current --space-id foreign"),
  exact.replace("space current", "space list"), exact.replace("auth whoami", "auth login --api-base https://foreign.invalid"), exact.replace("auth whoami", "auth login --token secret"), exact.replace("space current", "issue create --title nope"), exact + " ; curl bad.invalid",
  "outpost space current\noutpost context use acorn", "outpost context use acorn\noutpost auth whoami"])("rejects unsafe, unresolved, foreign or missing scoped readback: %s", text => {
  expect(contextGuidanceArgv(fence(text), fixture)).toBeUndefined();
});
// Recorded reply from run 42638568885: an optional sign-in step precedes the
// context commands. It is recorded, not executed: the owned actor is signed in.
it("records a well-formed sign-in step without executing it", () => {
  const recorded = "npx @outpost/cli auth login --api-base <your Outpost URL>\nnpx @outpost/cli context set --profile acorn --api-base <your Outpost URL> --space-id owned-space --use\nnpx @outpost/cli context show\nnpx @outpost/cli space current\nnpx @outpost/cli auth whoami";
  const parsed = contextGuidanceArgv(fence(recorded), fixture);
  expect(parsed?.signIn).toEqual([["auth", "login", "--api-base", "<your Outpost URL>"]]);
  expect(parsed?.commands.map(argv => argv.slice(0, 2))).toEqual([["context", "set"], ["context", "show"], ["space", "current"], ["auth", "whoami"]]);
});
// The agent cannot see the person's profile names, so the name is its choice:
// a new profile parses, and rewriting the other profile fails on saved state.
it.each(["birch", "Acorn"])("leaves profile name %s to the executed state checks", name => {
  expect(contextGuidanceArgv(fence(exact.replace("acorn", name)), fixture)?.commands[0]?.[3]).toBe(name);
});
it("actual production partial profile update preserves configured API and Birch while explicit operator persona is retained", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "owned-cli-profile-")); directories.push(dir); const file = path.join(dir, "context.json");
  for (const [name, space] of [["acorn", fixture.space], ["birch", "other-space"]]) upsertProfile(name!, { apiBase: fixture.apiBase, spaceId: space, persona: "operator" }, file);
  setCurrentProfile("birch", file); const before = readContext(file);
  upsertProfile("acorn", { spaceId: fixture.space, persona: "operator" }, file); setCurrentProfile("acorn", file); const after = readContext(file);
  expect(after.currentProfile).toBe("acorn"); expect(after.profiles.acorn).toEqual({ apiBase: fixture.apiBase, spaceId: fixture.space, persona: "operator" });
  expect(after.profiles.birch).toEqual(before.profiles.birch);
});
it("requires independently executed context, actual scoped space and an operator identity rather than grammar alone", () => {
  const o = { scenarioId: "cli", origin: fixture.apiBase, spaceId: fixture.space, leadId: "lead", projects: [], tasks: [], goals: [], comments: [], activity: [], documents: [], revisions: [], links: [], humanQueries: ["canonical"], runs: [{id:"native",status:"succeeded"}], reply: fence(exact),
    state: { initialProfile: "birch", finalProfile: "acorn", selectedSpaceId: fixture.space, selectedApiBase: fixture.apiBase, selectedPersona: "operator", actualScopedSpaceId: fixture.space,
      contextCommandsExecuted: true, otherProfilePreserved: true, onlyOwnedContextWritten: true, operatorUserId: "person", identityIsOperatorUser: true, identityIncludesSelectedSpace: true } };
  expect(gradeChooseCliContext(o).passed).toBe(true);
  // The optional persona label may be left unset: the authenticated identity decides who runs the commands.
  expect(gradeChooseCliContext({ ...o, state: { ...o.state, selectedPersona: undefined } }).passed).toBe(true);
  for (const delta of [{ selectedPersona: "agent" }, { identityIsOperatorUser: false }, { actualScopedSpaceId: "foreign" }, { actualScopedSpaceId: undefined },
    { contextCommandsExecuted: false }, { identityIncludesSelectedSpace: false }, { otherProfilePreserved: false }])
    expect(gradeChooseCliContext({ ...o, state: { ...o.state, ...delta } }).passed).toBe(false);
});

it.each([fixture.space, "foreign"])("owning act executes unmodified returned commands then independently observes actual scoped space %s", async savedSpace => {
  const commands = contextGuidanceArgv(fence(exact), fixture)!.commands;
  const otherProfile = { spaceId: "birch-space", apiBase: fixture.apiBase, persona: "operator" };
  const profile = { spaceId: fixture.space, apiBase: fixture.apiBase, persona: "operator" };
  vi.mocked(settlePrivilegedChat).mockResolvedValue({ reply: fence(exact) } as never);
  vi.mocked(runOwnedCli).mockImplementation(async (_ctx, argv) => {
    // The first three calls are the returned sequence. Verification uses fresh
    // JSON reads after it, never treats a suggested command as an outcome.
    const index = vi.mocked(runOwnedCli).mock.calls.length;
    if (index <= commands.length) return "{}";
    if (argv[0] === "context") return JSON.stringify({ currentProfile: "acorn", contextPath: "/owned/context.json", profile, profiles: { acorn: profile, birch: otherProfile } });
    if (argv[0] === "space") return JSON.stringify({ id: savedSpace });
    return JSON.stringify({ user: { id: "person", name: "Person", email: "person@example.test" }, userId: "person", spaceIds: [fixture.space] });
  });
  const ctx = { observationDeadlineAt: Date.now() + 10_000, input: { api: { baseURL: fixture.apiBase }, fixtures: { space: { id: fixture.space } }, evidence: vi.fn() } } as unknown as ChatCatalogContext;
  const state: Record<string, unknown> = { initialProfile: "birch", operatorDirectory: "/owned", otherProfile };
  await privilegedCliCases.find(row => row.scenarioId === "cli-operations.choose-cli-context")!.act!(ctx, state);
  expect(vi.mocked(runOwnedCli).mock.calls.map(call => call[1])).toEqual([...commands, ["context", "show", "--json"], ["space", "current", "--json"], ["auth", "whoami", "--json"]]);
  expect(state.unresolvedContextBindings).toEqual([]); expect(state.actualScopedSpaceId).toBe(savedSpace);
  const observation = { scenarioId: "cli", origin: fixture.apiBase, spaceId: fixture.space, leadId: "lead", projects: [], tasks: [], goals: [], comments: [], activity: [], documents: [], revisions: [], links: [], humanQueries: ["canonical"], runs: [{ id: "native", status: "succeeded" }], reply: fence(exact), state };
  expect(gradeChooseCliContext(observation).passed).toBe(savedSpace === fixture.space);
});
