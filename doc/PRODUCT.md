# Outpost — Product Definition

## Space boundary

A **Space** is Outpost's top-level user-facing boundary. The user creates one by
choosing an existing working directory, and that normalized directory may
belong to only one Space. Switching Spaces changes the complete visible agent,
task, Decision, North Star, session, and configuration context without stopping
agent processes that are already running.

The legacy `space` and `project` names remain in internal APIs where changing
them would create migration risk. Each Space owns one hidden compatibility
project/workspace whose cwd is the Space directory; Projects are not a second
user-created navigation layer. Portable identity/configuration belongs in the
repository's `.outpost/` directory. Provider authentication and secrets remain
machine-global and outside the repository.

An agent belongs to one Space for its lifetime. Native sessions always start
and resume from that Space's working-directory root, even when an old session or
task carries another cwd. Agents may use subdirectories within the repository,
but cannot be moved to a different Space; the user creates a new agent there.
Repository-backed Spaces use the local host environment and do not expose a
per-agent Environment selector.

Outpost does not expose the inherited Connectors catalog. Provider login and
other connection machinery may remain as internal runtime plumbing where agent
execution requires it, but Connectors is not a user-facing product area.

Reusable workflows stay inside the Cases experiment. A workflow is a Space-shared
name and Markdown prompt; a case may adopt, leave and revisit workflows without
changing its primary task. The task's workflow document is the effective copy,
so shared edits affect future adoptions and explicit refreshes. Existing handoffs
record workflow/phase movement and document revisions, including names as they
were at the time. Authoring starts with agents/APIs; the case UI reads current
workflow information and history.

## What It Is

Outpost coordinates persistent AI agents and their work. One instance can host
multiple **Spaces**, each rooted in one working directory and isolated from the
agents, tasks, Decisions, North Stars, sessions, and configuration of every
other Space.

## Core Concepts

### Space

A Space has:

- A **North Star** — the higher-level reason for its work
- **Agents** — durable scope owners with free-form names and titles
- **Coordination relationships** — optional `leadAgentId` links, never rank
- **Tasks and Decisions** — owned work and explicit human input
- **Artifacts** — durable results attached to tasks

### Agents

Agents are persistent workers bound to one Space and its working directory. A
Space may have multiple root agents; they are peers unless the user expresses
an optional coordination relationship.

Each agent has:

- **Adapter type + config** — how this agent runs and what defines its identity/behavior. This is adapter-specific (for example, a Claude Code agent may use CLAUDE.md and a Codex agent may use AGENTS.md). Outpost does not prescribe the format — the harness does.
- **Title & reporting** — a free-form title and optional coordination links
- **Capabilities description** — a short paragraph on what this agent does and when they're relevant (helps other agents discover who can help with what)

Example: a lead may route work to the correct scope owner, while that scope owner
keeps the task from implementation through follow-up. Other agents participate
only when explicitly delegated, invited, or mentioned.

Each Space has one **default agent**. Its first human-created agent becomes the
default automatically; the user can choose another from an agent profile. An
existing default is replaced only after confirmation. The pin appears on the
profile, and the default stays first in the Agents sidebar. Stars remain
independent. Task drafts, explicit assignments, and recent choices take precedence
over the default; Chat similarly reopens a valid recent conversation before
falling back to it. Opening Chat does not start execution. Being the default is a
routing preference only: it does not change reporting relationships, rank, or
permissions.

### Agent Execution

Agents have an **Advanced** tab for editing their settings across all configuration tabs
as a versioned YAML document. Instructions, skills, tools, channels, trust,
secret operations, API keys, and revision restore use their existing domain APIs.
It edits the same configuration as the regular settings pages, validates before saving, preserves masked secrets, and rejects
stale edits. See [Agent configuration YAML](agent-configuration-yaml.md).

Existing Claude, Codex, and Grok Build agents can upgrade from the legacy runner on their
Harness / Runtime page when the Outpost Runner is the qualified default for their
environment. One action saves pending edits and translates compatible settings
while keeping the harness, selected model, account bindings, instructions, and
history. Unsupported settings produce an actionable error without changing the
saved agent. Future runs start fresh sessions.

