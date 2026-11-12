<p align="center">
  <img src="https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/assets/banner.jpg" alt="Outpost coordinates persistent AI agents and their work." width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://docs.paperclip.ing"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/paperclipai/paperclip"><strong>GitHub</strong></a> &middot;
  <a href="https://discord.gg/paperclipai"><strong>Discord</strong></a> &middot;
  <a href="https://x.com/papercliping"><strong>Twitter</strong></a> &middot;
  <a href="https://paperclip.ing"><strong>Website</strong></a>
</p>

<p align="center">
  <a href="https://github.com/paperclipai/paperclip/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/paperclipai/paperclip/stargazers"><img src="https://img.shields.io/github/stars/paperclipai/paperclip?style=flat" alt="Stars" /></a>
  <a href="https://discord.gg/paperclipai"><img src="https://img.shields.io/discord/000000000?label=discord" alt="Discord" /></a>
</p>

<br/>

<div align="center">
  <video src="https://github.com/user-attachments/assets/773bdfb2-6d1e-4e30-8c5f-3487d5b70c8f" width="600" controls></video>
</div>

<br/>

# Outpost coordinates persistent AI agents and their work.

Open-source orchestration for teams of AI agents.

Outpost is a private fork for persistent AI-agent sessions, durable development scopes, and Campfire group chat. Internal package names and command compatibility remain unchanged where renaming would break existing data or automation.

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the North Star | _"Ship the next useful version of this project."_                  |
| **02** | Form the crew   | Outpost Lead, Engineering Lead, specialists — any bot, any provider. |
| **03** | Approve and run | Review direction. Start work. Monitor from the dashboard.          |

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Works<br/>with</strong></td>
    <td align="center"><img src="https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/assets/logos/openclaw.svg" width="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/assets/logos/claude.svg" width="32" alt="Claude" /><br/><sub>Claude Code</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/assets/logos/codex.svg" width="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/assets/logos/cursor.svg" width="32" alt="Cursor" /><br/><sub>Cursor</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/assets/logos/bash.svg" width="32" alt="Bash" /><br/><sub>Bash</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/assets/logos/http.svg" width="32" alt="HTTP" /><br/><sub>HTTP</sub></td>
  </tr>
</table>

<em>If it can receive a heartbeat, it's hired.</em>

</div>

<br/>

## Outpost is right for you if

- ✅ You want persistent AI agents with clear development scopes
- ✅ You **coordinate many different agents** (OpenClaw, Codex, Claude, Cursor) toward a common North Star
- ✅ You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- ✅ You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- ✅ You want a process for managing agents that **feels like using a task manager**
- ✅ You want to review and coordinate agent work **from your phone**

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one crew map. If it can receive a heartbeat, it can join the crew.
</td>
<td align="center" width="33%">
<h3>🎯 North Star Alignment</h3>
Every task traces back to the outpost mission. Agents know <em>what</em> to do and <em>why</em>.
</td>
<td align="center" width="33%">
<h3>💓 Heartbeats</h3>
Agents wake on a schedule, check work, and act. Delegation follows the crew map.
</td>
</tr>
<tr>
<td align="center">
<h3>🔥 Campfire</h3>
Persistent group chat lets people and agents coordinate in shared rooms.
</td>
<td align="center">
<h3>🏕️ Multiple Outposts</h3>
One deployment can coordinate separate outposts with isolated work and history.
</td>
<td align="center">
<h3>🎫 Ticket System</h3>
Every conversation traced. Every decision explained. Full tool-call tracing and immutable audit log.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Governance</h3>
Approve hires, override strategy, pause or terminate any agent — at any time.
</td>
<td align="center">
<h3>📊 Crew Map</h3>
Roles, reporting lines, and durable scopes make ownership explicit.
</td>
<td align="center">
<h3>📱 Mobile Ready</h3>
Monitor and coordinate agent work from anywhere.
</td>
</tr>
</table>

<br/>

## Problems Outpost solves

| Without Outpost                                                                                                                     | With Outpost                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ You have 20 Claude Code tabs open and can't track which one does what. On reboot you lose everything.                              | ✅ Tasks are ticket-based, conversations are threaded, sessions persist across reboots.                                                |
| ❌ You manually gather context from several places to remind your bot what you're actually doing.                                     | ✅ Context flows from the task up through the project and outpost North Stars — your agent always knows what to do and why.                  |
| ❌ Folders of agent configs are disorganized and you're re-inventing task management, communication, and coordination between agents. | ✅ Outpost gives you crew maps, ticketing, delegation, and governance out of the box — so you coordinate one durable outpost, not a pile of scripts. |
| ❌ Long-running work is hard to supervise across many sessions.                                                                      | ✅ Run history, stop controls, and durable task state keep execution visible and recoverable.                                           |
| ❌ You have recurring jobs (customer support, social, reports) and have to remember to manually kick them off.                        | ✅ Heartbeats handle regular work on a schedule. Management supervises.                                                                |
| ❌ You have an idea, you have to find your repo, fire up Claude Code, keep a tab open, and babysit it.                                | ✅ Add a task in Outpost. Your coding agent works on it until it's done. Management reviews their work.                              |

