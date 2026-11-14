import { describe, expect, it, vi } from "vitest";
import { websiteCreateArgv, validContextGuidance, contextGuidanceArgv } from "./privileged-cli-support.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { privilegedCliCases, gradeChooseCliContext, gradeCreateFromCli } from "./privileged-cli.js";
vi.mock("./internal-definition.js", () => ({ fixtureWorker: vi.fn() }));
const target = { space: "owned-space", project: "launch", agent: "morgan", apiBase: "http://127.0.0.1:3100" };
const command = (text: string) => `Use the explicit owned context.\n\`\`\`bash\n${text}\n\`\`\``;
const valid = 'outpost issue create --space-id <SPACE_ID> --title "Website task" --project-id <PROJECT_ID> --assignee-agent-id <MORGAN_AGENT_ID>';
describe("returned CLI command admission", () => {
  it("executes only finite supported argv with unresolved IDs bound to actual fixtures", () => {
    expect(websiteCreateArgv(command(valid), target)).toEqual(["issue", "create", "--space-id", "owned-space", "--title", "Website task", "--project-id", "launch", "--assignee-agent-id", "morgan"]);
    expect(websiteCreateArgv(command(valid + " --json"), target).at(-1)).toBe("--json");
    expect(websiteCreateArgv(command(valid.replace("Website task", "Landing page refresh")), target)[5]).toBe("Landing page refresh");
    const retained = 'npx @outpost/cli issue create --space-id "$OUTPOST_SPACE_ID" --title "Build the website" --project-id "<LAUNCH_PROJECT_ID>" --assignee-agent-id "<MORGAN_AGENT_ID>" --status todo --standalone';
    expect(websiteCreateArgv(command(retained), target)).toEqual(["issue", "create", "--space-id", target.space,
      "--title", "Build the website", "--project-id", target.project, "--assignee-agent-id", target.agent, "--status", "todo", "--standalone"]);
  });
  it("rejects shell execution, invented flags, real wrong IDs and ambiguous writes before launch", () => {
    for (const text of [valid + " ; curl attacker.invalid", valid + " --invented yes", valid.replace("<SPACE_ID>", "foreign-space"),
      valid.replace("<PROJECT_ID>", "other-project"), valid + " -C foreign-space", valid + " --status in_progress",
      valid + " --api-base https://foreign.invalid", valid + " --description '$(read-secret)'", valid + "\n" + valid])
      expect(() => websiteCreateArgv(command(text), target)).toThrow();
  });
  it("requires supported context selection and readback instead of ignoring invented flags", () => {
    const valid = command("outpost context use acorn\noutpost context show --json");
    expect(validContextGuidance(valid, target)).toBe(true);
    expect(validContextGuidance(valid.replace("use acorn", "use acorn --invented yes"), target)).toBe(false);
    expect(validContextGuidance(command("outpost context use acorn"), target)).toBe(false);
    expect(validContextGuidance(command('export OUTPOST_SPACE_ID="owned-space"\nnpx @outpost/cli board setup\necho "$OUTPOST_SPACE_ID"'), target)).toBe(false);
    // The space is known in the conversation, so its placeholder is not bound.
    expect(validContextGuidance(command("outpost context set --profile acorn --api-base <API_BASE> --space-id <SPACE_ID> --use\noutpost context show"), target)).toBe(false);
    // The person's own Outpost address is a placeholder the agent cannot fill; it binds to the fixture origin.
    const addressed = contextGuidanceArgv(command("npx @outpost/cli context set --profile acorn-co --api-base <your Outpost URL> --space-id owned-space --use\nnpx @outpost/cli space current\nnpx @outpost/cli auth whoami"), target);
    expect(addressed?.commands[0]).toEqual(["context", "set", "--profile", "acorn-co", "--api-base", target.apiBase, "--space-id", "owned-space", "--use"]);
    expect(addressed?.bindings).toEqual([{ commandIndex: 0, flag: "--api-base", placeholder: "<your Outpost URL>", fixtureValue: target.apiBase }]);
    expect(validContextGuidance(command("outpost space list\noutpost context list\noutpost context set --profile acorn --space-id owned-space --use\noutpost context show"), target)).toBe(true);
    // Without --profile, set rewrites the person's current (other) profile; a wrong real address is not repaired.
    expect(validContextGuidance(command("outpost context set --api-base <URL> --space-id owned-space --use\noutpost context show"), target)).toBe(false);
    expect(validContextGuidance(command("outpost context set --profile acorn --api-base http://localhost:3100 --space-id owned-space --use\noutpost context show"), target)).toBe(false);
  });
});
const base = { scenarioId: "cli", origin: target.apiBase, spaceId: target.space, leadId: "lead", state: {}, projects: [], goals: [],
  comments: [], activity: [], documents: [], revisions: [], links: [], humanQueries: ["canonical"], runs: [{ id: "native", status: "succeeded" }], reply: "" };
