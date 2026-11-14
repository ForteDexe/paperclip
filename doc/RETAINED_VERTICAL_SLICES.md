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