Qualifying an existing agent's sandbox for that upgrade uses the same agent
configuration permission as saving the upgrade. The server checks the saved
computer and its Space binding. Space users do not need instance-admin
access for this step; general instance environment management remains restricted.

Outpost supports several ways to run an agent's heartbeat:

1. **Local CLI/session adapters** — Outpost starts or resumes local coding-tool sessions such as Claude Code and Codex, then tracks the run.
2. **Run a command** — Outpost starts a process and tracks it.
3. **External adapter plugins** — compatibility plumbing may load additional runtimes without making them first-class product choices.

Agent runs can use execution workspaces, managed runtime services such as preview/dev servers, and adapter-specific session state. The adapter remains the execution boundary: if a runtime can be invoked, observed, and authorized, Outpost can coordinate it.

### Task Management

Tasks may have parentage and should connect to the Space's North Star when that
context is useful. A task still has one durable owner from start to finish.

```
I am researching the Facebook ads Granola uses (current task)
  because → I need to create Facebook ads for our software (parent)
    because → I need to grow new signups by 100 users (parent)
      because → I need to get revenue to $2,000 this week (parent)
        because → ...
          because → We're building the #1 AI note-taking app to $1M MRR in 3 months
```

The current issue compatibility model includes stable task identifiers,
parent/subtasks, blockers, a single assignee, comments, documents, attachments,
and work products. That structure keeps work inspectable by both the human and
agents while still allowing agents to decompose work into smaller tasks.

Serious tool and workflow tasks may also use a structured **Task Record** after
the user agrees to that workflow. It replaces a repository-local working spec:
the database stores the current intent, feature outcomes and states,
per-feature validation, constraints and non-goals, cross-cutting decisions,
unresolved questions, one feature-linked next step, and optional cross-cutting
results. The UI and agent assignment render that data; agents do not maintain a
parallel Markdown source. Simple patches, quick fixes, and ordinary debugging
do not require a Record. An early Record task stays in backlog while its brief
is clarified so creation does not start execution.

The Record is current shared memory rather than an append-only history. Agents
update settled facts during task discussion and work, remove resolved questions,
and fill a feature's validation only after a real run or test. Document
revisions retain the change history without keeping obsolete requirements in
the current Record.

When an agent creates a subtask or follow-up task, its source task's feed shows
a linked card at creation time with the current title, task number, and status.
The Tasks tab keeps the full relationship list.

Agent-owned tasks show **In Progress** only while a task-linked run is queued
or running. When execution ends, their visible status reflects recovery
(**Blocked**), a pending response or review (**In Review**), monitoring, or
remaining work (**Todo**). The stored lifecycle status still controls execution
and recovery. Human-owned tasks retain their selected ownership status.

Tasks waiting between automatic checks show **Monitoring** with a blue clock.
Task lists, board columns, filters, search, recent navigation and task properties
use the same read-only display state. The task retains its execution lifecycle
status, and the monitor banner shows when the next check is due.

Automatic monitor checks pause when a task is blocked. A person can use Check now
to request one check of a retained monitor through normal execution admission.
Dependencies, recovery, pause, budgets and ownership still apply. Provider-usage
recovery stays paused until the task resumes. A check that
cannot start reports that result instead of claiming it was queued.

The experimental Cases feature also supports persistent work records and
prompt-driven agent handoffs. Native case creation requires kickoff and creates
one primary task; later handoffs move that same task
between agents with a phase and instructions. The case retains facts, document references,
and history while normal task assignments form each agent's queue. Task sessions,
workspaces, private access, review rules, and human intervention remain part of
the ordinary execution model. Ordinary task completion leaves case status unchanged.
An explicit handoff to `done` closes the case when primary-task completion is
accepted through the existing gates; review and human waits keep it open.

