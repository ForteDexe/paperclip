# Retained Outpost vertical slices

Outpost is being reduced by complete product slices rather than by filename or
terminology searches. A slice remains only when it supports the target workflow
from user interface through runtime and persistence.

## Product boundary

- **Spaces**: a working-directory boundary and the complete context visible when
  switching repositories.
- **Agents**: durable Codex or Claude sessions, agent identity, optional
  coordination relationships, and the Space default agent.
- **Runtime**: local authentication, ACP and CLI execution, session resume,
  environment variables, run state, cancellation, and diagnostics needed to run
  those agents reliably.
- **Tasks**: one durable owner carries work from assignment through completion;
  a lead may route a task to the appropriate scope owner.
- **Decisions**: explicit questions or choices that require human input without
  reassigning the task.
- **Artifacts**: task-linked files and evidence, including intermediate or final
  screenshots and reports.
- **Cases**: durable subjects that can group recurring tasks and debugging work.
- **North Stars**: optional longer-lived direction retained for future workflows.
- **Chat**: direct agent conversation and the future Campfire group-chat surface.
- **Minimal settings**: only controls required by the retained slices.

## Removal rule

Before deleting a feature, trace and remove its complete path:

1. navigation and UI;
2. client API and shared contracts;
3. server route and service;
4. packages, CLI commands, and release wiring;
5. focused tests, fixtures, and active documentation.

Historical migrations may remain when they are needed to open an existing
database. Runtime internals stay until their dependency on the retained slices
has been mapped. A hidden route is not considered removed.

## Retired slices

### Ready-made Team Catalog

Outpost no longer ships or installs prebuilt teams. Agents are created manually
inside a Space and may be connected through the agent hierarchy. This removes
the catalog package, browse/install API, CLI command, unused UI, and their
focused tests. It does not remove agent creation, hierarchy, task delegation, or
runtime skill injection.

### Unsupported Agent Adapters

Outpost supports Codex and Claude as user-facing agent harnesses. The retired
Cursor, Gemini, Grok, Hermes, Kimi, OpenClaw, OpenCode, and Pi adapter packages,
configuration surfaces, container images, release wiring, stories, and focused
tests are removed. Portability and permission contracts now exercise only the
retained Codex and Claude adapters rather than preserving retired adapter test
matrices. Shared ACP/session runtime code remains until its Codex and Claude
dependencies can be separated from historical provider compatibility.

### KV Demo MCP Package

The standalone key/value MCP server was a development demonstration rather than
a retained product feature. Its only meaningful consumer was the tool-gateway
integration suite, which now owns a small private Streamable HTTP fixture. The
demo is no longer shipped as a workspace or release package.

### Google Sheets Robot Connector

The local service-account-based Google Sheets connector was an additional
credential and runtime path outside Outpost's retained Codex and Claude
workflow. Its stdio package, robot-account setup method, spreadsheet allowlist,
server templates, UI editors, release wiring, and focused tests are removed.
The separate remote Google Sheets OAuth/MCP methods remain available until the
broader external Connections slice is reviewed.

### Public Skill Catalog

Outpost no longer ships a curated skill marketplace. The catalog package,
browse/detail/install API, CLI marketplace commands, unreachable Store UI,
portable catalog provenance, release wiring, and focused tests are removed.
Spaces can still import local, GitHub, `skills.sh`, and URL skills and attach
them to agents. The two required internal agent instructions formerly sourced
from the catalog now live under `server/src/built-ins/agents/`.

### Remote Sandbox Providers

Outpost runs Codex and Claude locally in the working directory owned by their
Space. The Boxd, Cloudflare, CreateOS, Daytona, E2B, exe.dev, Kubernetes, Modal,
and Novita sandbox-provider packages are outside that boundary. Their package
sources, standalone dependency workspaces, provider-specific CI and release
wiring, hosted full-stack qualification workflow, credential passthrough, and
focused tests are removed. Generic local plugin support remains for retained
extensions such as Campfire; historical environment schemas and managed-runtime
internals remain until their dependencies are audited as a separate slice.

### Status Cards

Status Cards were an experimental saved-summary surface outside Outpost's
retained task, decision, artifact, case, and chat workflow. Their navigation,
UI, shared contracts, API routes, scheduler and notification wiring, active
database schema exports, agent prompt guidance, focused tests, and active
documentation are removed. Historical database migrations remain so an older
database can still be opened and migrated without rewriting migration history.

### Summary Slots

Summary Slots were an experimental generated-report layer rather than part of
the retained task, artifact, or chat workflow. Their cards, streaming client,
shared contracts, API and service layer, active schema exports, experimental
setting, focused tests, and opt-in Summarizer agent bundle are removed. Normal
task descriptions, run summaries, and other domain-specific summary fields are
unchanged. Historical migrations and migration-focused tests remain intact.

### Optional Built-in Agents

Outpost no longer ships opt-in Briefs, Learning, Reflection Coach, or
Summarizer agents. Their bundled instructions, provisioning and reconciliation
services, API routes, experimental flag, dedicated UI, routine grouping, and
focused tests are removed. All user-created Codex and Claude agents now follow
the same lifecycle, permissions, portability, and instruction paths.

The `built_in_managed_resources` schema name remains temporarily because the
same table also tracks managed runtime environments. It is not evidence that
built-in agents remain active; renaming or splitting that shared persistence is
a separate schema migration.
