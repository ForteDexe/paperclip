# Chat feature runner tests

`chat-features` promotes explicitly registered scenarios from
[`chat-scenarios/`](chat-scenarios/) into local runner E2E executions. It tests
the retained Outpost product slices; it is not a remote qualification campaign.

## Source of truth

- `chat-catalog-inventory.ts` reads and validates the current YAML catalog.
- `chat-catalog-descriptors.json` contains discovery metadata only.
- `chat-catalog-registry.ts` maps executable scenarios to their implementation.
- `chat-catalog-contract.ts` validates returned grades.
- `chat-catalog-fingerprint.ts` binds the selected scenario, implementation,
  runtime entry points, and relevant production dependencies.

Scenario counts and capability counts are derived from the current catalog.
There is no separately frozen denominator or mutable campaign ledger.

## Execution model

Every executable scenario declares its setup, action, independent observation,
grading, cleanup, run bounds, and timeout bounds. The runner sends the exact
catalog query and retains normalized evidence. Missing checks, contradictory
grades, descriptor drift, or cleanup failures fail closed.

Discovery does not import every domain. Runtime loads only the selected domain
module and rejects differences between the discovered descriptor and the loaded
implementation. Unknown dynamic imports are conservatively included in the
fingerprint closure.

The two original task journeys remain as focused regression cases. Additional
scenarios must belong to one of the retained product slices documented in
[`doc/RETAINED_VERTICAL_SLICES.md`](../../doc/RETAINED_VERTICAL_SLICES.md).

## Local selection

Catalog cases are excluded from broad `--all` runs. Select a case explicitly:

```sh
pnpm test:e2e:runner -- --id <execution-id>
```

Use the catalog and selector tests to verify discovery before attempting a live
case. A listed case or calibrated oracle is not proof that a live run passed.

## Private inputs

Credentials and external references are staged through the reviewed private
input envelope. Fingerprints retain only the declared names and requirements,
not secret values. Raw private input files can be removed after staging without
changing the selected-case identity.

## Browser boundaries

Scenarios that exercise an authentication or installed-product boundary use the
separate browser-boundary flow. Its fingerprint binds the selected live catalog
scenario and executable closure directly. It does not depend on a historical
campaign manifest.

## Historical results

Previously published remote campaign results remain archival evidence only.
They do not define the active catalog, acceptance threshold, retry allowance, or
current product scope.