Native agents can create, read and update case facts through dedicated tools.
Creation always includes a kickoff and either `workflowId` or explicit `workflow_document_text`.
The latter becomes the primary task's Markdown `workflow` document, describing
phase owners, routing, evidence and completion rules. Agents read it before
choosing their next step. Recommended authoring includes both a Mermaid
`stateDiagram-v2` map and prose explaining each transition's conditions, evidence,
destination agent, human waits and correction limits. Transitions remain advisory. Initial documents belong to
the first task and are saved before its agent wakes; the case displays documents
from its primary and accessible linked tasks without copying them. Agents use
ordinary task document tools; historical case-owned documents remain readable.
Each phase receives its current handoff instructions;
compatible resumed sessions receive changed facts without repeating unchanged
case contents. Agents can read current persisted data whenever they need it.

Case pages are a lightweight read-only view: search or filter the list, open a
record, read its findings and documents, and follow its current task and handoff
history. Agents and APIs author the records; the pages have no editing controls.

When a task is assigned to the current human, the message composer defaults to
the latest agent that assigned it to them. If no assignment is available, it uses
the latest other commenter, or leaves the recipient empty. A manual recipient
choice stays selected while task data refreshes.

Task reply and new-task composers submit with Enter by default; Shift+Enter
adds a new line. Settings → Experimental → **Command/Ctrl+Enter to Submit**
restores the previous behavior, where Enter adds a new line and Command/Ctrl+Enter
submits.

### Task conversations and run intent

A task thread behaves like ordinary Chat with task context attached. The agent
receives the task, Record, workspace, and audit context, but each message is
still one conversational turn. A direct answer can finish that turn while the
task remains open. Saying Stop ends the current response and does not create an
automatic continuation merely because the task is unfinished. The composer does
not add separate Ask or Plan task modes; the user states the desired action in
the conversation.

Tasks expose a **Run intent** property with **Manual** and **Automatic** values.
Manual means the agent should handle only the currently requested increment.
Automatic means that, after execution is authorized, the agent should pursue
the requested task from start to finish. This property is descriptive context
for the agent. It is not a scheduler, heartbeat toggle, retry policy, or source
of new authority.

### Routine responsibility

The routine Overview shows its responsible user beside Default agent. People with
`tasks:assign` can select an active Space user from the name's picker.
The change creates a routine revision and applies to future automatic tasks.
Existing tasks keep their responsibility. Manual runs use the person who starts
them. Agents cannot transfer routine responsibility.


### Task collection creation filters

Tasks opens All tasks for new users. A saved view or an explicit view in the URL
takes precedence over this default.
The task table orders rows by Last updated, newest first, without highlighting a
column header. Selecting a column sort activates its header and direction arrow;
explicit sort URLs retain that selection.

The task Filters menu also offers **Routine tasks**. It selects tasks with
`originKind=routine_execution`, including manually triggered routine runs, even
when other automatic tasks are hidden. The routines list's **View all tasks**
link opens `/issues?view=all&originKind=routine_execution&sortField=created&sortDir=desc` with that checkbox
selected. The URL retains the selection across reloads and task navigation.
Coordinator task labels use repeated `label` URL parameters so selected labels survive reloads and shared task-list links.
Sort controls save `sortField` and `sortDir` in the URL. URL sorting overrides
saved collection sorting, and the routines link opens newest-created tasks first.
Shared sort links work across Coordinator, Streamlined UI, and Classic UI, including
sort fields without a visible column in the selected interface. Search relevance
and board-column membership keep their existing server order.
Search and pagination apply the routine origin filter on the server. Creation-time
sorting also runs before pagination, with task ID as a stable tie-breaker.

Tasks and project lists hide agent-created and system-created tasks by default.
The Filters menu's **Show agent-created tasks** checkbox includes routine runs,
recovery/watchdog tasks, chat-channel tasks, and other automation. Channel tasks
remain bot-created for this filter even when a human starts the conversation. The choice is saved per Space
and collection; Clear filters restores the hidden default. Nested lists preserve
ancestors and expandable subtasks as context without promoting unrelated automated
work to independent results. Agent profiles, routine histories, and task-detail
subtasks retain their full history.

