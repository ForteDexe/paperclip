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
The executable chat catalog also excludes Daytona target provisioning, image
preparation, cloud assignment, destroyed-sandbox recovery, and remote workspace
repair journeys. Their historical campaign results remain archival only.

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

### External Gateway Smoke Infrastructure

The Hermes and OpenClaw Docker smoke environments exercised external agent
gateways rather than Outpost's retained local Codex and Claude runtime. Their
Docker fixtures, shell harnesses, package commands, smoke-specific guides, and
focused script tests are removed. Their provider-specific onboarding prompt,
CLI and OpenAPI surface, static configuration document, and focused route tests
are also removed. Agent-invite acceptance no longer normalizes gateway URLs or
credentials, generates OpenClaw device keys, stores Hermes secrets, or permits
gateway-only replay of accepted invites. Agent creation and environment probes
also no longer generate OpenClaw device credentials or special-case Hermes
probe keys, and heartbeat metadata no longer assigns gateway-only timeout
defaults. Gateway connection-failure markers and Hermes-specific failure-report
suppression are removed, so failures from unsupported providers cannot be
silently excluded. Top-level adapter-schema secret normalization and runtime
resolution are removed because the retained Codex and Claude adapters use local
authentication plus explicit environment-variable bindings; environment secret
bindings remain supported. Space portability also no longer injects OpenClaw
defaults. Gateway-specific display metadata, onboarding fields, credentials,
external-agent presets, model ordering, and chat labels are removed from the
UI. The shared adapter catalog, invite schema, provider-routing compatibility,
managed credential-home projection, and create-form contract also no longer
carry Hermes or OpenClaw. Session compaction, identity, continuation, watchdog,
workspace validation, heartbeat recovery, and the Hermes-only canonical session
algorithm are removed as well. Remaining names in historical migrations and
retired gateway test fixtures are compatibility-cleanup work, not retained
product behavior.

### LLM Wiki Plugin

The LLM Wiki was a separate knowledge-management product rather than part of
Outpost's retained Space, task, decision, artifact, case, North Star, chat, or
runtime workflow. Its package, database migrations, managed agent and skill
bundle, UI, bundled-plugin registration, Docker/release wiring, and
feature-specific tests are removed. Generic plugin database and UI-slot tests
remain, and the plugin SDK stays because Campfire depends on it.

### Packaged Fake Sandbox Plugin

The fake sandbox provider was a packaged test fixture, not a runtime product.
Its package and Docker/lockfile wiring are removed. Environment service tests
retain self-contained in-memory fake manifests, so they continue testing the
generic plugin contracts without shipping a fake provider package.

### Plugin Project Scaffolder

Outpost retains its plugin host and SDK for Campfire, but it no longer ships a
general-purpose plugin project generator or the `outpost plugin init` command.
Generic plugin installation tests now create their minimal disposable package
directly. Plugin lifecycle commands, local package installation, the plugin
SDK, and Campfire remain supported.

### Retired Feedback Export Journey

The privileged feedback-bundle catalog journey targeted a removed CLI export
command and trace types. Its scenario, implementation, focused assertions, and
active catalog records are removed. Historical campaign results remain as
archived measurement data rather than executable product coverage.

### External TestOps Campaign

Outpost's retained local Codex and Claude workflow does not publish evaluation
catalogs to Allure TestOps or operate a paid remote-provider campaign. The
TestOps adapters, catalog manifests, projection and upload utilities, dedicated
GitHub workflows, protocol publication scripts, remote AWS chat qualification,
and their workflow-security tests are removed. Focused local runner tests,
runtime typechecking, Playwright evidence validation, and ordinary CI remain;
external campaign reporting is not part of the product boundary.

### Runner Evaluation Subsystem

The standalone evaluation-matrix kernel, paid and controlled evaluation
campaigns, Evalbook/report publication, evaluation CLI session, chaos/live
evaluation workflows, and their dedicated schemas and fixtures are not part of
Outpost's local agent runtime. They are removed together with release and build
dependencies on the evaluation package, the standalone Promptfoo smoke suite,
and evaluation-only release qualification contracts. Runtime protocol, Codex
and Claude execution, deterministic conformance checks, and local diagnostics
remain.

### Merged Review Evidence

Historical pull-request screenshots are not product assets and are not retained
in the repository. Review evidence belongs in the pull request or review thread,
as required by `CONTRIBUTING.md`; keeping it in `docs/pr-screenshots/` or the
root `screenshots/` directory adds clone weight without supporting a retained
runtime or user-facing feature.

### One-off Screenshot Launchers

Issue-specific browser scripts for producing review screenshots are not product
automation. The unreferenced PAP, fork-flow, verdict, recovery-card, Notion,
file-viewer, and inbox capture launchers are removed with their old evidence.
The maintained Storybook visual-baseline workflow remains.

### Bundled Plugin Catalog

Campfire is the retained first-party plugin. The generic example plugins and
the former Workspace Diff plugin are removed; the plugin SDK, lifecycle,
bundled-plugin discovery, and install UI remain available for Campfire.

### AWS AgentCore Provisioning Lab

The CloudFormation template, AWS CLI lifecycle wrapper, paid live smoke, and
their provisioning-contract test were a remote-provider proof of concept rather
than part of Outpost's retained local Codex and Claude workflow. They are no
longer shipped or exposed as runner package commands. Historical provider
compatibility inside the shared runner remains deferred until it can be removed
without disturbing the local session transport.

### OpenCode Qualification Utilities

The standalone OpenCode binary materializer and opt-in live qualification test
served a provider that is outside the retained Codex and Claude product. They
are removed from the package test lane and command surface. The still-shared
OpenCode transport branches remain part of the deferred provider migration and
must not be mistaken for a supported user-facing harness.

### Remote Restart-Chaos Campaign

The paid, on-demand restart-chaos campaign targeted Daytona sandboxes, cloud
storage faults, provider credentials, remote deployment waves, and fleet image
behavior. Its 131-file harness, launcher, and GitHub workflow are removed from
the local product. Small deterministic crash-point and fault-injection helpers
remain where focused unit tests still exercise retained recovery behavior.

### Paid Agent-Creation Acceptance Harness

The opt-in browser harness for AI-assisted agent creation required real provider
credentials and also exercised the retired Daytona environment. Its live and
Storybook scenarios, provider-spend instructions, and remote image setup are
removed. Deterministic local tests remain the required coverage for creating
Codex and Claude agents and running them with the user's existing local login.

### Daytona Runner Image Pipeline

The mutable and release-consumer Daytona images, manual publication workflow,
artifact downloader, and image-specific tests supported the retired remote
sandbox product. They are removed. The pull-request `Docker Runner check` keeps
its isolated local native-runner compilation and dependency-cache verification;
it no longer publishes images or runs paid remote qualification.

### Routines UI Surface

Routines are not part of Outpost's retained Space, agent, task, decision,
artifact, case, North Star, chat, or runtime workflow. Their pages, navigation,
client API, editor autocomplete, profile bindings, audit presentation,
Storybook fixtures, and focused UI tests are removed. Historical routine links
can still render as ordinary document content while the underlying server, CLI,
shared-contract, and active-schema removal is deferred to a later complete
backend slice. This UI checkpoint must not be interpreted as deletion of the
routine persistence model.

## Scope guard

`scripts/check-retained-product-scope.mjs` verifies that the required Codex,
Claude, Campfire, runner, database, shared, and plugin-SDK package roots remain
present while retired package roots and registrations stay absent. Add each
package-level retirement to that guard as its removal is completed.
