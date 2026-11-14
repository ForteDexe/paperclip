# Eval coverage and operating costs

Use this with [OPERATIONS.md](OPERATIONS.md). The bounded daily and weekly
selections cover Product E2E only. They do not authorize or cap the separate
Runner protocol workflow, manual matrix runs, or other live probes.

## Initial cadence

The runner E2E maintainers own these selections and their failure triage.
Both profiles use the exact model and limits in the reviewed pricecard.

| Journey | Failure detected | Feature-map association | Cadence |
| --- | --- | --- | --- |
| Native Claude message marker | A real task cannot complete and persist its expected answer through the metered route | `runs-adapters/runs` | Daily and weekly |
| Native Claude complaint and suggestion | Completed tools fail to save attributed feedback or collection loses it | `activity/agent-commentary` | Daily and weekly |
| Native Codex message marker | The corresponding Codex task/connection path fails | `runs-adapters/runs` | Weekly |
| Native Codex complaint and suggestion | The corresponding Codex feedback/tool path fails | `activity/agent-commentary` | Weekly |

These associations identify partial coverage. They do not qualify every run
lifecycle, the Commentary browser page, continuation, or remote execution.
The October 27 qualifications measured one successful attempt per selected cell:
$0.428650100 and 107.286 summed attempt seconds for the daily selection,
$0.793676500 and 158.093 seconds for the weekly selection. Claude ran on
GitHub-hosted Ubuntu; Codex ran in a local Linux ARM64 container. These are
historical gateway estimates from 19 final model request receipts. They include
setup, background and disconnected-client requests with terminal usage. Attempt
time includes setup and teardown, but omits workflow queue/build time and
non-model charges. Provider exports match usage and charges (Claude at one-cent
export precision); final monthly invoices remain pending. The hosted workflow
failed during report dependency setup after both cases passed. Its original
failure, and all earlier failed or interrupted attempts, remain retained.

`scheduled-measurements.json` retains each attempt, source revision, definition,
model, price version, measurement host, final request count, result hash and
journal hashes. `forecast.json` includes that evidence and a snapshot hash.
Historical totals remain separate from samples matching the current definition,
model, environment, runtime, route and pricing. Hosts form separate cohorts;
measurements from different hosts are not pooled into one cell distribution.
The feedback definition's source fingerprint changed after these samples, so
current compatible selection totals remain unknown. No historical hash is
rewritten to match the new definition.

`historicalHostedSelection` records the measured hosted subset only when every
selected cell has hosted evidence. Current `hostedModelUsd` and
`hostedAttemptMs` additionally require matching definitions. The four-case
weekly selection has no complete hosted measurement yet. Summed attempt time
is neither campaign wall time nor billed infrastructure time.

Per-cell mean and median are descriptive. P95 stays unknown below 20 samples
and then uses nearest rank; this is not a statistical confidence guarantee.
Do not sum per-cell percentiles into a campaign percentile. A passing sample
does not predict failure frequency or account for infrastructure, storage,
observability or subscriptions. Forecasts never reduce reservations, approved
budget limits, or qualification gates.

At the October 21, 2026 catalog audit, 47 suites declared 738 cells. `--all`
included 179; the other 559 required explicit selection. The bounded weekly
selection included four cells, and daily two. These are dated inventory counts,
not live acceptance results or an enduring catalog-size contract. Inspect the
current `pnpm test:e2e:runner -- --list` before choosing work. In particular,
Everyday Workflows, provider connections, feedback persistence, interruption,
and case handoffs must not be inferred from a passing `--all` campaign.

The explicit feedback suite also registers native Claude/Codex cells on Daytona.
Their model usage, duration, feedback persistence and cleanup remain unqualified
until retained live attempts prove them. These cells do not enter the daily or
weekly selections, and `--all` continues to exclude the suite.

Keep the broader rotating lane disabled until its exact cells have a metered
route, complete retained attempts, a measured cost/time distribution, and a
budget that includes failures. Prefer targeted continuation, approval, and
cleanup cases that detect different failures over another model running the
same marker. A release lane may broaden coverage only with its own reviewed
manifest; the daily/weekly allowance does not authorize it.

## Adding an eval or changing its cadence

The change's fixture documentation and PR must declare:

- A responsible maintainer/team and the concrete failure the case detects.
- Feature-map capability IDs, or an explicit unmapped gap. State what the
  journey does not exercise within a broader capability.
- Exact suite, case, profiles, models, environment, and intended cadence.
  State whether it is explicit-only and how it differs from existing coverage.
- A deterministic alternative considered, and why paid behavior is necessary.
- Attempt, request, output-token, concurrency, retry, and wall-time limits.
  Include setup, judges, child/background work, and cleanup in the route audit.
- Estimated cost/time before the first run, then all-attempt measurements with
  sample count, retained failures, source/definition IDs, and uncertainty.
  An unmeasured field is unknown, never zero.