<br/>

## Why Outpost is special

Outpost handles the hard orchestration details correctly.

|                                   |                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Atomic execution.**             | Task checkout is atomic, preventing double-work across concurrent agents.                                     |
| **Persistent agent state.**       | Agents resume the same task context across heartbeats instead of restarting from scratch.                     |
| **Runtime skill injection.**      | Agents can learn Outpost workflows and project context at runtime, without retraining.                      |
| **Governance with rollback.**     | Approval gates are enforced, config changes are revisioned, and bad changes can be rolled back safely.        |
| **North Star-aware execution.**         | Tasks carry full North Star ancestry so agents consistently see the "why," not just a title.                        |
| **Portable outpost templates.**   | Export/import outposts, agents, and skills with secret scrubbing and collision handling.                      |
| **Outpost isolation.**            | Compatibility-layer scoping lets one deployment run many outposts with separate data and audit trails.       |

<br/>

## What's Under the Hood

Outpost is a full control plane, not a wrapper. Before you build any of this yourself, know that it already exists:

```
┌──────────────────────────────────────────────────────────────┐
│                         OUTPOST SERVER                       │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │Identity & │  │  Work &   │  │ Heartbeat │  │Governance │  │
│  │  Access   │  │   Tasks   │  │ Execution │  │& Approvals│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Crew Map  │  │Workspaces │  │  Plugins  │  │ Campfire  │  │
│  │ & Agents  │  │ & Runtime │  │           │  │Group Chat │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Routines  │  │ Secrets & │  │ Activity  │  │  Outpost  │  │
│  │& Schedules│  │  Storage  │  │ & Events  │  │Portability│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
   ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
   │  Claude   │  │   Codex   │  │   CLI     │  │ HTTP/web  │
   │   Code    │  │           │  │  agents   │  │   bots    │
   └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

### The Systems

<table>
<tr>
<td width="50%">

**Identity & Access** — Two deployment modes (trusted local or authenticated), board users, agent API keys, short-lived run JWTs, outpost crew access, invite flows, and OpenClaw onboarding. Every mutating request is traced to an actor.

</td>
<td width="50%">

**Crew Map & Agents** — Agents have roles, titles, reporting lines, permissions, and durable scopes. Adapter examples match the diagram: Claude Code, Codex, CLI agents such as Cursor/Gemini/bash, HTTP/webhook bots such as OpenClaw, and external adapter plugins.

</td>
</tr>
<tr>
<td>

**Work & Task System** — Issues carry outpost/project/North Star/parent links, atomic checkout with execution locks, first-class blocker dependencies, comments, documents, attachments, work products, labels, and inbox state. No double-work, no lost context.

</td>
<td>

**Heartbeat Execution** — DB-backed wakeup queue with coalescing, workspace resolution, secret injection, skill loading, and adapter invocation. Runs produce structured logs, session state, and audit trails. Recovery handles orphaned runs automatically.

</td>
</tr>
<tr>
<td>

**Workspaces & Runtime** — Project workspaces, isolated execution workspaces (git worktrees, operator branches), and runtime services (dev servers, preview URLs). Agents work in the right directory with the right context every time.

</td>
<td>

**Governance & Approvals** — Review and approval workflows, execution policies, decision tracking, agent pause/resume/terminate, and full audit logging. Nothing ships without your sign-off.

</td>
</tr>
<tr>
<td>

</td>
<td>

**Routines & Schedules** — Recurring tasks with cron, webhook, and API triggers. Concurrency and catch-up policies. Each routine execution creates a tracked issue and wakes the assigned agent — no manual kick-offs needed.

</td>
</tr>
<tr>
<td>

**Plugins** — Instance-wide plugin system with out-of-process workers, capability-gated host services, job scheduling, tool exposure, and UI contributions. Extend Outpost without forking it.

</td>
<td>

**Secrets & Storage** — Instance and outpost secrets, encrypted local storage, provider-backed object storage, attachments, and work products. Sensitive values stay out of prompts unless a scoped run explicitly needs them.

</td>
</tr>
<tr>
<td>

**Activity & Events** — Mutating actions, heartbeat state changes, run events, approvals, comments, and work products are recorded as durable activity so operators can audit what happened and why.

</td>
<td>

**Outpost Portability** — Export and import entire outposts — agents, skills, projects, routines, and issues — with secret scrubbing and collision handling. One deployment, many outposts, complete data isolation.

</td>
</tr>
</table>

<br/>

## What Outpost is not

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Not a chatbot.**           | Agents have jobs, not chat windows.                                                                                  |
| **Not an agent framework.**  | We don't tell you how to build agents. We coordinate persistent agents as one crew.                                |
| **Not a workflow builder.**  | No drag-and-drop pipelines. Outpost models shared scopes with crew maps, North Stars, and governance.                    |
| **Not a prompt manager.**    | Agents bring their own prompts, models, and runtimes. Outpost manages the shared scope they work in.               |
| **Not a single-agent tool.** | This is for teams. If you have one agent, you probably don't need Outpost. If you have twenty — you definitely do. |
| **Not a code review tool.**  | Outpost orchestrates work, not pull requests. Bring your own review process.                                       |

<br/>

## Quickstart

Open source. Self-hosted. No Outpost account required.

```bash
npx paperclipai onboard --yes
```

That quickstart path now defaults to trusted local loopback mode for the fastest first run. To start in authenticated/private mode instead, choose a bind preset explicitly:

```bash
npx paperclipai onboard --yes --bind lan
# or:
npx paperclipai onboard --yes --bind tailnet
```

If you already have Outpost configured, rerunning `onboard` keeps the existing config in place. Use `paperclipai configure` to edit settings.

Or manually:

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100`. An embedded PostgreSQL database is created automatically — no setup required.

