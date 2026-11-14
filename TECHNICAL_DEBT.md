# Outpost Technical Debt

This document records compatibility code that is intentionally retained after
the Outpost product-surface cleanup. These items are not active product bugs or
current test failures.

## Unsupported agent providers

The product currently exposes only Codex and Claude, but implementation,
schema, and runner packages for older providers still exist for historical
record compatibility.

Do not remove these piecemeal. Revisit them as a deliberate package and schema
migration after deciding whether existing databases must remain readable and
resumable. The migration should include a data audit, explicit handling for old
provider records, package removal, and full runtime validation.

## Coupled runtime and database systems

Routines and schedulers, execution-workspace internals, environment and secret
schemas, and historical migrations remain coupled to agent execution and stored
history. Some corresponding user-facing surfaces have been retired, but that
does not prove the underlying runtime or persistence code is unused.

Before removing any of these systems, map their callers, database relations,
background jobs, and agent-runtime dependencies. Remove them only through a
focused migration with end-to-end agent execution and restart/recovery tests.

## Historical feature maps

Several feature-map documents describe retired surfaces. They are intentionally
kept and updated to identify those surfaces as retired rather than linking to
deleted tests.

Keep these documents while they help explain historical compatibility code and
prevent retired features from being restored accidentally. Archive or remove
them only when the related compatibility code and migrations are also gone.

## Legacy terminology identifiers

Outpost presents **Spaces**, **tasks**, **users/humans**, and a routing-only
**default agent**. The inherited implementation still uses `Paperclip`,
`company`, `project`, `issue`, and `board` in compatibility-critical places:

- published package names and npm scopes such as `@paperclipai/*`;
- `PAPERCLIP_*` environment variables and protocol/header identifiers;
- database tables, columns, enums, historical migrations, and API routes;
- persisted actor kinds such as `board` and adapter kinds such as
  `paperclip_runner`;
- upstream links, attribution, historical plans, fixtures, and feature maps.

Do not globally replace these identifiers. New user-facing and agent-facing
copy must map them to current Outpost terms. Renaming the stored/API contracts
requires a dedicated compatibility migration, aliases for existing clients and
data, and restart/resume validation.

The legacy `paperclip-board` and `paperclip-create-agent` skill identifiers and
the board-chat compatibility route are also retained until their callers and
stored skill assignments can migrate together. They must not be treated as the
current product vocabulary or reintroduced into navigation.

## Revisit condition

Return to this cleanup after the main Outpost workflow and Campfire work
end-to-end. At that point, make each area a separate, reversible migration
rather than combining it with feature development.