Mine contains personal work. Channel tasks, routine tasks, and agent-created tasks
stay outside Mine by default. This includes routines that a person starts manually.
Linked accounts, creator IDs, responsible-user IDs, synchronized provider comments,
and read markers do not establish participation in automatic work. Direct operator
API comments, human assignment, and deliberate user mutations do establish
participation. Open requests addressed to the person also admit the task until
resolution. Ordinary human-created tasks keep their creator's participation.
These rules apply to existing tasks, Mine, unread counts, badges, and task toasts.
Approvals retain their existing recipient and permission rules.

An advisory PR review does not require human completion approval because its
rating is low, CI is pending or failing, or the PR is unmerged. After publication,
the bot may stay in review with an authorized provider-event wait or a saved
monitor. Neither wait enrolls a person in Mine. Human requests are for concrete
dependencies of the assigned review, such as missing repository access.
A later published review with no human dependency withdraws the same bot's
earlier completion request for a published review when its result commits and
independent gates are clear. Finish-report validation is read-only. Independent approval gates
and requests without that review evidence remain unchanged.

New inbound comments retain their provider in `metadata.sourceChannel`. Historical
imports use inbound message links or the stored provider-sender metadata. These
checks preserve direct operator comments on channel tasks. If both historical
records are absent, the comment remains unclassified and keeps its previous
behavior. A task origin alone cannot prove the source of an old comment.

Inbox discovery searches and Blocked hide unrelated automatic tasks unless the
checkbox is checked. The checkbox does not subscribe a person to automatic work.
Source feeds and project task lists retain their existing access rules.

### Space Skills and Policy (compatibility subsystem)

Outpost's user-facing Skills area is intentionally small. It lists the skills
installed in the current Space, supports search, imports a skill from a local
path or GitHub URL, shows its files and current agent usage, and removes it when
no agent depends on it. Marketplace discovery, stars, forks, folders, sharing,
bulk organization, source management, version comparison, and Skill Studio are
not product surfaces. Their inherited backend contracts may remain temporarily
for compatibility while the fork is simplified.

Only the core Outpost operational skill is bundled and assigned automatically.
Connector-specific, onboarding, autonomous agent creation, task-pipeline, feedback, and
auxiliary memory skills are not part of the default product.

Space skills are shared operating capabilities in the inherited skill subsystem. Every authenticated agent in a Space can create, import, install, edit, update, test, reset, and remove that Space's skills unless an explicit restriction exists.

Outpost-managed skills are immutable saved versions. Studio and API authoring
publish complete content before acknowledging a save; stale edits return a version
conflict and Studio retains the draft. Installed repository skills use the same
version-based reads and execution selection. Web-server files are disposable caches
and staging, so compatible replacement servers can read, edit and deliver protected
versions from the same database and remote object storage. Explicit linked-local
sources retain local behavior. Active or recovering run pins prevent deletion even
after an agent detaches the skill. See [ephemeral-server skills](skill-ephemeral-web-servers.md)
for conversion, compatibility and qualification boundaries.

The governing rule is: **skill permissions are opt-in restrictions, not opt-in capabilities**. Missing skill grants never create a denial in an otherwise unconfigured Space, and ordinary skill work does not require human confirmation, a draft-only workflow, or an activation approval.

Outpost core owns the skill runtime, Space-boundary enforcement, policy evaluation contract, API denials, validation, path containment, secret redaction, and activity logging. Those safety invariants cannot be disabled by policy. Open-by-default skill work never authorizes arbitrary host-path reads, unsafe executable content, or policy edits: local imports and scans must stay within Outpost-known workspace or managed-skill roots, remote sources must resolve to validated immutable content, and platform safety denials must stay distinct from optional administrative restrictions. Existing restrictions continue to be enforced by core.