> **Requirements:** Node.js 24.11+, pnpm 9.15+

<br/>

## FAQ

**What does a typical setup look like?**
Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and North Stars — the agents take care of the rest.

If you're a solo entrepreneur you can use Tailscale to access Outpost on the go. Then later you can deploy to e.g. Vercel when you need it.

**Can I run multiple outposts?**
Yes. A single deployment can run many outposts with complete data isolation. Existing storage and APIs retain their legacy `company` identifiers for compatibility.

**How is Outpost different from agents like OpenClaw or Claude Code?**
Outpost _uses_ those agents. It coordinates them as a persistent crew with tasks, North Stars, governance, and accountability.

**Why should I use Outpost instead of just pointing my OpenClaw to Asana or Trello?**
Agent orchestration has subtleties in work ownership, persistent sessions, shared context, and governance—Outpost handles those concerns.

(Bring-your-own-ticket-system is on the Roadmap)

**Do agents run continuously?**
By default, agents run on scheduled heartbeats and event-based triggers (task assignment, @-mentions). You can also hook in continuous agents like OpenClaw. You bring your agent and Outpost coordinates.

<br/>

## Importing & Exporting Outposts

Export an outpost to a portable package and import it into any other instance — local or cloud — from a local path or GitHub. The CLI retains `company` as a compatibility command:

```bash
paperclipai company export <company-id> --out ./my-export
paperclipai company import ./my-export --dry-run
paperclipai company import org/repo --target new
```

The board UI has matching Export and Import pages in outpost settings: the Export page shows a fidelity panel listing what the bundle will not carry, and the Import page starts imported agents and routines paused by default, with a post-import activation step. See the [Importing & Exporting guide](https://github.com/paperclipai/paperclip/blob/master/docs/guides/board-operator/importing-and-exporting.md) for details.

## Development

```bash
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test             # Cheap default test run (Vitest only)
pnpm test:watch       # Vitest watch mode
pnpm test:e2e         # Playwright browser suite
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

`pnpm test` does not run Playwright. Browser suites stay separate and are typically run only when working on those flows or in CI.

See [doc/DEVELOPING.md](https://github.com/paperclipai/paperclip/blob/master/doc/DEVELOPING.md) for the full development guide.

<br/>

## Roadmap

- ✅ Plugin system (e.g. add a knowledge base, custom tracing, queues, etc)
- ✅ Get OpenClaw / claw-style agent employees
- ✅ Outpost import and export (`company` remains the compatibility command)
- ✅ Easy AGENTS.md configurations
- ✅ Skills Manager
- ✅ Scheduled Routines
- ✅ Agent Reviews and Approvals
- ✅ Multiple Human Users
- ⚪ Cloud / Sandbox agents (e.g. Cursor / e2b / Novita agents)
- ⚪ Artifacts & Work Products
- ⚪ Memory / Knowledge
- ⚪ Enforced Outcomes
- ⚪ MAXIMIZER MODE
- ⚪ Deep Planning
- ⚪ Work Queues
- ⚪ Self-Coordination
- ⚪ Automatic Crew Learning
- ⚪ Outpost Lead Chat
- ⚪ Cloud deployments
- ⚪ Desktop App

This is the short roadmap preview. See the full roadmap in [ROADMAP.md](https://github.com/paperclipai/paperclip/blob/master/ROADMAP.md).

<br/>

## Community & Plugins

Find Plugins and more at [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip)

## Privacy

Outpost disables anonymous product telemetry, hosted tracing, crash uploads, automatic update checks, and vendor feedback export. Local logs, local feedback votes, audit activity, and explicit update commands remain available.

## Contributing

We welcome contributions. See the [contributing guide](https://github.com/paperclipai/paperclip/blob/master/CONTRIBUTING.md) for details.

<br/>

## Community

- [Discord](https://discord.gg/paperclipai) — Join the community
- [Twitter / X](https://x.com/papercliping) — Follow updates and announcements
- [GitHub Issues](https://github.com/paperclipai/paperclip/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/paperclipai/paperclip/discussions) — ideas and RFC

<br/>

## License

MIT &copy; 2026 [Outpost Labs, Inc](https://paperclip.ing)

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=paperclipai/paperclip&type=date&legend=top-left)](https://www.star-history.com/?repos=paperclipai%2Fpaperclip&type=date&legend=top-left)

<br/>

---

<p align="center">
  <sub>Open source under MIT. Built for people who want to get work done, not babysit agents.</sub>
</p>