describe("CLI public-state oracles", () => {
  it("requires one actual later result, requested actor/project/space, and independently saved task", () => {
    const row = { id: "created", spaceId: target.space, title: "Website task", projectId: "launch", assigneeAgentId: "morgan", status: "backlog" };
    const o = { ...base, tasks: [row], state: { cliResult: row, worker: { id: "morgan" }, project: { id: "launch" }, tasksBeforeCli: 0,
      cliCommandExecuted: true, expectedCliStatus: "backlog", cliStructuredResultVerified: true, workerWasManuallyPaused: true, explicitSpace: target.space, executedArgv: ["issue", "create"] } };
    expect(gradeCreateFromCli(o).passed).toBe(true);
    expect(gradeCreateFromCli({ ...o, tasks: [{ ...row, status: "todo" }], state: { ...o.state,
      cliResult: { ...row, status: "todo" }, expectedCliStatus: "todo" } }).passed).toBe(true);
    for (const delta of [{ expectedCliStatus: "todo" }, { cliStructuredResultVerified: false }, { workerWasManuallyPaused: false }])
      expect(gradeCreateFromCli({ ...o, state: { ...o.state, ...delta } }).passed).toBe(false);
    // The title is model wording: a valid task with another title passes on the same structure.
    expect(gradeCreateFromCli({ ...o, tasks: [{ ...row, title: "Landing page refresh" }], state: { ...o.state, cliResult: { ...row, title: "Landing page refresh" } } }).passed).toBe(true);
    expect(gradeCreateFromCli({ ...o, tasks: [{ ...row, assigneeAgentId: "other" }] }).passed).toBe(false);
    expect(gradeCreateFromCli({ ...o, tasks: [{ ...row, projectId: "other" }] }).passed).toBe(false);
    expect(gradeCreateFromCli({ ...o, tasks: [{ ...row, spaceId: "foreign" }] }).passed).toBe(false);
    expect(gradeCreateFromCli({ ...o, tasks: [row, { ...row, id: "duplicate" }] }).passed).toBe(false);
    expect(gradeCreateFromCli({ ...o, state: { ...o.state, tasksBeforeCli: 1 } }).passed).toBe(false);
    expect(gradeCreateFromCli({ ...o, state: { ...o.state, cliResult: { ...row, status: "todo" } } }).passed).toBe(false);
    expect(gradeCreateFromCli(null).passed).toBe(false);
  });
  it("requires selected identity/space and preserves the other operator profile", () => {
    const o = { ...base, tasks: [], reply: command("outpost context use acorn\noutpost context show --json"),
      state: { initialProfile: "birch", finalProfile: "acorn", selectedSpaceId: target.space, selectedApiBase: target.apiBase,
        selectedPersona: "board", actualScopedSpaceId: target.space, contextCommandsExecuted: true,
        otherProfilePreserved: true, onlyOwnedContextWritten: true, operatorUserId: "synthetic-person", identityIsOperatorUser: true, identityIncludesSelectedSpace: true } };
    expect(gradeChooseCliContext(o).passed).toBe(true);
    // The profile name is the model's choice; selecting the other (birch) profile is not.
    expect(gradeChooseCliContext({ ...o, state: { ...o.state, finalProfile: "acorn-space" } }).passed).toBe(true);
    for (const delta of [{ otherProfilePreserved: false }, { selectedSpaceId: "foreign" }, { identityIncludesSelectedSpace: false }, { onlyOwnedContextWritten: false }, { finalProfile: "birch" }])
      expect(gradeChooseCliContext({ ...o, state: { ...o.state, ...delta } }).passed).toBe(false);
  });
});

// Independent setup readback must preserve the actual pause, rather than treating
// a declared fixture flag as proof that todo cannot dispatch native work.
it("independently checks source readiness and the same-space manual-only CLI worker hold", async () => {
  const definition = privilegedCliCases.find(row => row.scenarioId === "cli-operations.create-from-cli")!;
  const lead = { id: "lead", spaceId: target.space, lifecycleState: "ready", status: "idle" };
  const worker = { id: "morgan", spaceId: target.space, lifecycleState: "paused", status: "paused", lifecycleHolds: ["manual"] };
  const context = (saved: typeof worker) => ({ input: { fixtures: { space: { id: target.space }, agent: { id: "lead" } },
    api: { get: async (route: string) => route.endsWith("/lead") ? lead : saved } } }) as unknown as ChatCatalogContext;
  const state = { worker: { id: "morgan" } };
  expect(definition.setupPolicy?.readiness).toBe("preserve-scenario");
  expect((await definition.verifySetup!(context(worker), state)).passed).toBe(true);
  for (const delta of [{ spaceId: "foreign" }, { status: "idle" }, { lifecycleHolds: ["budget"] }, { lifecycleHolds: ["manual", "budget"] }])
    expect((await definition.verifySetup!(context({ ...worker, ...delta }), state)).passed).toBe(false);
});