GitHub repositories attached to new projects automatically become skill sources.
Outpost imports their skills and checks the configured branch every five minutes,
using the setup person's authorized GitHub connection. New skills import automatically
unless excluded. Existing projects can adopt their repositories from Skills → Sources;
existing manually imported sources preserve their selections and gain automatic updates.
Refresh remains available, and operators can pause automatic updates.
Independent skill sources have a searchable branch picker with the repository's
default branch marked. People can also enter a branch name that is not listed.
Saving checks GitHub access and the selected ref before changing tracking; failed
saves keep the selection and installed content. Project refs remain owned by project
configuration so changing a source cannot redirect another project's tracking.
If a repository exceeds the supported package size, Outpost first packages its
skill folders and referenced repository files, preserving their original paths.
Missing references are advisory: a valid selected skill can still be imported.
Unavailable files are listed, and existing installed dependencies are retained
when a bounded refresh cannot preserve them. File limits and content validation
still apply; importing never executes repository code.
Authored and unproven legacy versions retain an independent recovery copy. Unused Git
packages with an exact restore recipe may expire; later use requires access to that
original repository and commit.
External package storage keeps repository contents out of the control-plane database;
per-turn checks reuse verified local files while rechecking current skill access.
See [automatic storage and recovery](skill-package-storage.md).

Project-derived skills inherit current project access. Access through any originating
project is sufficient, including the responsible-user restrictions on agent execution.
Existing explicit Space imports retain their visibility. Editable copies inherit
project restrictions; private content cannot be published or exported implicitly.
Detachment retains installed content and access provenance. Deleting its last project
never makes a skill Space-visible.

Task and routine skill mentions remain stable references to the latest installed version.
Each execution records the immutable versions it uses; resuming keeps those versions,
while a new execution resolves latest again. Upstream failures and removals preserve
installed snapshots. GitHub refresh does not delay task execution.

Old, unused skill-version disk caches expire automatically while current and in-use
versions remain. Saved database snapshots rebuild an expired copy on demand, including
when its upstream repository is unavailable. Recovery data has separate retention.

Disconnecting removes a repository from Sources after an explicit choice: keep
independent editable copies in My Skills, or delete its imported skills. Kept
copies and derived forks retain their project access restrictions. Copies preserve
agent assignments; skills used by agents must be detached before deletion.

An explicit restricted policy may deny selected operations or switch to a default-deny preset with explicit allow rules. Core exposes a stable versioned policy API so EE and other administrative clients configure and simulate the same evaluator used by skill mutation routes. Core Skill Studio only needs to perform normal skill work, explain an explicit denial, and point administrators to EE when its richer policy UI is available; it must not recreate a partial enterprise permission editor.

## Principles

1. **Use the agent harnesses people already trust.** Outpost coordinates Codex and Claude sessions without owning provider authentication.

2. **Space is the unit of organization.** Everything visible lives under a repository-backed Space. One Outpost instance may host many Spaces.

3. **Adapter config defines the agent.** Every agent has an adapter type and configuration that controls its identity and behavior. The minimum contract is just "be callable."

4. **Work has durable ownership and purpose.** A task keeps one owner; a North Star can explain why the work matters without forcing deep task decomposition.

5. **Coordination surface, not execution engine.** Outpost orchestrates. Agent harnesses execute the work.

## User Flow (Dream Scenario)

1. Create a Space by choosing a working directory.
2. Create persistent Codex or Claude agents with free-form names and titles.
3. Optionally connect agents with coordination relationships and choose a default agent.
4. Give a feature or bug to a lead or directly to its scope owner.
5. The owner works it from start to finish, raising Decisions for human input and attaching artifacts as results.
6. Invite peers into Campfire only when shared discussion is useful.

## Guidelines

There are two runtime modes Outpost must support:

- `local_trusted` (default): single-user local trusted deployment with no login friction
- `authenticated`: login-required mode that supports both private-network and public deployment exposure policies

Canonical mode design and command expectations live in `doc/DEPLOYMENT-MODES.md`.