- Feedback collection/review, trace verification, missing-receipt handling,
  and a failure/cleanup owner. Novel complaints are reviewed independently
  of the product grade.

Use the existing [Product E2E authoring skill](../../.agents/skills/add-product-e2e-eval/SKILL.md)
or the separate [Runner authoring skill](../../.agents/skills/add-runner-eval/SKILL.md).
Update the existing scheduled selection and forecast only after qualification;
adding a catalog entry alone must not enable recurring spending.

## Reading campaign time

The report's summed attempt time uses every retained accounting receipt,
including failed retries. A missing attempt makes the total unknown; the report
keeps the observed subtotal and missing count. The observed attempt window runs
from the earliest retained start to the latest retained finish. Parallel attempts
overlap in that window, while their individual durations add to the sum. Gaps
between attempts remain in the window. Carried-forward evidence can span older
runs, so this window is not the current workflow's duration.

Agent execution and Daytona lease time remain separate measurements. Attempt
durations include the setup and cleanup inside their recorded boundaries.
New browser-worker results retain a separate phase receipt for fixture setup,
execution, feedback capture, cleanup and worker finalization. Repeated cleanup
segments add together. Atomic checkpoints preserve completed phases if the
worker is interrupted; the active phase has no inferred end time. Parent
recovery checks identity, interval bounds and file size before retaining that
partial receipt. Missing, malformed or unavailable receipts keep phase totals
unknown, while closed segments remain visible as observed subtotals.

These phases start inside the test callback, after browser/server startup, and
end before result publication. Parent teardown/finalization, CI queue/build time
and provider-billed runtime need their own receipts. Historical results and
non-browser launchers without a worker receipt remain explicitly unmeasured.
Test details show each selected attempt's receipt status and raw timing metadata.
Do not infer missing measurements by subtracting summed agent time from the
observed window. Refreshing a report computes these views from retained
results without making provider calls or changing the original measurements.

## Costs outside the model journal

Keep a separate cost component for each resource, with its currency, service,
resource/request identity, source window, allocation basis, and status. Join
components to campaign/attempt IDs where evidence permits. Do not sum a model
estimate with the invoice that later reconciles that same usage.

| Component | Evidence and allocation | When evidence is missing |
| --- | --- | --- |
| Provider models and paid tools | Dedicated project/key usage and billing exports; match provider request IDs or the narrowest available billing window | Preserve estimates, unknown requests, held reservations and the reconciliation difference |
| Daytona | Owned sandbox ID, actual resources, billable lifecycle and provider receipt; include failed creates, retries, stopped storage and delayed deletion | Retain the reservation or an explicitly partial estimate; a requested TTL does not prove deletion |
| CI compute | Workflow/job IDs, runner type, actual billed runtime and invoice rates; include setup, builds and failed jobs | Mark CI cost unknown; a short agent turn does not imply a cheap CI job |
| Storage and transfer | Artifact size, retention window and billed storage/egress | Report the unpriced component, including retained failure evidence |
| Braintrust/gateway usage | Project usage export and its window; distinguish included allowance from incremental overage | Do not treat free-looking trace metrics as proof of zero provider charges |
| Shared subscriptions | Show the existing Braintrust Pro $249/month separately under the October 21 operator policy; allocate newly incurred subscription/capacity charges from invoices with an explicit denominator | Keep new shared charges unallocated rather than assign an invented exact per-test cost |

Retain both the service total and the allocation denominator so allocated
amounts can be reproduced. A zero incremental usage charge can coexist with a
nonzero shared subscription. Never add the entire subscription to every test.
The approved daily/weekly budgets cover additional run costs, so they exclude
the existing $249/month fee while including new usage and capacity charges.
Scheduled admission now reserves the declared CI, storage, observability and
subscription allowances inside the same $20/$100 journal limit. Missing or stale
allowances stop scheduling before the AWS test runner starts. Missing receipts
keep their reservations held. Explicit reviewed full-lifecycle bounds may allow
provisional completion while billing remains pending; missing bounds, conflicts
and overspending still fail. Legacy reservations gain no qualification from the
policy change. This is a local admission
control, not a provider billing cap. Actual resource bounds, cost collection and
reviewed allowances still need qualification before recurrence is enabled; see
[the allowance contract](OPERATIONS.md#recurring-campaigns).

Recurring evidence and reports use private S3 archives with file/byte/request
boundaries, retained transfer receipts and verified access/expiration rules;
see [private recurring history](OPERATIONS.md#private-recurring-history). The
public workflow retains only a content-free availability marker for monitoring.
Public history is a separate explicit publication step. Private retention still
needs hosted OIDC qualification and actual storage/transfer billing evidence;
local archive tests and an infrastructure template do not establish those facts.
