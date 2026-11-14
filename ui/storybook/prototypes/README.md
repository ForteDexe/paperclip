# New agent prototype and onboarding connection stories

Run Storybook:

```sh
pnpm --filter @outpost/ui exec storybook dev --port 6010 --host 127.0.0.1 --no-open -c storybook/.storybook
```

## Connector catalog chips

**Apps → Catalog source selection → Chips** is the focused catalog preview.
The five text chips are **Outpost**, **Composio**, **Arcade**, **Installed**, and **All**.
The selected chip has a neutral pill background; the other choices are plain text.
Connected accounts stay above discovery. Installed shows only saved native and
Composio apps. All includes every catalog source, including Arcade. Searching
from Outpost includes aggregator apps; choosing a chip explicitly scopes the
search. Clearing that automatic global search returns to Outpost, while
explicit All or Installed selections remain selected.

Stories cover each chip, global and installed-account search, empty results,
native precedence, and mobile. **Switch filters and search** exercises selection,
pagination, installed-only results, and search. The superseded dropdown, sidebar,
and provider-overview explorations have been removed.

These remain design fixtures, not changes to the production Apps page. They use
shipped `ConnectorCard`, representative native entries, public aggregator catalogs
with native duplicates omitted, and example saved accounts. Eight entries per page
keep review compact; the page-size control also offers 24. Setup and account
mutations are outside this preview.

## Existing onboarding

**Onboarding → Agent arc** is a historical design fixture. Outpost no longer
ships provider sign-in onboarding; users authenticate Codex or Claude in their
own CLI before creating an agent.

**Onboarding → Connect a model** remains the older tile/mode design preview, not
the shipped flow. Use Agent arc to inspect current onboarding behavior.

## New agent

**Onboarding → New agent → Start here · Interactive flow** starts with naming the
agent, selecting an adapter, and simulated creation. Claude and Codex then walk
through Connect → Configure → Confirmation. Other adapters go straight to
configuration. No working directory, instructions, advanced settings, role,
permissions, or scheduling steps are shown.

Current production creation offers only the local Codex and Claude adapters. The
adapter stays fixed after creation and uses the provider's existing CLI login.

**06 · Confirmation** and **Confirmation · Native Codex runner** expose the final
screen directly. Finish setup reaches that screen interactively; Edit configuration
preserves the choices, and Start over clears them.

These stories remain isolated design fixtures. The production implementation
lives in `ui/src/components/new-agent/` and uses local CLI authentication.

## Configuration checks and task assignment

The numbered sidebar shows Connect (where supported), Configure, and Confirmation.
Model and thinking-effort labels use the same `Field` component; their controls
share padding, line height, and border sizing. Environment has one section label.

**Test** invokes the existing `agentsApi.testEnvironment` client with the selected
adapter, model, effort, runner provider, and environment. Story-scoped fetch
fixtures return the configured result after a short delay, and `RuntimeTestCard` presents the result in a shared neutral surface. Each state
has one status icon, a short summary, and an action in the same position.
Individual checks and remediation hints remain available under **Test details**. These are simulated runtime probes;
no provider process runs. The **Test · Succeeded**, **Failed**, **Running**, and
**Retry after failure** stories expose each state. Storybook controls choose the
outcome and latency. A failed test prevents finishing until settings change or a
retry succeeds. Changing settings clears stale results; leaving the story or
starting over invalidates pending responses.

**Assign <agentName> a Task** opens the shipped `NewIssueDialog` with this story’s
agent ID as assignee. A scoped agent fixture provides the matching display name.
Task submission is also intercepted locally and displays a confirmation without
persisting a real issue. Fixture overrides and the temporary agent cache entry
are cleaned up on unmount.


## Full agent configuration review

**Agents / Configuration refresh** is a historical fixture. Production retains
the local Codex/Claude runtime and core agent settings; Skills, managed secrets,
and provider-connection management are no longer product surfaces.

This preview composes historical configuration surfaces and must not be treated
as the current route contract.

The remaining mutable fixtures are historical design references only. They do
not define which production settings Outpost supports.

The configuration header uses the onboarding `PillGuy` avatar and omits the
manual heartbeat action and status badge. Routine next-run notices are omitted in
this review layout.