## Further Detail

See [TASKS.md](./TASKS.md) for the task management data model.

---

Outpost's core identity is a **coordination surface for persistent agents**, centered on **Spaces, agents, tasks, Decisions, artifacts, North Stars, and optional Campfire discussion**.

## What Outpost should do vs. not do

**Do**

- Stay **human-directed and Space-scoped**. Users should manage agents, tasks, Decisions, and outputs.
- Make the first five minutes useful: select a repository, create an agent, and complete a real task.
- Keep work anchored to **issues/comments/projects/goals**, even if the surface feels conversational.
- Treat **agency / internal team / startup** as the same underlying abstraction with different templates and labels.
- Make outputs first-class: files, docs, reports, previews, links, screenshots.
- Provide **hooks into engineering workflows**: worktrees, preview servers, PR links, external review tools.
- Use **plugins** for edge cases like rich chat, knowledge bases, doc editors, custom tracing.

**Do not**

- Do not make the core product a general chat app. The current product definition is explicitly task/comment-centric and “not a chatbot,” and that boundary is valuable.
- Do not build a complete Jira/GitHub replacement. Outpost coordinates agent-owned work rather than replacing source control.
- Do not lead with enterprise-grade RBAC. Fine-grained administration is secondary to the local Space workflow.
- Do not interpret agent-profile privacy flags as task privacy. Work remains Space-visible by default, while explicitly private tasks use their own ACLs.
- Do not lead with raw bash logs and transcripts. Default view should be human-readable intent/progress, with raw detail beneath.
- Do not force users to understand provider/API-key plumbing unless absolutely necessary. There are active onboarding/auth issues already; friction here is clearly real.

## Specific design goals

1. **Time-to-first-success under 5 minutes**
   A fresh user should go from install to “my agent completed a first task” in one sitting.

2. **Human-readable coordination always wins**
   The default UI should answer: what is this Space doing, who owns it, why does it matter, and what needs my input.

3. **Conversation stays attached to work objects**
   Agent conversation should remain connected to Decisions, tasks, and artifacts.

4. **Progressive disclosure**
   Top layer: human-readable summary. Middle layer: checklist/steps/artifacts. Bottom layer: raw logs/tool calls/transcript.

5. **Output-first**
   Work is not done until the user can see the result: file, document, preview link, screenshot, plan, or PR.

6. **Execution visibility without log worship**
   Active runs, recovery issues, blockers, and work products should be first-class surfaces. Raw transcripts are available when needed, but they are not the primary product surface.

7. **Local-first, cloud-ready**
   The mental model should not change between local solo use and shared/private or public/cloud deployment.

8. **Safe autonomy**
   Auto mode is allowed; hidden token burn is not.

9. **Thin core, rich edges**
   Put optional chat, knowledge, and special surfaces into plugins/extensions rather than bloating the control plane.

### Experimental iMessage Photon channel

A Photon Cloud project can represent one agent through the existing
experimental channel subsystem. DMs and explicitly enabled groups create or
continue task-bound conversations. Linked sender identity is the default;
telephone numbers, email addresses, names, and group membership do not grant
Outpost authority. Photos/files and ordinary questions/confirmations use the
existing attachment, interaction, continuation, and publication contracts.
Pause and Disconnect govern runtime behavior independently of the UI gate.
Local Mac access, unsolicited conversations, and SMS/RCS
fallback are excluded. Live qualification is required before release readiness.
Pro shared allocation supports DMs only, with sender enrollment in Photon and
separate identity linking in Outpost. Shared channels reserve one compatibility project, not
a pool phone number; group admission and publication are disabled. Dedicated
allocation retains one selected number and individually enabled groups.

See [iMessage Photon](connections/IMESSAGE-PHOTON.md) for the implementation
contract, setup, recovery, boundaries, and qualification status.
### Persistent agent conversations

