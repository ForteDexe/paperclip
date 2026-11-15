# Outpost feature map

Start here when reproducing a user-facing bug, verifying a change, or deciding
which surfaces a fix must cover. Each recipe describes what a person can do,
where they can do it, the expected result, and the evidence needed to verify it.
Product behavior is still governed by the code and its tests.

The sibling [agent access map](../agent-access-map/README.md) records APIs,
agent entry points and permission boundaries for the same capability IDs.
Follow the [shared map contract](../README.md) when maintaining either map.

The [chat scenario catalog](../../tests/runner-e2e/chat-scenarios/README.md)
describes how people might request these capabilities in conversation, including
setup and permission branches. These are planned Product E2E journeys, not live
coverage results.

## IDs and references

Use the existing IDs in issues, PRs, Storybook annotations, tests, and verification
evidence:

| Reference | Example | Defined by |
| --- | --- | --- |
| Feature ID | `onboarding` | The recipe filename without `.md`. |
| Capability ID | `onboarding/space` | The feature ID plus a key from its Sub-features list, separated by `/`. |
| Entry-point reference | [onboarding.md#web-wizard](onboarding.md#web-wizard) | The recipe filename plus its entry-point heading. The local entry-point ID is `web-wizard`. |

For example, report verifying `onboarding/space` through `web-wizard`.
Capabilities describe behavior; entry points identify the surface used to exercise
it. Entry-point IDs are separate from generated capability IDs. Both maps and
Storybook use the same full capability IDs. Each child page states its feature
ID; recipe bullets show the full capability ID beside the local key, and access
companions show it beneath the local heading. Local keys remain unchanged for
parsing and existing anchors.

Keep recipe filenames, sub-feature keys, and entry-point keys stable when changing
display titles or navigation. Renaming a filename or key changes its references.
The section headings below are navigation labels, not additional IDs.

## Browse features

Use this index to open a recipe or copy its feature and full capability IDs.

### Getting started and access

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |
| `onboarding` | [Onboarding and first work](onboarding.md) | `onboarding/instance`, `onboarding/space`, `onboarding/adapter`, `onboarding/first-task`, `onboarding/resume` |
| `access` | [Login, invitations, and access](access.md) | `access/login`, `access/invitations`, `access/membership`, `access/resources`, `access/cli-auth` |
| `spaces` | [Spaces and portability](spaces.md) | `spaces/selection`, `spaces/identity`, `spaces/decision-models`, `spaces/prompt-injection-prevention`, `spaces/fast-responses`, `spaces/archive`, `spaces/portability` |

### Tasks and conversations

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |
| `tasks` | [Task creation and lifecycle](tasks.md) | `tasks/create`, `tasks/organize`, `tasks/properties`, `tasks/discussion`, `tasks/completion`, `tasks/privacy` |
| `task-coordination` | [Delegation, dependencies, and signoff](task-coordination.md) | `task-coordination/delegation`, `task-coordination/dependencies`, `task-coordination/signoff`, `task-coordination/tree-control` |
| `inbox-search` | [Inbox, decisions, and search](inbox-search.md) | `inbox-search/views`, `inbox-search/triage`, `inbox-search/decisions`, `inbox-search/search`, `inbox-search/toasts` |
| `agent-chat` | [Agent conversations and project handoff](agent-chat.md) | `agent-chat/discovery`, `agent-chat/history`, `agent-chat/handoff`, `agent-chat/conference-room` |
| `questions-and-approvals` | [Questions and approvals](questions-and-approvals.md) | `questions-and-approvals/questions`, `questions-and-approvals/dismiss-and-reopen`, `questions-and-approvals/confirmations`, `questions-and-approvals/plan-review`, `questions-and-approvals/audience`, `questions-and-approvals/governance`, `questions-and-approvals/tool-review`, `questions-and-approvals/continuation` |
| `steering` | [Steering and queued messages](steering.md) | `steering/queue`, `steering/edit-order-discard`, `steering/steer`, `steering/interrupt`, `steering/stop-and-pause`, `steering/drafts`, `steering/approval-queue` |
| `documents-artifacts` | [Documents, attachments, and work products](documents-artifacts.md) | `documents-artifacts/documents`, `documents-artifacts/annotations`, `documents-artifacts/attachments`, `documents-artifacts/work-products`, `documents-artifacts/library` |

### Agents and reusable capabilities

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |
| `agents` | [Creation, configuration, and coordination](agents.md) | `agents/create`, `agents/instructions`, `agents/coordination`, `agents/default-agent`, `agents/lifecycle`, `agents/built-in`, `agents/api-keys`, `agents/managed-agent-setup` |
| `runs-adapters` | [Runs, harnesses, and model accounts](runs-adapters.md) | `runs-adapters/availability`, `runs-adapters/validation`, `runs-adapters/runs`, `runs-adapters/session` |
| `skills` | [Skills and Skill Studio](skills.md) | `skills/discovery`, `skills/authoring`, `skills/versions`, `skills/policy`, `skills/testing` |

### Projects and execution

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |
| `projects` | [Projects and repositories](projects.md) | `projects/lifecycle`, `projects/task-context`, `projects/repositories`, `projects/defaults`, `projects/privacy` |
| `goals` | [Goals and work alignment](goals.md) | `goals/hierarchy`, `goals/alignment`, `goals/navigation` |
| `workspaces` | [Workspaces, services, and files](workspaces.md) | `workspaces/binding`, `workspaces/provisioning`, `workspaces/services`, `workspaces/files-git`, `workspaces/closure` |
| `execution-environments` | [Execution environments](execution-environments.md) | `execution-environments/configuration`, `execution-environments/capabilities`, `execution-environments/probe`, `execution-environments/assignment`, `execution-environments/images` |
| `recovery` | [Recovery](recovery.md) | `recovery/diagnosis`, `recovery/bounded-continuation`, `recovery/source-action`, `recovery/exhaustion`, `recovery/workspace`, `recovery/unknown-outcome`, `recovery/user-continuation`, `recovery/reconnect` |

### Apps, channels, and extensions

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |

### Automation and structured work

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |
| `routines` | [Routines, schedules, and triggers](routines.md) | `routines/definition`, `routines/triggers`, `routines/run-now`, `routines/history`, `routines/management` |
| `cases` | [Cases](cases.md) | `cases/browse`, `cases/structure`, `cases/history`, `cases/task-links`, `cases/handoffs` |

### Oversight and operation

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |
| `budgets-costs` | [Costs and budgets](budgets-costs.md) | `budgets-costs/cost-reporting`, `budgets-costs/budgets`, `budgets-costs/incidents`, `budgets-costs/resolution`, `budgets-costs/subscriptions`, `budgets-costs/accounting-recovery` |
| `activity` | [Dashboards and audit trails](activity.md) | `activity/overview`, `activity/activity`, `activity/runs`, `activity/routine-audit`, `activity/timeline`, `activity/agent-commentary` |
| `navigation-preferences` | [Navigation, profile, and announcements](navigation-preferences.md) | `navigation-preferences/navigation`, `navigation-preferences/preferences`, `navigation-preferences/profile`, `navigation-preferences/announcements`, `navigation-preferences/fallbacks`, `navigation-preferences/command-palette` |
| `instance-operations` | [Instance operations](instance-operations.md) | `instance-operations/install-update`, `instance-operations/server-service`, `instance-operations/configuration`, `instance-operations/diagnostics`, `instance-operations/backup`, `instance-operations/runtime-setup` |
| `cli-operations` | [CLI/API and local worktrees](cli-operations.md) | `cli-operations/context`, `cli-operations/domain-commands`, `cli-operations/outputs`, `cli-operations/run-controls`, `cli-operations/worktree-instances` |

### Contributor surfaces

| Feature ID | Recipe | Capability IDs |
| --- | --- | --- |
| `developer-labs` | [Developer previews and diagnostic labs](developer-labs.md) | `developer-labs/design`, `developer-labs/interaction-labs`, `developer-labs/performance`, `developer-labs/route-gates` |

Open the [published Storybook guide](https://d1p6rlowie26tp.cloudfront.net/storybook/branches/master/?path=/story/overview-storybook-guide--coverage-guide)
for the assembled feature and capability index. The Markdown recipes in this
directory are the authored source. Each has a same-named agent-access companion.

Run `node scripts/storybook-catalog.mjs` to generate local navigation in
`maps/generated/feature-map.md`, `maps/generated/agent-access-map.md`, and the
Storybook guide. Recipes are discovered automatically from their navigation
metadata; generation does not depend on this high-level index.

## Before driving a journey

1. Use this checkout's [isolated test drive](../../doc/DEVELOPING.md#one-command-isolated-manual-test-drive)
   for manual product checks. It creates a temporary instance and prints its URL
   and data directory. Do not guess that a server on port 3100 belongs to you.
2. Record the commit, URL, space, login role, relevant experimental settings,
   adapter, runtime mode, and live versus simulated dependencies. Use disposable
   tasks and provider resources. A fresh test drive creates a space and CEO,
   but no task or first run.
3. Use the current navigation and space prefix. Paths in recipes omit that
   prefix. Record whether the streamlined or production shell is selected;
   Agent Chat, chat connectors, and the combined Inbox/Tasks view have separate
   gates. A hidden surface is an unmet prerequisite, not a successful test.
4. Run the smallest relevant test first. Vitest commands below run from the
   repository root after installing dependencies. Playwright recipes use their
   named configuration and its isolated environment, not an unrelated running
   instance. Reserve expensive runner/provider tests for the behavior at issue.
5. Exercise the actual user action, inspect its result, reload, and verify the
   persisted state or continuation. Use read-only API checks to corroborate UI
   evidence; creating state through the API does not prove the creation UI.

For agent-driven acceptance work, start with the
[Outpost verification skill](../../.agents/skills/verify-outpost/SKILL.md) for an
isolated launch, ownership/readiness checks, browser driving, evidence, and cleanup.
It uses this directory as its feature map. The existing
[dev-workspace run/verify skill](../../.agents/skills/outpost-dev-workspace-run-verify-fix/SKILL.md)
and [evaluation skill](../../.agents/skills/outpost-evals/SKILL.md) describe runtime
ownership and evidence handling. Reuse them; this map introduces no environment
launcher, credentials, scheduled job, or second test framework.

## Evidence contract

Report each entry point as **passed**, **failed**, **blocked** (with its missing
prerequisite), or **not run**. Include the feature ID, full capability IDs and
entry-point ID (for example, `onboarding/space` through `web-wizard`), plus the
recipe link, commit/environment, user action, expected and observed result,
command/exit code, and evidence links. Screenshots or traces should show both the
action and the discriminating result. Include task/run/request IDs when relevant,
without secrets.

A fix is verified across its affected surfaces only when each has evidence or
an explicit reason it does not apply. Shared code alone does not prove parity.
Keep product regressions visible; do not change the recipe to bless a failure.
For Outpost-assigned work, attach evidence through the
[artifact workflow](../../doc/AGENT-ARTIFACTS.md).

## Inventory and remaining depth

The generated `maps/generated/coverage.json` lists the current non-test TSX page
modules and the recipes that directly reference each one. An unreferenced module
is a documentation candidate, not proof that its feature is absent or untested.
Remaining workflow limits live in each recipe. Inventory and example associations
describe documentation scope, not runtime health.

## Maintaining the reference

The map documents user journeys. It does not execute them automatically;
generated inventories record documentation scope rather than live test health.
Product E2E reports reuse these capability IDs through the
[journey associations](../../tests/runner-e2e/journey-features.ts). Their coverage
view shows which scenarios in a campaign are linked to each capability and the
associated test results. An association or passing scenario does not certify
the whole capability; unselected and unmapped journeys remain distinct.

When maintaining a recipe, compare its entry points and expected results with
the current source. Check that linked tests still exercise the stated behavior
and that local references still exist. Keep the same-named agent access companion
and stable sub-feature IDs aligned when behavior or access changes. Source-only
access inventory remains distinct from live verification. Run
`node scripts/check-maps.mjs` after map edits for structural/reference checks;
follow the shared contract for the source and behavioral checks it cannot perform.

Each recipe starts with a small frontmatter navigation record, then an H1:

```markdown
---
navigation: {"section":"Tasks and conversations","sectionOrder":20,"order":10}
---
```

The H1 supplies the feature title, and the first paragraph supplies its summary.
Orders are local to the section; leave gaps for additions. Equal orders use the
stable filename as a tie-breaker. Keep a section's name/order consistent across
its recipes. Discovery uses the recipe and companion; keep the readable ID index
above aligned when features or capability IDs change.

Optional `### Storybook verification` guidance lives inside the recipe's Gotchas
section. Each level-four heading contains a backtick-quoted capability key and
has `Scope` (`ui`, `cli`, or `browser`),
`Storybook`, `Production`, and `Sources` fields. These are verification instructions
and intentional scope limits, not run results or a required story for every API.
The generated gap report combines this guidance with current story associations.

After frontmatter, each recipe starts with an H1 and a user-visible description, then exactly:

1. **Sub-features** — stable backticked local keys, full capability IDs, and observable behavior/states,
   such as ``- `space`: `onboarding/space` — create a space``.
2. **How to get to it (user POV)** — one H3 backticked entry-point ID per surface.
3. **Driving it with <harness>** — starts with `Preconditions:`; repeat each entry-point H3,
   with `Automated:` and `Manual:` paragraphs. Name test scope and gaps honestly.
4. **Gotchas** — misleading look-alikes, feature gates, and invalid evidence.

New or updated entries follow
[Poteto's feature-map examples](../../.agents/skills/create-verification-skill/references/feature-map-example).
Existing entries with a `Driving it` heading can adopt the named harness when
their recipes are updated. The original format was inspired by
[Omnigent's feature map](https://github.com/omnigent-ai/omnigent/tree/91acfbbb59f6fc210ff95a9e9428aadd62e06582/feature-map).
Outpost's recipes and checks follow its own task model and test infrastructure.
