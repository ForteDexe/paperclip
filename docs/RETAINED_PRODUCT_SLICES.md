# Retained Outpost product slices

Outpost is intentionally smaller than the upstream platform it was derived
from. This document is the boundary for dependency-guided cleanup. A package,
route, migration, or test belongs in the product only when it supports one of
the retained slices below or a named shared dependency.

## Product slices

| Slice | User-facing responsibility | Core implementation boundary |
| --- | --- | --- |
| Spaces | Select a repository-scoped working context | Space UI/context, space routes and services, space persistence |
| Agents | Persistent identities, hierarchy, default routing agent, and lifecycle | Agent UI/routes/services, native runtime, Codex and Claude adapters |
| Tasks | Create, delegate, discuss, and complete work | Task and issue UI/routes/services/persistence |
| Decisions | Ask the operator for a choice without transferring task ownership | Decision UI/routes/services/persistence |
| Artifacts | Store task-linked evidence and final results | Artifact UI/routes/services/storage |
| Cases | Group repeated or durable subjects across tasks | Case UI/routes/services/persistence |
| North Stars | Record durable direction for a Space | North Star UI/routes/services/persistence |
| Chat | Direct operator-to-agent conversation | Chat UI/routes, wake/turn orchestration, message persistence |
| Campfire | Optional multi-agent discussion inside a Space | Campfire plugin, plugin SDK/host contracts needed by Campfire |
| Runtime | Run and resume Codex and Claude sessions reliably | Runner, native runtime, ACP/CLI drivers, workspace recovery |

## Retained shared dependencies

- `ui`, `server`, `cli`
- `@outpost/db`, `@outpost/shared`, and `@outpost/adapter-utils`
- `@outpost/outpost-runner`
- `@outpost/adapter-codex-local` and `@outpost/adapter-claude-local`
- `@outpost/plugin-sdk` and `@forted/plugin-campfire`
- MCP/API support required by the Outpost task, decision, artifact, case, and
  North Star skills

Retaining a shared package does not retain every feature inside it. Shared
packages should be narrowed after their unused consumers are removed.

## Removal policy

1. Identify a package or feature with no path to a retained slice.
2. Remove its product code, registration, packaging, and feature-specific tests
   together.
3. Keep generic host/runtime tests by replacing retired product fixtures with a
   neutral fixture.
4. Run the narrow package checks, then repository type checks/build checks.
5. Commit each independently reversible removal.

Historical migrations remain until the active schema is stable enough to be
collapsed into a clean baseline. They are compatibility debt, not evidence that
the retired product surface is still supported.

## Retired packages

- `@outpost/plugin-llm-wiki`: unrelated knowledge-management product removed in
  the first package-scope cleanup.

`scripts/check-retained-product-scope.mjs` prevents retired package roots and
registrations from being reintroduced.