Agents can deliver proactive task and routine results into their own chat with
the task's responsible human. A morning PR digest arrives as an agent message
with a source-task link and unread indicators, even before the first human
message. The person can reply using the digest as context. Publishing a message
and completing work are separate actions; sending never starts or interrupts a
chat turn. Delivery obeys membership, run authority and task privacy. This version delivers
in-app only.

Coordinator is the standard workspace for everyone. Settings → Experimental offers a personal **Classic workspace** opt-in, off by default. Historical Coordinator experiment settings do not enable Classic. Agent Chat is available to everyone on new and existing instances. The retired `enableAgentChat` key remains accepted for compatibility; stored and managed off values are ignored. Each person has one persistent task-backed conversation per agent and Space, with ordinary Space task visibility. The shared task composer, transcript, tools, files, and document panel remain the interaction surface. Agents clarify goals and hand substantial execution to linked, assigned tasks; a reply ends a turn without completing the conversation. `/new` starts fresh provider context in the same conversation while preserving visible history and artifacts. Healthy idle conversations wait for a message and do not count as unfinished execution work. See `doc/plans/2026-09-10-agent-chat.md` for the implementation contract.

### Agent chat project handoff (2026-09-11)

Chat supports research and full plan drafting/revision in its existing plan document. On handoff, each ordinary assigned task receives the relevant plan in its own `plan` document, committed with task creation before execution is scheduled. The source plan remains in the conversation. Plan acceptance hands off execution; it never switches the conversation into implementation.

Chat instructions require selecting a suitable project, reusing an existing one where appropriate. The project requirement is prompt-only; ordinary projectless tasks remain supported. New parent relationships beneath conversation tasks are rejected by task services, including direct API creation and reparenting. Existing children remain readable/editable and can be moved elsewhere. The Subtasks panel is unchanged.

The `create_project` runtime tool uses the normal project API with durable idempotency. `list_projects` and `list_project_repositories` support selection. Multiple `repositoryIds` select authorized catalog entries; multiple HTTPS GitHub `repositoryUrls` register existing repositories absent from the catalog. IDs and URLs may be combined, but cannot accompany an explicit `workspace`. URLs do not create repositories on GitHub or grant credentials. Execution uses normal repository access rules. Repository IDs are revalidated against the authenticated run's responsible user and connection grants. Agents should consider proper available repositories, clarify material ambiguity, and use repository-free projects when appropriate for non-code work.

Confirmed project creation appears as a durable card in the shared task transcript, including selected repository links. Tasks are linked inline. Failed creation never produces a success card. Tool evals cover planning/handoff, project/repository selection, retries, permission and mode denials, and ordinary delegation regressions using the production chat directive.

### Agent chat discovery

With Agent Chat enabled, Chat is the first row of the Work section and opens a
secondary sidebar beside the primary nav. It lists every agent you can chat
with: the open conversation first, then your other conversations by recent
activity, then the rest of the roster alphabetically. Terminated agents and
agents you have left are omitted unless you have history with them. Search
filters by name, title, or role; **+** starts or reopens a conversation.
Selecting an agent opens their persistent conversation; it does not reset history
or create a task until the existing first-write flow requires one.

Beside a conversation, the side panel opens on the agent's tasks: one card per
task the agent created, was assigned, commented on, or acted on, newest first,
with the task list's filters and a sort control. The agent's artifacts are a
second card stack available from the panel's **+** menu. Both open in a new tab
so the conversation stays open.

### Coordinator Inbox and personal task views

Coordinator navigation uses **Chat**, **Tasks**, and **Inbox**. Inbox uses the
inbox icon and keeps the existing decision feed, its count, and decision history
at `/decisions`. The previous Inbox destination under More is removed.

Tasks defaults to **All tasks**, with a saved view per person and Space. Mine uses
the previous Inbox's personal participation rules, mixed attention items,
read/unread title weights, keyboard shortcuts, archive and undo, mobile
swipe-to-archive, grouping, and saved columns. Its existing preferences carry
over. Unread, Recent, Blocked, and Everything are also task views. Organization
views retain the task table and board. The table saves column selection and
order per person and Space. Old `/inbox/*` links redirect to their Tasks view.

