# Product vocabulary boundary

Outpost has two deliberately separate naming layers.

## Canonical domain model

Internal identifiers are stable contracts. Database columns, API routes, event
codes, protocol fields, and TypeScript model keys keep canonical names such as
`spaceId`, `agentId`, `defaultAgentId`, `operator`, `task`, `decision`,
`artifact`, `case`, `northStar`, and `room`. A visual theme change must not
rename these identifiers.

## Presentation vocabulary

Human-facing product nouns live in
`packages/shared/src/product-vocabulary.ts`. UI, CLI, and server-rendered copy
should use `productLabel()` instead of repeating labels such as “Space”,
“Default agent”, or “North Star”. Each term defines singular, plural, and
lowercase forms. Add a new replaceable noun there first, add its casing tests,
then consume it at presentation boundaries.

Do not use vocabulary helpers to build persistence keys, URLs, API routes,
headers, error codes, telemetry/event names, or protocol identifiers. Stable
machine codes and rendered human messages should remain separate.

## Mechanical checks

- `pnpm terminology:check` rejects retired corporate/Paperclip wording in
  active presentation strings.
- `pnpm terminology:report` lists remaining hardcoded theme-sensitive labels
  so they can be migrated in focused slices.
- Reviewed external identifiers and upstream attribution live in the explicit
  allowlist in `scripts/outpost-visible-terminology.mjs`.

The checker intentionally ignores tests, fixtures, generated files, migrations,
Storybook, and historical archives. Those are migrated separately when their
surface becomes active.
