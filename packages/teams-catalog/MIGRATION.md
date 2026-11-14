# Teams Catalog Notes

This package ships reusable agent crews for Outpost Spaces. The catalog uses
neutral coordination roles: a Space may have a Default agent for routing,
multiple peer root agents, and optional leads or scope owners.

## Bundled entries

- `outpost/bundled/space-defaults/core-crew` provides a Default agent, an
  Engineering Lead, QA, a starter project, and a recurring priority review.
- `outpost/bundled/software-development/product-engineering` provides an
  Engineering Lead, Senior Coder, QA, and a weekly engineering sync.
- `outpost/bundled/product/product-design` provides a Product Designer with
  design-review skills and a weekly review.

## Optional entries

- `outpost/optional/content/content-machine` provides a content lead and a
  weekly content review.
- `outpost/optional/communications/speko-space-phone-agent` provides a phone
  intake agent.

## Catalog policy

- Agent titles are descriptive, not ranks. Reporting links express
  coordination only.
- Adapter choices remain install-time options so operators can select Codex or
  Claude per agent.
- Catalog entries contain Markdown and assets only. Executable setup hooks are
  not bundled.
- The `agentcompanies/v1` schema name is retained because it is the external
  catalog specification, not an Outpost product-boundary term.

Run `pnpm --filter @outpost/teams-catalog validate` and
`pnpm --filter @outpost/teams-catalog test` after catalog changes.