### Combined Inbox + Task List

In the Classic workspace, an opt-in setting (`enableCombinedInboxTasks`, off by default)
folds Inbox into Tasks. The Inbox nav row goes away and its unread badge moves
to Tasks. A Views menu on the task list covers the inbox views (Mine, Unread,
Blocked, Recent, Everything) and the task-status views (All, Active, Backlog,
Done). Bare `/issues` opens the last-used view, defaulting to All tasks; links that
carry a task filter open All. Old `/inbox` links redirect to the matching view.

### CSV file previews

Task attachment and workspace file tabs render CSV files as tables by default.
The first record supplies column headers. Row numbers, row and column counts,
and sticky headers help operators scan exports. Rendered and raw view icons
remain next to download; raw view preserves the original source. The table
shows up to 500 data rows and 100 columns, with a notice when the preview is
limited. Download retains the complete file.

### Filesystem access boundary (2026-10-20)

Filesystem isolation belongs to the OS, execution environment, and storage layout.
Outpost authorizes the current task/run, Space, explicitly selected configuration,
execution policy, and repository credentials. It does not infer file permissions from
other tasks or agents that previously used the same directory, overlapping roots,
symlink aliases, or shared Git storage. Existing files under an authorized task root
may be read subject to OS access and API path containment.

Private task records, comments, attachments, run logs, full workspace metadata, and
operation logs retain their app authorization. Workspace `_issuePrivacySources` and
operation privacy metadata protect app-record disclosure; they do not grant or deny
filesystem execution or task-bound file browsing. Current trust and sandbox policy,
publication receipts, binding checks, and lifecycle locks remain authoritative.

## Agent connection administration (2026-10-13)

Standard agents can configure connections through the same domain APIs used by the app, bounded by their grants and their responsible user's current authority. Fresh standard agents for default Operators can manage app/tool connections, chat/email channels, AI accounts and pools, profiles and gateways without additional grants. Existing grants are not backfilled; explicit restrictions persist. Gateway administration retains the responsible human's administrative permission and does not grant agents blanket `tools:admin`.

The agent performs authorized setup, reuses saved accounts and drafts, and hands off only required human authentication, consent, credential entry or identity confirmation. Saved handoffs resume through existing task continuation after current authority is rechecked. Management, tool execution and approval remain separate. Private accounts, host commands and stored credentials retain their boundaries; agent-issued gateway clients preserve issuer and responsible-user restrictions at use time.

Authorized policy administration includes user-requested changes that loosen the acting agent’s own tool controls. These writes remain bounded by management grants, resource scope and the responsible user’s current authority; they do not need an additional approval solely because the agent is a target. Subsequent tool calls obey the resulting policy. Agents cannot approve their own governed action requests or edit their own principal permission grants.

Ordinary tool approvals remain reviewable without an implicit one-hour deadline. Authenticated OAuth refresh preserves a pending approval for the same saved action and authorization. Sign-in repair retains an accepted decision and resumes through connection-change events after revalidation; changed consent, permissions, credentials or action targets require a new review. Current access, explicit deadlines, task closure and execution receipts remain enforced. See [Delayed tool approvals](execution-semantics.md#delayed-tool-approvals).

The implementation, operation inventory, permission matrix and fixture qualification are recorded in [Agent API parity for connection configuration](plans/2026-10-13-connection-api-parity.md). Provider fixtures establish API behavior; they do not constitute live provider setup or an empirical agent-success claim.

## Budget control behavior

Outpost records paid-operation charges durably and avoids Space-wide
serialization during receipt ingestion and settlement. Budget checks and
threshold enforcement are best effort. Concurrent operations can start from
the same observed balance; estimates and provider caps do not replace the
actual bill. A background worker applies threshold holds and scoped Stop intent.
Manual Stop and authorization remain independently enforced. Unknown charges
remain visible, and stale unevaluated accounting blocks new limited-budget work
until reconciliation catches up.
