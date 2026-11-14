---
navigation: {"section":"Getting started and access","sectionOrder":10,"order":30}
---

# Spaces and portability

An operator can switch between spaces, change their identity and settings, archive them, and preview an import or export. Each space remains a separate scope for work and agents.

Feature ID: `spaces`.

Implementation: [spaces](../../ui/src/pages/Spaces.tsx), [settings](../../ui/src/pages/SpaceSettings.tsx). Historical portability compatibility remains available through the CLI and server APIs, but is not exposed in the Outpost UI.

Agent access: [companion](../agent-access-map/spaces.md).

## Sub-features

- `selection`: `spaces/selection` — create/select a space and keep navigation in its scope.
- `identity`: `spaces/identity` — update space identity and configured settings.
- `decision-models`: `spaces/decision-models` — configure and test the space's decision model, then inspect invocation history and recorded usage.
- `prompt-injection-prevention`: `spaces/prompt-injection-prevention` — opt into a shared OpenRouter classifier for existing tool-result guards, test fixed samples, and recover unavailable selections.
- `fast-responses`: `spaces/fast-responses` — configure and test the experimental fast-response service, then inspect acknowledgement history, failures, and recorded usage.
- `archive`: `spaces/archive` — archive and restore through the available controls without confusing archival with deletion.
- `portability`: `spaces/portability` — preview a space package and inspect imported agents, projects, skills, and conflicts.

## How to get to it (user POV)

### `space-switcher`

Use the space switcher or `/spaces`, then enter space Settings.

### `package-transfer`

Use `/space/export` and `/space/import` where enabled, or the corresponding CLI space commands.

### `space-ai-services`

There is no user-facing shared-connection configuration surface. Open the Decisions
and Fast responses tabs in Costs to inspect retained invocation history.

## Driving it with Playwright and the Outpost CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Use two disposable spaces and a small package fixture. Record cloud-managed restrictions and visible settings gates.

### `space-switcher`

Automated: [Space list](../../ui/src/pages/Spaces.test.tsx) covers the retained UI behavior with mocks. The archive UI is retired.

Manual: Create or select a space, rename it, and reload. Switch to the second space and back; verify tasks, agents, and settings follow the selection. Archive the disposable space and verify its visibility and offered restoration path.

### `package-transfer`

Automated: [portability routes](../../server/src/__tests__/space-portability-routes.test.ts) and [CLI import/export](../../cli/src/__tests__/space-import-export-e2e.test.ts) cover package and command behavior, not every external Git host.

Manual: Export a small space, inspect the package preview, and import into a disposable target. Verify counts, references, conflict choices, and agent configuration. Run one imported task after supplying its required local credentials. Confirm source space data is unchanged.

### `space-ai-services`

Automated: [decision history](../../ui/src/components/decision-models/DecisionHistory.test.tsx),
[decision service](../../server/src/__tests__/decision-models.test.ts), and
[fast-response service](../../server/src/__tests__/fast-responses.test.ts) cover
history and service contracts with simulated providers.

Manual: Inspect retained success and failure receipts in Costs. Shared provider
configuration and model tests are intentionally unavailable in Outpost.

## Gotchas

- Restore an archived space through `/spaces` → its menu → **Unarchive**.
  Archiving pauses eligible agents and cancels active runs; restoration handles
  agents paused specifically for space archival.

- Package presence does not prove a runnable imported space; credentials and environment bindings need separate verification.
- Space deletion is a distinct gated operation; do not use it as the archive test.
- Settings hidden in a managed deployment should be recorded as unavailable, not bypassed.
- A fast-response receipt is an acknowledgement, not completed agent work. Task
  links in retained history still require access to the underlying task.

### Storybook verification

#### `selection`

Capability ID: `spaces/selection`.

Scope: ui
Storybook: Space list/create/switcher; empty, loading, error, unavailable space and switched navigation.
Production: Switch and reload between spaces; verify tasks/agents/cache/routes remain scoped and unauthorized space requests fail.
Sources: Source: [Spaces.tsx](../../ui/src/pages/Spaces.tsx), [SpaceSwitcher.tsx](../../ui/src/components/SpaceSwitcher.tsx), [SpaceContext.tsx](../../ui/src/context/SpaceContext.tsx). Tests: [Spaces.test.tsx](../../ui/src/pages/Spaces.test.tsx), [SpaceContext.test.tsx](../../ui/src/context/SpaceContext.test.tsx), [spaces-route-cross-space-authz.test.ts](../../server/src/__tests__/spaces-route-cross-space-authz.test.ts)

#### `archive`

Capability ID: `spaces/archive`.

Scope: ui
Storybook: Archive confirmation, pending/error and departure navigation; archived list entry and Unarchive action.
Production: Archive eligible agents/runs without deleting history; restoration handles archival-specific pause and navigates to correct space.
Sources: [SpaceSettings.tsx](../../ui/src/pages/SpaceSettings.tsx), [Spaces.tsx](../../ui/src/pages/Spaces.tsx), [spaces.ts](../../ui/src/api/spaces.ts). Tests: [Spaces.test.tsx](../../ui/src/pages/Spaces.test.tsx), [spaces-service.test.ts](../../server/src/__tests__/spaces-service.test.ts)

#### `portability`

Capability ID: `spaces/portability`.

Scope: ui
Storybook: Import/export preview, conflict choice, warnings, async progress/failure/success and restricted managed deployment.
Production: Apply real small package to disposable target; inspect counts/references/conflicts, source immutability and credential exclusions; imported task requires separate runnable-account proof.
Sources: Source: [spaces.ts](../../ui/src/api/spaces.ts). Tests: [space-portability-routes.test.ts](../../server/src/__tests__/space-portability-routes.test.ts), [space-import-export-e2e.test.ts](../../cli/src/__tests__/space-import-export-e2e.test.ts)

### Documentation scope: Space and instance administration

Core administration/import/export/operator workflows are mapped; cloud/self-hosted differences, migration/restore compatibility, and platform-specific service variants need deeper recipes.

### `prompt-injection-prevention`

Capability ID: `spaces/prompt-injection-prevention`.

Scope: api, runtime
Automated: [service](../../server/src/__tests__/prompt-injection-prevention.test.ts),
[gateway](../../server/src/__tests__/prompt-injection-gateway.test.ts),
[guards](../../server/src/__tests__/tool-content-guards.test.ts) including redaction
that hides content still delivered under the existing return contract.
Manual: Verify benign code reaches a gateway caller, malicious instructions are blocked,
and provider failure records regex fallback. There is no user-facing connection setup.
Root results with concealed instruction text use `input_redaction_mismatch`
fallback without model dispatch.
